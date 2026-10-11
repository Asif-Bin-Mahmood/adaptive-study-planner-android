import { formatTime } from '../../domain/dates';
import type { Session, SessionStatus, Workstream } from '../../domain/types';
import { useApp } from '../ctx';
import { Icon } from '../kit';
import { wsColor } from '../loaders';

const STATUS_TEXT: Partial<Record<SessionStatus, string>> = {
  cancelled: 'Not scheduled',
  dropped: 'Dropped this week',
  moved: 'Moved',
};

/** A study block with one-tap Done / Partial / Missed. Tapping the active state again undoes it. */
export function SessionBlock(props: {
  session: Session;
  workstreams: Workstream[];
  onLogged?: (s: Session, status: SessionStatus) => void;
  onOpen?: (s: Session) => void;
  compact?: boolean;
}) {
  const { repo, fail, toast } = useApp();
  const s = props.session;
  const loggable = s.status === 'planned' || s.status === 'done' || s.status === 'partial' || s.status === 'missed';
  const set = async (status: SessionStatus) => {
    const next = s.status === status ? 'planned' : status;
    try {
      await repo.setSessionStatus(s.id, next);
      if (next === 'planned') toast('Cleared');
      else props.onLogged?.(s, next);
    } catch (e) {
      fail(e);
    }
  };
  const time = s.startTime ? `${formatTime(s.startTime)} · ` : 'Any time · ';
  return (
    <div className={`block is-${s.status}`}>
      <button
        type="button"
        className="row"
        style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: props.onOpen ? 'pointer' : 'default', alignItems: 'flex-start' }}
        onClick={() => props.onOpen?.(s)}
        aria-label={`${s.title}, details`}
      >
        <span className="dot" style={{ background: wsColor(props.workstreams, s.workstreamId), marginTop: 7 }} />
        <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <span className="title">{s.title}</span>
          <span className="meta">
            {time}
            {s.durationMin} min
            {s.tier === 'optional' && <span className="tag optional" style={{ marginLeft: 6 }}>Optional</span>}
            {s.origin === 'replan' && <span className="tag changed" style={{ marginLeft: 6 }}>Changed</span>}
          </span>
          {!props.compact && s.output && <span className="meta">Output: {s.output}</span>}
          {STATUS_TEXT[s.status] && <span className="meta">{STATUS_TEXT[s.status]}{s.reason ? ` — ${s.reason.replace(/^Not scheduled: /, '')}` : ''}</span>}
          {s.status !== 'cancelled' && s.status !== 'dropped' && s.status !== 'moved' && s.reason && s.origin !== 'template' && <span className="meta">{s.reason}</span>}
        </span>
      </button>
      {loggable && (
        <div className="status3" role="group" aria-label={`Log ${s.title}`}>
          <button data-s="done" aria-pressed={s.status === 'done'} onClick={() => set('done')}>
            <Icon name="check" size={18} /> Done
          </button>
          <button data-s="partial" aria-pressed={s.status === 'partial'} onClick={() => set('partial')}>
            <Icon name="half" size={16} /> Partial
          </button>
          <button data-s="missed" aria-pressed={s.status === 'missed'} onClick={() => set('missed')}>
            <Icon name="cross" size={18} /> Missed
          </button>
        </div>
      )}
    </div>
  );
}
