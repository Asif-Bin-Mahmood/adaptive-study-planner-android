// Pure planning of study reminders. The platform adapter only executes the diff,
// so editing a block can never leave a stale or duplicate reminder behind.
import { addDays, addMinutes, inSleepWindow, todayLocal, nowHHMM } from './dates';
import type { ISODate, PlanningRules, Session } from './types';

export interface PlannedReminder {
  id: number; // stable per session
  sessionId: string;
  date: ISODate;
  time: string; // HH:MM local
  title: string;
  body: string;
  fingerprint: string; // changes whenever the reminder content/time changes
}

/** Stable positive 31-bit id from a session id (FNV-1a). */
export function reminderId(sessionId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}

/**
 * Reminders for planned study blocks with a start time in the next `days` days.
 * Skips blocks in the past and any reminder that would fire inside protected
 * sleep. Fixed classes and exams are never included (Google Calendar covers them).
 */
export function planReminders(sessions: Session[], rules: PlanningRules, now: Date, days = 7): PlannedReminder[] {
  if (!rules.notifications.enabled) return [];
  const today = todayLocal(now);
  const nowT = nowHHMM(now);
  const last = addDays(today, days);
  const out: PlannedReminder[] = [];
  for (const s of sessions) {
    if (s.status !== 'planned' || !s.startTime) continue;
    if (s.date < today || s.date > last) continue;
    const before = rules.notifications.minutesBefore;
    let date = s.date;
    let time = addMinutes(s.startTime, -before);
    if (+s.startTime.slice(0, 2) * 60 + +s.startTime.slice(3) < before) date = addDays(s.date, -1);
    if (date < today || (date === today && time <= nowT)) continue;
    if (inSleepWindow(time, rules.sleep.lightsOut, rules.sleep.wake)) continue;
    const title = s.title;
    const body = `Starts at ${s.startTime} · ${s.durationMin} min${s.output ? ` · ${s.output}` : ''}`;
    out.push({ id: reminderId(s.id), sessionId: s.id, date, time, title, body, fingerprint: `${date} ${time}|${title}|${body}` });
  }
  return out;
}

export interface ReminderDiff {
  cancel: number[];
  schedule: PlannedReminder[];
}

/** Compare what is scheduled (id -> fingerprint) with what should be. */
export function diffReminders(existing: Map<number, string>, desired: PlannedReminder[]): ReminderDiff {
  const want = new Map(desired.map((r) => [r.id, r]));
  const cancel: number[] = [];
  const schedule: PlannedReminder[] = [];
  for (const [id, fp] of existing) {
    const d = want.get(id);
    if (!d || d.fingerprint !== fp) cancel.push(id);
  }
  for (const d of desired) {
    if (existing.get(d.id) !== d.fingerprint) schedule.push(d);
  }
  return { cancel, schedule };
}
