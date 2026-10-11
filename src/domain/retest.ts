// Spaced retests and the mastery rule for logged errors.
import { addDays } from './dates';
import type { ErrorStatus, ISODate, PlanningRules, Retest } from './types';

export interface RetestDraft {
  dueDate: ISODate;
  label: string;
}

function dayLabel(n: number): string {
  if (n % 7 === 0) return n === 7 ? '1 week' : `${n / 7} weeks`;
  return n === 1 ? '1 day' : `${n} days`;
}

/**
 * Default schedule: each configured offset after the error date, plus one the
 * day before the next exam for that course (if it falls after the last offset).
 */
export function buildRetests(
  errorDate: ISODate,
  rules: PlanningRules,
  nextExam: { date: ISODate; title: string } | null,
): RetestDraft[] {
  let out: RetestDraft[] = rules.retest.offsetsDays
    .slice()
    .sort((a, b) => a - b)
    .map((n) => ({ dueDate: addDays(errorDate, n), label: dayLabel(n) }));
  if (rules.retest.beforeExam && nextExam) {
    // spacing retests that would land on/after the exam are replaced by the pre-exam one
    out = out.filter((r) => r.dueDate < nextExam.date);
    const due = addDays(nextExam.date, -1);
    if (due > errorDate && !out.some((r) => r.dueDate === due)) out.push({ dueDate: due, label: `Before ${nextExam.title}` });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/**
 * Mastery needs N independent passes (outcome 'pass', never 'assisted'),
 * optionally on separate days. Viewing an explanation never counts.
 */
export function isMastered(retests: Retest[], rules: PlanningRules): boolean {
  const passes = retests.filter((r) => r.outcome === 'pass' && r.doneDate);
  const n = rules.mastery.separateDays ? new Set(passes.map((r) => r.doneDate)).size : passes.length;
  return n >= rules.mastery.independentPassesRequired;
}

export function errorStatusAfter(retests: Retest[], rules: PlanningRules, current: ErrorStatus): ErrorStatus {
  if (current === 'retired') return 'retired';
  return isMastered(retests, rules) ? 'mastered' : 'open';
}

/** After a failed or assisted attempt with no open retest left, schedule another one. */
export function followUpRetest(retests: Retest[], doneDate: ISODate, rules: PlanningRules): RetestDraft | null {
  const pending = retests.some((r) => !r.doneDate);
  if (pending) return null;
  if (isMastered(retests, rules)) return null;
  return { dueDate: addDays(doneDate, rules.retest.failRetryDays), label: `Retry in ${dayLabel(rules.retest.failRetryDays)}` };
}
