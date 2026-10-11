// Builds weekly reports and the optional-block gate from stored records.
import { addDays, startOfWeek } from '../domain/dates';
import { recommend, weeklyReport, type Recommendation, type WeeklyReport } from '../domain/metrics';
import type { ISODate, Term } from '../domain/types';
import type { Repo } from '../data/repo';

export async function computeWeek(repo: Repo, term: Term, weekStart: ISODate, today: ISODate): Promise<WeeklyReport> {
  const end = addDays(weekStart, 6);
  await repo.ensureSessions(term.id, weekStart, end, false);
  const [sessions, checkins, timedSets, errors, retests, workstreams] = await Promise.all([
    repo.listSessions(term.id, weekStart, end),
    repo.listCheckIns(weekStart, end),
    repo.listTimedSets(term.id, weekStart, end),
    repo.listErrors(term.id),
    repo.listRetests(term.id),
    repo.listWorkstreams(term.id),
  ]);
  return weeklyReport({
    weekStart,
    today,
    rules: term.rules,
    sessions,
    checkins,
    timedSets,
    weekErrors: errors.filter((e) => e.date >= weekStart && e.date <= end),
    retests,
    workstreams,
  });
}

export async function computeRecommendation(repo: Repo, term: Term, weekStart: ISODate, today: ISODate): Promise<{ report: WeeklyReport; previous: WeeklyReport; rec: Recommendation }> {
  const report = await computeWeek(repo, term, weekStart, today);
  const previous = await computeWeek(repo, term, addDays(weekStart, -7), today);
  const [errors, templates] = await Promise.all([repo.listErrors(term.id, 'open'), repo.listTemplates(term.id)]);
  const optional = templates.filter((t) => t.tier === 'optional');
  const rec = recommend(report, previous, term.rules, errors, optional.filter((t) => !t.active).length, optional.filter((t) => t.active).length);
  return { report, previous, rec };
}

/**
 * Optional blocks may only be added after a saved weekly review (this week's or
 * last week's) whose rule check allowed it and in which you chose "Add one
 * optional block", at most `maxAddPerWeek` per review.
 */
export async function optionalGate(repo: Repo, term: Term, today: ISODate): Promise<{ allowed: boolean; reasons: string[]; reviewWeek: ISODate | null }> {
  const thisWeek = startOfWeek(today, term.rules.weekStartsOn);
  const lastWeek = addDays(thisWeek, -7);
  const review = (await repo.getReview(term.id, thisWeek)) ?? (await repo.getReview(term.id, lastWeek));
  if (!review) {
    const { rec } = await computeRecommendation(repo, term, lastWeek, today);
    return { allowed: false, reviewWeek: null, reasons: ['Save a weekly review first (Progress tab). Optional blocks are added only from a review.', ...rec.reasons] };
  }
  const snap = review.snapshot as { rec?: { decision?: string; reasons?: string[] } } | null;
  const ruleOk = snap?.rec?.decision === 'add_optional';
  if (!ruleOk) return { allowed: false, reviewWeek: review.weekStart, reasons: snap?.rec?.reasons ?? ['The last review did not meet the rule for adding optional work.'] };
  if (review.decision !== 'add_optional') return { allowed: false, reviewWeek: review.weekStart, reasons: ['In the last review you chose not to add optional work.'] };
  const added = Number((await repo.getMeta(`optional_added:${term.id}:${review.weekStart}`)) ?? 0);
  if (added >= term.rules.optional.maxAddPerWeek) {
    return { allowed: false, reviewWeek: review.weekStart, reasons: [`You already added ${added} optional block after this review (limit ${term.rules.optional.maxAddPerWeek}).`] };
  }
  return { allowed: true, reviewWeek: review.weekStart, reasons: snap?.rec?.reasons ?? [] };
}

export async function recordOptionalAdded(repo: Repo, term: Term, reviewWeek: ISODate) {
  const key = `optional_added:${term.id}:${reviewWeek}`;
  const n = Number((await repo.getMeta(key)) ?? 0);
  await repo.tx.run(() => repo.setMeta(key, String(n + 1)));
}
