import { isHHMM, isISODate } from './dates';
import type { PlanningRules } from './types';

/** Generic defaults for a brand-new semester. A term stores its own copy. */
export function defaultRules(): PlanningRules {
  return {
    sleep: { lightsOut: '22:45', wake: '06:15', noDeepWorkAfter: '21:30' },
    weekStartsOn: 0,
    partialWeight: 0.5,
    optional: {
      enabled: false,
      minCoreCompletion: 0.85,
      minAvgSleep: 7,
      requireNoConcentrationDrop: true,
      maxAddPerWeek: 1,
    },
    reduce: { belowCompletion: 0.7, belowSleep: 7 },
    weakCourse: { accuracyBelow: 0.6, recurringErrorCount: 3 },
    disruptedDay: { maxFlexibleItems: 2, continuityMinutes: 10, shortenToMinutes: 25 },
    backlog: { maxDisplacedPerWeek: 3, nextDayMaxMoved: 1 },
    retest: { offsetsDays: [2, 7], beforeExam: true, failRetryDays: 2 },
    mastery: { independentPassesRequired: 2, separateDays: true },
    dailyBufferMinutes: 60,
    errorCategories: ['Knowledge gap', 'Misunderstanding', 'Execution error', 'Question-reading error', 'Other'],
    notifications: { enabled: false, minutesBefore: 10 },
    trial: { start: null, end: null },
  };
}

/** Merge stored (possibly older / partial) rules over defaults, then validate. */
export function normalizeRules(input: unknown): PlanningRules {
  const d = defaultRules();
  const r = (input && typeof input === 'object' ? input : {}) as Partial<PlanningRules>;
  const merged: PlanningRules = {
    ...d,
    ...r,
    sleep: { ...d.sleep, ...(r.sleep ?? {}) },
    optional: { ...d.optional, ...(r.optional ?? {}) },
    reduce: { ...d.reduce, ...(r.reduce ?? {}) },
    weakCourse: { ...d.weakCourse, ...(r.weakCourse ?? {}) },
    disruptedDay: { ...d.disruptedDay, ...(r.disruptedDay ?? {}) },
    backlog: { ...d.backlog, ...(r.backlog ?? {}) },
    retest: { ...d.retest, ...(r.retest ?? {}) },
    mastery: { ...d.mastery, ...(r.mastery ?? {}) },
    notifications: { ...d.notifications, ...(r.notifications ?? {}) },
    trial: { ...d.trial, ...(r.trial ?? {}) },
    errorCategories: Array.isArray(r.errorCategories) && r.errorCategories.length ? r.errorCategories : d.errorCategories,
  };
  const problems = validateRules(merged);
  if (problems.length) throw new Error('Invalid planning rules: ' + problems.join('; '));
  return merged;
}

export function validateRules(r: PlanningRules): string[] {
  const p: string[] = [];
  const frac = (v: number, name: string) => {
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) p.push(`${name} must be between 0 and 1`);
  };
  const pos = (v: number, name: string, allowZero = true) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (!allowZero && v === 0)) p.push(`${name} must be a positive number`);
  };
  if (!isHHMM(r.sleep.lightsOut) || !isHHMM(r.sleep.wake) || !isHHMM(r.sleep.noDeepWorkAfter)) p.push('sleep times must be HH:MM');
  if (!(r.weekStartsOn >= 0 && r.weekStartsOn <= 6)) p.push('weekStartsOn must be 0-6');
  frac(r.partialWeight, 'partialWeight');
  frac(r.optional.minCoreCompletion, 'optional.minCoreCompletion');
  frac(r.reduce.belowCompletion, 'reduce.belowCompletion');
  frac(r.weakCourse.accuracyBelow, 'weakCourse.accuracyBelow');
  pos(r.optional.minAvgSleep, 'optional.minAvgSleep');
  pos(r.reduce.belowSleep, 'reduce.belowSleep');
  pos(r.disruptedDay.maxFlexibleItems, 'disruptedDay.maxFlexibleItems', false);
  pos(r.backlog.maxDisplacedPerWeek, 'backlog.maxDisplacedPerWeek');
  pos(r.backlog.nextDayMaxMoved, 'backlog.nextDayMaxMoved');
  pos(r.mastery.independentPassesRequired, 'mastery.independentPassesRequired', false);
  if (!Array.isArray(r.retest.offsetsDays) || r.retest.offsetsDays.some((n) => !(n > 0))) p.push('retest.offsetsDays must be positive day counts');
  if (r.trial.start !== null && !isISODate(r.trial.start)) p.push('trial.start must be a date');
  if (r.trial.end !== null && !isISODate(r.trial.end)) p.push('trial.end must be a date');
  return p;
}
