// Secondary area: semesters, study rules, reminders, backup, privacy.
import { useEffect, useRef, useState } from 'react';
import { formatDate, formatTime } from '../../domain/dates';
import { validateRules } from '../../domain/rules';
import type { PlanningRules, Term } from '../../domain/types';
import { previewImport, validateBackup, type BackupFile } from '../../data/backup';
import { APP_VERSION } from '../../data/repo';
import { readFileAsText, saveBackupFile } from '../../platform/files';
import { cancelAllReminders, notificationPermission, requestNotificationPermission, sendTestNotification, type PermissionState } from '../../platform/notify';
import { useApp, useData } from '../ctx';
import { Chips, Field, NumInput, Sheet } from '../kit';
import { SemesterWizard } from './Wizard';

type Page = 'home' | 'semesters' | 'rules' | 'reminders' | 'backup' | 'about' | 'editTerm';

export function Settings({ onClose, onSwitched }: { onClose: () => void; onSwitched: (id: string) => void }) {
  const { term } = useApp();
  const [page, setPage] = useState<Page>('home');
  const [wizard, setWizard] = useState(false);
  const titles: Record<Page, string> = {
    home: 'Settings',
    semesters: 'Semesters',
    rules: 'Study rules',
    reminders: 'Reminders',
    backup: 'Backup and restore',
    about: 'Privacy and about',
    editTerm: `Edit ${term.name}`,
  };
  return (
    <Sheet title={titles[page]} onClose={onClose} full onBack={page === 'home' ? undefined : () => setPage(page === 'editTerm' ? 'semesters' : 'home')}>
      {page === 'home' && (
        <div className="list">
          {(
            [
              ['semesters', 'Semesters', `${term.name} · switch, create, archive`],
              ['rules', 'Study rules', 'Thresholds, sleep window, retests'],
              ['reminders', 'Reminders', 'Optional study notifications'],
              ['backup', 'Backup and restore', 'Export or import a JSON file'],
              ['about', 'Privacy and about', `Version ${APP_VERSION} · offline`],
            ] as [Page, string, string][]
          ).map(([p, t, h]) => (
            <button key={p} className="item" onClick={() => setPage(p)}>
              <span className="grow">{t}<br /><span className="small muted">{h}</span></span>
            </button>
          ))}
        </div>
      )}
      {page === 'semesters' && <Semesters onNew={() => setWizard(true)} onEdit={() => setPage('editTerm')} onSwitched={onSwitched} />}
      {page === 'editTerm' && <EditTerm onDone={() => setPage('semesters')} />}
      {page === 'rules' && <RulesEditor />}
      {page === 'reminders' && <Reminders />}
      {page === 'backup' && <Backup onRestored={onSwitched} />}
      {page === 'about' && <About />}
      {wizard && <SemesterWizard onClose={() => setWizard(false)} onCreated={(id) => { setWizard(false); onSwitched(id); }} />}
    </Sheet>
  );
}

function Semesters({ onNew, onEdit, onSwitched }: { onNew: () => void; onEdit: () => void; onSwitched: (id: string) => void }) {
  const { repo, term, fail, toast } = useApp();
  const terms = useData(() => repo.listTerms(), []).data ?? [];
  const switchTo = async (t: Term) => {
    try {
      await repo.setActiveTerm(t.id);
      onSwitched(t.id);
      toast(`Switched to ${t.name}`);
    } catch (e) {
      fail(e);
    }
  };
  const archive = async (t: Term) => {
    try {
      await repo.setTermStatus(t.id, t.status === 'archived' ? 'upcoming' : 'archived');
      toast(t.status === 'archived' ? `${t.name} restored` : `${t.name} archived. All its records are kept and still viewable.`);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <div className="card stack">
        <span className="small muted">Active semester</span>
        <h2>{term.name}</h2>
        <span className="small muted">{formatDate(term.startDate)} – {formatDate(term.endDate)} · {term.timezone} · {term.status}</span>
        <div className="grid2">
          <button className="btn" onClick={onEdit}>Edit dates</button>
          <button className="btn" onClick={() => archive(term)}>{term.status === 'archived' ? 'Restore' : 'Archive'}</button>
        </div>
      </div>
      <button className="btn primary" onClick={onNew}>New semester</button>
      <section className="section">
        <h2>All semesters</h2>
        <div className="list">
          {terms.map((t) => (
            <div key={t.id} className="item" style={{ cursor: 'default' }}>
              <span className="grow">{t.name}<br /><span className="small muted">{formatDate(t.startDate, false)} – {formatDate(t.endDate, false)} · {t.status}</span></span>
              {t.id !== term.id ? <button className="btn text" onClick={() => switchTo(t)}>Open</button> : <span className="tag">Active</span>}
              {t.id !== term.id && <button className="btn text" onClick={() => archive(t)}>{t.status === 'archived' ? 'Restore' : 'Archive'}</button>}
            </div>
          ))}
        </div>
        <p className="tiny">Archiving never deletes records; archived semesters keep their reports and can be opened at any time.</p>
      </section>
    </>
  );
}

function EditTerm({ onDone }: { onDone: () => void }) {
  const { repo, term, fail, toast } = useApp();
  const [f, setF] = useState({ name: term.name, institution: term.institution ?? '', year: term.academicYear ?? '', start: term.startDate, end: term.endDate, tz: term.timezone, status: term.status });
  const save = async () => {
    try {
      await repo.updateTerm(term.id, { name: f.name, institution: f.institution || null, academicYear: f.year || null, startDate: f.start, endDate: f.end, timezone: f.tz, status: f.status, rules: term.rules });
      toast('Semester saved');
      onDone();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="Institution"><input value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} /></Field>
        <Field label="Academic year"><input value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></Field>
      </div>
      <div className="grid2">
        <Field label="Start"><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="End"><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      </div>
      <Field label="Time zone"><input value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })} /></Field>
      <Field label="Status">
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Term['status'] })}>
          <option value="current">Current</option>
          <option value="upcoming">Upcoming</option>
          <option value="archived">Archived</option>
        </select>
      </Field>
      <p className="tiny">Holidays and special days are edited in Plan › Edit plan.</p>
      <button className="btn primary" onClick={save}>Save</button>
    </>
  );
}

export function RulesForm({ rules, onChange }: { rules: PlanningRules; onChange: (r: PlanningRules) => void }) {
  const r = rules;
  const set = (patch: Partial<PlanningRules>) => onChange({ ...r, ...patch });
  const pctField = (label: string, v: number, f: (n: number) => void, hint?: string) => (
    <Field label={label} hint={hint}><NumInput value={Math.round(v * 100)} min={0} max={100} onChange={(n) => f((n ?? 0) / 100)} /></Field>
  );
  return (
    <>
      <details open>
        <summary>Sleep (protected)</summary>
        <div className="grid3">
          <Field label="Lights out"><input type="time" value={r.sleep.lightsOut} onChange={(e) => set({ sleep: { ...r.sleep, lightsOut: e.target.value } })} /></Field>
          <Field label="Wake"><input type="time" value={r.sleep.wake} onChange={(e) => set({ sleep: { ...r.sleep, wake: e.target.value } })} /></Field>
          <Field label="No deep work after"><input type="time" value={r.sleep.noDeepWorkAfter} onChange={(e) => set({ sleep: { ...r.sleep, noDeepWorkAfter: e.target.value } })} /></Field>
        </div>
      </details>
      <details>
        <summary>Optional extension blocks</summary>
        <div className="stack" style={{ gap: 12 }}>
          <div className="grid2">
            {pctField('Add only if core ≥ (%)', r.optional.minCoreCompletion, (n) => set({ optional: { ...r.optional, minCoreCompletion: n } }))}
            <Field label="…and sleep ≥ (h)"><NumInput value={r.optional.minAvgSleep} step={0.25} onChange={(n) => set({ optional: { ...r.optional, minAvgSleep: n ?? 0 } })} /></Field>
          </div>
          <Field label="Most added per week"><NumInput value={r.optional.maxAddPerWeek} min={0} onChange={(n) => set({ optional: { ...r.optional, maxAddPerWeek: n ?? 0 } })} /></Field>
          <label className="row"><input type="checkbox" style={{ width: 22, height: 22 }} checked={r.optional.requireNoConcentrationDrop} onChange={(e) => set({ optional: { ...r.optional, requireNoConcentrationDrop: e.target.checked } })} /> Also require that focus did not drop</label>
          <div className="grid2">
            {pctField('Remove optional if core < (%)', r.reduce.belowCompletion, (n) => set({ reduce: { ...r.reduce, belowCompletion: n } }))}
            <Field label="…or sleep < (h)"><NumInput value={r.reduce.belowSleep} step={0.25} onChange={(n) => set({ reduce: { ...r.reduce, belowSleep: n ?? 0 } })} /></Field>
          </div>
        </div>
      </details>
      <details>
        <summary>Disrupted days and backlog</summary>
        <div className="grid2">
          <Field label="Max flexible items"><NumInput value={r.disruptedDay.maxFlexibleItems} min={1} onChange={(n) => set({ disruptedDay: { ...r.disruptedDay, maxFlexibleItems: n ?? 1 } })} /></Field>
          <Field label="Shorten kept items to (min)"><NumInput value={r.disruptedDay.shortenToMinutes} min={5} onChange={(n) => set({ disruptedDay: { ...r.disruptedDay, shortenToMinutes: n ?? 25 } })} /></Field>
          <Field label="Long-term goal minutes"><NumInput value={r.disruptedDay.continuityMinutes} min={0} onChange={(n) => set({ disruptedDay: { ...r.disruptedDay, continuityMinutes: n ?? 0 } })} /></Field>
          <Field label="Moved blocks per day"><NumInput value={r.backlog.nextDayMaxMoved} min={0} onChange={(n) => set({ backlog: { ...r.backlog, nextDayMaxMoved: n ?? 0 } })} /></Field>
          <Field label="Displaced per week before cutting scope"><NumInput value={r.backlog.maxDisplacedPerWeek} min={0} onChange={(n) => set({ backlog: { ...r.backlog, maxDisplacedPerWeek: n ?? 0 } })} /></Field>
          {pctField('Partial counts as (%)', r.partialWeight, (n) => set({ partialWeight: n }))}
        </div>
      </details>
      <details>
        <summary>Retests, mastery and weak courses</summary>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Retest after (days, comma-separated)">
            <input defaultValue={r.retest.offsetsDays.join(', ')} onBlur={(e) => set({ retest: { ...r.retest, offsetsDays: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) } })} />
          </Field>
          <label className="row"><input type="checkbox" style={{ width: 22, height: 22 }} checked={r.retest.beforeExam} onChange={(e) => set({ retest: { ...r.retest, beforeExam: e.target.checked } })} /> Add a retest the day before the course's next exam</label>
          <div className="grid2">
            <Field label="Independent passes for mastery"><NumInput value={r.mastery.independentPassesRequired} min={1} onChange={(n) => set({ mastery: { ...r.mastery, independentPassesRequired: n ?? 2 } })} /></Field>
            <Field label="Retry a failed retest after (days)"><NumInput value={r.retest.failRetryDays} min={1} onChange={(n) => set({ retest: { ...r.retest, failRetryDays: n ?? 2 } })} /></Field>
            {pctField('Weak course below (%)', r.weakCourse.accuracyBelow, (n) => set({ weakCourse: { ...r.weakCourse, accuracyBelow: n } }))}
            <Field label="…or same error type ×"><NumInput value={r.weakCourse.recurringErrorCount} min={1} onChange={(n) => set({ weakCourse: { ...r.weakCourse, recurringErrorCount: n ?? 3 } })} /></Field>
          </div>
          <label className="row"><input type="checkbox" style={{ width: 22, height: 22 }} checked={r.mastery.separateDays} onChange={(e) => set({ mastery: { ...r.mastery, separateDays: e.target.checked } })} /> Passes must be on separate days</label>
          <Field label="Error categories (one per line)">
            <textarea defaultValue={r.errorCategories.join('\n')} onBlur={(e) => set({ errorCategories: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
          </Field>
        </div>
      </details>
      <details>
        <summary>Calendar</summary>
        <div className="stack" style={{ gap: 12 }}>
          <div className="field"><span className="label">Week starts on</span>
            <Chips label="Week start" value={r.weekStartsOn} allowClear={false} onChange={(n) => set({ weekStartsOn: n ?? 0 })} options={[{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 6, label: 'Saturday' }]} />
          </div>
          <div className="grid2">
            <Field label="Trial start (optional)"><input type="date" value={r.trial.start ?? ''} onChange={(e) => set({ trial: { ...r.trial, start: e.target.value || null } })} /></Field>
            <Field label="Trial end"><input type="date" value={r.trial.end ?? ''} onChange={(e) => set({ trial: { ...r.trial, end: e.target.value || null } })} /></Field>
          </div>
        </div>
      </details>
    </>
  );
}

function RulesEditor() {
  const { repo, term, fail, toast } = useApp();
  const [rules, setRules] = useState<PlanningRules>(term.rules);
  const problems = validateRules(rules);
  const save = async () => {
    try {
      await repo.updateRules(term.id, rules);
      toast('Rules saved for this semester');
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <p className="small muted">These rules belong to {term.name} only. A new semester can copy them or start from defaults.</p>
      <RulesForm rules={rules} onChange={setRules} />
      {problems.length > 0 && <div className="err">{problems.join(' ')}</div>}
      <button className="btn primary" disabled={problems.length > 0} onClick={save}>Save rules</button>
    </>
  );
}

function Reminders() {
  const { repo, term, fail, toast } = useApp();
  const [perm, setPerm] = useState<PermissionState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    notificationPermission().then(setPerm, () => setPerm('unsupported'));
  }, []);
  const n = term.rules.notifications;
  const update = async (patch: Partial<PlanningRules['notifications']>) => {
    try {
      let enabled = patch.enabled ?? n.enabled;
      if (patch.enabled) {
        const p = await requestNotificationPermission();
        setPerm(p);
        if (p !== 'granted' && p !== 'unsupported') {
          enabled = false;
          setMsg('Permission was not granted, so reminders stay off. You can allow notifications later in Android Settings › Apps › Study Planner.');
        }
      }
      await repo.updateRules(term.id, { ...term.rules, notifications: { ...n, ...patch, enabled } });
      if (!enabled) await cancelAllReminders(repo);
      toast(enabled ? 'Reminders on' : 'Reminders off');
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <p className="small muted">Reminders are for study blocks only, so they do not duplicate class or exam reminders from your calendar app. A reminder that would fire during sleep ({formatTime(term.rules.sleep.lightsOut)}–{formatTime(term.rules.sleep.wake)}) is skipped.</p>
      <label className="row card" style={{ minHeight: 56 }}>
        <input type="checkbox" style={{ width: 24, height: 24 }} checked={n.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        <span className="grow">Remind me before study blocks</span>
      </label>
      {n.enabled && (
        <div className="field">
          <span className="label">How long before</span>
          <Chips label="Minutes before" tap value={n.minutesBefore} allowClear={false} onChange={(v) => update({ minutesBefore: v ?? 10 })} options={[5, 10, 15, 30].map((v) => ({ value: v, label: `${v} min` }))} />
        </div>
      )}
      <p className="small">Permission: {perm === null ? 'checking…' : perm === 'unsupported' ? 'not available in the browser preview' : perm}</p>
      {perm === 'denied' && <div className="warn">Notifications are blocked. Allow them in Android Settings › Apps › Study Planner › Notifications.</div>}
      {msg && <div className="warn">{msg}</div>}
      <button className="btn" onClick={async () => setMsg(await sendTestNotification())}>Send a test notification</button>
      <p className="tiny">Reminders use inexact Android alarms (no "Alarms &amp; reminders" permission is requested), so one may arrive a few minutes late, and battery savers or "Do not disturb" can delay or hide it. Reminders are planned 7 days ahead and refreshed whenever you open the app or change the plan.</p>
    </>
  );
}

function Backup({ onRestored }: { onRestored: (id: string) => void }) {
  const { repo, fail, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; preview: ReturnType<typeof previewImport> } | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const hasUndo = useData(() => repo.hasPreImportBackup(), []).data;
  const exportNow = async () => {
    setBusy(true);
    try {
      const b = await repo.exportBackup();
      const json = JSON.stringify(b, null, 1);
      // prove the file we are about to hand over parses and validates
      const check = validateBackup(JSON.parse(json));
      if (!check.ok) throw new Error('Backup self-check failed: ' + check.errors.join(' '));
      const name = `study-planner-backup-${b.exportedAt.slice(0, 10)}.json`;
      toast(await saveBackupFile(name, json));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (file: File | undefined) => {
    setErrors(null);
    setPending(null);
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return setErrors(['The file is not valid JSON.']);
      }
      const v = validateBackup(parsed);
      if (!v.ok || !v.backup) return setErrors(v.errors);
      setPending({ backup: v.backup, preview: previewImport(v.backup, await repo.counts()) });
    } catch (e) {
      fail(e);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await repo.restoreBackup(pending.backup);
      if (!res.ok) return setErrors(res.errors);
      setPending(null);
      toast('Backup restored. Your previous data was kept as an undo point.');
      const id = await repo.activeTermId();
      if (id) onRestored(id);
    } catch (e) {
      fail(e);
      setErrors(['The restore failed and was rolled back. Your existing data is unchanged.']);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!confirm('Go back to the data you had before the last restore?')) return;
    const res = await repo.undoLastImport();
    if (!res.ok) return setErrors(res.errors);
    toast('Previous data restored');
    const id = await repo.activeTermId();
    if (id) onRestored(id);
  };
  return (
    <>
      <section className="card stack">
        <h3>Export</h3>
        <p className="small muted">Creates a JSON file with every semester, plan, log, error and review. You choose where to save it; nothing is uploaded automatically.</p>
        <button className="btn primary" disabled={busy} onClick={exportNow}>Export backup</button>
      </section>
      <section className="card stack">
        <h3>Restore</h3>
        <p className="small muted">The file is checked first and you see what will change. Restoring replaces all data in the app; the current data is kept as an undo point.</p>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose backup file" />
        {errors && <div className="err"><strong>This file was not restored:</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{errors.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        {pending && (
          <div className="stack">
            <p className="small">Backup from {formatDate(pending.backup.exportedAt.slice(0, 10))} · semesters: {pending.preview.terms.join(', ') || 'none'}</p>
            <div className="list">
              {pending.preview.rows.filter((r) => r.current || r.incoming).map((r) => (
                <div key={r.table} className="item fixed small"><span className="grow">{r.table.replace(/_/g, ' ')}</span><span>{r.current} → {r.incoming}</span></div>
              ))}
            </div>
            {pending.preview.lostRecords > 0 && <div className="warn">{pending.preview.lostRecords} current record(s) are not in this backup and will be replaced. You can undo afterwards.</div>}
            <div className="grid2">
              <button className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={restore}>Replace my data</button>
            </div>
          </div>
        )}
        {hasUndo && <button className="btn text" onClick={undo}>Undo last restore</button>}
      </section>
      <p className="tiny">Android does not back this app up to Google automatically (it is turned off so records are never uploaded without you). Export regularly and keep the file somewhere safe.</p>
    </>
  );
}

function About() {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p>Study Planner {APP_VERSION}</p>
      <p className="small muted">Everything is stored in a SQLite database inside the app on this phone. There is no account, server, advertising, analytics or telemetry, and the app makes no network requests. The only permission it may ask for is notifications, and only if you turn reminders on.</p>
      <p className="small muted">The app does not read your calendar or contacts, and only opens a file when you choose one to import.</p>
      <p className="small muted">Uninstalling the app deletes its data. Export a backup first.</p>
    </div>
  );
}

