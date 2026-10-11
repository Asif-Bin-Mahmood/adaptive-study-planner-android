// New-semester wizard: six short steps. Nothing is saved until "Create".
import { useState } from 'react';
import { isHHMM, isISODate, weekdayShort } from '../../domain/dates';
import { defaultRules } from '../../domain/rules';
import type { PlanningRules, WorkstreamType } from '../../domain/types';
import { parseAssessmentLines } from '../../data/termPackage';
import { useApp, useData } from '../ctx';
import { Field, NumInput, Sheet } from '../kit';
import { COLORS, WS_TYPE_LABEL } from '../loaders';
import { RulesForm } from './Settings';

interface CourseRow { code: string; name: string; type: 'course' | 'lab'; min: number | null; target: number | null }
interface SlotRow { code: string; days: number[]; start: string; end: string; location: string }
interface StreamRow { name: string; type: WorkstreamType; min: number | null; target: number | null }

const STEPS = ['Name and dates', 'Courses and labs', 'Class times', 'Exams and deadlines', 'Research and skills', 'Rules'];

export function SemesterWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { repo, term, fail, toast } = useApp();
  const terms = useData(() => repo.listTerms(), []).data ?? [];
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [basics, setBasics] = useState({ name: '', institution: term.institution ?? '', start: '', end: '', tz: term.timezone, copyFrom: term.id as string | '', copyRules: true, copyStreams: true });
  const [holidays, setHolidays] = useState<{ name: string; start: string; end: string }[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([{ code: '', name: '', type: 'course', min: 60, target: 90 }]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [examText, setExamText] = useState('');
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [rules, setRules] = useState<PlanningRules | null>(null);
  const source = terms.find((t) => t.id === basics.copyFrom);
  const effectiveRules = rules ?? (basics.copyRules && source ? { ...source.rules, trial: { start: null, end: null }, optional: { ...source.rules.optional, enabled: false } } : defaultRules());
  const parsed = parseAssessmentLines(examText);
  const codes = courses.map((c) => c.code.trim().toUpperCase()).filter(Boolean);

  const validate = (): string | null => {
    if (step === 0) {
      if (!basics.name.trim()) return 'Enter a name, e.g. Spring 2027.';
      if (!isISODate(basics.start) || !isISODate(basics.end) || basics.end < basics.start) return 'Enter valid start and end dates.';
      if (holidays.some((h) => !h.name.trim() || !isISODate(h.start))) return 'Each holiday needs a name and date.';
    }
    if (step === 1 && courses.some((c) => (c.code || c.name) && !c.code.trim())) return 'Each course needs a code.';
    if (step === 2) {
      for (const s of slots) {
        if (!codes.includes(s.code)) return `Choose the course for every class time.`;
        if (!s.days.length || !isHHMM(s.start) || !isHHMM(s.end) || s.end <= s.start) return `Check the days and times for ${s.code}.`;
      }
    }
    if (step === 3) {
      if (parsed.problems.length) return parsed.problems[0];
      const unknown = parsed.rows.find((r) => !codes.includes(r.code));
      if (unknown) return `${unknown.code} is not one of your courses.`;
    }
    return null;
  };
  const next = () => {
    const p = validate();
    setProblem(p);
    if (!p) setStep(step + 1);
  };

  const create = async () => {
    try {
      let id = '';
      await repo.tx.run(async () => {
        const input = { name: basics.name, institution: basics.institution || null, academicYear: null, startDate: basics.start, endDate: basics.end, timezone: basics.tz, rules: effectiveRules, status: 'upcoming' as const };
        id = source && basics.copyStreams ? await repo.cloneTerm(source.id, input, { copyRules: false, copyLongTermWorkstreams: true }) : await repo.createTerm(input);
        if (source && basics.copyStreams) await repo.updateRules(id, effectiveRules);
        for (const h of holidays) await repo.saveException({ termId: id, name: h.name, kind: 'holiday', startDate: h.start, endDate: h.end || h.start, cancelsClasses: true, suppressesStudy: false });
        const wsIds = new Map<string, string>();
        for (const [i, c] of courses.filter((x) => x.code.trim()).entries()) {
          const code = c.code.trim().toUpperCase();
          wsIds.set(code, await repo.createWorkstream({ termId: id, type: c.type, code, name: c.name.trim() || code, color: COLORS[i % COLORS.length], priority: c.type === 'lab' ? 1 : 2, deadline: null, minWeeklyMinutes: c.min ?? 0, targetWeeklyMinutes: c.target ?? 0, extensionWeeklyMinutes: 0, floorRule: null, archived: false, notes: null }));
        }
        for (const s of slots) {
          const type = courses.find((c) => c.code.trim().toUpperCase() === s.code)?.type;
          await repo.saveCommitment({ termId: id, workstreamId: wsIds.get(s.code) ?? null, kind: type === 'lab' ? 'lab' : 'class', title: s.code, location: s.location || null, weekdays: s.days, startTime: s.start, endTime: s.end, validFrom: basics.start, validTo: basics.end });
        }
        for (const a of parsed.rows) {
          await repo.saveAssessment({ termId: id, workstreamId: wsIds.get(a.code) ?? null, kind: a.kind, title: `${a.code} ${a.kind.replace('_', ' ')}`, date: a.date, startTime: a.startTime, endTime: a.endTime, confirmed: true, notes: null });
        }
        for (const [i, s] of streams.filter((x) => x.name.trim()).entries()) {
          await repo.createWorkstream({ termId: id, type: s.type, code: null, name: s.name.trim(), color: COLORS[(i + 4) % COLORS.length], priority: 3, deadline: null, minWeeklyMinutes: s.min ?? 0, targetWeeklyMinutes: s.target ?? 0, extensionWeeklyMinutes: 0, floorRule: null, archived: false, notes: null });
        }
      });
      await repo.setActiveTerm(id);
      toast(`${basics.name} created. Add weekly study blocks in Plan › Edit plan.`);
      onCreated(id);
    } catch (e) {
      fail(e);
    }
  };

  const toggleDay = (i: number, d: number) => setSlots(slots.map((s, j) => (j === i ? { ...s, days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort() } : s)));

  return (
    <Sheet
      title={`New semester · ${step + 1} of ${STEPS.length}`}
      onClose={onClose}
      full
      onBack={step > 0 ? () => setStep(step - 1) : undefined}
      footer={step < STEPS.length - 1 ? <button className="btn primary" onClick={next}>Next</button> : <button className="btn primary" onClick={create}>Create semester</button>}
    >
      <div className="steps" aria-hidden="true">{STEPS.map((s, i) => <span key={s} className={i <= step ? 'on' : ''} />)}</div>
      <h3>{STEPS[step]}</h3>
      {problem && <div className="err" role="alert">{problem}</div>}

      {step === 0 && (
        <>
          <Field label="Name"><input value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} placeholder="Spring 2027" /></Field>
          <Field label="Institution (optional)"><input value={basics.institution} onChange={(e) => setBasics({ ...basics, institution: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="First day"><input type="date" value={basics.start} onChange={(e) => setBasics({ ...basics, start: e.target.value })} /></Field>
            <Field label="Last day"><input type="date" value={basics.end} onChange={(e) => setBasics({ ...basics, end: e.target.value })} /></Field>
          </div>
          <Field label="Time zone"><input value={basics.tz} onChange={(e) => setBasics({ ...basics, tz: e.target.value })} /></Field>
          <Field label="Copy settings from" hint="Only reusable settings are copied. Courses, classes, exams and deadlines are never copied.">
            <select value={basics.copyFrom} onChange={(e) => setBasics({ ...basics, copyFrom: e.target.value })}>
              <option value="">Start fresh</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {source && (
            <>
              <label className="row"><input type="checkbox" style={{ width: 22, height: 22 }} checked={basics.copyRules} onChange={(e) => { setRules(null); setBasics({ ...basics, copyRules: e.target.checked }); }} /> Study rules and thresholds (review them in the last step)</label>
              <label className="row"><input type="checkbox" style={{ width: 22, height: 22 }} checked={basics.copyStreams} onChange={(e) => setBasics({ ...basics, copyStreams: e.target.checked })} /> Thesis, research and skill workstreams (without deadlines)</label>
            </>
          )}
          <div className="section-head"><span className="label small">Holidays (optional)</span><button className="btn text" onClick={() => setHolidays([...holidays, { name: '', start: '', end: '' }])}>Add holiday</button></div>
          {holidays.map((h, i) => (
            <div key={i} className="grid3">
              <input aria-label="Holiday name" placeholder="Name" value={h.name} onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input aria-label="From" type="date" value={h.start} onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <input aria-label="To" type="date" value={h.end} onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
            </div>
          ))}
        </>
      )}

      {step === 1 && (
        <>
          <p className="small muted">Minimum and normal are study minutes per week outside class.</p>
          {courses.map((c, i) => (
            <div key={i} className="card stack">
              <div className="grid2">
                <Field label="Code"><input value={c.code} onChange={(e) => setCourses(courses.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} placeholder="MATH201" /></Field>
                <Field label="Type">
                  <select value={c.type} onChange={(e) => setCourses(courses.map((x, j) => (j === i ? { ...x, type: e.target.value as 'course' | 'lab' } : x)))}>
                    <option value="course">Course</option>
                    <option value="lab">Lab</option>
                  </select>
                </Field>
              </div>
              <Field label="Name (optional)"><input value={c.name} onChange={(e) => setCourses(courses.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field>
              <div className="grid3">
                <Field label="Minimum"><NumInput value={c.min} step={15} onChange={(v) => setCourses(courses.map((x, j) => (j === i ? { ...x, min: v } : x)))} /></Field>
                <Field label="Normal"><NumInput value={c.target} step={15} onChange={(v) => setCourses(courses.map((x, j) => (j === i ? { ...x, target: v } : x)))} /></Field>
                <button className="btn text danger" style={{ alignSelf: 'end' }} onClick={() => setCourses(courses.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
          ))}
          <button className="btn" onClick={() => setCourses([...courses, { code: '', name: '', type: 'course', min: 60, target: 90 }])}>Add course or lab</button>
        </>
      )}

      {step === 2 && (
        <>
          {slots.map((s, i) => (
            <div key={i} className="card stack">
              <Field label="Course">
                <select value={s.code} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}>
                  <option value="">Choose…</option>
                  {codes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <div className="wrap chips-tap">
                {[0, 1, 2, 3, 4, 5, 6].map((d) => <button key={d} type="button" className="chip" aria-pressed={s.days.includes(d)} onClick={() => toggleDay(i, d)}>{weekdayShort(d)}</button>)}
              </div>
              <div className="grid3">
                <Field label="Start"><input type="time" value={s.start} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} /></Field>
                <Field label="End"><input type="time" value={s.end} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} /></Field>
                <Field label="Room"><input value={s.location} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)))} /></Field>
              </div>
              <button className="btn text danger" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button className="btn" onClick={() => setSlots([...slots, { code: codes[0] ?? '', days: [], start: '', end: '', location: '' }])}>Add class time</button>
        </>
      )}

      {step === 3 && (
        <>
          <p className="small muted">Paste one per line: course, type, date, start, end. Times are optional. Types: midterm, final, quiz, assignment, lab_report, presentation, deadline.</p>
          <Field label="Exams and deadlines">
            <textarea rows={7} value={examText} onChange={(e) => setExamText(e.target.value)} placeholder={'MATH201, midterm, 2031-03-20, 10:00, 12:00\nMATH201, assignment, 2031-02-28'} />
          </Field>
          <p className="small">{parsed.rows.length} recognised{parsed.problems.length ? ` · ${parsed.problems.length} problem(s)` : ''}</p>
          {parsed.problems.map((p) => <p key={p} className="err small">{p}</p>)}
        </>
      )}

      {step === 4 && (
        <>
          {source && basics.copyStreams && <p className="small muted">Reusable workstreams from {source.name} will be copied. Add any new ones here.</p>}
          {streams.map((s, i) => (
            <div key={i} className="card stack">
              <div className="grid2">
                <Field label="Name"><input value={s.name} onChange={(e) => setStreams(streams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field>
                <Field label="Type">
                  <select value={s.type} onChange={(e) => setStreams(streams.map((x, j) => (j === i ? { ...x, type: e.target.value as WorkstreamType } : x)))}>
                    {Object.entries(WS_TYPE_LABEL).filter(([k]) => k !== 'course' && k !== 'lab').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid3">
                <Field label="Minimum"><NumInput value={s.min} step={15} onChange={(v) => setStreams(streams.map((x, j) => (j === i ? { ...x, min: v } : x)))} /></Field>
                <Field label="Normal"><NumInput value={s.target} step={15} onChange={(v) => setStreams(streams.map((x, j) => (j === i ? { ...x, target: v } : x)))} /></Field>
                <button className="btn text danger" style={{ alignSelf: 'end' }} onClick={() => setStreams(streams.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
          ))}
          <button className="btn" onClick={() => setStreams([...streams, { name: '', type: 'research', min: 30, target: 60 }])}>Add workstream</button>
        </>
      )}

      {step === 5 && (
        <>
          <p className="small muted">Optional blocks start off. You can change all of this later in Settings › Study rules.</p>
          <RulesForm rules={effectiveRules} onChange={setRules} />
        </>
      )}
    </Sheet>
  );
}
