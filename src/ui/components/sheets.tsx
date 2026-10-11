import { useMemo, useState } from 'react';
import { formatDate, isHHMM, isISODate } from '../../domain/dates';
import { accuracy } from '../../domain/metrics';
import { buildRetests } from '../../domain/retest';
import { findConflicts, occurrencesOn } from '../../domain/schedule';
import type { BlockKind, ErrorEntry, ISODate, Session, Tier, TimedSet, Workstream } from '../../domain/types';
import { useApp, useData } from '../ctx';
import { Chips, Field, NumInput, Sheet } from '../kit';
import { KIND_LABEL } from '../loaders';

/** Courses and labs with a code, courses first: the things timed sets and errors belong to. */
export const courseLike = (ws: Workstream[]) =>
  ws
    .filter((w) => !w.archived && (w.type === 'course' || w.type === 'lab') && w.code)
    .sort((a, b) => (a.type === b.type ? (a.code ?? '').localeCompare(b.code ?? '') : a.type === 'course' ? -1 : 1));

// ---------------------------------------------------------------- study block
export function SessionSheet(props: { session?: Session; date?: ISODate; workstreams: Workstream[]; onClose: () => void }) {
  const { repo, term, fail, toast } = useApp();
  const s = props.session;
  const editable = !s || s.origin !== 'template';
  const [title, setTitle] = useState(s?.title ?? '');
  const [workstreamId, setWs] = useState<string | null>(s?.workstreamId ?? null);
  const [date, setDate] = useState(s?.date ?? props.date ?? '');
  const [startTime, setStart] = useState(s?.startTime ?? '');
  const [duration, setDuration] = useState<number | null>(s?.durationMin ?? 45);
  const [kind, setKind] = useState<BlockKind>(s?.kind ?? 'deep');
  const [tier, setTier] = useState<Tier>(s?.tier ?? 'core');
  const [output, setOutput] = useState(s?.output ?? '');
  const [actual, setActual] = useState<number | null>(s?.actualMinutes ?? null);
  const [note, setNote] = useState(s?.outputNote ?? '');
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (force = false) => {
    setProblem(null);
    try {
      if (editable) {
        if (!title.trim()) return setProblem('Give the block a title.');
        if (!isISODate(date)) return setProblem('Choose a date.');
        if (startTime && !isHHMM(startTime)) return setProblem('Time must be HH:MM.');
        if (!duration || duration <= 0) return setProblem('Duration must be more than 0 minutes.');
        if (!force) {
          const [commitments, changes, exceptions, assessments, sessions] = await Promise.all([
            repo.listCommitments(term.id),
            repo.listChanges(term.id),
            repo.listExceptions(term.id),
            repo.listAssessments(term.id),
            repo.listSessions(term.id, date, date),
          ]);
          const found = findConflicts(
            { date, startTime: startTime || null, durationMin: duration, ignoreSessionId: s?.id },
            { occurrences: occurrencesOn(date, commitments, changes, exceptions), assessments, sessions, rules: term.rules, exceptions },
          );
          if (found.length) return setConflicts(found);
        }
        await repo.saveManualSession({
          id: s?.id,
          termId: term.id,
          workstreamId,
          assessmentId: s?.assessmentId ?? null,
          date,
          startTime: startTime || null,
          durationMin: duration,
          title,
          output: output || null,
          kind,
          tier,
          status: s?.status ?? 'planned',
          actualMinutes: null,
          outputNote: null,
        });
      }
      if (s && (actual !== s.actualMinutes || (note || null) !== s.outputNote)) {
        await repo.updateSessionDetails(s.id, { actualMinutes: actual, outputNote: note || null });
      }
      toast('Saved');
      props.onClose();
    } catch (e) {
      fail(e);
    }
  };

  const drop = async () => {
    if (!s) return;
    try {
      await repo.setSessionStatus(s.id, 'dropped');
      toast('Marked as not needed this week. It is not counted as missed.');
      props.onClose();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Sheet
      title={s ? 'Study block' : 'New study block'}
      onClose={props.onClose}
      footer={
        conflicts ? (
          <>
            <button className="btn" onClick={() => setConflicts(null)}>Change it</button>
            <button className="btn primary" onClick={() => save(true)}>Save anyway</button>
          </>
        ) : (
          <button className="btn primary" onClick={() => save()}>Save</button>
        )
      }
    >
      {conflicts && (
        <div className="warn" role="alert">
          <strong>Check before saving:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {problem && <div className="err" role="alert">{problem}</div>}
      {editable ? (
        <>
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. MATH201 problem set" />
          </Field>
          <Field label="Workstream">
            <select value={workstreamId ?? ''} onChange={(e) => setWs(e.target.value || null)}>
              <option value="">None</option>
              {props.workstreams.filter((w) => !w.archived).map((w) => (
                <option key={w.id} value={w.id}>{w.code ?? w.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid2">
            <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Start (optional)"><input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} /></Field>
          </div>
          <div className="grid2">
            <Field label="Minutes"><NumInput value={duration} onChange={setDuration} min={5} step={5} /></Field>
            <Field label="Type">
              <select value={kind} onChange={(e) => setKind(e.target.value as BlockKind)}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <details>
            <summary>More options</summary>
            <div className="stack" style={{ gap: 12 }}>
              <Field label="Expected output (optional)"><input value={output} onChange={(e) => setOutput(e.target.value)} /></Field>
              <Field label="Counts as">
                <select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                  <option value="core">Core</option>
                  <option value="optional">Optional extension</option>
                </select>
              </Field>
            </div>
          </details>
        </>
      ) : (
        <div className="stack">
          <h3>{s!.title}</h3>
          <p className="muted">{formatDate(s!.date)} · {s!.startTime ?? 'any time'} · {s!.durationMin} min · {KIND_LABEL[s!.kind]}</p>
          {s!.output && <p className="muted">Expected output: {s!.output}</p>}
          <p className="tiny">This block comes from your weekly plan. Change it under Plan › Edit plan › Weekly study blocks.</p>
        </div>
      )}
      {s && (s.status === 'done' || s.status === 'partial') && (
        <>
          <Field label="Minutes actually studied (optional)" hint="Leave empty to count the planned length (or half of it for Partial).">
            <NumInput value={actual} onChange={setActual} min={0} step={5} />
          </Field>
          <Field label="What did you produce? (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. lab plan written, 300 words" /></Field>
        </>
      )}
      {s && s.status === 'planned' && (
        <button className="btn text danger" onClick={drop}>Not needed this week</button>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- timed set
export function TimedSetSheet(props: { workstreams: Workstream[]; session?: Session; existing?: TimedSet; onClose: () => void; onAddError?: (workstreamId: string, setId: string) => void }) {
  const { repo, term, today, fail, toast } = useApp();
  const courses = courseLike(props.workstreams);
  const e = props.existing;
  const initialWs = e?.workstreamId ?? (props.session && courses.some((c) => c.id === props.session!.workstreamId) ? props.session.workstreamId : null);
  const [ws, setWs] = useState<string | null>(initialWs);
  const [date, setDate] = useState(e?.date ?? props.session?.date ?? today);
  const [topic, setTopic] = useState(e?.topic ?? '');
  const [attempted, setAttempted] = useState<number | null>(e?.attempted ?? null);
  const [correct, setCorrect] = useState<number | null>(e?.correct ?? null);
  const [minutes, setMinutes] = useState<number | null>(e?.minutes ?? null);
  const [target, setTarget] = useState<number | null>(e?.targetMinutes ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const topics = useData(async () => (ws ? repo.listTopics(ws) : []), [ws]).data ?? [];
  const acc = accuracy(attempted, correct);

  const save = async () => {
    if (!ws) return setProblem('Choose the course.');
    if (attempted != null && correct != null && correct > attempted) return setProblem('Correct cannot be more than attempted.');
    try {
      const id = await repo.saveTimedSet({
        id: e?.id,
        termId: term.id,
        workstreamId: ws,
        sessionId: e?.sessionId ?? props.session?.id ?? null,
        date,
        topic: topic || null,
        attempted,
        correct,
        minutes,
        targetMinutes: target,
        notes: null,
      });
      props.onClose();
      toast({ text: acc === null ? 'Timed set saved' : `Saved · ${acc}% accuracy`, action: props.onAddError ? { label: 'Add error', run: () => props.onAddError!(ws, id) } : undefined });
    } catch (err) {
      fail(err);
    }
  };
  const remove = async () => {
    if (!e) return;
    if (!confirm('Delete this timed set? Errors linked to it are kept.')) return;
    try {
      await repo.deleteTimedSet(e.id);
      props.onClose();
      toast('Timed set deleted');
    } catch (err) {
      fail(err);
    }
  };
  return (
    <Sheet title={e ? 'Timed set' : 'Log timed set'} onClose={props.onClose} footer={<button className="btn primary" onClick={save}>Save</button>}>
      {problem && <div className="err" role="alert">{problem}</div>}
      <div className="field">
        <span className="label">Course</span>
        <Chips label="Course" value={ws} onChange={setWs} options={courses.map((c) => ({ value: c.id, label: c.code ?? c.name }))} allowClear={false} tap />
      </div>
      <div className="grid3">
        <Field label="Attempted"><NumInput value={attempted} onChange={setAttempted} min={0} /></Field>
        <Field label="Correct"><NumInput value={correct} onChange={setCorrect} min={0} /></Field>
        <Field label="Minutes"><NumInput value={minutes} onChange={setMinutes} min={0} /></Field>
      </div>
      <p className="muted" aria-live="polite">Accuracy: {acc === null ? '—' : `${acc}%`}</p>
      <details>
        <summary>More details</summary>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Topic (optional)">
            <input list="topic-list" value={topic} onChange={(x) => setTopic(x.target.value)} />
            <datalist id="topic-list">{topics.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <div className="grid2">
            <Field label="Date"><input type="date" value={date} onChange={(x) => setDate(x.target.value)} /></Field>
            <Field label="Target minutes"><NumInput value={target} onChange={setTarget} min={0} /></Field>
          </div>
          {e && <button className="btn text danger" onClick={remove}>Delete timed set</button>}
        </div>
      </details>
    </Sheet>
  );
}

// ---------------------------------------------------------------- error log
export function ErrorSheet(props: { workstreams: Workstream[]; workstreamId?: string | null; timedSetId?: string | null; existing?: ErrorEntry; onClose: () => void }) {
  const { repo, term, today, fail, toast } = useApp();
  const courses = courseLike(props.workstreams);
  const e = props.existing;
  const [ws, setWs] = useState<string | null>(e?.workstreamId ?? props.workstreamId ?? null);
  const [question, setQuestion] = useState(e?.question ?? '');
  const [category, setCategory] = useState<string | null>(e?.category ?? null);
  const [cause, setCause] = useState(e?.cause ?? '');
  const [rule, setRule] = useState(e?.correctionRule ?? '');
  const [similar, setSimilar] = useState(e?.similarRef ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const exams = useData(() => repo.listAssessments(term.id), []).data ?? [];
  const retests = useData(async () => (e ? repo.retestsForError(e.id) : []), [e?.id]).data ?? [];
  const preview = useMemo(() => {
    if (e || !ws) return [];
    const next = exams.filter((a) => a.workstreamId === ws && (a.kind === 'midterm' || a.kind === 'final') && a.date > today)[0];
    return buildRetests(today, term.rules, next ? { date: next.date, title: next.title } : null);
  }, [e, ws, exams, today, term.rules]);

  const save = async () => {
    if (!ws) return setProblem('Choose the course.');
    if (!question.trim()) return setProblem('Describe the question or topic.');
    if (!category) return setProblem('Choose an error type.');
    try {
      if (e) await repo.updateError(e.id, { question, category, cause: cause || null, correctionRule: rule || null, similarRef: similar || null });
      else
        await repo.addError(
          { termId: term.id, workstreamId: ws, timedSetId: props.timedSetId ?? null, date: today, question, category, cause: cause || null, correctionRule: rule || null, similarRef: similar || null },
          term.rules,
        );
      toast(e ? 'Saved' : `Error logged · ${preview.length} retests scheduled`);
      props.onClose();
    } catch (err) {
      fail(err);
    }
  };
  const retire = async () => {
    if (!e) return;
    try {
      await repo.updateError(e.id, { status: e.status === 'retired' ? 'open' : 'retired' });
      props.onClose();
    } catch (err) {
      fail(err);
    }
  };
  return (
    <Sheet title={e ? 'Error' : 'Add error'} onClose={props.onClose} footer={<button className="btn primary" onClick={save}>Save</button>}>
      {problem && <div className="err" role="alert">{problem}</div>}
      {!e && (
        <div className="field">
          <span className="label">Course</span>
          <Chips label="Course" value={ws} onChange={setWs} options={courses.map((c) => ({ value: c.id, label: c.code ?? c.name }))} allowClear={false} tap />
        </div>
      )}
      <Field label="Question or topic"><input value={question} onChange={(x) => setQuestion(x.target.value)} placeholder="e.g. Past paper 2024 Q3, deadlock detection" /></Field>
      <div className="field">
        <span className="label">Error type</span>
        <Chips label="Error type" value={category} onChange={setCategory} options={term.rules.errorCategories.map((c) => ({ value: c, label: c }))} allowClear={false} />
      </div>
      <details open={!!(e && (e.cause || e.correctionRule || e.similarRef))}>
        <summary>Cause and correction (optional)</summary>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Cause"><input value={cause} onChange={(x) => setCause(x.target.value)} placeholder="Why it happened, in one sentence" /></Field>
          <Field label="Correction rule"><input value={rule} onChange={(x) => setRule(x.target.value)} placeholder="What you will do next time" /></Field>
          <Field label="Similar question or reference"><input value={similar} onChange={(x) => setSimilar(x.target.value)} /></Field>
        </div>
      </details>
      {!e && preview.length > 0 && <p className="tiny">Retests: {preview.map((r) => `${formatDate(r.dueDate, false)} (${r.label})`).join(', ')}</p>}
      {e && (
        <div className="stack">
          <h3>Retests</h3>
          {retests.map((r) => (
            <p key={r.id} className="small">
              {formatDate(r.dueDate)} · {r.label} · {r.outcome ? { pass: 'Solved alone', assisted: 'Needed help', fail: 'Not solved' }[r.outcome] : 'Not done yet'}
            </p>
          ))}
          <p className="tiny">Mastered after {term.rules.mastery.independentPassesRequired} independent passes{term.rules.mastery.separateDays ? ' on separate days' : ''}. Status: {e.status}.</p>
          <button className="btn text" onClick={retire}>{e.status === 'retired' ? 'Reopen' : 'Retire (no longer relevant)'}</button>
        </div>
      )}
    </Sheet>
  );
}
