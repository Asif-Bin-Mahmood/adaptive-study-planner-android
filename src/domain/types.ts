// Core data types. Every academic fact (courses, dates, rules) is data stored in
// SQLite; nothing here is specific to one semester.

export type ISODate = string; // YYYY-MM-DD (local date in the term's time zone)
export type HHMM = string; // 24h "HH:MM"

export type TermStatus = 'current' | 'upcoming' | 'archived';

export interface Term {
  id: string;
  name: string; // e.g. "Spring 2031"
  institution: string | null;
  academicYear: string | null; // e.g. "2030-31"
  startDate: ISODate;
  endDate: ISODate;
  status: TermStatus;
  timezone: string; // IANA, e.g. "Europe/London"
  rules: PlanningRules;
  createdAt: string;
  updatedAt: string;
}

export type ExceptionKind = 'holiday' | 'recess' | 'exam_period' | 'override_day' | 'note';

/** A date range with an effect on the plan. */
export interface DateException {
  id: string;
  termId: string;
  startDate: ISODate;
  endDate: ISODate;
  name: string;
  kind: ExceptionKind;
  /** Fixed classes/labs do not take place on these dates. */
  cancelsClasses: boolean;
  /** Recurring study templates do not generate sessions (day has its own plan). */
  suppressesStudy: boolean;
}

export type WorkstreamType =
  | 'course'
  | 'lab'
  | 'thesis'
  | 'research'
  | 'cyber'
  | 'ml'
  | 'project'
  | 'habit'
  | 'other';

export interface Workstream {
  id: string;
  termId: string | null; // null = not tied to one semester (e.g. ML/AI learning)
  type: WorkstreamType;
  code: string | null; // e.g. "MATH201"
  name: string;
  color: string;
  priority: number; // 1 (highest) .. 5 (lowest); used when cutting work
  deadline: ISODate | null;
  minWeeklyMinutes: number; // floor kept even in disrupted / exam weeks
  targetWeeklyMinutes: number; // normal core target
  extensionWeeklyMinutes: number; // optional extension target
  floorRule: string | null; // plain-language "counts as done when"
  archived: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CommitmentKind = 'class' | 'lab' | 'other';

/** Fixed recurring commitment (class, lab, job...). Never moved by the app. */
export interface Commitment {
  id: string;
  termId: string;
  workstreamId: string | null;
  kind: CommitmentKind;
  title: string;
  location: string | null;
  weekdays: number[]; // 0=Sun..6=Sat
  startTime: HHMM;
  endTime: HHMM;
  validFrom: ISODate;
  validTo: ISODate;
}

export type OccurrenceChangeKind = 'cancelled' | 'makeup';

export interface CommitmentChange {
  id: string;
  commitmentId: string;
  date: ISODate;
  kind: OccurrenceChangeKind; // cancelled: occurrence removed; makeup: extra occurrence
  startTime: HHMM | null; // makeup only
  endTime: HHMM | null;
  reason: string | null;
}

export type AssessmentKind = 'midterm' | 'final' | 'quiz' | 'assignment' | 'lab_report' | 'presentation' | 'deadline' | 'other';

export interface Assessment {
  id: string;
  termId: string;
  workstreamId: string | null;
  kind: AssessmentKind;
  title: string;
  date: ISODate;
  startTime: HHMM | null;
  endTime: HHMM | null;
  confirmed: boolean; // confirmed dates cannot be moved silently
  notes: string | null;
}

export type Tier = 'core' | 'optional';
export type BlockKind = 'timed_set' | 'recall' | 'prelab' | 'lablog' | 'retest' | 'deep' | 'review' | 'other';

/** Recurring flexible study block. Generates Session rows week by week. */
export interface StudyTemplate {
  id: string;
  termId: string;
  workstreamId: string | null;
  title: string;
  output: string | null; // expected written output
  kind: BlockKind;
  weekday: number;
  startTime: HHMM;
  durationMin: number;
  tier: Tier;
  active: boolean;
  validFrom: ISODate;
  validTo: ISODate;
  /** If set, the block only happens when this commitment occurs that week
   *  on `dependsOnWeekday` (e.g. lecture recall needs the lecture). */
  dependsOnCommitmentId: string | null;
  dependsOnWeekday: number | null;
}

export type SessionStatus =
  | 'planned'
  | 'done'
  | 'partial'
  | 'missed'
  | 'cancelled' // not scheduled (holiday, class cancelled) - never counted as missed
  | 'moved' // replaced by another session row (moved_to)
  | 'dropped'; // explicitly dropped for this week - no longer needs doing

export type SessionOrigin = 'template' | 'manual' | 'replan' | 'seed';

export interface Session {
  id: string;
  termId: string;
  workstreamId: string | null;
  templateId: string | null;
  assessmentId: string | null;
  date: ISODate;
  startTime: HHMM | null;
  durationMin: number;
  title: string;
  output: string | null;
  kind: BlockKind;
  tier: Tier;
  status: SessionStatus;
  actualMinutes: number | null;
  outputNote: string | null;
  origin: SessionOrigin;
  movedFromId: string | null;
  reason: string | null; // why the replan created/changed it
  createdAt: string;
  updatedAt: string;
}

export interface CheckIn {
  date: ISODate;
  sleepHours: number | null;
  concentration: number | null; // 1..5
  lowEnergy: boolean;
  note: string | null;
  updatedAt: string;
}

export interface TimedSet {
  id: string;
  termId: string;
  workstreamId: string;
  sessionId: string | null;
  date: ISODate;
  topic: string | null;
  attempted: number | null;
  correct: number | null;
  minutes: number | null;
  targetMinutes: number | null;
  notes: string | null;
  createdAt: string;
}

export type ErrorStatus = 'open' | 'mastered' | 'retired';

export interface ErrorEntry {
  id: string;
  termId: string;
  workstreamId: string;
  timedSetId: string | null;
  date: ISODate;
  question: string;
  category: string;
  cause: string | null;
  correctionRule: string | null;
  similarRef: string | null;
  status: ErrorStatus;
  createdAt: string;
  updatedAt: string;
}

export type RetestOutcome = 'pass' | 'assisted' | 'fail';

export interface Retest {
  id: string;
  errorId: string;
  dueDate: ISODate;
  label: string; // "2 days", "1 week", "Before MATH201 midterm"
  doneDate: ISODate | null;
  outcome: RetestOutcome | null;
}

export type ReviewDecision = 'keep' | 'add_optional' | 'remove_optional' | 'reduce_scope';

export interface WeeklyReview {
  id: string;
  termId: string;
  weekStart: ISODate;
  decision: ReviewDecision | null;
  notes: string | null;
  snapshot: unknown; // computed report at time of saving
  createdAt: string;
}

export interface ScheduleChange {
  id: string;
  termId: string;
  date: ISODate;
  scenario: string;
  summary: string;
  details: unknown;
  createdAt: string;
}

export interface PlanningRules {
  sleep: { lightsOut: HHMM; wake: HHMM; noDeepWorkAfter: HHMM };
  weekStartsOn: number; // 0 = Sunday
  partialWeight: number; // fraction of a block credited when Partial
  optional: {
    enabled: boolean; // master switch; optional templates still need approval one by one
    minCoreCompletion: number; // 0..1
    minAvgSleep: number; // hours
    requireNoConcentrationDrop: boolean;
    maxAddPerWeek: number;
  };
  reduce: { belowCompletion: number; belowSleep: number };
  weakCourse: { accuracyBelow: number; recurringErrorCount: number };
  disruptedDay: { maxFlexibleItems: number; continuityMinutes: number; shortenToMinutes: number };
  backlog: { maxDisplacedPerWeek: number; nextDayMaxMoved: number };
  retest: { offsetsDays: number[]; beforeExam: boolean; failRetryDays: number };
  mastery: { independentPassesRequired: number; separateDays: boolean };
  dailyBufferMinutes: number;
  errorCategories: string[];
  notifications: { enabled: boolean; minutesBefore: number };
  trial: { start: ISODate | null; end: ISODate | null };
}
