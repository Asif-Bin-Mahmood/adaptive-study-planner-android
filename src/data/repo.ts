// Repository: the only place that knows SQL. UI and rules talk to this class.
import { addDays, isISODate, startOfWeek } from '../domain/dates';
import { version as packageVersion } from '../../package.json';
import { draftSessions } from '../domain/schedule';
import { normalizeRules, validateRules } from '../domain/rules';
import { buildRetests, errorStatusAfter, followUpRetest } from '../domain/retest';
import type { Action, Proposal } from '../domain/replan';
import type {
  Assessment,
  CheckIn,
  Commitment,
  CommitmentChange,
  DateException,
  ErrorEntry,
  ISODate,
  PlanningRules,
  Retest,
  RetestOutcome,
  ReviewDecision,
  ScheduleChange,
  Session,
  SessionStatus,
  StudyTemplate,
  Term,
  TimedSet,
  WeeklyReview,
  Workstream,
} from '../domain/types';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, validateBackup, type BackupFile, type Row } from './backup';
import { TxRunner, type SqlDriver, type SqlValue } from './driver';
import { BACKUP_TABLES, LATEST_VERSION, MIGRATIONS } from './schema';

export const APP_VERSION: string = packageVersion;

export class DowngradeError extends Error {}

let idCounter = 0;
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  idCounter++;
  return `id-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

const nowIso = () => new Date().toISOString();
const b = (v: boolean) => (v ? 1 : 0);
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));

// ---------- row mappers ----------
function toTerm(r: Row): Term {
  return {
    id: String(r.id),
    name: String(r.name),
    institution: s(r.institution),
    academicYear: s(r.academic_year),
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    status: r.status as Term['status'],
    timezone: String(r.timezone),
    rules: normalizeRules(JSON.parse(String(r.rules_json))),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
function toException(r: Row): DateException {
  return {
    id: String(r.id),
    termId: String(r.term_id),
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    name: String(r.name),
    kind: r.kind as DateException['kind'],
    cancelsClasses: !!r.cancels_classes,
    suppressesStudy: !!r.suppresses_study,
  };
}
function toWorkstream(r: Row): Workstream {
  return {
    id: String(r.id),
    termId: s(r.term_id),
    type: r.type as Workstream['type'],
    code: s(r.code),
    name: String(r.name),
    color: String(r.color),
    priority: Number(r.priority),
    deadline: s(r.deadline),
    minWeeklyMinutes: Number(r.min_weekly_minutes),
    targetWeeklyMinutes: Number(r.target_weekly_minutes),
    extensionWeeklyMinutes: Number(r.extension_weekly_minutes),
    floorRule: s(r.floor_rule),
    archived: !!r.archived,
    notes: s(r.notes),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
function toCommitment(r: Row): Commitment {
  return {
    id: String(r.id),
    termId: String(r.term_id),
    workstreamId: s(r.workstream_id),
    kind: r.kind as Commitment['kind'],
    title: String(r.title),
    location: s(r.location),
    weekdays: String(r.weekdays)
      .split(',')
      .filter((x) => x !== '')
      .map(Number),
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    validFrom: String(r.valid_from),
    validTo: String(r.valid_to),
  };
}
function toChange(r: Row): CommitmentChange {
  return {
    id: String(r.id),
    commitmentId: String(r.commitment_id),
    date: String(r.date),
    kind: r.kind as CommitmentChange['kind'],
    startTime: s(r.start_time),
    endTime: s(r.end_time),
    reason: s(r.reason),
  };
}
function toAssessment(r: Row): Assessment {
  return {
    id: String(r.id),
    termId: String(r.term_id),
    workstreamId: s(r.workstream_id),
    kind: r.kind as Assessment['kind'],
    title: String(r.title),
    date: String(r.date),
    startTime: s(r.start_time),
    endTime: s(r.end_time),
    confirmed: !!r.confirmed,
    notes: s(r.notes),
  };
}
function toTemplate(r: Row): StudyTemplate {
  return {
    id: String(r.id),
    termId: String(r.term_id),
    workstreamId: s(r.workstream_id),
    title: String(r.title),
    output: s(r.output),
    kind: r.kind as StudyTemplate['kind'],
    weekday: Number(r.weekday),
    startTime: String(r.start_time),
    durationMin: Number(r.duration_min),
    tier: r.tier as StudyTemplate['tier'],
    active: !!r.active,
    validFrom: String(r.valid_from),
    validTo: String(r.valid_to),
    dependsOnCommitmentId: s(r.depends_on_commitment_id),
    dependsOnWeekday: n(r.depends_on_weekday),
  };
}
function toSession(r: Row): Session {
  return {
    id: String(r.id),
    termId: String(r.term_id),
    workstreamId: s(r.workstream_id),
    templateId: s(r.template_id),
    assessmentId: s(r.assessment_id),
    date: String(r.date),
    startTime: s(r.start_time),
    durationMin: Number(r.duration_min),
    title: String(r.title),
    output: s(r.output),
    kind: r.kind as Session['kind'],
    tier: r.tier as Session['tier'],
    status: r.status as SessionStatus,
    actualMinutes: n(r.actual_minutes),
    outputNote: s(r.output_note),
    origin: r.origin as Session['origin'],
    movedFromId: s(r.moved_from_id),
    reason: s(r.reason),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
function toCheckIn(r: Row): CheckIn {
  return {
    date: String(r.date),
    sleepHours: n(r.sleep_hours),
    concentration: n(r.concentration),
    lowEnergy: !!r.low_energy,
    note: s(r.note),
    updatedAt: String(r.updated_at),
  };
}
function toTimedSet(r: Row): TimedSet {
  return {
    id: String(r.id),
    termId: String(r.term_id),
    workstreamId: String(r.workstream_id),
    sessionId: s(r.session_id),
    date: String(r.date),
    topic: s(r.topic),
    attempted: n(r.attempted),
    correct: n(r.correct),
    minutes: n(r.minutes),
    targetMinutes: n(r.target_minutes),
    notes: s(r.notes),
    createdAt: String(r.created_at),
  };
}
function toError(r: Row): ErrorEntry {
  return {
    id: String(r.id),
    termId: String(r.term_id),
    workstreamId: String(r.workstream_id),
    timedSetId: s(r.timed_set_id),
    date: String(r.date),
    question: String(r.question),
    category: String(r.category),
    cause: s(r.cause),
    correctionRule: s(r.correction_rule),
    similarRef: s(r.similar_ref),
    status: r.status as ErrorEntry['status'],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
function toRetest(r: Row): Retest {
  return {
    id: String(r.id),
    errorId: String(r.error_id),
    dueDate: String(r.due_date),
    label: String(r.label),
    doneDate: s(r.done_date),
    outcome: (r.outcome ?? null) as RetestOutcome | null,
  };
}

export interface TermInput {
  name: string;
  institution: string | null;
  academicYear: string | null;
  startDate: ISODate;
  endDate: ISODate;
  timezone: string;
  status?: Term['status'];
  rules: PlanningRules;
}

export type WorkstreamInput = Omit<Workstream, 'id' | 'createdAt' | 'updatedAt'>;

/** A semester package: validated JSON that can be imported (the test fixtures use this format). */
export interface TermPackage {
  packageId: string; // stable id; importing the same package twice is a no-op
  term: Omit<TermInput, 'rules'> & { rules?: Partial<PlanningRules> };
  exceptions?: (Omit<DateException, 'id' | 'termId'> & { key?: string })[];
  workstreams?: (Omit<WorkstreamInput, 'termId' | 'archived'> & { key: string; termScoped?: boolean })[];
  commitments?: (Omit<Commitment, 'id' | 'termId' | 'workstreamId'> & { key: string; workstream?: string })[];
  commitmentChanges?: { commitment: string; date: ISODate; kind: 'cancelled' | 'makeup'; startTime?: string; endTime?: string; reason?: string }[];
  assessments?: (Omit<Assessment, 'id' | 'termId' | 'workstreamId'> & { key: string; workstream?: string })[];
  templates?: (Omit<StudyTemplate, 'id' | 'termId' | 'workstreamId' | 'dependsOnCommitmentId'> & {
    key: string;
    workstream?: string;
    dependsOn?: string;
  })[];
  sessions?: {
    key: string;
    workstream?: string;
    date: ISODate;
    startTime: string | null;
    durationMin: number;
    title: string;
    output?: string | null;
    kind: Session['kind'];
    tier: Session['tier'];
    note?: string;
  }[];
}

export class Repo {
  readonly tx: TxRunner;
  /** Bumped after every write so the UI can refresh. */
  version = 0;
  private listeners = new Set<() => void>();

  constructor(readonly db: SqlDriver) {
    this.tx = new TxRunner(db);
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    const out = await this.tx.run(fn);
    this.changed();
    return out;
  }

  // ---------- setup & migrations ----------
  async schemaVersion(): Promise<number> {
    await this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    const r = await this.db.all<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
    return r.length ? Number(r[0].value) : 0;
  }

  /**
   * Safe initialisation: creates missing tables, applies pending migrations one
   * at a time inside transactions, and refuses to touch a database created by a
   * newer app version. A JSON snapshot is stored before upgrading existing data.
   */
  async init(): Promise<{ from: number; to: number }> {
    const from = await this.schemaVersion();
    if (from > LATEST_VERSION) {
      throw new DowngradeError(`This database was created by a newer version of the app (schema ${from}). Install the newer version; nothing was changed.`);
    }
    if (from > 0 && from < LATEST_VERSION) {
      const snap = await this.exportBackupRaw(from);
      await this.setMeta('pre_migration_backup', JSON.stringify(snap));
    }
    for (const m of MIGRATIONS) {
      if (m.version <= from) continue;
      await this.tx.run(async () => {
        for (const st of m.statements) await this.db.exec(st);
        await this.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(m.version)]);
      });
    }
    return { from, to: LATEST_VERSION };
  }

  async getMeta(key: string): Promise<string | null> {
    const r = await this.db.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return r.length ? r[0].value : null;
  }
  async setMeta(key: string, value: string | null) {
    if (value === null) await this.db.run('DELETE FROM meta WHERE key = ?', [key]);
    else await this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }

  // ---------- terms ----------
  async listTerms(): Promise<Term[]> {
    return (await this.db.all<Row>('SELECT * FROM terms ORDER BY start_date DESC')).map(toTerm);
  }
  async getTerm(id: string): Promise<Term | null> {
    const r = await this.db.all<Row>('SELECT * FROM terms WHERE id = ?', [id]);
    return r.length ? toTerm(r[0]) : null;
  }
  async activeTermId(): Promise<string | null> {
    const id = await this.getMeta('active_term_id');
    if (id && (await this.getTerm(id))) return id;
    const terms = await this.listTerms();
    return (terms.find((t) => t.status === 'current') ?? terms.find((t) => t.status !== 'archived') ?? terms[0])?.id ?? null;
  }
  async setActiveTerm(id: string) {
    await this.write(async () => {
      if (!(await this.getTerm(id))) throw new Error('Semester not found');
      await this.setMeta('active_term_id', id);
    });
  }

  validateTermInput(t: TermInput): string[] {
    const p: string[] = [];
    if (!t.name.trim()) p.push('Name is required.');
    if (!isISODate(t.startDate) || !isISODate(t.endDate)) p.push('Start and end dates are required.');
    else if (t.endDate < t.startDate) p.push('End date is before start date.');
    if (!t.timezone) p.push('Time zone is required.');
    p.push(...validateRules(t.rules));
    return p;
  }

  async createTerm(t: TermInput, id = newId()): Promise<string> {
    const problems = this.validateTermInput(t);
    if (problems.length) throw new Error(problems.join(' '));
    return this.write(async () => {
      const ts = nowIso();
      await this.db.run(
        'INSERT INTO terms (id, name, institution, academic_year, start_date, end_date, status, timezone, rules_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [id, t.name.trim(), t.institution, t.academicYear, t.startDate, t.endDate, t.status ?? 'upcoming', t.timezone, JSON.stringify(t.rules), ts, ts],
      );
      return id;
    });
  }

  async updateTerm(id: string, t: TermInput) {
    const problems = this.validateTermInput(t);
    if (problems.length) throw new Error(problems.join(' '));
    await this.write(async () => {
      await this.db.run(
        'UPDATE terms SET name=?, institution=?, academic_year=?, start_date=?, end_date=?, status=?, timezone=?, rules_json=?, updated_at=? WHERE id=?',
        [t.name.trim(), t.institution, t.academicYear, t.startDate, t.endDate, t.status ?? 'upcoming', t.timezone, JSON.stringify(t.rules), nowIso(), id],
      );
    });
  }

  async updateRules(termId: string, rules: PlanningRules) {
    const problems = validateRules(rules);
    if (problems.length) throw new Error(problems.join(' '));
    await this.write(async () => {
      await this.db.run('UPDATE terms SET rules_json=?, updated_at=? WHERE id=?', [JSON.stringify(rules), nowIso(), termId]);
    });
  }

  /** Archiving keeps every record; it only changes the status. */
  async setTermStatus(id: string, status: Term['status']) {
    await this.write(async () => {
      await this.db.run('UPDATE terms SET status=?, updated_at=? WHERE id=?', [status, nowIso(), id]);
    });
  }

  /**
   * New semester from a previous one. Only reusable configuration is copied
   * (rules, and optionally non-course workstreams and their study templates);
   * courses, exams, deadlines and classes are never copied.
   */
  async cloneTerm(sourceId: string, input: TermInput, opts: { copyRules: boolean; copyLongTermWorkstreams: boolean }): Promise<string> {
    const src = await this.getTerm(sourceId);
    if (!src) throw new Error('Source semester not found');
    const rules: PlanningRules = opts.copyRules ? { ...src.rules, trial: { start: null, end: null }, optional: { ...src.rules.optional, enabled: false } } : input.rules;
    return this.write(async () => {
      const id = await this.createTerm({ ...input, rules });
      if (opts.copyLongTermWorkstreams) {
        const ws = (await this.listWorkstreams(sourceId)).filter((w) => w.termId === sourceId && !['course', 'lab'].includes(w.type) && !w.archived);
        for (const w of ws) {
          await this.createWorkstream({ ...w, termId: id, deadline: null });
        }
      }
      return id;
    });
  }

  // ---------- exceptions ----------
  async listExceptions(termId: string): Promise<DateException[]> {
    return (await this.db.all<Row>('SELECT * FROM date_exceptions WHERE term_id = ? ORDER BY start_date', [termId])).map(toException);
  }
  async saveException(e: Omit<DateException, 'id'> & { id?: string }) {
    if (!isISODate(e.startDate) || !isISODate(e.endDate) || e.endDate < e.startDate) throw new Error('Invalid dates');
    if (!e.name.trim()) throw new Error('Name is required');
    await this.write(async () => {
      const id = e.id ?? newId();
      await this.db.run(
        'INSERT OR REPLACE INTO date_exceptions (id, term_id, start_date, end_date, name, kind, cancels_classes, suppresses_study) VALUES (?,?,?,?,?,?,?,?)',
        [id, e.termId, e.startDate, e.endDate, e.name.trim(), e.kind, b(e.cancelsClasses), b(e.suppressesStudy)],
      );
      await this.syncTemplateSessionsInternal(e.termId, e.startDate, e.endDate);
    });
  }
  async deleteException(id: string) {
    await this.write(async () => {
      const r = await this.db.all<Row>('SELECT * FROM date_exceptions WHERE id = ?', [id]);
      await this.db.run('DELETE FROM date_exceptions WHERE id = ?', [id]);
      if (r.length) await this.syncTemplateSessionsInternal(String(r[0].term_id), String(r[0].start_date), String(r[0].end_date));
    });
  }

  // ---------- workstreams ----------
  /** Workstreams of a term plus those not tied to any term. */
  async listWorkstreams(termId: string, includeArchived = false): Promise<Workstream[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM workstreams WHERE (term_id = ? OR term_id IS NULL) ${includeArchived ? '' : 'AND archived = 0'} ORDER BY priority, code, name`,
      [termId],
    );
    return rows.map(toWorkstream);
  }
  async createWorkstream(w: WorkstreamInput, id = newId()): Promise<string> {
    if (!w.name.trim()) throw new Error('Name is required');
    return this.write(async () => {
      const ts = nowIso();
      await this.db.run(
        `INSERT INTO workstreams (id, term_id, type, code, name, color, priority, deadline, min_weekly_minutes, target_weekly_minutes,
          extension_weekly_minutes, floor_rule, archived, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, w.termId, w.type, w.code, w.name.trim(), w.color, w.priority, w.deadline, w.minWeeklyMinutes, w.targetWeeklyMinutes, w.extensionWeeklyMinutes, w.floorRule, b(w.archived), w.notes, ts, ts],
      );
      return id;
    });
  }
  async updateWorkstream(id: string, w: WorkstreamInput) {
    await this.write(async () => {
      await this.db.run(
        `UPDATE workstreams SET term_id=?, type=?, code=?, name=?, color=?, priority=?, deadline=?, min_weekly_minutes=?, target_weekly_minutes=?,
          extension_weekly_minutes=?, floor_rule=?, archived=?, notes=?, updated_at=? WHERE id=?`,
        [w.termId, w.type, w.code, w.name.trim(), w.color, w.priority, w.deadline, w.minWeeklyMinutes, w.targetWeeklyMinutes, w.extensionWeeklyMinutes, w.floorRule, b(w.archived), w.notes, nowIso(), id],
      );
    });
  }

  async listTopics(workstreamId: string): Promise<string[]> {
    return (await this.db.all<Row>('SELECT name FROM topics WHERE workstream_id = ? ORDER BY sort, name', [workstreamId])).map((r) => String(r.name));
  }
  async setTopics(workstreamId: string, names: string[]) {
    const clean = [...new Set(names.map((x) => x.trim()).filter(Boolean))];
    await this.write(async () => {
      await this.db.run('DELETE FROM topics WHERE workstream_id = ?', [workstreamId]);
      for (const [i, name] of clean.entries()) {
        await this.db.run('INSERT INTO topics (id, workstream_id, name, sort, created_at) VALUES (?,?,?,?,?)', [newId(), workstreamId, name, i, nowIso()]);
      }
    });
  }

  // ---------- commitments ----------
  async listCommitments(termId: string): Promise<Commitment[]> {
    return (await this.db.all<Row>('SELECT * FROM commitments WHERE term_id = ? ORDER BY start_time', [termId])).map(toCommitment);
  }
  async saveCommitment(c: Omit<Commitment, 'id'> & { id?: string }): Promise<string> {
    if (!c.title.trim() || !c.weekdays.length) throw new Error('Title and at least one weekday are required');
    if (c.endTime <= c.startTime) throw new Error('End time must be after start time');
    return this.write(async () => {
      const id = c.id ?? newId();
      await this.db.run(
        'INSERT OR REPLACE INTO commitments (id, term_id, workstream_id, kind, title, location, weekdays, start_time, end_time, valid_from, valid_to) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [id, c.termId, c.workstreamId, c.kind, c.title.trim(), c.location, c.weekdays.join(','), c.startTime, c.endTime, c.validFrom, c.validTo],
      );
      return id;
    });
  }
  async listChanges(termId: string): Promise<CommitmentChange[]> {
    return (
      await this.db.all<Row>('SELECT cc.* FROM commitment_changes cc JOIN commitments c ON c.id = cc.commitment_id WHERE c.term_id = ? ORDER BY cc.date', [termId])
    ).map(toChange);
  }
  async addChange(ch: Omit<CommitmentChange, 'id'>) {
    await this.write(async () => {
      await this.addChangeInternal(ch);
    });
  }
  private async addChangeInternal(ch: Omit<CommitmentChange, 'id'>) {
    await this.db.run(
      'INSERT OR REPLACE INTO commitment_changes (id, commitment_id, date, kind, start_time, end_time, reason) VALUES (?,?,?,?,?,?,?)',
      [newId(), ch.commitmentId, ch.date, ch.kind, ch.startTime, ch.endTime, ch.reason],
    );
    const c = await this.db.all<Row>('SELECT term_id FROM commitments WHERE id = ?', [ch.commitmentId]);
    if (c.length) await this.syncTemplateSessionsInternal(String(c[0].term_id), addDays(ch.date, -6), ch.date);
  }
  async deleteChange(id: string) {
    await this.write(async () => {
      await this.db.run('DELETE FROM commitment_changes WHERE id = ?', [id]);
    });
  }

  // ---------- assessments ----------
  async listAssessments(termId: string): Promise<Assessment[]> {
    return (await this.db.all<Row>('SELECT * FROM assessments WHERE term_id = ? ORDER BY date, start_time', [termId])).map(toAssessment);
  }
  async saveAssessment(a: Omit<Assessment, 'id'> & { id?: string }): Promise<string> {
    if (!a.title.trim() || !isISODate(a.date)) throw new Error('Title and date are required');
    return this.write(async () => this.saveAssessmentInternal(a));
  }
  private async saveAssessmentInternal(a: Omit<Assessment, 'id'> & { id?: string }): Promise<string> {
    const id = a.id ?? newId();
    await this.db.run(
      'INSERT OR REPLACE INTO assessments (id, term_id, workstream_id, kind, title, date, start_time, end_time, confirmed, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, a.termId, a.workstreamId, a.kind, a.title.trim(), a.date, a.startTime, a.endTime, b(a.confirmed), a.notes],
    );
    return id;
  }
  async deleteAssessment(id: string) {
    await this.write(async () => {
      await this.db.run('UPDATE sessions SET assessment_id = NULL WHERE assessment_id = ?', [id]);
      await this.db.run('DELETE FROM assessments WHERE id = ?', [id]);
    });
  }

  // ---------- study templates & sessions ----------
  async listTemplates(termId: string): Promise<StudyTemplate[]> {
    return (await this.db.all<Row>('SELECT * FROM study_templates WHERE term_id = ? ORDER BY weekday, start_time', [termId])).map(toTemplate);
  }
  async saveTemplate(t: Omit<StudyTemplate, 'id'> & { id?: string }, today: ISODate): Promise<string> {
    if (!t.title.trim() || !(t.durationMin > 0)) throw new Error('Title and duration are required');
    return this.write(async () => {
      const id = t.id ?? newId();
      await this.db.run(
        `INSERT OR REPLACE INTO study_templates (id, term_id, workstream_id, title, output, kind, weekday, start_time, duration_min, tier, active,
          valid_from, valid_to, depends_on_commitment_id, depends_on_weekday) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, t.termId, t.workstreamId, t.title.trim(), t.output, t.kind, t.weekday, t.startTime, t.durationMin, t.tier, b(t.active), t.validFrom, t.validTo, t.dependsOnCommitmentId, t.dependsOnWeekday],
      );
      // future planned rows from this template are only plans: rebuild them from the new definition
      await this.db.run("DELETE FROM sessions WHERE template_id = ? AND status IN ('planned','cancelled') AND date >= ? AND id NOT IN (SELECT moved_from_id FROM sessions WHERE moved_from_id IS NOT NULL)", [id, today]);
      return id;
    });
  }
  async setTemplateActive(id: string, active: boolean, today: ISODate) {
    await this.write(async () => {
      await this.db.run('UPDATE study_templates SET active = ? WHERE id = ?', [b(active), id]);
      if (!active) {
        await this.db.run("DELETE FROM sessions WHERE template_id = ? AND status IN ('planned','cancelled') AND date >= ? AND id NOT IN (SELECT moved_from_id FROM sessions WHERE moved_from_id IS NOT NULL)", [id, today]);
      }
    });
  }

  /**
   * Make sure template sessions exist for [start, end]. Idempotent: the row id is
   * derived from (template, date) and protected by a UNIQUE constraint, so
   * reopening the app never duplicates blocks. Existing logged rows are never touched.
   */
  async ensureSessions(termId: string, start: ISODate, end: ISODate, notify = true) {
    if (notify) await this.write(async () => this.syncTemplateSessionsInternal(termId, start, end));
    else await this.tx.run(async () => this.syncTemplateSessionsInternal(termId, start, end));
  }

  private async syncTemplateSessionsInternal(termId: string, start: ISODate, end: ISODate) {
    const [templates, commitments, changes, exceptions] = await Promise.all([
      this.listTemplates(termId),
      this.listCommitments(termId),
      this.listChanges(termId),
      this.listExceptions(termId),
    ]);
    const drafts = draftSessions(start, end, templates, commitments, changes, exceptions);
    const wanted = new Set(drafts.map((d) => `${d.templateId}:${d.date}`));
    const ts = nowIso();
    for (const d of drafts) {
      const t = templates.find((x) => x.id === d.templateId)!;
      const id = `${t.id}:${d.date}`;
      await this.db.run(
        `INSERT OR IGNORE INTO sessions (id, term_id, workstream_id, template_id, assessment_id, date, start_time, duration_min, title, output, kind, tier,
          status, actual_minutes, output_note, origin, moved_from_id, reason, created_at, updated_at) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,NULL,NULL,'template',NULL,?,?,?)`,
        [id, termId, t.workstreamId, t.id, d.date, t.startTime, t.durationMin, t.title, t.output, t.kind, t.tier, d.status, d.reason, ts, ts],
      );
      // a holiday added or removed later flips unlogged rows between planned and not-scheduled
      if (d.status === 'cancelled') {
        await this.db.run("UPDATE sessions SET status='cancelled', reason=?, updated_at=? WHERE template_id=? AND date=? AND status='planned'", [d.reason, ts, t.id, d.date]);
      } else {
        await this.db.run(
          "UPDATE sessions SET status='planned', reason=NULL, updated_at=? WHERE template_id=? AND date=? AND status='cancelled' AND reason LIKE 'Not scheduled:%' AND origin='template'",
          [ts, t.id, d.date],
        );
      }
    }
    // unlogged template rows that no longer apply (e.g. day now has its own plan)
    const existing = await this.db.all<Row>(
      "SELECT id, template_id, date FROM sessions WHERE term_id=? AND origin='template' AND status='planned' AND date BETWEEN ? AND ?",
      [termId, start, end],
    );
    for (const r of existing) {
      if (!wanted.has(`${r.template_id}:${r.date}`)) {
        await this.db.run("UPDATE sessions SET status='cancelled', reason='Not scheduled: this day has its own plan or the block was removed', updated_at=? WHERE id=?", [ts, String(r.id)]);
      }
    }
  }

  async listSessions(termId: string, start: ISODate, end: ISODate): Promise<Session[]> {
    return (
      await this.db.all<Row>('SELECT * FROM sessions WHERE term_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time IS NULL, start_time', [termId, start, end])
    ).map(toSession);
  }
  async getSession(id: string): Promise<Session | null> {
    const r = await this.db.all<Row>('SELECT * FROM sessions WHERE id = ?', [id]);
    return r.length ? toSession(r[0]) : null;
  }

  /** One-tap logging. Re-tapping the same status returns the block to "planned". */
  async setSessionStatus(id: string, status: SessionStatus, extra: { actualMinutes?: number | null; outputNote?: string | null } = {}) {
    await this.write(async () => {
      await this.db.run(
        'UPDATE sessions SET status=?, actual_minutes=COALESCE(?, actual_minutes), output_note=COALESCE(?, output_note), updated_at=? WHERE id=?',
        [status, extra.actualMinutes ?? null, extra.outputNote ?? null, nowIso(), id],
      );
    });
  }
  async updateSessionDetails(id: string, f: { actualMinutes: number | null; outputNote: string | null }) {
    await this.write(async () => {
      await this.db.run('UPDATE sessions SET actual_minutes=?, output_note=?, updated_at=? WHERE id=?', [f.actualMinutes, f.outputNote, nowIso(), id]);
    });
  }
  async saveManualSession(x: Omit<Session, 'id' | 'createdAt' | 'updatedAt' | 'origin' | 'templateId' | 'movedFromId' | 'reason'> & { id?: string }): Promise<string> {
    if (!x.title.trim() || !(x.durationMin > 0) || !isISODate(x.date)) throw new Error('Title, date and duration are required');
    return this.write(async () => {
      const ts = nowIso();
      if (x.id) {
        await this.db.run(
          'UPDATE sessions SET workstream_id=?, assessment_id=?, date=?, start_time=?, duration_min=?, title=?, output=?, kind=?, tier=?, updated_at=? WHERE id=?',
          [x.workstreamId, x.assessmentId, x.date, x.startTime, x.durationMin, x.title.trim(), x.output, x.kind, x.tier, ts, x.id],
        );
        return x.id;
      }
      const id = newId();
      await this.db.run(
        `INSERT INTO sessions (id, term_id, workstream_id, template_id, assessment_id, date, start_time, duration_min, title, output, kind, tier, status,
          actual_minutes, output_note, origin, moved_from_id, reason, created_at, updated_at) VALUES (?,?,?,NULL,?,?,?,?,?,?,?,?,?,NULL,NULL,'manual',NULL,NULL,?,?)`,
        [id, x.termId, x.workstreamId, x.assessmentId, x.date, x.startTime, x.durationMin, x.title.trim(), x.output, x.kind, x.tier, x.status, ts, ts],
      );
      return id;
    });
  }

  // ---------- check-ins ----------
  async getCheckIn(date: ISODate): Promise<CheckIn | null> {
    const r = await this.db.all<Row>('SELECT * FROM checkins WHERE date = ?', [date]);
    return r.length ? toCheckIn(r[0]) : null;
  }
  async listCheckIns(start: ISODate, end: ISODate): Promise<CheckIn[]> {
    return (await this.db.all<Row>('SELECT * FROM checkins WHERE date BETWEEN ? AND ? ORDER BY date', [start, end])).map(toCheckIn);
  }
  async saveCheckIn(c: Partial<Omit<CheckIn, 'updatedAt'>> & { date: ISODate }) {
    if (c.sleepHours != null && !(c.sleepHours >= 0 && c.sleepHours <= 16)) throw new Error('Sleep must be between 0 and 16 hours');
    if (c.concentration != null && !(c.concentration >= 1 && c.concentration <= 5)) throw new Error('Concentration is 1 to 5');
    await this.write(async () => {
      const cur = await this.getCheckIn(c.date);
      const merged = { sleepHours: null, concentration: null, lowEnergy: false, note: null, ...cur, ...c };
      await this.db.run('INSERT OR REPLACE INTO checkins (date, sleep_hours, concentration, low_energy, note, updated_at) VALUES (?,?,?,?,?,?)', [
        c.date,
        merged.sleepHours,
        merged.concentration,
        b(!!merged.lowEnergy),
        merged.note,
        nowIso(),
      ]);
    });
  }

  // ---------- practice ----------
  async listTimedSets(termId: string, start?: ISODate, end?: ISODate): Promise<TimedSet[]> {
    const rows = start
      ? await this.db.all<Row>('SELECT * FROM timed_sets WHERE term_id=? AND date BETWEEN ? AND ? ORDER BY date DESC, created_at DESC', [termId, start, end ?? start])
      : await this.db.all<Row>('SELECT * FROM timed_sets WHERE term_id=? ORDER BY date DESC, created_at DESC', [termId]);
    return rows.map(toTimedSet);
  }
  async saveTimedSet(t: Omit<TimedSet, 'id' | 'createdAt'> & { id?: string }): Promise<string> {
    if (t.attempted != null && (t.attempted < 0 || !Number.isInteger(t.attempted))) throw new Error('Attempted must be a whole number');
    if (t.correct != null && (t.correct < 0 || (t.attempted != null && t.correct > t.attempted))) throw new Error('Correct cannot exceed attempted');
    return this.write(async () => {
      const id = t.id ?? newId();
      await this.db.run(
        'INSERT OR REPLACE INTO timed_sets (id, term_id, workstream_id, session_id, date, topic, attempted, correct, minutes, target_minutes, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, t.termId, t.workstreamId, t.sessionId, t.date, t.topic, t.attempted, t.correct, t.minutes, t.targetMinutes, t.notes, nowIso()],
      );
      return id;
    });
  }
  async deleteTimedSet(id: string) {
    await this.write(async () => {
      await this.db.run('UPDATE errors SET timed_set_id = NULL WHERE timed_set_id = ?', [id]);
      await this.db.run('DELETE FROM timed_sets WHERE id = ?', [id]);
    });
  }

  async listErrors(termId: string, status?: ErrorEntry['status']): Promise<ErrorEntry[]> {
    const rows = status
      ? await this.db.all<Row>('SELECT * FROM errors WHERE term_id=? AND status=? ORDER BY date DESC', [termId, status])
      : await this.db.all<Row>('SELECT * FROM errors WHERE term_id=? ORDER BY date DESC', [termId]);
    return rows.map(toError);
  }

  /** Adds an error and its default retest schedule in one transaction. */
  async addError(e: Omit<ErrorEntry, 'id' | 'status' | 'createdAt' | 'updatedAt'>, rules: PlanningRules): Promise<string> {
    if (!e.question.trim()) throw new Error('Describe the question or topic');
    if (!e.category.trim()) throw new Error('Choose an error category');
    return this.write(async () => {
      const id = newId();
      const ts = nowIso();
      await this.db.run(
        `INSERT INTO errors (id, term_id, workstream_id, timed_set_id, date, question, category, cause, correction_rule, similar_ref, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
        [id, e.termId, e.workstreamId, e.timedSetId, e.date, e.question.trim(), e.category, e.cause, e.correctionRule, e.similarRef, ts, ts],
      );
      const exam = (
        await this.db.all<Row>(
          "SELECT title, date FROM assessments WHERE workstream_id = ? AND kind IN ('midterm','final') AND date > ? ORDER BY date LIMIT 1",
          [e.workstreamId, e.date],
        )
      )[0];
      for (const r of buildRetests(e.date, rules, exam ? { title: String(exam.title), date: String(exam.date) } : null)) {
        await this.db.run('INSERT INTO retests (id, error_id, due_date, label, done_date, outcome) VALUES (?,?,?,?,NULL,NULL)', [newId(), id, r.dueDate, r.label]);
      }
      return id;
    });
  }
  async updateError(id: string, f: Partial<Pick<ErrorEntry, 'question' | 'category' | 'cause' | 'correctionRule' | 'similarRef' | 'status'>>) {
    await this.write(async () => {
      const cur = (await this.db.all<Row>('SELECT * FROM errors WHERE id=?', [id]))[0];
      if (!cur) throw new Error('Error entry not found');
      const e = { ...toError(cur), ...f };
      await this.db.run('UPDATE errors SET question=?, category=?, cause=?, correction_rule=?, similar_ref=?, status=?, updated_at=? WHERE id=?', [
        e.question,
        e.category,
        e.cause,
        e.correctionRule,
        e.similarRef,
        e.status,
        nowIso(),
        id,
      ]);
    });
  }
  async listRetests(termId: string): Promise<Retest[]> {
    return (
      await this.db.all<Row>('SELECT r.* FROM retests r JOIN errors e ON e.id = r.error_id WHERE e.term_id = ? ORDER BY r.due_date', [termId])
    ).map(toRetest);
  }
  async retestsForError(errorId: string): Promise<Retest[]> {
    return (await this.db.all<Row>('SELECT * FROM retests WHERE error_id = ? ORDER BY due_date', [errorId])).map(toRetest);
  }

  /** Record a retest result; updates mastery and schedules a retry when needed. */
  async recordRetest(retestId: string, outcome: RetestOutcome, date: ISODate, rules: PlanningRules) {
    await this.write(async () => {
      const r = (await this.db.all<Row>('SELECT * FROM retests WHERE id = ?', [retestId]))[0];
      if (!r) throw new Error('Retest not found');
      await this.db.run('UPDATE retests SET done_date=?, outcome=? WHERE id=?', [date, outcome, retestId]);
      const errorId = String(r.error_id);
      const all = await this.retestsForError(errorId);
      const err = toError((await this.db.all<Row>('SELECT * FROM errors WHERE id=?', [errorId]))[0]);
      const status = errorStatusAfter(all, rules, err.status);
      await this.db.run('UPDATE errors SET status=?, updated_at=? WHERE id=?', [status, nowIso(), errorId]);
      if (status === 'open') {
        const f = followUpRetest(all, date, rules);
        if (f) await this.db.run('INSERT INTO retests (id, error_id, due_date, label, done_date, outcome) VALUES (?,?,?,?,NULL,NULL)', [newId(), errorId, f.dueDate, f.label]);
      } else {
        // mastered: remaining scheduled retests are no longer needed
        await this.db.run('DELETE FROM retests WHERE error_id=? AND done_date IS NULL', [errorId]);
      }
    });
  }

  // ---------- reviews & change log ----------
  async getReview(termId: string, weekStart: ISODate): Promise<WeeklyReview | null> {
    const r = (await this.db.all<Row>('SELECT * FROM weekly_reviews WHERE term_id=? AND week_start=?', [termId, weekStart]))[0];
    return r
      ? {
          id: String(r.id),
          termId: String(r.term_id),
          weekStart: String(r.week_start),
          decision: (r.decision ?? null) as ReviewDecision | null,
          notes: s(r.notes),
          snapshot: r.snapshot_json ? JSON.parse(String(r.snapshot_json)) : null,
          createdAt: String(r.created_at),
        }
      : null;
  }
  async saveReview(termId: string, weekStart: ISODate, decision: ReviewDecision, notes: string | null, snapshot: unknown) {
    await this.write(async () => {
      const cur = await this.getReview(termId, weekStart);
      await this.db.run('INSERT OR REPLACE INTO weekly_reviews (id, term_id, week_start, decision, notes, snapshot_json, created_at) VALUES (?,?,?,?,?,?,?)', [
        cur?.id ?? newId(),
        termId,
        weekStart,
        decision,
        notes,
        JSON.stringify(snapshot),
        cur?.createdAt ?? nowIso(),
      ]);
    });
  }
  async listChangesLog(termId: string, limit = 20): Promise<ScheduleChange[]> {
    return (await this.db.all<Row>('SELECT * FROM schedule_changes WHERE term_id=? ORDER BY created_at DESC LIMIT ?', [termId, limit])).map((r) => ({
      id: String(r.id),
      termId: String(r.term_id),
      date: String(r.date),
      scenario: String(r.scenario),
      summary: String(r.summary),
      details: r.details_json ? JSON.parse(String(r.details_json)) : null,
      createdAt: String(r.created_at),
    }));
  }

  /** Apply a confirmed replanning proposal atomically and log it. */
  async applyProposal(termId: string, date: ISODate, p: Proposal): Promise<void> {
    await this.write(async () => {
      const ts = nowIso();
      const tempIds = new Map<string, string>();
      for (const a of p.actions) {
        if (a.type === 'add_assessment') tempIds.set(a.tempId, await this.saveAssessmentInternal(a.draft));
      }
      for (const a of p.actions) await this.applyAction(termId, a, tempIds, ts);
      await this.db.run('INSERT INTO schedule_changes (id, term_id, date, scenario, summary, details_json, created_at) VALUES (?,?,?,?,?,?,?)', [
        newId(),
        termId,
        date,
        p.scenario,
        p.summary.join(' '),
        JSON.stringify({ actions: p.actions, warnings: p.warnings, reduceNextWeek: p.reduceNextWeek }),
        ts,
      ]);
      if (p.reduceNextWeek) await this.setMeta(`reduce_scope:${termId}`, addDays(startOfWeek(date), 7));
    });
  }

  private async copySession(src: Session, toDate: ISODate, reason: string, ts: string): Promise<string> {
    const id = newId();
    await this.db.run(
      `INSERT INTO sessions (id, term_id, workstream_id, template_id, assessment_id, date, start_time, duration_min, title, output, kind, tier, status,
        actual_minutes, output_note, origin, moved_from_id, reason, created_at, updated_at) VALUES (?,?,?,NULL,?,?,NULL,?,?,?,?,?,'planned',NULL,NULL,'replan',?,?,?,?)`,
      [id, src.termId, src.workstreamId, src.assessmentId, toDate, src.durationMin, src.title, src.output, src.kind, src.tier, src.id, reason, ts, ts],
    );
    return id;
  }

  private async applyAction(termId: string, a: Action, tempIds: Map<string, string>, ts: string) {
    switch (a.type) {
      case 'keep':
      case 'add_assessment':
        return;
      case 'shorten':
        await this.db.run('UPDATE sessions SET duration_min=?, reason=?, updated_at=? WHERE id=?', [a.toMinutes, a.reason, ts, a.sessionId]);
        return;
      case 'swap':
        await this.db.run('UPDATE sessions SET title=?, kind=?, duration_min=?, reason=?, updated_at=? WHERE id=?', [a.title, a.kind, a.toMinutes, a.reason, ts, a.sessionId]);
        return;
      case 'set_status':
        await this.db.run('UPDATE sessions SET status=?, reason=?, updated_at=? WHERE id=?', [a.status, a.reason, ts, a.sessionId]);
        return;
      case 'move': {
        const src = await this.getSession(a.sessionId);
        if (!src) throw new Error('Session not found');
        await this.db.run("UPDATE sessions SET status='moved', reason=?, updated_at=? WHERE id=?", [a.reason, ts, a.sessionId]);
        await this.copySession(src, a.toDate, a.reason, ts);
        return;
      }
      case 'makeup': {
        const src = await this.getSession(a.sessionId);
        if (!src) throw new Error('Session not found');
        await this.copySession({ ...src, title: src.title.startsWith('Make-up:') ? src.title : `Make-up: ${src.title}` }, a.toDate, a.reason, ts);
        return;
      }
      case 'add': {
        const d = a.draft;
        await this.db.run(
          `INSERT INTO sessions (id, term_id, workstream_id, template_id, assessment_id, date, start_time, duration_min, title, output, kind, tier, status,
            actual_minutes, output_note, origin, moved_from_id, reason, created_at, updated_at) VALUES (?,?,?,NULL,?,?,?,?,?,NULL,?,?,'planned',NULL,NULL,'replan',?,?,?,?)`,
          [newId(), termId, d.workstreamId, d.assessmentId ? tempIds.get(d.assessmentId) ?? d.assessmentId : null, d.date, d.startTime, d.durationMin, d.title, d.kind, d.tier, d.movedFromId, a.reason, ts, ts],
        );
        return;
      }
      case 'update_assessment':
        await this.db.run('UPDATE assessments SET date=?, start_time=?, end_time=? WHERE id=?', [a.date, a.startTime, a.endTime, a.assessmentId]);
        return;
      case 'cancel_occurrence':
        await this.addChangeInternal({ commitmentId: a.commitmentId, date: a.date, kind: 'cancelled', startTime: null, endTime: null, reason: a.reason });
        return;
      case 'update_retest':
        await this.db.run('UPDATE retests SET due_date=? WHERE id=?', [a.dueDate, a.retestId]);
        return;
    }
  }

  // ---------- notifications bookkeeping ----------
  async getReminderMap(): Promise<Map<number, string>> {
    const rows = await this.db.all<Row>('SELECT id, fingerprint FROM notification_map');
    return new Map(rows.map((r) => [Number(r.id), String(r.fingerprint)]));
  }
  async setReminderMap(entries: { id: number; sessionId: string; fingerprint: string }[]) {
    await this.tx.run(async () => {
      await this.db.run('DELETE FROM notification_map');
      for (const e of entries) await this.db.run('INSERT INTO notification_map (id, session_id, fingerprint) VALUES (?,?,?)', [e.id, e.sessionId, e.fingerprint]);
    });
  }

  // ---------- semester packages (import) ----------
  async isPackageImported(packageId: string): Promise<boolean> {
    return (await this.getMeta(`package:${packageId}`)) !== null;
  }

  /**
   * Import a semester package. Ids are derived from the package id, every insert
   * is INSERT OR IGNORE, and a meta flag is written in the same transaction, so
   * running it again (e.g. after a restart) never duplicates anything.
   */
  async importTermPackage(pkg: TermPackage, opts: { makeActive: boolean }): Promise<{ termId: string; imported: boolean }> {
    const p = pkg.packageId;
    const termId = p;
    const k = (key: string) => `${p}:${key}`;
    if (await this.isPackageImported(p)) return { termId, imported: false };
    const rules = normalizeRules(pkg.term.rules ?? {});
    const termInput: TermInput = { ...pkg.term, rules };
    const problems = this.validateTermInput(termInput);
    if (problems.length) throw new Error('Invalid semester package: ' + problems.join(' '));
    await this.write(async () => {
      const ts = nowIso();
      await this.db.run(
        'INSERT OR IGNORE INTO terms (id, name, institution, academic_year, start_date, end_date, status, timezone, rules_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [termId, termInput.name, termInput.institution, termInput.academicYear, termInput.startDate, termInput.endDate, termInput.status ?? 'current', termInput.timezone, JSON.stringify(rules), ts, ts],
      );
      for (const [i, e] of (pkg.exceptions ?? []).entries()) {
        if (!isISODate(e.startDate) || !isISODate(e.endDate)) throw new Error(`Exception ${e.name}: invalid date`);
        await this.db.run(
          'INSERT OR IGNORE INTO date_exceptions (id, term_id, start_date, end_date, name, kind, cancels_classes, suppresses_study) VALUES (?,?,?,?,?,?,?,?)',
          [k(e.key ?? `exc${i}`), termId, e.startDate, e.endDate, e.name, e.kind, b(e.cancelsClasses), b(e.suppressesStudy)],
        );
      }
      for (const w of pkg.workstreams ?? []) {
        await this.db.run(
          `INSERT OR IGNORE INTO workstreams (id, term_id, type, code, name, color, priority, deadline, min_weekly_minutes, target_weekly_minutes,
            extension_weekly_minutes, floor_rule, archived, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
          [k(w.key), w.termScoped === false ? null : termId, w.type, w.code, w.name, w.color, w.priority, w.deadline, w.minWeeklyMinutes, w.targetWeeklyMinutes, w.extensionWeeklyMinutes, w.floorRule, w.notes, ts, ts],
        );
      }
      const ref = (key?: string) => (key ? k(key) : null);
      for (const c of pkg.commitments ?? []) {
        await this.db.run(
          'INSERT OR IGNORE INTO commitments (id, term_id, workstream_id, kind, title, location, weekdays, start_time, end_time, valid_from, valid_to) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [k(c.key), termId, ref(c.workstream), c.kind, c.title, c.location, c.weekdays.join(','), c.startTime, c.endTime, c.validFrom, c.validTo],
        );
      }
      for (const ch of pkg.commitmentChanges ?? []) {
        await this.db.run('INSERT OR IGNORE INTO commitment_changes (id, commitment_id, date, kind, start_time, end_time, reason) VALUES (?,?,?,?,?,?,?)', [
          k(`chg:${ch.commitment}:${ch.date}:${ch.kind}`),
          k(ch.commitment),
          ch.date,
          ch.kind,
          ch.startTime ?? null,
          ch.endTime ?? null,
          ch.reason ?? null,
        ]);
      }
      for (const a of pkg.assessments ?? []) {
        await this.db.run(
          'INSERT OR IGNORE INTO assessments (id, term_id, workstream_id, kind, title, date, start_time, end_time, confirmed, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [k(a.key), termId, ref(a.workstream), a.kind, a.title, a.date, a.startTime, a.endTime, b(a.confirmed), a.notes],
        );
      }
      for (const t of pkg.templates ?? []) {
        await this.db.run(
          `INSERT OR IGNORE INTO study_templates (id, term_id, workstream_id, title, output, kind, weekday, start_time, duration_min, tier, active,
            valid_from, valid_to, depends_on_commitment_id, depends_on_weekday) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [k(t.key), termId, ref(t.workstream), t.title, t.output, t.kind, t.weekday, t.startTime, t.durationMin, t.tier, b(t.active), t.validFrom, t.validTo, ref(t.dependsOn), t.dependsOnWeekday],
        );
      }
      for (const x of pkg.sessions ?? []) {
        await this.db.run(
          `INSERT OR IGNORE INTO sessions (id, term_id, workstream_id, template_id, assessment_id, date, start_time, duration_min, title, output, kind, tier, status,
            actual_minutes, output_note, origin, moved_from_id, reason, created_at, updated_at) VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,?,'planned',NULL,NULL,'seed',NULL,?,?,?)`,
          [k(x.key), termId, ref(x.workstream), x.date, x.startTime, x.durationMin, x.title, x.output ?? null, x.kind, x.tier, x.note ?? null, ts, ts],
        );
      }
      await this.setMeta(`package:${p}`, ts);
      if (opts.makeActive) await this.setMeta('active_term_id', termId);
    });
    return { termId, imported: true };
  }

  // ---------- backup / restore ----------
  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of BACKUP_TABLES) out[t] = Number((await this.db.all<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`))[0].c);
    return out;
  }

  private async exportBackupRaw(schemaVersion: number): Promise<BackupFile> {
    const tables = {} as BackupFile['tables'];
    const counts: Record<string, number> = {};
    for (const t of BACKUP_TABLES) {
      tables[t] = await this.db.all<Row>(`SELECT * FROM ${t}`);
      counts[t] = tables[t].length;
    }
    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion,
      exportedAt: nowIso(),
      appVersion: APP_VERSION,
      activeTermId: await this.getMeta('active_term_id'),
      counts,
      tables,
    };
  }

  async exportBackup(): Promise<BackupFile> {
    return this.exportBackupRaw(await this.schemaVersion());
  }

  /**
   * Replace all data with a validated backup. A snapshot of the current data is
   * saved first, and the whole replacement runs in one transaction: if anything
   * fails, SQLite rolls back and the existing data is untouched.
   */
  async restoreBackup(input: unknown): Promise<{ ok: true } | { ok: false; errors: string[] }> {
    const v = validateBackup(input);
    if (!v.ok || !v.backup) return { ok: false, errors: v.errors };
    const backup = v.backup;
    const snapshot = await this.exportBackup();
    await this.write(async () => {
      await this.setMeta('pre_import_backup', JSON.stringify(snapshot));
      await this.db.exec('PRAGMA defer_foreign_keys = ON');
      for (const t of [...BACKUP_TABLES].reverse()) await this.db.run(`DELETE FROM ${t}`);
      await this.db.run('DELETE FROM notification_map');
      for (const t of BACKUP_TABLES) {
        for (const row of backup.tables[t]) {
          const cols = Object.keys(row);
          await this.db.run(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c]));
        }
      }
      // keep "already imported" flags so a package is not imported twice after a restore
      for (const r of backup.tables.terms) await this.setMeta(`package:${r.id}`, nowIso());
      await this.setMeta('active_term_id', backup.activeTermId ?? (backup.tables.terms[0]?.id as string | undefined) ?? null);
    });
    return { ok: true };
  }

  async hasPreImportBackup(): Promise<boolean> {
    return (await this.getMeta('pre_import_backup')) !== null;
  }

  /** Undo the last import by restoring the snapshot taken just before it. */
  async undoLastImport(): Promise<{ ok: true } | { ok: false; errors: string[] }> {
    const raw = await this.getMeta('pre_import_backup');
    if (!raw) return { ok: false, errors: ['There is no earlier snapshot.'] };
    const res = await this.restoreBackup(JSON.parse(raw));
    if (res.ok) await this.write(async () => this.setMeta('pre_import_backup', null));
    return res;
  }
}

export type { SqlValue };
