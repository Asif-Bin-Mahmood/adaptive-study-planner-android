// Shared read models for screens. Each call first makes sure template sessions
// exist for the requested range (idempotent, quiet).
import { addDays, startOfWeek } from '../domain/dates';
import { occurrencesOn, type Occurrence } from '../domain/schedule';
import type { Assessment, DateException, ISODate, Session, Term, Workstream } from '../domain/types';
import type { Repo } from '../data/repo';

export interface RangeData {
  sessions: Session[];
  occurrences: Map<ISODate, Occurrence[]>;
  assessments: Assessment[];
  workstreams: Workstream[];
  exceptions: DateException[];
}

export async function loadRange(repo: Repo, term: Term, start: ISODate, end: ISODate): Promise<RangeData> {
  await repo.ensureSessions(term.id, start, end, false);
  const [sessions, commitments, changes, exceptions, assessments, workstreams] = await Promise.all([
    repo.listSessions(term.id, start, end),
    repo.listCommitments(term.id),
    repo.listChanges(term.id),
    repo.listExceptions(term.id),
    repo.listAssessments(term.id),
    repo.listWorkstreams(term.id, true),
  ]);
  const occurrences = new Map<ISODate, Occurrence[]>();
  for (let d = start; d <= end; d = addDays(d, 1)) occurrences.set(d, occurrencesOn(d, commitments, changes, exceptions));
  return { sessions, occurrences, assessments, workstreams, exceptions };
}

export function weekOf(term: Term, d: ISODate) {
  const start = startOfWeek(d, term.rules.weekStartsOn);
  return { start, end: addDays(start, 6) };
}

export function wsName(ws: Workstream[], id: string | null): string {
  const w = ws.find((x) => x.id === id);
  return w ? w.code ?? w.name : '';
}

export function wsColor(ws: Workstream[], id: string | null): string {
  return ws.find((x) => x.id === id)?.color ?? 'var(--text-3)';
}

export const KIND_LABEL: Record<string, string> = {
  timed_set: 'Timed set',
  recall: 'Recall',
  prelab: 'Pre-lab',
  lablog: 'Lab log',
  retest: 'Retest',
  deep: 'Focused block',
  review: 'Review',
  other: 'Other',
};

export const ASSESS_LABEL: Record<string, string> = {
  midterm: 'Midterm',
  final: 'Final',
  quiz: 'Quiz',
  assignment: 'Assignment',
  lab_report: 'Lab report',
  presentation: 'Presentation',
  deadline: 'Deadline',
  other: 'Other',
};

export const WS_TYPE_LABEL: Record<string, string> = {
  course: 'Course',
  lab: 'Laboratory',
  thesis: 'Thesis',
  research: 'Research paper',
  cyber: 'Cybersecurity',
  ml: 'ML/AI',
  project: 'Personal project',
  habit: 'Routine',
  other: 'Other',
};

export const COLORS = ['#3b6fb6', '#2f8f6b', '#b5562f', '#7a4fb0', '#0f766e', '#a16207', '#be185d', '#6b7280'];
