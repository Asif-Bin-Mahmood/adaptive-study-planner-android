// Date helpers that work on plain "YYYY-MM-DD" strings so results never depend
// on the device time zone offset. Arithmetic is done in UTC.
import type { HHMM, ISODate } from './types';

const DAY_MS = 86_400_000;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isHHMM(s: unknown): s is HHMM {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function toUTC(d: ISODate): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * DAY_MS);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a) - toUTC(b)) / DAY_MS);
}

export function weekday(d: ISODate): number {
  return new Date(toUTC(d)).getUTCDay();
}

export function startOfWeek(d: ISODate, weekStartsOn = 0): ISODate {
  const delta = (weekday(d) - weekStartsOn + 7) % 7;
  return addDays(d, -delta);
}

export function daysInRange(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function inRange(d: ISODate, start: ISODate, end: ISODate): boolean {
  return d >= start && d <= end;
}

/** Local calendar date of the device (the app assumes the phone is set to the term's zone). */
export function todayLocal(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toMinutes(t: HHMM): number {
  return +t.slice(0, 2) * 60 + +t.slice(3, 5);
}

export function fromMinutes(m: number): HHMM {
  const mm = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}

export function addMinutes(t: HHMM, n: number): HHMM {
  return fromMinutes(toMinutes(t) + n);
}

/** Overlap of [aStart, aEnd) and [bStart, bEnd) in minutes-of-day. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** True if a time-of-day falls inside the sleep window (which may cross midnight). */
export function inSleepWindow(t: HHMM, lightsOut: HHMM, wake: HHMM): boolean {
  const m = toMinutes(t);
  const lo = toMinutes(lightsOut);
  const w = toMinutes(wake);
  return lo > w ? m >= lo || m < w : m >= lo && m < w;
}

/** Does a block [start, start+duration) intrude into the sleep window? */
export function blockHitsSleep(start: HHMM, durationMin: number, lightsOut: HHMM, wake: HHMM): boolean {
  if (inSleepWindow(start, lightsOut, wake)) return true;
  const end = toMinutes(start) + durationMin;
  const lo = toMinutes(lightsOut);
  // block that runs past lights-out on the same evening
  return lo > toMinutes(wake) && toMinutes(start) < lo && end > lo;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekdayShort = (n: number) => WEEKDAYS[n];
export const weekdayLong = (n: number) => WEEKDAYS_LONG[n];

export function formatDate(d: ISODate, withWeekday = true): string {
  const s = `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
  return withWeekday ? `${WEEKDAYS[weekday(d)]}, ${s}` : s;
}

export function formatTime(t: HHMM | null | undefined): string {
  if (!t) return '';
  const h = +t.slice(0, 2);
  const m = t.slice(3, 5);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

export function nowHHMM(now: Date = new Date()): HHMM {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
