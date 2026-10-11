// Validation of semester packages (JSON imports and test fixtures)
// and of the quick text format used by the new-semester wizard.
import { isHHMM, isISODate } from '../domain/dates';
import type { AssessmentKind } from '../domain/types';
import type { TermPackage } from './repo';

export function validateTermPackage(p: unknown): string[] {
  const e: string[] = [];
  if (!p || typeof p !== 'object') return ['Package is not an object.'];
  const pkg = p as TermPackage;
  if (!pkg.packageId || typeof pkg.packageId !== 'string') e.push('packageId is required.');
  if (!pkg.term || !pkg.term.name) e.push('term.name is required.');
  if (!isISODate(pkg.term?.startDate) || !isISODate(pkg.term?.endDate)) e.push('term dates are invalid.');
  const ws = new Set((pkg.workstreams ?? []).map((w) => w.key));
  const cm = new Set((pkg.commitments ?? []).map((c) => c.key));
  const keyRef = (k: string | undefined, set: Set<string>, what: string) => {
    if (k && !set.has(k)) e.push(`${what} refers to unknown key "${k}".`);
  };
  for (const c of pkg.commitments ?? []) {
    if (!isHHMM(c.startTime) || !isHHMM(c.endTime) || c.endTime <= c.startTime) e.push(`Commitment ${c.title}: invalid times.`);
    if (!c.weekdays.length || c.weekdays.some((d) => d < 0 || d > 6)) e.push(`Commitment ${c.title}: invalid weekdays.`);
    if (!isISODate(c.validFrom) || !isISODate(c.validTo)) e.push(`Commitment ${c.title}: invalid dates.`);
    keyRef(c.workstream, ws, `Commitment ${c.title}`);
  }
  for (const a of pkg.assessments ?? []) {
    if (!isISODate(a.date)) e.push(`Assessment ${a.title}: invalid date.`);
    if ((a.startTime && !isHHMM(a.startTime)) || (a.endTime && !isHHMM(a.endTime))) e.push(`Assessment ${a.title}: invalid time.`);
    keyRef(a.workstream, ws, `Assessment ${a.title}`);
  }
  for (const t of pkg.templates ?? []) {
    if (!isHHMM(t.startTime) || !(t.durationMin > 0) || t.weekday < 0 || t.weekday > 6) e.push(`Template ${t.title}: invalid time, weekday or duration.`);
    keyRef(t.workstream, ws, `Template ${t.title}`);
    keyRef(t.dependsOn, cm, `Template ${t.title}`);
  }
  for (const s of pkg.sessions ?? []) {
    if (!isISODate(s.date) || (s.startTime && !isHHMM(s.startTime)) || !(s.durationMin > 0)) e.push(`Session ${s.title}: invalid date, time or duration.`);
    keyRef(s.workstream, ws, `Session ${s.title}`);
  }
  for (const ch of pkg.commitmentChanges ?? []) keyRef(ch.commitment, cm, `Change on ${ch.date}`);
  for (const x of pkg.exceptions ?? []) if (!isISODate(x.startDate) || !isISODate(x.endDate)) e.push(`Exception ${x.name}: invalid dates.`);
  return e;
}

export interface ParsedAssessment {
  code: string;
  kind: AssessmentKind;
  date: string;
  startTime: string | null;
  endTime: string | null;
}

const KINDS: AssessmentKind[] = ['midterm', 'final', 'quiz', 'assignment', 'lab_report', 'presentation', 'deadline', 'other'];

/**
 * Parse pasted lines like "MATH201, midterm, 2031-03-20, 10:00, 12:00".
 * Time columns are optional. Returns rows and per-line problems.
 */
export function parseAssessmentLines(text: string): { rows: ParsedAssessment[]; problems: string[] } {
  const rows: ParsedAssessment[] = [];
  const problems: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .forEach((line, i) => {
      const parts = line.split(/[,\t;]/).map((x) => x.trim());
      const [code, kindRaw, date, start, end] = parts;
      const kind = (kindRaw ?? '').toLowerCase().replace(/[\s-]+/g, '_') as AssessmentKind;
      if (!code) return problems.push(`Line ${i + 1}: course code missing.`);
      if (!KINDS.includes(kind)) return problems.push(`Line ${i + 1}: unknown type "${kindRaw}". Use one of ${KINDS.join(', ')}.`);
      if (!isISODate(date)) return problems.push(`Line ${i + 1}: date must be YYYY-MM-DD.`);
      if ((start && !isHHMM(start)) || (end && !isHHMM(end))) return problems.push(`Line ${i + 1}: times must be HH:MM (24 h).`);
      if (start && end && end <= start) return problems.push(`Line ${i + 1}: end time is before start time.`);
      rows.push({ code: code.toUpperCase(), kind, date, startTime: start || null, endTime: end || null });
    });
  return { rows, problems };
}
