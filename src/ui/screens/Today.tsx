import { useState } from 'react';
import { diffDays, formatDate, formatTime, nowHHMM, weekdayLong, weekday } from '../../domain/dates';
import type { Session, SessionStatus } from '../../domain/types';
import { SessionBlock } from '../components/SessionBlock';
import { SessionSheet, TimedSetSheet, ErrorSheet } from '../components/sheets';
import { useApp, useData } from '../ctx';
import { Chips, Empty, Icon, Progress } from '../kit';
import { loadRange } from '../loaders';

const SLEEP = [5, 6, 6.5, 7, 7.5, 8, 9].map((v) => ({ value: v, label: `${v} h` }));
const FOCUS = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));
const MAX_VISIBLE = 4;

export function Today() {
  const { repo, term, today, openReplan, fail, toast } = useApp();
  const { data } = useData(() => loadRange(repo, term, today, today), [term.id, today]);
  const checkin = useData(() => repo.getCheckIn(today), [today]).data;
  const [showAll, setShowAll] = useState(false);
  const [editCheckin, setEditCheckin] = useState(false);
  const [open, setOpen] = useState<Session | null>(null);
  const [scoreFor, setScoreFor] = useState<Session | null>(null);
  const [errorFor, setErrorFor] = useState<{ ws: string; set: string } | null>(null);

  if (!data) return <div className="screen" aria-busy="true" />;
  const ws = data.workstreams;
  const sessions = data.sessions.filter((s) => s.status !== 'moved');
  const active = sessions.filter((s) => s.status !== 'cancelled' && s.status !== 'dropped');
  const finished = active.filter((s) => s.status === 'done' || s.status === 'partial').length;
  const now = nowHHMM();
  const planned = active.filter((s) => s.status === 'planned');
  const next = planned.find((s) => !s.startTime || s.startTime >= now) ?? planned[0] ?? null;
  const rest = sessions.filter((s) => s.id !== next?.id);
  const visible = showAll ? rest : rest.slice(0, MAX_VISIBLE);
  const fixed = data.occurrences.get(today) ?? [];
  const soon = data.assessments
    .filter((a) => diffDays(a.date, today) >= 0 && diffDays(a.date, today) <= 3)
    .sort((a, b) => a.date.localeCompare(b.date));
  const trial = term.rules.trial;
  const inTrial = trial.start && trial.end && today >= trial.start && today <= trial.end;
  const beforeTrial = trial.start && today < trial.start;

  const onLogged = (s: Session, status: SessionStatus) => {
    if (s.kind === 'timed_set' && (status === 'done' || status === 'partial')) {
      setScoreFor(s);
      return;
    }
    toast({ text: status === 'done' ? 'Marked done' : status === 'partial' ? 'Marked partial' : 'Marked missed', action: { label: 'Add note', run: () => setOpen(s) } });
  };

  const saveCheckin = async (patch: { sleepHours?: number | null; concentration?: number | null }) => {
    try {
      await repo.saveCheckIn({ date: today, ...patch });
    } catch (e) {
      fail(e);
    }
  };
  const checkinDone = checkin?.sleepHours != null && checkin?.concentration != null && !editCheckin;

  return (
    <div className="screen">
      <header className="stack" style={{ gap: 4, paddingTop: 4 }}>
        <h1>{weekdayLong(weekday(today))}, {formatDate(today, false)}</h1>
        {inTrial && <p className="muted small">Trial weeks · {formatDate(trial.start!, false)} – {formatDate(trial.end!, false)}</p>}
        {active.length > 0 && (
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            <span className="small muted">{finished} of {active.length} study blocks logged as done or partial</span>
            <Progress value={active.length ? finished / active.length : 0} label="Today's progress" />
          </div>
        )}
      </header>

      {soon.map((a) => (
        <div key={a.id} className="warn">
          <strong>{a.title}</strong> {a.date === today ? 'is today' : `on ${formatDate(a.date)}`}
          {a.startTime ? ` at ${formatTime(a.startTime)}` : ''}.
        </div>
      ))}

      {next ? (
        <section className="section" aria-labelledby="next-h">
          <h2 id="next-h">Next</h2>
          <SessionBlock session={next} workstreams={ws} onLogged={onLogged} onOpen={setOpen} />
        </section>
      ) : (
        active.length === 0 && (
          <Empty title="No study blocks today">
            <p className="small">{beforeTrial ? `Your plan's study blocks start on ${formatDate(trial.start!)}. Until then, just log sleep and focus.` : 'Use the time as buffer, or add a block from Plan.'}</p>
          </Empty>
        )
      )}

      {rest.length > 0 && (
        <section className="section" aria-label="Rest of today">
          <h2>Rest of today</h2>
          {visible.map((s) => (
            <SessionBlock key={s.id} session={s} workstreams={ws} onLogged={onLogged} onOpen={setOpen} compact />
          ))}
          {rest.length > MAX_VISIBLE && (
            <button className="btn text" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show less' : `Show all ${rest.length}`}
            </button>
          )}
        </section>
      )}

      <button className="btn tonal block" onClick={openReplan}>
        <Icon name="replan" /> Replan my day
      </button>

      <section className="card stack" aria-labelledby="checkin-h" style={{ gap: 12 }}>
        <div className="section-head">
          <h2 id="checkin-h">Check-in</h2>
          {checkinDone && <button className="btn text" onClick={() => setEditCheckin(true)}>Edit</button>}
        </div>
        {checkinDone ? (
          <p className="muted">Slept {checkin!.sleepHours} h · Focus {checkin!.concentration} of 5</p>
        ) : (
          <>
            <div className="stack">
              <span className="small muted">Sleep last night</span>
              <Chips label="Hours slept" value={checkin?.sleepHours ?? null} options={SLEEP} onChange={(v) => saveCheckin({ sleepHours: v })} />
            </div>
            <div className="stack">
              <span className="small muted">Focus today (1 = very poor, 5 = very good)</span>
              <Chips label="Focus" value={checkin?.concentration ?? null} options={FOCUS} onChange={(v) => saveCheckin({ concentration: v })} tap />
            </div>
            {editCheckin && <button className="btn text" onClick={() => setEditCheckin(false)}>Done</button>}
          </>
        )}
      </section>

      {fixed.length > 0 && (
        <details>
          <summary>Fixed today ({fixed.length})</summary>
          <div className="list">
            {fixed.map((o) => (
              <div key={o.commitment.id + o.startTime} className="item fixed">
                <span className="tag fixed"><Icon name="lock" size={12} /> Fixed</span>
                <span className="grow">{o.commitment.title}{o.commitment.location ? ` · ${o.commitment.location}` : ''}</span>
                <span className="small">{formatTime(o.startTime)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {open && <SessionSheet session={open} workstreams={ws} onClose={() => setOpen(null)} />}
      {scoreFor && (
        <TimedSetSheet
          workstreams={ws}
          session={scoreFor}
          onClose={() => setScoreFor(null)}
          onAddError={(w, set) => setErrorFor({ ws: w, set })}
        />
      )}
      {errorFor && <ErrorSheet workstreams={ws} workstreamId={errorFor.ws} timedSetId={errorFor.set} onClose={() => setErrorFor(null)} />}
    </div>
  );
}
