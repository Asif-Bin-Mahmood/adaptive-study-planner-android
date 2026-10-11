import { useState } from 'react';
import { formatDate } from '../../domain/dates';
import { accuracy } from '../../domain/metrics';
import type { ErrorEntry, RetestOutcome, TimedSet } from '../../domain/types';
import { courseLike, ErrorSheet, TimedSetSheet } from '../components/sheets';
import { useApp, useData } from '../ctx';
import { Chips, Empty, Icon } from '../kit';
import { wsColor, wsName } from '../loaders';

export function Practice() {
  const { repo, term, today, fail, toast } = useApp();
  const [course, setCourse] = useState<string | null>(null);
  const [logSet, setLogSet] = useState<TimedSet | true | null>(null);
  const [addError, setAddError] = useState<{ ws: string | null; set: string | null } | null>(null);
  const [openError, setOpenError] = useState<ErrorEntry | null>(null);
  const { data } = useData(async () => {
    const [ws, sets, errors, retests] = await Promise.all([repo.listWorkstreams(term.id, true), repo.listTimedSets(term.id), repo.listErrors(term.id), repo.listRetests(term.id)]);
    return { ws, sets, errors, retests };
  }, [term.id]);
  if (!data) return <div className="screen" aria-busy="true" />;
  const courses = courseLike(data.ws);
  const errById = new Map(data.errors.map((e) => [e.id, e]));
  const due = data.retests.filter((r) => !r.doneDate && r.dueDate <= today && errById.get(r.errorId)?.status === 'open' && (!course || errById.get(r.errorId)?.workstreamId === course));
  const sets = data.sets.filter((s) => !course || s.workstreamId === course);
  const open = data.errors.filter((e) => e.status === 'open' && (!course || e.workstreamId === course));

  const record = async (retestId: string, outcome: RetestOutcome) => {
    try {
      await repo.recordRetest(retestId, outcome, today, term.rules);
      toast(outcome === 'pass' ? 'Recorded: solved independently' : outcome === 'assisted' ? 'Recorded: needed help (does not count toward mastery)' : 'Recorded: not solved; another retest is scheduled');
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="screen">
      <div className="stack" style={{ gap: 12, paddingTop: 4 }}>
        <h1>Practice</h1>
        <div className="grid2">
          <button className="btn primary" onClick={() => setLogSet(true)}><Icon name="plus" size={18} /> Timed set</button>
          <button className="btn tonal" onClick={() => setAddError({ ws: course, set: null })}><Icon name="plus" size={18} /> Error</button>
        </div>
        {courses.length > 0 && (
          <Chips label="Filter by course" value={course} onChange={setCourse} options={courses.map((c) => ({ value: c.id, label: c.code ?? c.name }))} />
        )}
      </div>

      <section className="section" aria-labelledby="due-h">
        <h2 id="due-h">Retests due {due.length > 0 && `(${due.length})`}</h2>
        {due.length === 0 ? (
          <p className="muted small">Nothing due. Retests appear here about 2 days and 1 week after you log an error, and before the exam.</p>
        ) : (
          due.map((r) => {
            const e = errById.get(r.errorId)!;
            return (
              <div key={r.id} className="block">
                <button className="row" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpenError(e)}>
                  <span className="dot" style={{ background: wsColor(data.ws, e.workstreamId) }} />
                  <span className="stack" style={{ gap: 2 }}>
                    <span className="title">{e.question}</span>
                    <span className="meta">{wsName(data.ws, e.workstreamId)} · {e.category} · {r.label}{r.dueDate < today ? ` · due ${formatDate(r.dueDate, false)}` : ''}</span>
                    {e.correctionRule && <span className="meta">Rule: {e.correctionRule}</span>}
                  </span>
                </button>
                <div className="status3" role="group" aria-label="Retest result">
                  <button data-s="done" onClick={() => record(r.id, 'pass')}>Solved alone</button>
                  <button data-s="partial" onClick={() => record(r.id, 'assisted')}>With help</button>
                  <button data-s="missed" onClick={() => record(r.id, 'fail')}>Not yet</button>
                </div>
              </div>
            );
          })
        )}
      </section>

      <section className="section" aria-labelledby="sets-h">
        <h2 id="sets-h">Recent timed sets</h2>
        {sets.length === 0 ? (
          <Empty title="No timed sets yet"><p className="small">Marking a timed-set block done on Today asks for the score.</p></Empty>
        ) : (
          <div className="list">
            {sets.slice(0, 8).map((s) => {
              const acc = accuracy(s.attempted, s.correct);
              return (
                <button key={s.id} className="item" onClick={() => setLogSet(s)}>
                  <span className="dot" style={{ background: wsColor(data.ws, s.workstreamId) }} />
                  <span className="grow">
                    {wsName(data.ws, s.workstreamId)}{s.topic ? ` · ${s.topic}` : ''}
                    <br />
                    <span className="small muted">{formatDate(s.date)} · {s.correct ?? '–'}/{s.attempted ?? '–'}{s.minutes ? ` · ${s.minutes} min` : ''}</span>
                  </span>
                  <strong>{acc === null ? '—' : `${acc}%`}</strong>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="err-h">
        <h2 id="err-h">Open errors ({open.length})</h2>
        {open.length === 0 ? (
          <p className="muted small">No open errors.</p>
        ) : (
          <div className="list">
            {open.slice(0, 12).map((e) => (
              <button key={e.id} className="item" onClick={() => setOpenError(e)}>
                <span className="dot" style={{ background: wsColor(data.ws, e.workstreamId) }} />
                <span className="grow">{e.question}<br /><span className="small muted">{wsName(data.ws, e.workstreamId)} · {e.category}</span></span>
              </button>
            ))}
          </div>
        )}
        {data.errors.some((e) => e.status === 'mastered') && (
          <p className="tiny">{data.errors.filter((e) => e.status === 'mastered').length} mastered (solved independently on {term.rules.mastery.independentPassesRequired} separate days).</p>
        )}
      </section>

      {logSet && (
        <TimedSetSheet
          workstreams={data.ws}
          existing={logSet === true ? undefined : logSet}
          onClose={() => setLogSet(null)}
          onAddError={(ws, set) => setAddError({ ws, set })}
        />
      )}
      {addError && <ErrorSheet workstreams={data.ws} workstreamId={addError.ws} timedSetId={addError.set} onClose={() => setAddError(null)} />}
      {openError && <ErrorSheet workstreams={data.ws} existing={openError} onClose={() => setOpenError(null)} />}
    </div>
  );
}
