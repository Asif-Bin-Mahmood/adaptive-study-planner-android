import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, todayLocal } from '../domain/dates';
import { defaultRules } from '../domain/rules';
import type { Term } from '../domain/types';
import { DowngradeError, Repo } from '../data/repo';
import { openDriver } from '../platform/db';
import { readFileAsText } from '../platform/files';
import { syncReminders } from '../platform/notify';
import { ReplanSheet } from './components/ReplanSheet';
import { Ctx, type AppCtx, type Toast } from './ctx';
import { Icon } from './kit';
import { Plan } from './screens/Plan';
import { Practice } from './screens/Practice';
import { ProgressScreen } from './screens/Progress';
import { Today } from './screens/Today';
import { Settings } from './settings/Settings';
import { SemesterWizard } from './settings/Wizard';

type Tab = 'today' | 'plan' | 'practice' | 'progress';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'practice', label: 'Practice', icon: 'practice' },
  { id: 'progress', label: 'Progress', icon: 'progress' },
];

/** Browser preview only: ?today=YYYY-MM-DD shows another day. Ignored on Android. */
function resolveToday(): string {
  const q = new URLSearchParams(location.search).get('today');
  return q && /^\d{4}-\d{2}-\d{2}$/.test(q) && !(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() ? q : todayLocal();
}

export function App() {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [term, setTerm] = useState<Term | null | undefined>(undefined);
  const [today, setToday] = useState(resolveToday);
  const [tab, setTab] = useState<Tab>('today');
  const [toast, setToast] = useState<Toast | null>(null);
  const [settings, setSettings] = useState(false);
  const [replan, setReplan] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  // open + migrate the database once
  useEffect(() => {
    (async () => {
      try {
        const r = new Repo(await openDriver());
        await r.init();
        setRepo(r);
      } catch (e) {
        setFatal(e instanceof DowngradeError ? e.message : `The database could not be opened: ${(e as Error).message}. Nothing was deleted.`);
      }
    })();
  }, []);

  const loadTerm = useCallback(async (r: Repo) => {
    const id = await r.activeTermId();
    setTerm(id ? await r.getTerm(id) : null);
  }, []);

  useEffect(() => {
    if (!repo) return;
    loadTerm(repo);
    return repo.onChange(() => loadTerm(repo)) as () => void;
  }, [repo, loadTerm]);

  // the date changes at midnight or when the app returns from the background
  useEffect(() => {
    const check = () => setToday(resolveToday());
    const t = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // keep study reminders in line with the plan (debounced after every change)
  useEffect(() => {
    if (!repo || !term) return;
    let timer: number | undefined;
    const run = async () => {
      try {
        await repo.ensureSessions(term.id, today, addDays(today, 7), false);
        await syncReminders(repo, await repo.listSessions(term.id, today, addDays(today, 7)), term.rules);
      } catch {
        /* reminders are best effort; the plan itself is unaffected */
      }
    };
    run();
    const off = repo.onChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 1500);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [repo, term, today]);

  const showToast = useCallback((t: Toast | string) => {
    window.clearTimeout(toastTimer.current);
    setToast(typeof t === 'string' ? { text: t } : t);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);
  const fail = useCallback((e: unknown) => showToast({ text: e instanceof Error ? e.message : String(e), kind: 'error' }), [showToast]);

  if (fatal) return <div className="content" style={{ paddingTop: 48 }}><div className="err">{fatal}</div></div>;
  if (!repo || term === undefined) return <div className="app" aria-busy="true" />;
  if (term === null) return <FirstRun repo={repo} onDone={() => loadTerm(repo)} />;

  const ctx: AppCtx = { repo, term, today, toast: showToast, fail, openSettings: () => setSettings(true), openReplan: () => setReplan(true) };
  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <span className="term">{term.name}{term.status === 'archived' ? ' (archived)' : ''}</span>
          <button className="iconbtn" aria-label="Settings" onClick={() => setSettings(true)}>
            <Icon name="settings" />
          </button>
        </header>
        <main className="content">
          {tab === 'today' && <Today />}
          {tab === 'plan' && <Plan />}
          {tab === 'practice' && <Practice />}
          {tab === 'progress' && <ProgressScreen />}
        </main>
        <nav className="navbar" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <span className="pill"><Icon name={t.icon} /></span>
              {t.label}
            </button>
          ))}
        </nav>
        {toast && (
          <div className={`toast${toast.kind === 'error' ? ' error' : ''}`} role="status" aria-live="polite">
            <span className="spacer">{toast.text}</span>
            {toast.action && (
              <button className="btn text" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>
            )}
          </div>
        )}
        {settings && <Settings onClose={() => setSettings(false)} onSwitched={() => { setSettings(false); loadTerm(repo); setTab('today'); }} />}
        {replan && <ReplanSheet onClose={() => setReplan(false)} />}
      </div>
    </Ctx.Provider>
  );
}

/** First launch: create a semester with the setup wizard, or restore a backup. */
function FirstRun({ repo, onDone }: { repo: Repo; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const restore = async (file: File | undefined) => {
    if (!file) return;
    try {
      const res = await repo.restoreBackup(JSON.parse(await readFileAsText(file)));
      if (!res.ok) return setErr(res.errors.join(' '));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  // a minimal context so the wizard can run before any semester exists
  const tmpTerm: Term = {
    id: '',
    name: '',
    institution: null,
    academicYear: null,
    startDate: todayLocal(),
    endDate: todayLocal(),
    status: 'upcoming',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    rules: defaultRules(),
    createdAt: '',
    updatedAt: '',
  };
  return (
    <div className="content" style={{ paddingTop: 48 }}>
      <div className="screen">
        <h1>Study Planner</h1>
        <p className="muted">Offline study planning and tracking. Your data stays on this device.</p>
        {err && <div className="err">{err}</div>}
        <div className="card stack">
          <h2>Set up your semester</h2>
          <p className="small muted">Add your term dates, courses, class times, exams and projects. Everything can be edited later.</p>
          <button className="btn primary" onClick={() => setWizard(true)}>Create a semester</button>
        </div>
        <label className="btn">
          Restore from a backup file
          <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => restore(e.target.files?.[0])} />
        </label>
      </div>
      {wizard && (
        <Ctx.Provider value={{ repo, term: tmpTerm, today: todayLocal(), toast: () => undefined, fail: (e) => setErr(String(e)), openSettings: () => undefined, openReplan: () => undefined }}>
          <SemesterWizard onClose={() => setWizard(false)} onCreated={() => onDone()} />
        </Ctx.Provider>
      )}
    </div>
  );
}
