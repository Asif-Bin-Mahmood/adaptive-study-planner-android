// Pure scheduling helpers: expanding recurring commitments, generating study
// sessions from templates, and detecting conflicts before a change is saved.
import { addDays, blockHitsSleep, diffDays, inRange, isHHMM, overlaps, toMinutes, weekday } from './dates';
import type {
  Assessment,
  Commitment,
  CommitmentChange,
  DateException,
  HHMM,
  ISODate,
  PlanningRules,
  Session,
  SessionStatus,
  StudyTemplate,
} from './types';

export interface Occurrence {
  commitment: Commitment;
  date: ISODate;
  startTime: HHMM;
  endTime: HHMM;
  makeup: boolean;
}

export function exceptionsOn(date: ISODate, exceptions: DateException[]): DateException[] {
  return exceptions.filter((e) => inRange(date, e.startDate, e.endDate));
}

export function classesCancelledOn(date: ISODate, exceptions: DateException[]): DateException | undefined {
  return exceptionsOn(date, exceptions).find((e) => e.cancelsClasses);
}

export function studySuppressedOn(date: ISODate, exceptions: DateException[]): DateException | undefined {
  return exceptionsOn(date, exceptions).find((e) => e.suppressesStudy);
}

/** Why a regular occurrence does not happen on `date`, or null if it does. */
export function occurrenceCancelReason(
  c: Commitment,
  date: ISODate,
  changes: CommitmentChange[],
  exceptions: DateException[],
): string | null {
  const change = changes.find((x) => x.commitmentId === c.id && x.date === date && x.kind === 'cancelled');
  if (change) return change.reason || 'Cancelled';
  const ex = classesCancelledOn(date, exceptions);
  if (ex) return ex.name;
  return null;
}

/** Fixed commitments that actually take place on `date`. */
export function occurrencesOn(
  date: ISODate,
  commitments: Commitment[],
  changes: CommitmentChange[],
  exceptions: DateException[],
): Occurrence[] {
  const out: Occurrence[] = [];
  const wd = weekday(date);
  for (const c of commitments) {
    if (inRange(date, c.validFrom, c.validTo) && c.weekdays.includes(wd)) {
      if (!occurrenceCancelReason(c, date, changes, exceptions)) {
        out.push({ commitment: c, date, startTime: c.startTime, endTime: c.endTime, makeup: false });
      }
    }
  }
  for (const ch of changes) {
    if (ch.kind === 'makeup' && ch.date === date && ch.startTime && ch.endTime) {
      const c = commitments.find((x) => x.id === ch.commitmentId);
      if (c) out.push({ commitment: c, date, startTime: ch.startTime, endTime: ch.endTime, makeup: true });
    }
  }
  return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Date of the commitment occurrence a template depends on (same day or next matching weekday). */
export function dependencyDate(t: StudyTemplate, date: ISODate): ISODate | null {
  if (!t.dependsOnCommitmentId || t.dependsOnWeekday === null) return null;
  return addDays(date, (t.dependsOnWeekday - weekday(date) + 7) % 7);
}

export interface SessionDraft {
  templateId: string;
  date: ISODate;
  status: SessionStatus; // 'planned' or 'cancelled'
  reason: string | null;
}

/**
 * Which sessions the active templates produce in [start, end]. Holidays and
 * cancelled classes yield 'cancelled' (not scheduled) rows for dependent blocks
 * so they are visible but never counted as missed. Days with their own plan
 * (suppressesStudy) produce nothing.
 */
export function draftSessions(
  start: ISODate,
  end: ISODate,
  templates: StudyTemplate[],
  commitments: Commitment[],
  changes: CommitmentChange[],
  exceptions: DateException[],
): SessionDraft[] {
  const out: SessionDraft[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (studySuppressedOn(d, exceptions)) continue;
    const wd = weekday(d);
    for (const t of templates) {
      if (!t.active || t.weekday !== wd || !inRange(d, t.validFrom, t.validTo)) continue;
      let status: SessionStatus = 'planned';
      let reason: string | null = null;
      const depDate = dependencyDate(t, d);
      if (depDate && t.dependsOnCommitmentId) {
        const c = commitments.find((x) => x.id === t.dependsOnCommitmentId);
        if (c) {
          const why = occurrenceCancelReason(c, depDate, changes, exceptions);
          const outside = !inRange(depDate, c.validFrom, c.validTo);
          if (why || outside) {
            status = 'cancelled';
            reason = `Not scheduled: ${c.title} does not take place on ${depDate}${why ? ` (${why})` : ''}`;
          }
        }
      }
      out.push({ templateId: t.id, date: d, status, reason });
    }
  }
  return out;
}

export interface ConflictInput {
  date: ISODate;
  startTime: HHMM | null;
  durationMin: number;
  ignoreSessionId?: string;
}

export interface ConflictContext {
  occurrences: Occurrence[]; // fixed commitments on that date
  assessments: Assessment[];
  sessions: Session[]; // sessions on that date
  rules: PlanningRules;
  exceptions: DateException[];
}

/** Human-readable conflicts for a proposed block. Empty list = safe to save. */
export function findConflicts(input: ConflictInput, ctx: ConflictContext): string[] {
  const out: string[] = [];
  const suppressed = studySuppressedOn(input.date, ctx.exceptions);
  if (suppressed) out.push(`${input.date} has its own plan (${suppressed.name}).`);
  for (const a of ctx.assessments) {
    if (a.date === input.date && (a.kind === 'midterm' || a.kind === 'final') && !a.startTime) {
      out.push(`Exam day: ${a.title}.`);
    }
  }
  if (!input.startTime || !isHHMM(input.startTime)) return out;
  const s = toMinutes(input.startTime);
  const e = s + input.durationMin;
  for (const o of ctx.occurrences) {
    if (overlaps(s, e, toMinutes(o.startTime), toMinutes(o.endTime))) {
      out.push(`Overlaps fixed ${o.commitment.kind} ${o.commitment.title} (${o.startTime}–${o.endTime}).`);
    }
  }
  for (const a of ctx.assessments) {
    if (a.date === input.date && a.startTime && a.endTime && overlaps(s, e, toMinutes(a.startTime), toMinutes(a.endTime))) {
      out.push(`Overlaps ${a.title} (${a.startTime}–${a.endTime}).`);
    }
  }
  for (const x of ctx.sessions) {
    if (x.id === input.ignoreSessionId || x.date !== input.date || !x.startTime) continue;
    if (x.status !== 'planned') continue;
    const xs = toMinutes(x.startTime);
    if (overlaps(s, e, xs, xs + x.durationMin)) out.push(`Overlaps study block ${x.title} (${x.startTime}).`);
  }
  const { lightsOut, wake } = ctx.rules.sleep;
  if (blockHitsSleep(input.startTime, input.durationMin, lightsOut, wake)) {
    out.push(`Runs into protected sleep (${lightsOut}–${wake}).`);
  }
  return out;
}

/** Days until the next confirmed exam/deadline for a workstream (or null). */
export function daysToNextAssessment(
  workstreamId: string | null,
  from: ISODate,
  assessments: Assessment[],
  kinds?: Assessment['kind'][],
): { days: number; assessment: Assessment } | null {
  let best: { days: number; assessment: Assessment } | null = null;
  for (const a of assessments) {
    if (workstreamId && a.workstreamId !== workstreamId) continue;
    if (kinds && !kinds.includes(a.kind)) continue;
    const d = diffDays(a.date, from);
    if (d < 0) continue;
    if (!best || d < best.days) best = { days: d, assessment: a };
  }
  return best;
}
