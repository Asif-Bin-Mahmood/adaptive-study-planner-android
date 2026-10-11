import type React from 'react';
import { useState } from 'react';
import { addDays, diffDays, formatDate, formatTime } from '../../domain/dates';
import type { Session } from '../../domain/types';
import { PlanSetup } from '../components/editors';
import { SessionBlock } from '../components/SessionBlock';
import { SessionSheet } from '../components/sheets';
import { useApp, useData } from '../ctx';
import { Icon, Segmented } from '../kit';
import { ASSESS_LABEL, loadRange, weekOf, wsColor } from '../loaders';

const STATUS_LABEL: Record<string, string> = {
  planned: '',
  done: 'Done',
  partial: 'Partial',
  missed: 'Missed',
  cancelled: 'Not scheduled',
  dropped: 'Dropped',
  moved: 'Moved',
};

export function Plan() {
  const { repo, term, today } = useApp();
  const [view, setView] = useState<'day' | 'week'>('week');
  const [anchor, setAnchor] = useState(today);
  const [open, setOpen] = useState<Session | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const range = view === 'day' ? { start: anchor, end: anchor } : weekOf(term, anchor);
  const { data } = useData(() => loadRange(repo, term, range.start, range.end), [term.id, range.start, range.end]);
  const changes = useData(() => repo.listChangesLog(term.id, 10), [term.id]).data ?? [];
  const upcoming = useData(async () => (await repo.listAssessments(term.id)).filter((a) => a.date >= today && diffDays(a.date, today) <= 30), [term.id, today]).data ?? [];

  const step = (n: number) => setAnchor(addDays(anchor, view === 'day' ? n : 7 * n));
  const label = view === 'day' ? formatDate(anchor) : `${formatDate(range.start, false)} – ${formatDate(range.end, false)}`;

  const dayItems = (d: string) => {
    if (!data) return null;
    const fixed = data.occurrences.get(d) ?? [];
    const exams = data.assessments.filter((a) => a.date === d);
    const sess = data.sessions.filter((s) => s.date === d && s.status !== 'moved');
    const exc = data.exceptions.filter((e) => d >= e.startDate && d <= e.endDate);
    type Row = { t: string; el: React.ReactElement };
    const rows: Row[] = [];
    for (const o of fixed)
      rows.push({
        t: o.startTime,
        el: (
          <div key={'f' + o.commitment.id + o.startTime} className="item fixed">
            <span className="tag fixed"><Icon name="lock" size={12} /> {o.commitment.kind === 'lab' ? 'Lab' : 'Class'}</span>
            <span className="grow">{o.commitment.title}{o.makeup ? ' (make-up)' : ''}</span>
            <span className="small">{formatTime(o.startTime)}</span>
          </div>
        ),
      });
    for (const a of exams)
      rows.push({
        t: a.startTime ?? '00:00',
        el: (
          <div key={'a' + a.id} className="item fixed">
            <span className="tag exam">{ASSESS_LABEL[a.kind]}</span>
            <span className="grow">{a.title}</span>
            <span className="small">{a.startTime ? formatTime(a.startTime) : 'Due'}</span>
          </div>
        ),
      });
    for (const s of sess)
      rows.push({
        t: s.startTime ?? '99:99',
        el: (
          <button key={s.id} className="item" onClick={() => setOpen(s)}>
            <span className="dot" style={{ background: wsColor(data.workstreams, s.workstreamId) }} />
            <span className="grow" style={{ opacity: s.status === 'cancelled' || s.status === 'dropped' ? 0.6 : 1 }}>
              {s.title}
              <br />
              <span className="small muted">
                {s.startTime ? formatTime(s.startTime) : 'Any time'} · {s.durationMin} min
                {STATUS_LABEL[s.status] ? ` · ${STATUS_LABEL[s.status]}` : ''}
              </span>
            </span>
            {s.origin === 'replan' && <span className="tag changed">Changed</span>}
            {s.tier === 'optional' && <span className="tag optional">Optional</span>}
          </button>
        ),
      });
    rows.sort((a, b) => a.t.localeCompare(b.t));
    return { rows, exc, sess };
  };

  return (
    <div className="screen">
      <div className="stack" style={{ gap: 12, paddingTop: 4 }}>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
        <div className="row">
          <button className="iconbtn" onClick={() => step(-1)} aria-label="Previous"><Icon name="back" /></button>
          <h2 className="spacer" style={{ textAlign: 'center' }}>{label}</h2>
          <button className="iconbtn" onClick={() => step(1)} aria-label="Next"><Icon name="next" /></button>
        </div>
        {anchor !== today && <button className="btn text" onClick={() => setAnchor(today)}>Back to today</button>}
      </div>

      {view === 'week' && upcoming.length > 0 && anchor === today && (
        <section className="section">
          <h2>Next 30 days</h2>
          <div className="list">
            {upcoming.map((a) => (
              <div key={a.id} className="item fixed">
                <span className="tag exam">{ASSESS_LABEL[a.kind]}</span>
                <span className="grow">{a.title}</span>
                <span className="small">{formatDate(a.date)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && view === 'week' &&
        Array.from({ length: 7 }, (_, i) => addDays(range.start, i)).map((d) => {
          const r = dayItems(d)!;
          return (
            <section key={d} className="section" aria-label={formatDate(d)}>
              <div className="section-head">
                <h3 style={d === today ? { color: 'var(--primary)' } : undefined}>{formatDate(d)}{d === today ? ' · Today' : ''}</h3>
                <button className="btn text" onClick={() => setAdding(d)} aria-label={`Add block on ${formatDate(d)}`}><Icon name="plus" size={18} /></button>
              </div>
              {r.exc.map((e) => <p key={e.id} className="tiny">{e.name}</p>)}
              {r.rows.length ? <div className="list">{r.rows.map((x) => x.el)}</div> : <p className="tiny">Nothing planned.</p>}
            </section>
          );
        })}

      {data && view === 'day' && (() => {
        const r = dayItems(anchor)!;
        return (
          <section className="section">
            {r.exc.map((e) => <p key={e.id} className="warn">{e.name}</p>)}
            {(data.occurrences.get(anchor) ?? []).length + data.assessments.filter((a) => a.date === anchor).length > 0 && (
              <div className="list">{r.rows.filter((x) => /^[fa]/.test(String(x.el.key))).map((x) => x.el)}</div>
            )}
            <h2>Study blocks</h2>
            {r.sess.length === 0 && <p className="muted">No study blocks.</p>}
            {r.sess.map((s) => <SessionBlock key={s.id} session={s} workstreams={data.workstreams} onOpen={setOpen} compact />)}
            <button className="btn" onClick={() => setAdding(anchor)}><Icon name="plus" size={18} /> Add a block</button>
          </section>
        );
      })()}

      <button className="btn tonal block" onClick={() => setSetup(true)}>Edit plan: courses, classes, exams, weekly blocks</button>

      {changes.length > 0 && (
        <details>
          <summary>Recent changes ({changes.length})</summary>
          <div className="list">
            {changes.map((c) => (
              <div key={c.id} className="item fixed" style={{ alignItems: 'flex-start' }}>
                <span className="grow small">
                  <strong>{formatDate(c.date)}</strong> · {c.summary}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {open && data && <SessionSheet session={open} workstreams={data.workstreams} onClose={() => setOpen(null)} />}
      {adding && data && <SessionSheet date={adding} workstreams={data.workstreams} onClose={() => setAdding(null)} />}
      {setup && <PlanSetup onClose={() => setSetup(false)} />}
    </div>
  );
}
