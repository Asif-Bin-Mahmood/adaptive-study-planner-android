// Editors for the semester's data: workstreams, classes, exams/deadlines,
// weekly study blocks and holidays. Reached from Plan › Edit plan.
import { useState } from 'react';
import { formatDate, formatTime, isHHMM, isISODate, weekdayShort } from '../../domain/dates';
import { findConflicts, occurrencesOn } from '../../domain/schedule';
import type {
  Assessment,
  AssessmentKind,
  BlockKind,
  Commitment,
  CommitmentKind,
  DateException,
  ExceptionKind,
  StudyTemplate,
  Tier,
  Workstream,
  WorkstreamType,
} from '../../domain/types';
import { useApp, useData } from '../ctx';
import { Chips, Field, Icon, NumInput, Sheet } from '../kit';
import { ASSESS_LABEL, COLORS, KIND_LABEL, WS_TYPE_LABEL, wsName } from '../loaders';
import { optionalGate, recordOptionalAdded } from '../report';

const DAYS = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: weekdayShort(d) }));

function useSave(onClose: () => void) {
  const { fail, toast } = useApp();
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, msg = 'Saved') => {
    setProblem(null);
    try {
      await fn();
      toast(msg);
      onClose();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setProblem(m);
      if (!m) fail(e);
    }
  };
  return { problem, setProblem, run };
}

// ---------------------------------------------------------------- workstream
export function WorkstreamSheet({ ws, onClose }: { ws?: Workstream; onClose: () => void }) {
  const { repo, term } = useApp();
  const { problem, run } = useSave(onClose);
  const [f, setF] = useState({
    type: ws?.type ?? ('course' as WorkstreamType),
    code: ws?.code ?? '',
    name: ws?.name ?? '',
    color: ws?.color ?? COLORS[0],
    priority: ws?.priority ?? 3,
    deadline: ws?.deadline ?? '',
    min: ws?.minWeeklyMinutes ?? 0 as number | null,
    target: ws?.targetWeeklyMinutes ?? 0 as number | null,
    ext: ws?.extensionWeeklyMinutes ?? 0 as number | null,
    floor: ws?.floorRule ?? '',
    notes: ws?.notes ?? '',
    allTerms: ws ? ws.termId === null : false,
  });
  const topics = useData(async () => (ws ? (await repo.listTopics(ws.id)).join('\n') : ''), [ws?.id]).data;
  const [topicText, setTopicText] = useState<string | null>(null);
  const save = () =>
    run(async () => {
      if (!f.name.trim()) throw new Error('Name is required.');
      const input = {
        termId: f.allTerms ? null : term.id,
        type: f.type,
        code: f.code.trim() || null,
        name: f.name,
        color: f.color,
        priority: f.priority,
        deadline: f.deadline || null,
        minWeeklyMinutes: f.min ?? 0,
        targetWeeklyMinutes: f.target ?? 0,
        extensionWeeklyMinutes: f.ext ?? 0,
        floorRule: f.floor || null,
        archived: ws?.archived ?? false,
        notes: f.notes || null,
      };
      const id = ws ? (await repo.updateWorkstream(ws.id, input), ws.id) : await repo.createWorkstream(input);
      if (topicText !== null) await repo.setTopics(id, topicText.split('\n'));
    });
  const archive = () => ws && run(() => repo.updateWorkstream(ws.id, { ...ws, archived: !ws.archived }), ws.archived ? 'Restored' : 'Archived; history kept');
  return (
    <Sheet title={ws ? ws.code ?? ws.name : 'New workstream'} onClose={onClose} footer={<button className="btn primary" onClick={save}>Save</button>}>
      {problem && <div className="err">{problem}</div>}
      <Field label="Type">
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as WorkstreamType })}>
          {Object.entries(WS_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <div className="grid2">
        <Field label="Code (optional)"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="MATH201" /></Field>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      </div>
      <div className="grid3">
        <Field label="Minimum / week" hint="Kept even in hard weeks"><NumInput value={f.min} onChange={(v) => setF({ ...f, min: v })} min={0} step={15} /></Field>
        <Field label="Normal / week"><NumInput value={f.target} onChange={(v) => setF({ ...f, target: v })} min={0} step={15} /></Field>
        <Field label="Optional extra"><NumInput value={f.ext} onChange={(v) => setF({ ...f, ext: v })} min={0} step={15} /></Field>
      </div>
      <p className="tiny">Minutes per week.</p>
      <details>
        <summary>More options</summary>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Priority (1 = protect first, 5 = cut first)">
            <Chips label="Priority" tap value={f.priority} allowClear={false} onChange={(v) => setF({ ...f, priority: v ?? 3 })} options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))} />
          </Field>
          <Field label="Deadline (optional)"><input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          <Field label="Counts as done when (optional)"><input value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} /></Field>
          <Field label="Topics or syllabus units (one per line)">
            <textarea value={topicText ?? topics ?? ''} onChange={(e) => setTopicText(e.target.value)} />
          </Field>
          <div className="field">
            <span className="label">Colour</span>
            <div className="wrap">
              {COLORS.map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={f.color === c} aria-label={`Colour ${c}`} onClick={() => setF({ ...f, color: c })}>
                  <span className="dot" style={{ background: c, width: 16, height: 16, borderRadius: 8 }} />
                </button>
              ))}
            </div>
          </div>
          <label className="row"><input type="checkbox" checked={f.allTerms} onChange={(e) => setF({ ...f, allTerms: e.target.checked })} style={{ width: 22, height: 22 }} /> Continues across semesters (e.g. ML/AI, personal projects)</label>
          <Field label="Notes"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {ws && <button className="btn text danger" onClick={archive}>{ws.archived ? 'Restore workstream' : 'Archive workstream (keeps history)'}</button>}
        </div>
      </details>
    </Sheet>
  );
}

// ---------------------------------------------------------------- recurring class / lab
export function CommitmentSheet({ c, workstreams, onClose }: { c?: Commitment; workstreams: Workstream[]; onClose: () => void }) {
  const { repo, term, fail, toast } = useApp();
  const { problem, run } = useSave(onClose);
  const [f, setF] = useState({
    kind: c?.kind ?? ('class' as CommitmentKind),
    title: c?.title ?? '',
    ws: c?.workstreamId ?? null as string | null,
    location: c?.location ?? '',
    days: c?.weekdays ?? [] as number[],
    start: c?.startTime ?? '',
    end: c?.endTime ?? '',
    from: c?.validFrom ?? term.startDate,
    to: c?.validTo ?? term.endDate,
  });
  const changes = useData(async () => (c ? (await repo.listChanges(term.id)).filter((x) => x.commitmentId === c.id) : []), [c?.id]).data ?? [];
  const [makeup, setMakeup] = useState({ date: '', start: '', end: '' });
  const save = () =>
    run(async () => {
      if (!isHHMM(f.start) || !isHHMM(f.end)) throw new Error('Enter start and end times.');
      if (!isISODate(f.from) || !isISODate(f.to)) throw new Error('Enter the first and last dates.');
      await repo.saveCommitment({ id: c?.id, termId: term.id, workstreamId: f.ws, kind: f.kind, title: f.title, location: f.location || null, weekdays: [...f.days].sort(), startTime: f.start, endTime: f.end, validFrom: f.from, validTo: f.to });
    });
  const addMakeup = async () => {
    if (!c || !isISODate(makeup.date) || !isHHMM(makeup.start) || !isHHMM(makeup.end)) return;
    try {
      await repo.addChange({ commitmentId: c.id, date: makeup.date, kind: 'makeup', startTime: makeup.start, endTime: makeup.end, reason: 'Make-up class' });
      toast('Make-up class added');
      setMakeup({ date: '', start: '', end: '' });
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Sheet title={c ? c.title : 'New class or lab'} onClose={onClose} footer={<button className="btn primary" onClick={save}>Save</button>}>
      {problem && <div className="err">{problem}</div>}
      <p className="tiny">Fixed commitments are never moved by the app. They are stored here so study blocks are planned around them.</p>
      <Chips label="Kind" value={f.kind} allowClear={false} onChange={(v) => setF({ ...f, kind: v ?? 'class' })} options={[{ value: 'class', label: 'Class' }, { value: 'lab', label: 'Lab' }, { value: 'other', label: 'Other fixed' }]} />
      <div className="grid2">
        <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="MATH201 lecture" /></Field>
        <Field label="Room (optional)"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
      </div>
      <Field label="Workstream">
        <select value={f.ws ?? ''} onChange={(e) => setF({ ...f, ws: e.target.value || null })}>
          <option value="">None</option>
          {workstreams.map((w) => <option key={w.id} value={w.id}>{w.code ?? w.name}</option>)}
        </select>
      </Field>
      <div className="field">
        <span className="label">Days</span>
        <div className="wrap chips-tap">
          {DAYS.map((d) => (
            <button key={d.value} type="button" className="chip" aria-pressed={f.days.includes(d.value)} onClick={() => setF({ ...f, days: f.days.includes(d.value) ? f.days.filter((x) => x !== d.value) : [...f.days, d.value] })}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid2">
        <Field label="Start"><input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="End"><input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      </div>
      <div className="grid2">
        <Field label="First date"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Last date"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      </div>
      {c && (
        <details>
          <summary>Cancellations and make-up classes ({changes.length})</summary>
          <div className="stack">
            {changes.map((x) => (
              <div key={x.id} className="row small">
                <span className="grow">{formatDate(x.date)} · {x.kind === 'cancelled' ? 'Cancelled' : `Make-up ${x.startTime}–${x.endTime}`}{x.reason ? ` (${x.reason})` : ''}</span>
                <button className="btn text danger" onClick={() => repo.deleteChange(x.id).catch(fail)}>Remove</button>
              </div>
            ))}
            <p className="tiny">To cancel one class, use Replan › A class was cancelled. Add a make-up class here:</p>
            <div className="grid3">
              <input type="date" aria-label="Make-up date" value={makeup.date} onChange={(e) => setMakeup({ ...makeup, date: e.target.value })} />
              <input type="time" aria-label="Make-up start" value={makeup.start} onChange={(e) => setMakeup({ ...makeup, start: e.target.value })} />
              <input type="time" aria-label="Make-up end" value={makeup.end} onChange={(e) => setMakeup({ ...makeup, end: e.target.value })} />
            </div>
            <button className="btn" onClick={addMakeup}>Add make-up class</button>
          </div>
        </details>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- exam / deadline
export function AssessmentSheet({ a, workstreams, onClose }: { a?: Assessment; workstreams: Workstream[]; onClose: () => void }) {
  const { repo, term } = useApp();
  const { problem, setProblem, run } = useSave(onClose);
  const [f, setF] = useState({
    kind: a?.kind ?? ('assignment' as AssessmentKind),
    title: a?.title ?? '',
    ws: a?.workstreamId ?? null as string | null,
    date: a?.date ?? '',
    start: a?.startTime ?? '',
    end: a?.endTime ?? '',
    confirmed: a?.confirmed ?? true,
    notes: a?.notes ?? '',
  });
  const [warned, setWarned] = useState<string[] | null>(null);
  const save = async (force = false) => {
    if (!f.title.trim() || !isISODate(f.date)) return setProblem('Title and date are required.');
    if (!force && f.start && f.end) {
      const [commitments, changes, exceptions, assessments] = await Promise.all([repo.listCommitments(term.id), repo.listChanges(term.id), repo.listExceptions(term.id), repo.listAssessments(term.id)]);
      const dur = (+f.end.slice(0, 2) * 60 + +f.end.slice(3)) - (+f.start.slice(0, 2) * 60 + +f.start.slice(3));
      const found = findConflicts(
        { date: f.date, startTime: f.start, durationMin: dur },
        { occurrences: occurrencesOn(f.date, commitments, changes, exceptions), assessments: assessments.filter((x) => x.id !== a?.id), sessions: [], rules: term.rules, exceptions: [] },
      );
      if (found.length) return setWarned(found);
    }
    await run(() => repo.saveAssessment({ id: a?.id, termId: term.id, workstreamId: f.ws, kind: f.kind, title: f.title, date: f.date, startTime: f.start || null, endTime: f.end || null, confirmed: f.confirmed, notes: f.notes || null }));
  };
  const del = () => a && confirm(`Delete ${a.title}?`) && run(() => repo.deleteAssessment(a.id), 'Deleted');
  return (
    <Sheet
      title={a ? a.title : 'New exam or deadline'}
      onClose={onClose}
      footer={warned ? (<><button className="btn" onClick={() => setWarned(null)}>Change it</button><button className="btn primary" onClick={() => save(true)}>Save anyway</button></>) : <button className="btn primary" onClick={() => save()}>Save</button>}
    >
      {problem && <div className="err">{problem}</div>}
      {warned && <div className="warn"><strong>Conflicts:</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warned.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <Field label="Type">
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AssessmentKind })}>
          {Object.entries(ASSESS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Workstream">
        <select value={f.ws ?? ''} onChange={(e) => setF({ ...f, ws: e.target.value || null })}>
          <option value="">None</option>
          {workstreams.map((w) => <option key={w.id} value={w.id}>{w.code ?? w.name}</option>)}
        </select>
      </Field>
      <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="Start (optional)"><input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="End (optional)"><input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      </div>
      <label className="row"><input type="checkbox" style={{ width: 22, height: 22 }} checked={f.confirmed} onChange={(e) => setF({ ...f, confirmed: e.target.checked })} /> Confirmed date (never moved automatically)</label>
      <Field label="Notes (optional)"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {a && <button className="btn text danger" onClick={del}>Delete</button>}
    </Sheet>
  );
}

// ---------------------------------------------------------------- weekly study block
export function TemplateSheet({ t, workstreams, commitments, onClose }: { t?: StudyTemplate; workstreams: Workstream[]; commitments: Commitment[]; onClose: () => void }) {
  const { repo, term, today, toast, fail } = useApp();
  const { problem, run } = useSave(onClose);
  const [f, setF] = useState({
    title: t?.title ?? '',
    ws: t?.workstreamId ?? null as string | null,
    output: t?.output ?? '',
    kind: t?.kind ?? ('deep' as BlockKind),
    weekday: t?.weekday ?? 0,
    start: t?.startTime ?? '',
    dur: t?.durationMin ?? 60 as number | null,
    tier: t?.tier ?? ('core' as Tier),
    from: t?.validFrom ?? (today > term.startDate ? today : term.startDate),
    to: t?.validTo ?? term.endDate,
    dep: t?.dependsOnCommitmentId ?? '',
    depDay: t?.dependsOnWeekday ?? null as number | null,
  });
  const [gate, setGate] = useState<{ allowed: boolean; reasons: string[]; reviewWeek: string | null } | null>(null);
  const save = () =>
    run(async () => {
      if (!isHHMM(f.start) || !f.dur) throw new Error('Enter a start time and duration.');
      const occ = commitments.filter((c) => c.weekdays.includes(f.weekday));
      const s = +f.start.slice(0, 2) * 60 + +f.start.slice(3);
      for (const c of occ) {
        const cs = +c.startTime.slice(0, 2) * 60 + +c.startTime.slice(3);
        const ce = +c.endTime.slice(0, 2) * 60 + +c.endTime.slice(3);
        if (s < ce && cs < s + f.dur) throw new Error(`Overlaps ${c.title} (${c.startTime}–${c.endTime}). Choose another time.`);
      }
      await repo.saveTemplate(
        {
          id: t?.id,
          termId: term.id,
          workstreamId: f.ws,
          title: f.title,
          output: f.output || null,
          kind: f.kind,
          weekday: f.weekday,
          startTime: f.start,
          durationMin: f.dur,
          tier: f.tier,
          active: t ? t.active : f.tier === 'core',
          validFrom: f.from,
          validTo: f.to,
          dependsOnCommitmentId: f.dep || null,
          dependsOnWeekday: f.dep ? f.depDay ?? f.weekday : null,
        },
        today,
      );
    });
  const checkGate = async () => setGate(await optionalGate(repo, term, today));
  const activate = async () => {
    if (!t) return;
    try {
      await repo.setTemplateActive(t.id, true, today);
      if (gate?.reviewWeek) await recordOptionalAdded(repo, term, gate.reviewWeek);
      toast('Optional block added from next occurrence');
      onClose();
    } catch (e) {
      fail(e);
    }
  };
  const deactivate = () => t && run(() => repo.setTemplateActive(t.id, false, today), t.tier === 'optional' ? 'Optional block removed' : 'Block paused; past records kept');
  return (
    <Sheet title={t ? t.title : 'New weekly study block'} onClose={onClose} footer={<button className="btn primary" onClick={save}>Save</button>}>
      {problem && <div className="err">{problem}</div>}
      <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Workstream">
        <select value={f.ws ?? ''} onChange={(e) => setF({ ...f, ws: e.target.value || null })}>
          <option value="">None</option>
          {workstreams.map((w) => <option key={w.id} value={w.id}>{w.code ?? w.name}</option>)}
        </select>
      </Field>
      <div className="field"><span className="label">Day</span><Chips label="Day" tap value={f.weekday} allowClear={false} onChange={(v) => setF({ ...f, weekday: v ?? 0 })} options={DAYS} /></div>
      <div className="grid2">
        <Field label="Start"><input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="Minutes"><NumInput value={f.dur} onChange={(v) => setF({ ...f, dur: v })} min={5} step={5} /></Field>
      </div>
      <details>
        <summary>More options</summary>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Expected output"><input value={f.output} onChange={(e) => setF({ ...f, output: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="Type">
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as BlockKind })}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Counts as">
              <select value={f.tier} disabled={!!t} onChange={(e) => setF({ ...f, tier: e.target.value as Tier })}>
                <option value="core">Core</option>
                <option value="optional">Optional extension</option>
              </select>
            </Field>
          </div>
          <div className="grid2">
            <Field label="From"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="Until"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          </div>
          <Field label="Only when this class happens (optional)" hint="e.g. recall after a lecture, pre-lab before a lab. Holidays then cancel the block instead of counting it as missed.">
            <select value={f.dep} onChange={(e) => setF({ ...f, dep: e.target.value })}>
              <option value="">Always</option>
              {commitments.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          {f.dep && (
            <div className="field"><span className="label">That class's day</span><Chips label="Class day" tap value={f.depDay ?? f.weekday} allowClear={false} onChange={(v) => setF({ ...f, depDay: v })} options={DAYS} /></div>
          )}
        </div>
      </details>
      {t && t.tier === 'optional' && !t.active && (
        <div className="card stack">
          <h3>Add this optional block?</h3>
          <p className="small muted">Optional blocks start off. Each one needs a saved weekly review that meets the rule (core ≥ {Math.round(term.rules.optional.minCoreCompletion * 100)}%, sleep ≥ {term.rules.optional.minAvgSleep} h, focus not dropping) and your approval. At most {term.rules.optional.maxAddPerWeek} per week.</p>
          {!gate && <button className="btn" onClick={checkGate}>Check the rule</button>}
          {gate && (
            <>
              {gate.reasons.map((r) => <p key={r} className={gate.allowed ? 'ok' : 'warn'}>{r}</p>)}
              {gate.allowed && <button className="btn primary" onClick={activate}>Approve and add</button>}
            </>
          )}
        </div>
      )}
      {t && t.active && <button className="btn text danger" onClick={deactivate}>{t.tier === 'optional' ? 'Remove optional block' : 'Pause this block'}</button>}
      {t && !t.active && t.tier === 'core' && <button className="btn" onClick={() => run(() => repo.setTemplateActive(t.id, true, today), 'Block resumed')}>Resume this block</button>}
    </Sheet>
  );
}

// ---------------------------------------------------------------- holidays & special days
export function ExceptionSheet({ e, onClose }: { e?: DateException; onClose: () => void }) {
  const { repo, term } = useApp();
  const { problem, run } = useSave(onClose);
  const [f, setF] = useState({
    name: e?.name ?? '',
    kind: e?.kind ?? ('holiday' as ExceptionKind),
    start: e?.startDate ?? '',
    end: e?.endDate ?? '',
    cancels: e?.cancelsClasses ?? true,
    suppress: e?.suppressesStudy ?? false,
  });
  const save = () => run(() => repo.saveException({ id: e?.id, termId: term.id, name: f.name, kind: f.kind, startDate: f.start, endDate: f.end || f.start, cancelsClasses: f.cancels, suppressesStudy: f.suppress }));
  const del = () => e && confirm(`Remove ${e.name}?`) && run(() => repo.deleteException(e.id), 'Removed');
  return (
    <Sheet title={e ? e.name : 'New holiday or special day'} onClose={onClose} footer={<button className="btn primary" onClick={save}>Save</button>}>
      {problem && <div className="err">{problem}</div>}
      <Field label="Name"><input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
      <Field label="Type">
        <select value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value as ExceptionKind })}>
          <option value="holiday">Holiday</option>
          <option value="recess">Recess</option>
          <option value="exam_period">Exam period</option>
          <option value="override_day">Day with its own plan</option>
          <option value="note">Note only</option>
        </select>
      </Field>
      <div className="grid2">
        <Field label="From"><input type="date" value={f.start} onChange={(x) => setF({ ...f, start: x.target.value })} /></Field>
        <Field label="To"><input type="date" value={f.end} onChange={(x) => setF({ ...f, end: x.target.value })} /></Field>
      </div>
      <label className="row"><input type="checkbox" style={{ width: 22, height: 22 }} checked={f.cancels} onChange={(x) => setF({ ...f, cancels: x.target.checked })} /> No classes on these days</label>
      <label className="row"><input type="checkbox" style={{ width: 22, height: 22 }} checked={f.suppress} onChange={(x) => setF({ ...f, suppress: x.target.checked })} /> Skip weekly study blocks (the day has its own plan)</label>
      {e && <button className="btn text danger" onClick={del}>Remove</button>}
    </Sheet>
  );
}

// ---------------------------------------------------------------- overview
type Editing =
  | { k: 'ws'; v?: Workstream }
  | { k: 'cm'; v?: Commitment }
  | { k: 'as'; v?: Assessment }
  | { k: 'tp'; v?: StudyTemplate }
  | { k: 'ex'; v?: DateException }
  | null;

export function PlanSetup({ onClose }: { onClose: () => void }) {
  const { repo, term } = useApp();
  const data = useData(async () => {
    const [ws, cm, as, tp, ex] = await Promise.all([
      repo.listWorkstreams(term.id, true),
      repo.listCommitments(term.id),
      repo.listAssessments(term.id),
      repo.listTemplates(term.id),
      repo.listExceptions(term.id),
    ]);
    return { ws, cm, as, tp, ex };
  }, [term.id]).data;
  const [editing, setEditing] = useState<Editing>(null);
  if (!data) return null;
  const close = () => setEditing(null);
  const coreMin = data.tp.filter((t) => t.tier === 'core' && t.active).reduce((a, t) => a + t.durationMin, 0);
  const optMin = data.tp.filter((t) => t.tier === 'optional').reduce((a, t) => a + t.durationMin, 0);
  const head = (title: string, add: () => void) => (
    <div className="section-head">
      <h2>{title}</h2>
      <button className="btn text" onClick={add}><Icon name="plus" size={18} /> Add</button>
    </div>
  );
  return (
    <Sheet title={`Edit plan · ${term.name}`} onClose={onClose} full>
      <section className="section">
        {head('Workstreams', () => setEditing({ k: 'ws' }))}
        <div className="list">
          {data.ws.map((w) => (
            <button key={w.id} className="item" onClick={() => setEditing({ k: 'ws', v: w })}>
              <span className="dot" style={{ background: w.color }} />
              <span className="grow">{w.code ? `${w.code}` : w.name}{w.archived ? ' (archived)' : ''}<br /><span className="small muted">{WS_TYPE_LABEL[w.type]} · min {w.minWeeklyMinutes} · normal {w.targetWeeklyMinutes}{w.extensionWeeklyMinutes ? ` · +${w.extensionWeeklyMinutes} optional` : ''} min/wk</span></span>
            </button>
          ))}
        </div>
      </section>
      <section className="section">
        {head('Classes and labs', () => setEditing({ k: 'cm' }))}
        <div className="list">
          {data.cm.map((c) => (
            <button key={c.id} className="item" onClick={() => setEditing({ k: 'cm', v: c })}>
              <span className="grow">{c.title}<br /><span className="small muted">{c.weekdays.map(weekdayShort).join(', ')} · {formatTime(c.startTime)}–{formatTime(c.endTime)}</span></span>
            </button>
          ))}
          {!data.cm.length && <p className="item muted">None yet.</p>}
        </div>
      </section>
      <section className="section">
        {head('Exams and deadlines', () => setEditing({ k: 'as' }))}
        <div className="list">
          {data.as.map((a) => (
            <button key={a.id} className="item" onClick={() => setEditing({ k: 'as', v: a })}>
              <span className="grow">{a.title}<br /><span className="small muted">{formatDate(a.date)}{a.startTime ? ` · ${formatTime(a.startTime)}` : ''} · {ASSESS_LABEL[a.kind]}</span></span>
            </button>
          ))}
          {!data.as.length && <p className="item muted">None yet.</p>}
        </div>
      </section>
      <section className="section">
        {head('Weekly study blocks', () => setEditing({ k: 'tp' }))}
        <p className="small muted">Core {Math.round((coreMin / 60) * 10) / 10} h/week active · optional {Math.round((optMin / 60) * 10) / 10} h/week available</p>
        <div className="list">
          {data.tp.map((t) => (
            <button key={t.id} className="item" onClick={() => setEditing({ k: 'tp', v: t })}>
              <span className="grow">{t.title}<br /><span className="small muted">{weekdayShort(t.weekday)} {formatTime(t.startTime)} · {t.durationMin} min · {wsName(data.ws, t.workstreamId) || 'General'}</span></span>
              {t.tier === 'optional' && <span className="tag optional">{t.active ? 'Optional · on' : 'Optional · off'}</span>}
              {t.tier === 'core' && !t.active && <span className="tag">Paused</span>}
            </button>
          ))}
          {!data.tp.length && <p className="item muted">None yet.</p>}
        </div>
      </section>
      <section className="section">
        {head('Holidays and special days', () => setEditing({ k: 'ex' }))}
        <div className="list">
          {data.ex.map((e) => (
            <button key={e.id} className="item" onClick={() => setEditing({ k: 'ex', v: e })}>
              <span className="grow">{e.name}<br /><span className="small muted">{formatDate(e.startDate)}{e.endDate !== e.startDate ? ` – ${formatDate(e.endDate)}` : ''}</span></span>
            </button>
          ))}
          {!data.ex.length && <p className="item muted">None yet.</p>}
        </div>
      </section>
      {editing?.k === 'ws' && <WorkstreamSheet ws={editing.v} onClose={close} />}
      {editing?.k === 'cm' && <CommitmentSheet c={editing.v} workstreams={data.ws} onClose={close} />}
      {editing?.k === 'as' && <AssessmentSheet a={editing.v} workstreams={data.ws} onClose={close} />}
      {editing?.k === 'tp' && <TemplateSheet t={editing.v} workstreams={data.ws} commitments={data.cm} onClose={close} />}
      {editing?.k === 'ex' && <ExceptionSheet e={editing.v} onClose={close} />}
    </Sheet>
  );
}
