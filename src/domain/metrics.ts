// Calculations for the Progress screen and the automatic weekly review.
// All inputs come from records the user already logged; nothing is re-entered.
import { addDays } from './dates';
import type {
  CheckIn,
  ErrorEntry,
  ISODate,
  PlanningRules,
  Retest,
  ReviewDecision,
  Session,
  SessionStatus,
  TimedSet,
  Workstream,
} from './types';

/** Accuracy in percent, or null when nothing was attempted (never divides by zero). */
export function accuracy(attempted: number | null | undefined, correct: number | null | undefined): number | null {
  if (attempted == null || correct == null || !Number.isFinite(attempted) || !Number.isFinite(correct)) return null;
  if (attempted <= 0) return null;
  const c = Math.max(0, Math.min(correct, attempted));
  return Math.round((c / attempted) * 1000) / 10;
}

export interface CompletionStats {
  scheduled: number; // units counted in the denominator
  done: number;
  partial: number;
  missed: number; // includes past planned blocks never logged
  notLogged: number; // subset of missed: past blocks with no status
  cancelled: number; // not scheduled (holiday / class cancelled): excluded
  dropped: number; // explicitly dropped by a replan: excluded
  upcoming: number; // planned today or later: excluded until they happen
  completion: number | null; // 0..1, null when nothing scheduled yet
}

/**
 * Completion = (done + partial × partialWeight) ÷ scheduled.
 * - Cancelled (not scheduled) and dropped blocks are excluded.
 * - A moved block is excluded; its replacement counts instead.
 * - A make-up for a missed block in the same week replaces it: the pair counts once,
 *   with the make-up's result if it was done or partial.
 * - Planned blocks dated before `today` with no status count as missed ("not logged").
 */
export function completionStats(sessions: Session[], today: ISODate, partialWeight: number): CompletionStats {
  const s: CompletionStats = { scheduled: 0, done: 0, partial: 0, missed: 0, notLogged: 0, cancelled: 0, dropped: 0, upcoming: 0, completion: null };
  const byId = new Map(sessions.map((x) => [x.id, x]));
  // make-ups that replace a missed original in this set
  const supersededBy = new Map<string, Session>();
  for (const x of sessions) {
    if (x.movedFromId) {
      const orig = byId.get(x.movedFromId);
      if (orig && orig.status === 'missed') supersededBy.set(orig.id, x);
    }
  }
  const makeupIds = new Set([...supersededBy.values()].map((x) => x.id));
  for (const x of sessions) {
    if (makeupIds.has(x.id)) continue; // counted through its original
    let status: SessionStatus = x.status;
    let date = x.date;
    const makeup = supersededBy.get(x.id);
    if (makeup && (makeup.status === 'done' || makeup.status === 'partial')) status = makeup.status;
    else if (makeup && makeup.status === 'planned' && makeup.date >= today) {
      status = 'planned';
      date = makeup.date;
    }
    switch (status) {
      case 'cancelled':
        s.cancelled++;
        break;
      case 'dropped':
        s.dropped++;
        break;
      case 'moved':
        break;
      case 'done':
        s.scheduled++;
        s.done++;
        break;
      case 'partial':
        s.scheduled++;
        s.partial++;
        break;
      case 'missed':
        s.scheduled++;
        s.missed++;
        break;
      case 'planned':
        if (date < today) {
          s.scheduled++;
          s.missed++;
          s.notLogged++;
        } else s.upcoming++;
        break;
    }
  }
  s.completion = s.scheduled > 0 ? (s.done + s.partial * partialWeight) / s.scheduled : null;
  return s;
}

/** Minutes credited for a session: actual minutes if given, else full / weighted duration. */
export function creditedMinutes(x: Session, partialWeight: number): number {
  if (x.status === 'done') return x.actualMinutes ?? x.durationMin;
  if (x.status === 'partial') return x.actualMinutes ?? Math.round(x.durationMin * partialWeight);
  return 0;
}

export function average(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
}

export interface CourseAccuracy {
  workstreamId: string;
  sets: number;
  attempted: number;
  correct: number;
  minutes: number;
  accuracy: number | null;
}

export function accuracyByCourse(sets: TimedSet[]): CourseAccuracy[] {
  const m = new Map<string, CourseAccuracy>();
  for (const t of sets) {
    const a = m.get(t.workstreamId) ?? { workstreamId: t.workstreamId, sets: 0, attempted: 0, correct: 0, minutes: 0, accuracy: null };
    a.sets++;
    a.attempted += t.attempted ?? 0;
    a.correct += Math.min(t.correct ?? 0, t.attempted ?? 0);
    a.minutes += t.minutes ?? 0;
    m.set(t.workstreamId, a);
  }
  for (const a of m.values()) a.accuracy = accuracy(a.attempted, a.correct);
  return [...m.values()];
}

export function categoryCounts(errors: ErrorEntry[]): { category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of errors) m.set(e.category, (m.get(e.category) ?? 0) + 1);
  return [...m.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

export interface WorkstreamProgress {
  workstreamId: string;
  creditedMin: number;
  plannedMin: number;
  minWeekly: number;
  meetsFloor: boolean;
}

export interface WeeklyReport {
  weekStart: ISODate;
  weekEnd: ISODate;
  core: CompletionStats;
  optional: CompletionStats;
  displaced: number; // moved + dropped + missed this week
  avgSleep: number | null;
  sleepNights: number;
  avgConcentration: number | null;
  courseAccuracy: CourseAccuracy[];
  recurringCategories: { category: string; count: number }[]; // seen twice or more this week
  retestsDue: number; // due on or before today, not done
  retestsOverdue: number; // due before today
  retestsNext7: number;
  retestPassRate: number | null; // independent passes / retests taken this week
  workstreams: WorkstreamProgress[];
  outputs: { sessionId: string; workstreamId: string | null; date: ISODate; title: string; note: string }[];
}

export interface ReportInput {
  weekStart: ISODate;
  today: ISODate;
  rules: PlanningRules;
  sessions: Session[]; // sessions dated in this week
  checkins: CheckIn[]; // check-ins in this week
  timedSets: TimedSet[]; // sets in this week
  weekErrors: ErrorEntry[]; // errors created this week
  retests: Retest[]; // all retests of the term
  workstreams: Workstream[];
}

export function weeklyReport(i: ReportInput): WeeklyReport {
  const weekEnd = addDays(i.weekStart, 6);
  const w = i.rules.partialWeight;
  const core = completionStats(i.sessions.filter((x) => x.tier === 'core'), i.today, w);
  const optional = completionStats(i.sessions.filter((x) => x.tier === 'optional'), i.today, w);
  const displaced = i.sessions.filter((x) => x.status === 'moved' || x.status === 'dropped' || x.status === 'missed').length;
  const ws: WorkstreamProgress[] = i.workstreams
    .filter((x) => !x.archived)
    .map((x) => {
      const mine = i.sessions.filter((s) => s.workstreamId === x.id);
      const creditedMin = mine.reduce((a, s) => a + creditedMinutes(s, w), 0);
      const plannedMin = mine.filter((s) => s.status !== 'cancelled' && s.status !== 'dropped' && s.status !== 'moved').reduce((a, s) => a + s.durationMin, 0);
      return { workstreamId: x.id, creditedMin, plannedMin, minWeekly: x.minWeeklyMinutes, meetsFloor: creditedMin >= x.minWeeklyMinutes };
    });
  const taken = i.retests.filter((r) => r.doneDate && r.doneDate >= i.weekStart && r.doneDate <= weekEnd);
  const open = i.retests.filter((r) => !r.doneDate);
  return {
    weekStart: i.weekStart,
    weekEnd,
    core,
    optional,
    displaced,
    avgSleep: average(i.checkins.map((c) => c.sleepHours)),
    sleepNights: i.checkins.filter((c) => c.sleepHours != null).length,
    avgConcentration: average(i.checkins.map((c) => c.concentration)),
    courseAccuracy: accuracyByCourse(i.timedSets),
    recurringCategories: categoryCounts(i.weekErrors).filter((c) => c.count >= 2),
    retestsDue: open.filter((r) => r.dueDate <= i.today).length,
    retestsOverdue: open.filter((r) => r.dueDate < i.today).length,
    retestsNext7: open.filter((r) => r.dueDate > i.today && r.dueDate <= addDays(i.today, 7)).length,
    retestPassRate: taken.length ? Math.round((taken.filter((r) => r.outcome === 'pass').length / taken.length) * 100) / 100 : null,
    workstreams: ws,
    outputs: i.sessions
      .filter((s) => (s.status === 'done' || s.status === 'partial') && s.outputNote)
      .map((s) => ({ sessionId: s.id, workstreamId: s.workstreamId, date: s.date, title: s.title, note: s.outputNote as string })),
  };
}

export interface Recommendation {
  decision: ReviewDecision;
  reasons: string[];
  weakCourseIds: string[];
}

/**
 * Weekly decision from the configured rules. It is only a recommendation; the
 * user confirms it, and optional blocks are never enabled without approval.
 */
export function recommend(
  report: WeeklyReport,
  previous: WeeklyReport | null,
  rules: PlanningRules,
  termOpenErrors: ErrorEntry[],
  inactiveOptionalCount: number,
  activeOptionalCount: number,
): Recommendation {
  const reasons: string[] = [];
  const c = report.core.completion;
  const sleep = report.avgSleep;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  const weak = new Set<string>();
  for (const a of report.courseAccuracy) {
    if (a.accuracy !== null && a.accuracy < rules.weakCourse.accuracyBelow * 100) weak.add(a.workstreamId);
  }
  const perCourse = new Map<string, Map<string, number>>();
  for (const e of termOpenErrors) {
    const m = perCourse.get(e.workstreamId) ?? new Map<string, number>();
    m.set(e.category, (m.get(e.category) ?? 0) + 1);
    perCourse.set(e.workstreamId, m);
  }
  for (const [ws, m] of perCourse) {
    for (const n of m.values()) if (n >= rules.weakCourse.recurringErrorCount) weak.add(ws);
  }

  if (c === null) {
    return { decision: 'keep', reasons: ['No core blocks were scheduled or logged this week, so there is nothing to judge yet.'], weakCourseIds: [...weak] };
  }
  if (report.displaced > rules.backlog.maxDisplacedPerWeek) {
    reasons.push(`${report.displaced} blocks were missed, moved or dropped (limit ${rules.backlog.maxDisplacedPerWeek}). Next week's scope should shrink instead of carrying a backlog.`);
  }
  const lowCompletion = c < rules.reduce.belowCompletion;
  const lowSleep = sleep !== null && sleep < rules.reduce.belowSleep;
  if (lowCompletion || lowSleep) {
    if (lowCompletion) reasons.push(`Core completion was ${pct(c)}, below ${pct(rules.reduce.belowCompletion)}.`);
    if (lowSleep) reasons.push(`Average sleep was ${sleep} h, below ${rules.reduce.belowSleep} h.`);
    if (activeOptionalCount > 0) {
      reasons.push('Remove all optional blocks first.');
      return { decision: 'remove_optional', reasons, weakCourseIds: [...weak] };
    }
    if (report.displaced > rules.backlog.maxDisplacedPerWeek) return { decision: 'reduce_scope', reasons, weakCourseIds: [...weak] };
    reasons.push('No optional blocks are active. If the load still feels too heavy, choose "Reduce scope" to cut core blocks to each minimum.');
    return { decision: 'keep', reasons, weakCourseIds: [...weak] };
  }
  if (report.displaced > rules.backlog.maxDisplacedPerWeek) {
    return { decision: 'reduce_scope', reasons, weakCourseIds: [...weak] };
  }
  const o = rules.optional;
  const concDrop =
    o.requireNoConcentrationDrop &&
    previous?.avgConcentration != null &&
    report.avgConcentration != null &&
    report.avgConcentration < previous.avgConcentration;
  const sleepOk = sleep !== null && sleep >= o.minAvgSleep;
  if (c >= o.minCoreCompletion && sleepOk && !concDrop && inactiveOptionalCount > 0) {
    reasons.push(`Core completion ${pct(c)} ≥ ${pct(o.minCoreCompletion)}, sleep ${sleep} h ≥ ${o.minAvgSleep} h, and concentration did not drop.`);
    reasons.push(`You may add up to ${o.maxAddPerWeek} optional block next week, if you want it.`);
    return { decision: 'add_optional', reasons, weakCourseIds: [...weak] };
  }
  if (c < o.minCoreCompletion) reasons.push(`Core completion ${pct(c)} is below ${pct(o.minCoreCompletion)}, so no optional block is added.`);
  if (sleep === null) reasons.push('No sleep was logged, so optional work cannot be unlocked.');
  else if (!sleepOk) reasons.push(`Average sleep ${sleep} h is below ${o.minAvgSleep} h.`);
  if (concDrop) reasons.push('Concentration dropped compared with last week.');
  if (!reasons.length) reasons.push('Keep the current plan.');
  return { decision: 'keep', reasons, weakCourseIds: [...weak] };
}
