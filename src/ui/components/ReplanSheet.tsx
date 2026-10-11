import { useState } from 'react';
import { addDays, formatDate, formatTime, isISODate } from '../../domain/dates';
import { propose, type Action, type Proposal, type ReplanContext, type Scenario } from '../../domain/replan';
import { occurrencesOn } from '../../domain/schedule';
import type { AssessmentKind, Session } from '../../domain/types';
import { useApp, useData } from '../ctx';
import { Chips, Field, NumInput, Sheet } from '../kit';
import { ASSESS_LABEL, weekOf } from '../loaders';

type Step = 'pick' | 'missed' | 'lost' | 'deadline' | 'cancel' | 'exam' | 'review';

const OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: 'missed', label: 'I missed a session', hint: 'Record it and decide what to make up' },
  { id: 'low_energy', label: 'Low energy or tired', hint: 'Keep at most two short items' },
  { id: 'concentration', label: "Can't concentrate", hint: 'Shorter blocks, fewer items' },
  { id: 'journey', label: 'Journey delayed', hint: 'Lost time today' },
  { id: 'lab', label: 'Lab took longer', hint: 'Lost time today' },
  { id: 'deadline', label: 'New assignment or deadline', hint: 'Fit the work in before it is due' },
  { id: 'cancel', label: 'A class was cancelled', hint: 'Frees time; dependent blocks are not counted' },
  { id: 'exam', label: 'An exam date changed', hint: 'Move it and check for conflicts' },
];

function actionText(a: Action, sessions: Session[]): { what: string; reason: string } {
  const t = (id: string) => sessions.find((s) => s.id === id)?.title ?? 'Block';
  switch (a.type) {
    case 'keep': return { what: `Keep: ${t(a.sessionId)}`, reason: a.reason };
    case 'shorten': return { what: `Shorten to ${a.toMinutes} min: ${t(a.sessionId)}`, reason: a.reason };
    case 'swap': return { what: `${t(a.sessionId)} → ${a.title} (${a.toMinutes} min)`, reason: a.reason };
    case 'move': return { what: `Move to ${formatDate(a.toDate)}: ${t(a.sessionId)}`, reason: a.reason };
    case 'makeup': return { what: `Make-up on ${formatDate(a.toDate)}: ${t(a.sessionId)}`, reason: a.reason };
    case 'set_status': return { what: `${{ missed: 'Missed', dropped: 'Drop this week', cancelled: 'Not scheduled' }[a.status]}: ${t(a.sessionId)}`, reason: a.reason };
    case 'add': return { what: `Add ${a.draft.durationMin} min on ${formatDate(a.draft.date)}: ${a.draft.title}`, reason: a.reason };
    case 'add_assessment': return { what: `Record deadline: ${a.draft.title} (${formatDate(a.draft.date)})`, reason: a.reason };
    case 'update_assessment': return { what: `Exam moves to ${formatDate(a.date)}${a.startTime ? ` at ${formatTime(a.startTime)}` : ''}`, reason: a.reason };
    case 'cancel_occurrence': return { what: `Class cancelled on ${formatDate(a.date)}`, reason: a.reason };
    case 'update_retest': return { what: `Retest moves to ${formatDate(a.dueDate)}`, reason: a.reason };
  }
}

export function ReplanSheet({ onClose }: { onClose: () => void }) {
  const { repo, term, today, fail, toast } = useApp();
  const wk = weekOf(term, today);
  const ctxData = useData(async (): Promise<ReplanContext> => {
    const end = addDays(today, 14);
    await repo.ensureSessions(term.id, wk.start, end, false);
    const [sessions, workstreams, assessments, commitments, changes, exceptions, templates, retests] = await Promise.all([
      repo.listSessions(term.id, wk.start, end),
      repo.listWorkstreams(term.id),
      repo.listAssessments(term.id),
      repo.listCommitments(term.id),
      repo.listChanges(term.id),
      repo.listExceptions(term.id),
      repo.listTemplates(term.id),
      repo.listRetests(term.id),
    ]);
    return { termId: term.id, today, rules: term.rules, sessions, workstreams, assessments, commitments, changes, exceptions, templates, retests };
  }, [term.id, today]).data;

  const [step, setStep] = useState<Step>('pick');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [lostCause, setLostCause] = useState<'journey' | 'lab_overrun'>('journey');
  const [lost, setLost] = useState<number | null>(60);
  const [picked, setPicked] = useState<string[]>([]);
  const [dl, setDl] = useState({ title: '', ws: null as string | null, kind: 'assignment' as AssessmentKind, due: addDays(today, 3), time: '', est: 120 as number | null, unexpected: true });
  const [cancel, setCancel] = useState<{ cid: string; date: string } | null>(null);
  const [exam, setExam] = useState({ id: '', date: '', start: '', end: '' });
  const [problem, setProblem] = useState<string | null>(null);

  if (!ctxData) return <Sheet title="Replan" onClose={onClose}><p className="muted">Loading…</p></Sheet>;
  const ctx = ctxData;

  const run = (sc: Scenario) => {
    setProblem(null);
    setProposal(propose(sc, ctx));
    setStep('review');
  };
  const choose = (id: string) => {
    if (id === 'low_energy' || id === 'concentration') return run({ type: id });
    if (id === 'journey' || id === 'lab') {
      setLostCause(id === 'lab' ? 'lab_overrun' : 'journey');
      return setStep('lost');
    }
    if (id === 'missed') {
      setPicked(ctx.sessions.filter((s) => s.status === 'planned' && s.date < today).map((s) => s.id));
    }
    setStep(id as Step);
  };
  const apply = async () => {
    if (!proposal) return;
    try {
      await repo.applyProposal(term.id, today, proposal);
      toast('Plan updated');
      onClose();
    } catch (e) {
      fail(e);
    }
  };

  const back = step === 'pick' ? undefined : () => setStep(step === 'review' ? 'pick' : 'pick');
  const loggable = ctx.sessions.filter((s) => (s.status === 'planned' || s.status === 'missed') && s.date <= today && s.date >= wk.start);
  const classes = [] as { cid: string; date: string; label: string }[];
  for (let d = today; d <= addDays(today, 7); d = addDays(d, 1)) {
    for (const o of occurrencesOn(d, ctx.commitments, ctx.changes, ctx.exceptions)) {
      if (!o.makeup) classes.push({ cid: o.commitment.id, date: d, label: `${formatDate(d)} · ${o.commitment.title} ${formatTime(o.startTime)}` });
    }
  }
  const exams = ctx.assessments.filter((a) => a.date >= today);
  const courses = ctx.workstreams.filter((w) => w.type === 'course' || w.type === 'lab' || w.type === 'thesis' || w.type === 'research');

  let footer = null;
  let body = null;
  switch (step) {
    case 'pick':
      body = (
        <div className="list">
          {OPTIONS.map((o) => (
            <button key={o.id} className="item" onClick={() => choose(o.id)}>
              <span className="grow stack" style={{ gap: 0 }}>
                <span style={{ fontWeight: 600 }}>{o.label}</span>
                <span className="small muted">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      );
      break;
    case 'missed':
      body = (
        <>
          <p className="muted">Which blocks did you miss? Missed blocks are recorded honestly; only a few are made up.</p>
          {loggable.length === 0 && <p className="muted">No unlogged blocks this week.</p>}
          <div className="list">
            {loggable.map((s) => (
              <label key={s.id} className="item">
                <input type="checkbox" style={{ width: 22, height: 22 }} checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                <span className="grow">{s.title}<br /><span className="small muted">{formatDate(s.date)}{s.startTime ? ` · ${formatTime(s.startTime)}` : ''}</span></span>
              </label>
            ))}
          </div>
        </>
      );
      footer = <button className="btn primary" disabled={!picked.length} onClick={() => run({ type: 'missed', sessionIds: picked })}>See suggested plan</button>;
      break;
    case 'lost':
      body = (
        <>
          <p className="muted">About how much study time did you lose today?</p>
          <Chips label="Minutes lost" tap value={lost} onChange={setLost} options={[30, 60, 90, 120, 180].map((v) => ({ value: v, label: `${v} min` }))} />
        </>
      );
      footer = <button className="btn primary" disabled={!lost} onClick={() => run({ type: 'lost_time', minutes: lost ?? 0, cause: lostCause })}>See suggested plan</button>;
      break;
    case 'deadline':
      body = (
        <>
          {problem && <div className="err">{problem}</div>}
          <Field label="What is it?"><input value={dl.title} onChange={(e) => setDl({ ...dl, title: e.target.value })} placeholder="e.g. MATH201 assignment 2" /></Field>
          <Field label="Workstream">
            <select value={dl.ws ?? ''} onChange={(e) => setDl({ ...dl, ws: e.target.value || null })}>
              <option value="">None</option>
              {courses.map((w) => <option key={w.id} value={w.id}>{w.code ?? w.name}</option>)}
            </select>
          </Field>
          <div className="grid2">
            <Field label="Due date"><input type="date" value={dl.due} onChange={(e) => setDl({ ...dl, due: e.target.value })} /></Field>
            <Field label="Due time (optional)"><input type="time" value={dl.time} onChange={(e) => setDl({ ...dl, time: e.target.value })} /></Field>
          </div>
          <Field label="Type">
            <select value={dl.kind} onChange={(e) => setDl({ ...dl, kind: e.target.value as AssessmentKind })}>
              {Object.entries(ASSESS_LABEL).filter(([k]) => k !== 'midterm' && k !== 'final').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Work needed (minutes, your estimate)"><NumInput value={dl.est} onChange={(v) => setDl({ ...dl, est: v })} min={0} step={15} /></Field>
        </>
      );
      footer = (
        <button
          className="btn primary"
          onClick={() => {
            if (!dl.title.trim() || !isISODate(dl.due)) return setProblem('Enter a title and due date.');
            run({ type: 'new_deadline', title: dl.title.trim(), workstreamId: dl.ws, kind: dl.kind, dueDate: dl.due, dueTime: dl.time || null, estimateMin: dl.est ?? 0, unexpected: dl.unexpected });
          }}
        >
          See suggested plan
        </button>
      );
      break;
    case 'cancel':
      body = (
        <>
          <p className="muted">Which class is cancelled? (Next 7 days)</p>
          <div className="list">
            {classes.map((c) => (
              <label key={c.cid + c.date} className="item">
                <input type="radio" name="cls" style={{ width: 22, height: 22 }} checked={cancel?.cid === c.cid && cancel?.date === c.date} onChange={() => setCancel({ cid: c.cid, date: c.date })} />
                <span className="grow">{c.label}</span>
              </label>
            ))}
          </div>
          {!classes.length && <p className="muted">No classes in the next 7 days.</p>}
        </>
      );
      footer = <button className="btn primary" disabled={!cancel} onClick={() => cancel && run({ type: 'cancelled_class', commitmentId: cancel.cid, date: cancel.date, reason: 'Cancelled' })}>See suggested plan</button>;
      break;
    case 'exam':
      body = (
        <>
          <Field label="Exam or deadline">
            <select value={exam.id} onChange={(e) => {
              const a = exams.find((x) => x.id === e.target.value);
              setExam({ id: e.target.value, date: a?.date ?? '', start: a?.startTime ?? '', end: a?.endTime ?? '' });
            }}>
              <option value="">Choose…</option>
              {exams.map((a) => <option key={a.id} value={a.id}>{a.title} · {formatDate(a.date)}</option>)}
            </select>
          </Field>
          <Field label="New date"><input type="date" value={exam.date} onChange={(e) => setExam({ ...exam, date: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="Start"><input type="time" value={exam.start} onChange={(e) => setExam({ ...exam, start: e.target.value })} /></Field>
            <Field label="End"><input type="time" value={exam.end} onChange={(e) => setExam({ ...exam, end: e.target.value })} /></Field>
          </div>
        </>
      );
      footer = <button className="btn primary" disabled={!exam.id || !isISODate(exam.date)} onClick={() => run({ type: 'exam_change', assessmentId: exam.id, newDate: exam.date, newStart: exam.start || null, newEnd: exam.end || null })}>See suggested plan</button>;
      break;
    case 'review':
      if (!proposal) break;
      body = (
        <>
          <div className="card tonal stack" style={{ gap: 4 }}>
            {proposal.summary.map((l) => <p key={l}>{l}</p>)}
          </div>
          {proposal.warnings.map((w) => <div key={w} className="warn">{w}</div>)}
          {proposal.reduceNextWeek && <div className="warn">Next week's scope will be reduced in the weekly review instead of carrying this backlog forward.</div>}
          <div className="list">
            {proposal.actions.map((a, i) => {
              const t = actionText(a, ctx.sessions);
              return (
                <div key={i} className="item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <span className="grow stack" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{t.what}</span>
                    <span className="small muted">{t.reason}</span>
                  </span>
                </div>
              );
            })}
          </div>
          {!proposal.actions.length && <p className="muted">Nothing to change.</p>}
          <p className="tiny">Nothing changes until you confirm. Postponed or dropped work is never marked as done.</p>
        </>
      );
      footer = (
        <>
          <button className="btn" onClick={() => setStep('pick')}>Cancel</button>
          <button className="btn primary" disabled={!proposal.actions.length} onClick={apply}>Apply changes</button>
        </>
      );
      break;
  }
  return (
    <Sheet title={step === 'review' ? proposal?.title ?? 'Suggested plan' : 'Replan my day'} onClose={onClose} onBack={back} footer={footer}>
      {body}
    </Sheet>
  );
}
