// Small shared UI pieces: icons with labels, sheets, fields, chips.
import { useEffect, useRef, type ReactNode } from 'react';

const PATHS: Record<string, string> = {
  today: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  plan: 'M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 7h3m-3 4h6',
  practice: 'M9 11l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
  progress: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  check: 'M5 12l5 5 9-10',
  half: 'M12 3a9 9 0 1 0 0 18V3Z',
  cross: 'M7 7l10 10M17 7 7 17',
  plus: 'M12 5v14M5 12h14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  replan: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} fill={name === 'half' ? 'currentColor' : 'none'} />
      {name === 'half' && <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}

let sheetDepth = 0;

/** Modal bottom sheet. The Android back button closes the top sheet (history entry per sheet). */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; full?: boolean; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    ref.current?.focus();
    const depth = ++sheetDepth;
    let poppedByBack = false;
    history.pushState({ sheetDepth: depth }, '');
    const onPop = (e: PopStateEvent) => {
      const now = (e.state && (e.state as { sheetDepth?: number }).sheetDepth) || 0;
      if (now < depth && !poppedByBack) {
        poppedByBack = true;
        onClose.current();
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && depth === sheetDepth && onClose.current();
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      sheetDepth--;
      if (!poppedByBack && (history.state as { sheetDepth?: number } | null)?.sheetDepth === depth) history.back();
    };
  }, []);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`sheet${props.full ? ' full' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={ref}>
        <div className="sheet-head">
          {props.onBack && (
            <button className="iconbtn" onClick={props.onBack} aria-label="Back">
              <Icon name="back" />
            </button>
          )}
          <h2>{props.title}</h2>
          <button className="iconbtn" onClick={props.onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{props.children}</div>
        {props.footer && <div className="sheet-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{props.label}</span>
      {props.children}
      {props.hint && <span className="hint">{props.hint}</span>}
    </label>
  );
}

export function Chips<T extends string | number>(props: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T | null) => void; label: string; tap?: boolean; allowClear?: boolean }) {
  return (
    <div className={`wrap${props.tap ? ' chips-tap' : ''}`} role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="chip"
          aria-pressed={props.value === o.value}
          onClick={() => props.onChange(props.value === o.value && props.allowClear !== false ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Number input that keeps empty as null. */
export function NumInput(props: { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; id?: string; 'aria-label'?: string }) {
  return (
    <input
      id={props.id}
      aria-label={props['aria-label']}
      type="number"
      inputMode="decimal"
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}
