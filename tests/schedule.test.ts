import { describe, expect, it } from 'vitest';
import { validateTermPackage } from '../src/data/termPackage';
import { findConflicts, occurrencesOn } from '../src/domain/schedule';
import { T, demoTerm, makeRepo, seededRepo } from './helpers';

describe('semester package import (synthetic demo term)', () => {
  it('validates and keeps the template totals (635 core + 120 optional minutes)', () => {
    expect(validateTermPackage(demoTerm)).toEqual([]);
    const core = demoTerm.templates!.filter((t) => t.tier === 'core').reduce((a, t) => a + t.durationMin, 0);
    const opt = demoTerm.templates!.filter((t) => t.tier === 'optional').reduce((a, t) => a + t.durationMin, 0);
    expect(core).toBe(635);
    expect(opt).toBe(120);
    expect(demoTerm.workstreams!.filter((w) => w.type === 'course')).toHaveLength(3);
    expect(demoTerm.commitments!.filter((c) => c.kind === 'lab')).toHaveLength(1);
    expect(demoTerm.assessments).toHaveLength(6);
  });

  it('starts with every optional block disabled and the trial set from the package', async () => {
    const { repo } = await seededRepo();
    const t = (await repo.getTerm(T))!;
    expect(t.rules.trial).toEqual({ start: '2030-10-20', end: '2030-11-02' });
    expect(t.rules.optional.enabled).toBe(false);
    const tpl = await repo.listTemplates(t.id);
    expect(tpl.filter((x) => x.tier === 'optional').every((x) => !x.active)).toBe(true);
  });

  it('rejects a package with broken references', () => {
    const bad = { ...demoTerm, templates: [{ ...demoTerm.templates![0], workstream: 'missing' }] };
    expect(validateTermPackage(bad).length).toBeGreaterThan(0);
  });
});

describe('11. duplicate prevention during import', () => {
  it('importing twice and regenerating sessions twice never duplicates', async () => {
    const { repo, driver } = await seededRepo();
    const again = await repo.importTermPackage(demoTerm, { makeActive: true });
    expect(again.imported).toBe(false);
    await repo.ensureSessions(T, '2030-10-20', '2030-11-02');
    await repo.ensureSessions(T, '2030-10-20', '2030-11-02');
    const before = await repo.counts();
    // simulate an app restart on the same database file
    const reopened = await makeRepo(driver.export());
    await reopened.repo.importTermPackage(demoTerm, { makeActive: true });
    await reopened.repo.ensureSessions(T, '2030-10-20', '2030-11-02');
    expect(await reopened.repo.counts()).toEqual(before);
    expect((await repo.listTerms()).length).toBe(1);
  });
});

describe('4. holidays and cancelled sessions', () => {
  it('holiday week: the four class-dependent blocks on Tue-Wed are not scheduled, and never counted as missed', async () => {
    const { repo } = await seededRepo();
    await repo.ensureSessions(T, '2030-10-20', '2030-10-26');
    const week = await repo.listSessions(T, '2030-10-20', '2030-10-26');
    const cancelled = week.filter((s) => s.status === 'cancelled').map((s) => `${s.date} ${s.title}`);
    expect(cancelled.sort()).toEqual([
      '2030-10-22 PHY110L pre-lab',
      '2030-10-22 Same-day recall: ALG101, PHY110',
      '2030-10-23 PHY110L lab log',
      '2030-10-23 STA120 recall',
    ]);
    expect(week.filter((s) => s.tier === 'core' && s.status === 'planned')).toHaveLength(10);
    expect(week.filter((s) => s.tier === 'optional')).toHaveLength(0);
    // Tuesday's timed set is not tied to a class and still happens
    expect(week.find((s) => s.date === '2030-10-22' && s.title === 'PHY110 timed set')?.status).toBe('planned');
  });

  it('removes holiday classes and a single cancelled class from the fixed timetable', async () => {
    const { repo } = await seededRepo();
    const [c, ch, ex] = await Promise.all([repo.listCommitments(T), repo.listChanges(T), repo.listExceptions(T)]);
    expect(occurrencesOn('2030-10-22', c, ch, ex)).toHaveLength(0);
    expect(occurrencesOn('2030-12-25', c, ch, ex)).toHaveLength(0);
    expect(occurrencesOn('2030-11-27', c, ch, ex).map((o) => o.commitment.title)).toEqual(['PHY110L lab']);
    expect(occurrencesOn('2030-11-20', c, ch, ex).map((o) => o.commitment.title)).toEqual(['STA120 lecture', 'PHY110L lab']);
  });

  it('a class cancelled later turns its dependent recall into "not scheduled"', async () => {
    const { repo } = await seededRepo();
    await repo.ensureSessions(T, '2030-11-03', '2030-11-09');
    await repo.addChange({ commitmentId: `${T}:cALG`, date: '2030-11-03', kind: 'cancelled', startTime: null, endTime: null, reason: 'Instructor away' });
    const s = await repo.listSessions(T, '2030-11-03', '2030-11-03');
    expect(s.find((x) => x.title.startsWith('Same-day recall'))?.status).toBe('cancelled');
  });

  it('exam-day plans replace the weekly template on override days', async () => {
    const { repo } = await seededRepo();
    await repo.ensureSessions(T, '2030-11-25', '2030-11-25');
    const s = await repo.listSessions(T, '2030-11-25', '2030-11-25');
    expect(s.map((x) => x.title)).toEqual(['ALG101 error-log retest (no new material)', 'PHY110 light review for tomorrow']);
  });
});

describe('5. examination conflicts', () => {
  it('detects overlaps with exams, classes, other blocks and sleep before saving', async () => {
    const { repo } = await seededRepo();
    const term = (await repo.getTerm(T))!;
    const [c, ch, ex, as] = await Promise.all([repo.listCommitments(T), repo.listChanges(T), repo.listExceptions(T), repo.listAssessments(T)]);
    const day = '2030-11-25';
    const ctx = { occurrences: occurrencesOn(day, c, ch, ex), assessments: as, sessions: [], rules: term.rules, exceptions: [] };
    expect(findConflicts({ date: day, startTime: '16:00', durationMin: 60 }, ctx).some((x) => x.includes('ALG101 midterm'))).toBe(true);
    expect(findConflicts({ date: day, startTime: '09:30', durationMin: 30 }, ctx).some((x) => x.includes('STA120 lecture'))).toBe(true);
    expect(findConflicts({ date: day, startTime: '22:30', durationMin: 30 }, ctx).some((x) => x.includes('sleep'))).toBe(true);
    expect(findConflicts({ date: day, startTime: '19:30', durationMin: 60 }, ctx)).toEqual([]);
  });
});
