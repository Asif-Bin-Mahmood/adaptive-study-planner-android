import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqlJsDriver } from '../src/data/sqljsDriver';
import { DowngradeError, Repo } from '../src/data/repo';
import { MIGRATIONS } from '../src/data/schema';
import { validateBackup } from '../src/data/backup';
import { defaultRules } from '../src/domain/rules';
import { T, demoTerm, makeRepo, seededRepo, sqljs } from './helpers';


describe('8. migration of stored data', () => {
  it('upgrades a version-1 database without losing records and keeps a pre-migration snapshot', async () => {
    const driver = await SqlJsDriver.create(await sqljs());
    await driver.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
    for (const st of MIGRATIONS[0].statements) await driver.exec(st);
    await driver.run("INSERT INTO meta VALUES ('schema_version','1')");
    await driver.run(
      "INSERT INTO terms VALUES ('t1','Old term',NULL,NULL,'2030-01-03','2030-05-02','archived','UTC',?,'x','x')",
      [JSON.stringify(defaultRules())],
    );
    await driver.run("INSERT INTO sessions (id, term_id, date, duration_min, title, kind, tier, status, origin, created_at, updated_at) VALUES ('s1','t1','2030-02-03',60,'Old block','deep','core','done','manual','x','x')");
    const repo = new Repo(driver);
    const res = await repo.init();
    expect(res).toEqual({ from: 1, to: 2 });
    const s = await repo.getSession('s1');
    expect(s?.status).toBe('done');
    expect(s?.reason).toBeNull();
    expect(await repo.getMeta('pre_migration_backup')).toContain('Old block');
    expect((await repo.init()).from).toBe(2); // idempotent
  });
  it('refuses to open a database from a newer app version and changes nothing', async () => {
    const driver = await SqlJsDriver.create(await sqljs());
    await driver.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('schema_version','99');");
    await expect(new Repo(driver).init()).rejects.toBeInstanceOf(DowngradeError);
    expect(await driver.all("SELECT name FROM sqlite_master WHERE name='terms'")).toEqual([]);
  });
});

describe('9-10. backup export, restore, and invalid backup rejection', () => {
  async function withData() {
    const r = await seededRepo();
    await r.repo.ensureSessions(T, '2030-10-20', '2030-10-26');
    const s = (await r.repo.listSessions(T, '2030-10-20', '2030-10-20'))[0];
    await r.repo.setSessionStatus(s.id, 'partial', { outputNote: 'half the set' });
    await r.repo.saveCheckIn({ date: '2030-10-20', sleepHours: 7.5, concentration: 4 });
    const rules = (await r.repo.getTerm(T))!.rules;
    await r.repo.saveTimedSet({ termId: T, workstreamId: `${T}:alg`, sessionId: s.id, date: '2030-10-20', topic: 'Scheduling', attempted: 8, correct: 6, minutes: 40, targetMinutes: 45, notes: null });
    await r.repo.addError({ termId: T, workstreamId: `${T}:alg`, timedSetId: null, date: '2030-10-20', question: 'Q2', category: 'Execution error', cause: 'rushed', correctionRule: 'check units', similarRef: null }, rules);
    return r;
  }

  it('exports a valid versioned file that restores every record into a fresh install', async () => {
    const { repo } = await withData();
    const backup = await repo.exportBackup();
    const json = JSON.stringify(backup);
    expect(validateBackup(JSON.parse(json)).ok).toBe(true);
    const fresh = await makeRepo();
    const res = await fresh.repo.restoreBackup(JSON.parse(json));
    expect(res).toEqual({ ok: true });
    expect(await fresh.repo.counts()).toEqual(await repo.counts());
    expect(await fresh.repo.activeTermId()).toBe(T);
    expect((await fresh.repo.getCheckIn('2030-10-20'))?.sleepHours).toBe(7.5);
    // the package is not imported again after restoring
    expect(await fresh.repo.isPackageImported(T)).toBe(true);
    // and the previous (empty) state can be brought back
    expect((await fresh.repo.undoLastImport()).ok).toBe(true);
    expect((await fresh.repo.counts()).terms).toBe(0);
  });

  it('rejects invalid backups without touching existing data', async () => {
    const { repo } = await withData();
    const before = await repo.counts();
    const good = await repo.exportBackup();
    const cases: unknown[] = [
      null,
      { format: 'something-else' },
      { ...good, schemaVersion: 99 },
      { ...good, tables: { ...good.tables, sessions: undefined } },
      { ...good, tables: { ...good.tables, sessions: [{ ...good.tables.sessions[0], status: 'finished' }] } },
      { ...good, tables: { ...good.tables, retests: [{ ...good.tables.retests[0], error_id: 'missing' }] } },
      { ...good, tables: { ...good.tables, checkins: [{ ...good.tables.checkins[0], date: '2026-02-30' }] } },
    ];
    for (const c of cases) {
      const res = await repo.restoreBackup(c);
      expect(res.ok).toBe(false);
    }
    expect(await repo.counts()).toEqual(before);
  });

  it('rolls back completely if a restore fails part-way', async () => {
    const { repo, driver } = await withData();
    const before = await repo.counts();
    const good = await repo.exportBackup();
    const orig = driver.run.bind(driver);
    let n = 0;
    driver.run = async (sql, params) => {
      if (sql.startsWith('INSERT INTO sessions') && ++n === 5) throw new Error('disk full');
      return orig(sql, params);
    };
    await expect(repo.restoreBackup(good)).rejects.toThrow('disk full');
    driver.run = orig;
    expect(await repo.counts()).toEqual(before);
  });

  it('upgrades and restores a backup written by schema version 1', async () => {
    const { repo } = await withData();
    const b = await repo.exportBackup();
    const v1 = { ...b, schemaVersion: 1, tables: { ...b.tables, sessions: b.tables.sessions.map(({ reason: _r, ...rest }) => rest) } };
    const fresh = await makeRepo();
    expect(await fresh.repo.restoreBackup(JSON.parse(JSON.stringify(v1)))).toEqual({ ok: true });
    expect((await fresh.repo.counts()).sessions).toBe(b.tables.sessions.length);
  });
});

describe('6-7. semester creation, switching, archiving (no source changes)', () => {
  it('creates a different semester from data, switches to it, and keeps the earlier semester history intact', async () => {
    const { repo } = await seededRepo();
    await repo.ensureSessions(T, '2030-10-20', '2030-10-26');
    const s = (await repo.listSessions(T, '2030-10-20', '2030-10-20'))[0];
    await repo.setSessionStatus(s.id, 'done');

    const spring = await repo.cloneTerm(T, { name: 'Spring 2031', institution: null, academicYear: null, startDate: '2031-02-03', endDate: '2031-06-01', timezone: 'UTC', rules: defaultRules() }, { copyRules: true, copyLongTermWorkstreams: true });
    const ws = await repo.listWorkstreams(spring);
    // reusable workstreams copied, courses not
    expect(ws.some((w) => w.type === 'course')).toBe(false);
    expect(ws.some((w) => w.name === 'Course project')).toBe(true);
    expect(await repo.listAssessments(spring)).toEqual([]);
    expect(await repo.listCommitments(spring)).toEqual([]);
    const springTerm = (await repo.getTerm(spring))!;
    expect(springTerm.rules.trial).toEqual({ start: null, end: null });
    expect(springTerm.rules.optional.enabled).toBe(false);

    const net210 = await repo.createWorkstream({ termId: spring, type: 'course', code: 'NET210', name: 'Computer Networks', color: '#333', priority: 2, deadline: null, minWeeklyMinutes: 60, targetWeeklyMinutes: 90, extensionWeeklyMinutes: 0, floorRule: null, archived: false, notes: null });
    const cls = await repo.saveCommitment({ termId: spring, workstreamId: net210, kind: 'class', title: 'NET210 lecture', location: null, weekdays: [1, 3], startTime: '09:30', endTime: '10:50', validFrom: '2031-02-03', validTo: '2031-05-22' });
    await repo.saveAssessment({ termId: spring, workstreamId: net210, kind: 'midterm', title: 'NET210 midterm', date: '2031-03-22', startTime: '10:00', endTime: '12:00', confirmed: true, notes: null });
    await repo.saveTemplate({ termId: spring, workstreamId: net210, title: 'NET210 timed set', output: null, kind: 'timed_set', weekday: 4, startTime: '08:00', durationMin: 60, tier: 'core', active: true, validFrom: '2031-02-03', validTo: '2031-05-22', dependsOnCommitmentId: null, dependsOnWeekday: null }, '2031-02-03');
    void cls;
    await repo.setActiveTerm(spring);
    await repo.setTermStatus(T, 'archived');
    await repo.ensureSessions(spring, '2031-02-03', '2031-02-09');
    expect((await repo.listSessions(spring, '2031-02-03', '2031-02-09')).map((x) => x.title)).toEqual(['NET210 timed set']);

    expect(await repo.activeTermId()).toBe(spring);
    const old = await repo.getTerm(T);
    expect(old?.status).toBe('archived');
    expect((await repo.getSession(s.id))?.status).toBe('done');
    expect((await repo.listAssessments(T)).length).toBe(6);
    // restore the archived term
    await repo.setTermStatus(T, 'upcoming');
    await repo.setActiveTerm(T);
    expect(await repo.activeTermId()).toBe(T);
  });

  it('supports a short summer term with no labs, several research projects and a custom project', async () => {
    const { repo } = await makeRepo();
    const id = await repo.createTerm({ name: 'Summer 2031', institution: null, academicYear: null, startDate: '2031-06-03', endDate: '2031-08-17', timezone: 'UTC', rules: { ...defaultRules(), weekStartsOn: 6 } });
    const course = await repo.createWorkstream({ termId: id, type: 'course', code: 'MAT361', name: 'MAT361', color: '#111', priority: 2, deadline: null, minWeeklyMinutes: 60, targetWeeklyMinutes: 120, extensionWeeklyMinutes: 0, floorRule: null, archived: false, notes: null });
    for (const n of ['Paper A', 'Paper B', 'Paper C']) {
      await repo.createWorkstream({ termId: id, type: 'research', code: null, name: n, color: '#111', priority: 3, deadline: '2031-08-03', minWeeklyMinutes: 30, targetWeeklyMinutes: 60, extensionWeeklyMinutes: 0, floorRule: null, archived: false, notes: null });
    }
    await repo.createWorkstream({ termId: null, type: 'project', code: null, name: 'Home lab server', color: '#111', priority: 4, deadline: null, minWeeklyMinutes: 0, targetWeeklyMinutes: 60, extensionWeeklyMinutes: 0, floorRule: null, archived: false, notes: null });
    const ws = await repo.listWorkstreams(id);
    expect(ws.filter((w) => w.type === 'research')).toHaveLength(3);
    expect(ws.filter((w) => w.type === 'lab')).toHaveLength(0);
    expect(ws.some((w) => w.name === 'Home lab server' && w.termId === null)).toBe(true);
    expect(course).toBeTruthy();
    await expect(repo.createTerm({ name: '', institution: null, academicYear: null, startDate: '2031-06-03', endDate: '2031-05-03', timezone: 'UTC', rules: defaultRules() })).rejects.toThrow();
  });
});

describe('14-15. offline operation and persistence after force-close', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs the full daily workflow with every network API disabled', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', class { constructor() { throw new Error('offline'); } });
    const { repo } = await seededRepo();
    await repo.ensureSessions(T, '2030-10-20', '2030-10-26');
    const [s] = await repo.listSessions(T, '2030-10-21', '2030-10-21');
    await repo.setSessionStatus(s.id, 'done');
    await repo.saveCheckIn({ date: '2030-10-21', sleepHours: 7, concentration: 3 });
    await repo.exportBackup();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps logged data after the process is killed and the database file reopened', async () => {
    const { repo, driver } = await seededRepo();
    await repo.ensureSessions(T, '2030-10-20', '2030-10-26');
    const [s] = await repo.listSessions(T, '2030-10-21', '2030-10-21');
    await repo.setSessionStatus(s.id, 'partial', { actualMinutes: 20 });
    await repo.saveCheckIn({ date: '2030-10-21', sleepHours: 6.5, concentration: 2 });
    const file = driver.export(); // what is on disk at the moment of the kill
    const reopened = await makeRepo(file);
    expect((await reopened.repo.getSession(s.id))?.status).toBe('partial');
    expect((await reopened.repo.getCheckIn('2030-10-21'))?.sleepHours).toBe(6.5);
    expect(await reopened.repo.activeTermId()).toBe(T);
    expect(await reopened.repo.importTermPackage(demoTerm, { makeActive: true })).toEqual({ termId: T, imported: false });
  });
});
