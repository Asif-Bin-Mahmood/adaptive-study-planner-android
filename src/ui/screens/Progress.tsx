import { useState } from 'react';
import { addDays, formatDate, startOfWeek } from '../../domain/dates';
import type { WeeklyReport } from '../../domain/metrics';
import { reduceScope } from '../../domain/replan';
import type { ReviewDecision } from '../../domain/types';
import { useApp, useData } from '../ctx';
import { Icon, Progress as Bar } from '../kit';
import { wsColor, wsName } from '../loaders';
import { computeRecommendation, computeWeek } from '../report';

const DECISIONS: { value: ReviewDecision; label: string; hint: string }[] = [
  { value: 'keep', label: 'Keep the plan', hint: 'No change next week' },
  { value: 'add_optional', label: 'Add one optional block', hint: 'Only when the rule is met' },
  { value: 'remove_optional', label: 'Remove optional blocks', hint: 'Back to core only' },
  { value: 'reduce_scope', label: 'Reduce scope', hint: 'Cut next week to each minimum' },
];

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function ProgressScreen() {
  const { repo, term, today, fail, toast } = useApp();
  const [weekStart, setWeekStart] = useState(startOfWeek(today, term.rules.weekStartsOn));
  const { data } = useData(async () => {
    const main = await computeRecommendation(repo, term, weekStart, today);
    const trend: { start: string; r: WeeklyReport }[] = [];
    for (let i = 5; i >= 0; i--) {
      const s = addDays(weekStart, -7 * i);
      trend.push({ start: s, r: i === 0 ? main.report : i === 1 ? main.previous : await computeWeek(repo, term, s, today) });
    }
    const [ws, review, templates] = await Promise.all([repo.listWorkstreams(term.id), repo.getReview(term.id, weekStart), repo.listTemplates(term.id)]);
    return { ...main, trend, ws, review, templates };
  }, [term.id, weekStart, today]);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  if (!data) return <div className="screen" aria-busy="true" />;
  const { report: r, previous: p, rec, ws } = data;
  const chosen = decision ?? data.review?.decision ?? rec.decision;
  const isCurrent = weekStart === startOfWeek(today, term.rules.weekStartsOn);
  const sleepDelta = r.avgSleep !== null && p.avgSleep !== null ? Math.round((r.avgSleep - p.avgSleep) * 10) / 10 : null;
  const concDelta = r.avgConcentration !== null && p.avgConcentration !== null ? Math.round((r.avgConcentration - p.avgConcentration) * 10) / 10 : null;
  const longTerm = r.workstreams
    .map((x) => ({ ...x, w: ws.find((y) => y.id === x.workstreamId)! }))
    .filter((x) => x.w && ['thesis', 'research', 'cyber', 'ml', 'project', 'lab'].includes(x.w.type) && (x.minWeekly > 0 || x.plannedMin > 0));

  const save = async () => {
    try {
      const next = addDays(weekStart, 7);
      if (chosen === 'remove_optional') {
        const active = data.templates.filter((t) => t.tier === 'optional' && t.active);
        if (active.length && !confirm(`Turn off ${active.length} optional block(s) from today? Past records stay.`)) return;
        for (const t of active) await repo.setTemplateActive(t.id, false, today);
      }
      if (chosen === 'reduce_scope') {
        await repo.ensureSessions(term.id, next, addDays(next, 6), false);
        const nextSessions = await repo.listSessions(term.id, next, addDays(next, 6));
        const actions = reduceScope(nextSessions, ws);
        if (actions.length && !confirm(`Reduce next week: ${actions.length} block(s) dropped or shortened to keep every workstream at its minimum. Continue?`)) return;
        if (actions.length) {
          await repo.applyProposal(term.id, today, { scenario: 'reduce_scope', title: 'Reduce scope', actions, warnings: [], reduceNextWeek: false, summary: [`Next week (${formatDate(next, false)}) reduced to minimums after the weekly review.`] });
        }
      }
      await repo.saveReview(term.id, weekStart, chosen, notes ?? data.review?.notes ?? null, { report: r, rec });
      toast(chosen === 'add_optional' ? 'Review saved. Choose the optional block under Plan › Edit plan › Weekly study blocks.' : 'Review saved');
      setDecision(null);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="screen">
      <div className="row" style={{ paddingTop: 4 }}>
        <button className="iconbtn" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><Icon name="back" /></button>
        <div className="spacer" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem' }}>{isCurrent ? 'This week' : `Week of ${formatDate(weekStart, false)}`}</h1>
          <p className="tiny">{formatDate(r.weekStart, false)} – {formatDate(r.weekEnd, false)}</p>
        </div>
        <button className="iconbtn" aria-label="Next week" disabled={isCurrent} onClick={() => setWeekStart(addDays(weekStart, 7))}><Icon name="next" /></button>
      </div>

      <section className="card stack" aria-label="Core completion" style={{ gap: 10 }}>
        <span className="small muted">Core blocks completed{isCurrent ? ' so far' : ''}</span>
        <span className="bigstat">{pct(r.core.completion)}</span>
        <span className="small muted">
          {r.core.done} done · {r.core.partial} partial (counts ½) · {r.core.missed} missed{r.core.notLogged ? ` (${r.core.notLogged} not logged)` : ''}
          {r.core.cancelled ? ` · ${r.core.cancelled} not scheduled` : ''}{r.core.dropped ? ` · ${r.core.dropped} dropped` : ''}{r.core.upcoming ? ` · ${r.core.upcoming} still ahead` : ''}
        </span>
        {r.optional.scheduled + r.optional.upcoming > 0 && <span className="small muted">Optional: {pct(r.optional.completion)}</span>}
        <div className="week-bars" aria-label="Core completion, last 6 weeks">
          {data.trend.map((t) => (
            <div key={t.start} className="col" title={`${formatDate(t.start, false)}: ${pct(t.r.core.completion)}`}>
              <div className={`b${t.r.core.completion === null ? ' none' : ''}`} style={{ height: `${Math.max(4, (t.r.core.completion ?? 0) * 70)}px` }} />
              <span>{formatDate(t.start, false).replace(/^\w+ /, '')}</span>
            </div>
          ))}
        </div>
        <p className="tiny">Last 6 weeks, by week start date. Are you keeping up with core work?</p>
      </section>

      <section className="grid2">
        <div className="card stack" style={{ gap: 4 }}>
          <span className="small muted">Average sleep</span>
          <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{r.avgSleep === null ? '—' : `${r.avgSleep} h`}</span>
          <span className="tiny">{r.sleepNights} night{r.sleepNights === 1 ? '' : 's'} logged{sleepDelta !== null ? ` · ${sleepDelta >= 0 ? '+' : ''}${sleepDelta} vs last week` : ''}</span>
        </div>
        <div className="card stack" style={{ gap: 4 }}>
          <span className="small muted">Focus (1–5)</span>
          <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{r.avgConcentration ?? '—'}</span>
          <span className="tiny">{concDelta !== null ? `${concDelta >= 0 ? '+' : ''}${concDelta} vs last week` : 'No comparison yet'}</span>
        </div>
      </section>

      <section className="section">
        <h2>Timed-set accuracy</h2>
        {r.courseAccuracy.length === 0 ? (
          <p className="muted small">No timed sets logged this week.</p>
        ) : (
          <div className="bars card">
            {r.courseAccuracy.map((a) => (
              <div key={a.workstreamId} className="bar-row">
                <span style={{ color: wsColor(ws, a.workstreamId), fontWeight: 600 }}>{wsName(ws, a.workstreamId)}</span>
                <Bar value={(a.accuracy ?? 0) / 100} label={`${wsName(ws, a.workstreamId)} accuracy`} />
                <span className="val">{a.accuracy === null ? '—' : `${a.accuracy}%`}</span>
              </div>
            ))}
            <p className="tiny">Below {Math.round(term.rules.weakCourse.accuracyBelow * 100)}% marks a course as needing attention.</p>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Mistakes and retests</h2>
        <div className="card stack">
          {r.recurringCategories.length ? (
            <p>Repeated this week: {r.recurringCategories.map((c) => `${c.category} (${c.count})`).join(', ')}</p>
          ) : (
            <p className="muted small">No error type repeated this week.</p>
          )}
          <p className="small">
            Retests: {r.retestsDue} due{r.retestsOverdue ? ` (${r.retestsOverdue} overdue)` : ''} · {r.retestsNext7} in the next 7 days
            {r.retestPassRate !== null ? ` · ${Math.round(r.retestPassRate * 100)}% solved independently this week` : ''}
          </p>
        </div>
      </section>

      {longTerm.length > 0 && (
        <section className="section">
          <h2>Labs, research and skills</h2>
          <div className="bars card">
            {longTerm.map((x) => (
              <div key={x.workstreamId} className="bar-row">
                <span className="small">{x.w.code ?? x.w.name}</span>
                <Bar value={x.minWeekly ? x.creditedMin / Math.max(x.minWeekly, 1) : x.plannedMin ? x.creditedMin / x.plannedMin : 0} label={`${x.w.name} minutes`} />
                <span className="val small">{x.creditedMin}m{x.minWeekly ? ` / ${x.minWeekly}` : ''}</span>
              </div>
            ))}
            <p className="tiny">Minutes credited against each weekly minimum.</p>
          </div>
          {r.outputs.length > 0 && (
            <details>
              <summary>Outputs recorded ({r.outputs.length})</summary>
              <div className="list">
                {r.outputs.map((o) => (
                  <div key={o.sessionId} className="item fixed">
                    <span className="grow small"><strong>{wsName(ws, o.workstreamId) || o.title}</strong> · {o.note}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <section className="card stack" aria-labelledby="review-h" style={{ gap: 12 }}>
        <h2 id="review-h">Weekly review</h2>
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">Suggested by your rules</span>
          <strong>{DECISIONS.find((d) => d.value === rec.decision)?.label}</strong>
          {rec.reasons.map((x) => <span key={x} className="small">{x}</span>)}
          {rec.weakCourseIds.length > 0 && <span className="small">Needs attention: {rec.weakCourseIds.map((id) => wsName(ws, id)).join(', ')}. The next earned rotation slot goes there.</span>}
        </div>
        <div className="stack" role="radiogroup" aria-label="Decision">
          {DECISIONS.map((d) => (
            <button key={d.value} type="button" role="radio" aria-checked={chosen === d.value} className="chip" aria-pressed={chosen === d.value} style={{ justifyContent: 'flex-start', minHeight: 48 }} onClick={() => setDecision(d.value)}>
              <span style={{ fontWeight: 600 }}>{d.label}</span>
              <span className="tiny" style={{ marginLeft: 'auto' }}>{d.hint}</span>
            </button>
          ))}
        </div>
        {chosen === 'add_optional' && rec.decision !== 'add_optional' && <p className="warn small">The rule is not met this week, so no optional block can be added from this review.</p>}
        <label className="field">
          <span className="label">Next-week changes (optional)</span>
          <input value={notes ?? data.review?.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button className="btn primary" onClick={save}>{data.review ? 'Update review' : 'Save review'}</button>
        {data.review && <p className="tiny">Saved {formatDate(data.review.createdAt.slice(0, 10))}: {DECISIONS.find((d) => d.value === data.review!.decision)?.label}</p>}
      </section>
    </div>
  );
}
