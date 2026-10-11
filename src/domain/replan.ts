// Deterministic, offline replanning engine. It never changes anything itself:
// it returns a Proposal that the user reviews and confirms before it is applied.
import { addDays, diffDays, formatDate, formatTime, startOfWeek, weekday } from './dates';
import { creditedMinutes, } from './metrics';
import { daysToNextAssessment, occurrencesOn, studySuppressedOn } from './schedule';
import type {
  Assessment,
  AssessmentKind,
  BlockKind,
  Commitment,
  CommitmentChange,
  DateException,
  HHMM,
  ISODate,
  PlanningRules,
  Retest,
  Session,
  StudyTemplate,
  Tier,
  Workstream,
} from './types';

export type Scenario =
  | { type: 'missed'; sessionIds: string[] }
  | { type: 'low_energy' }
  | { type: 'concentration' }
  | { type: 'lost_time'; minutes: number; cause: 'journey' | 'lab_overrun' | 'other' }
  | {
      type: 'new_deadline';
      title: string;
      workstreamId: string | null;
      kind: AssessmentKind;
      dueDate: ISODate;
      dueTime: HHMM | null;
      estimateMin: number;
      unexpected: boolean;
    }
  | { type: 'cancelled_class'; commitmentId: string; date: ISODate; reason: string }
  | { type: 'exam_change'; assessmentId: string; newDate: ISODate; newStart: HHMM | null; newEnd: HHMM | null };

export interface NewSessionDraft {
  workstreamId: string | null;
  assessmentId: string | null;
  date: ISODate;
  startTime: HHMM | null;
  durationMin: number;
  title: string;
  kind: BlockKind;
  tier: Tier;
  movedFromId: string | null;
}

export type Action =
  | { type: 'keep'; sessionId: string; reason: string }
  | { type: 'shorten'; sessionId: string; toMinutes: number; reason: string }
  | { type: 'swap'; sessionId: string; title: string; kind: BlockKind; toMinutes: number; reason: string }
  | { type: 'move'; sessionId: string; toDate: ISODate; reason: string }
  | { type: 'makeup'; sessionId: string; toDate: ISODate; reason: string }
  | { type: 'set_status'; sessionId: string; status: 'missed' | 'dropped' | 'cancelled'; reason: string }
  | { type: 'add'; draft: NewSessionDraft; reason: string }
  | { type: 'add_assessment'; draft: Omit<Assessment, 'id'>; tempId: string; reason: string }
  | { type: 'update_assessment'; assessmentId: string; date: ISODate; startTime: HHMM | null; endTime: HHMM | null; reason: string }
  | { type: 'cancel_occurrence'; commitmentId: string; date: ISODate; reason: string }
  | { type: 'update_retest'; retestId: string; dueDate: ISODate; reason: string };

export interface Proposal {
  scenario: Scenario['type'] | 'reduce_scope';
  title: string;
  actions: Action[];
  warnings: string[];
  reduceNextWeek: boolean;
  summary: string[]; // two or three plain-language lines
}

export interface ReplanContext {
  termId: string;
  today: ISODate;
  rules: PlanningRules;
  sessions: Session[]; // at least: this week and the next 14 days
  workstreams: Workstream[];
  assessments: Assessment[];
  commitments: Commitment[];
  changes: CommitmentChange[];
  exceptions: DateException[];
  templates: StudyTemplate[];
  retests: Retest[];
}

const LONG_TERM = new Set(['thesis', 'research', 'cyber', 'ml', 'project', 'habit', 'other']);
const EXAM_KINDS: AssessmentKind[] = ['midterm', 'final'];
const DUE_KINDS: AssessmentKind[] = ['assignment', 'lab_report', 'deadline', 'quiz', 'presentation', 'other'];

export interface Scored {
  session: Session;
  score: number;
  why: string[];
}

/**
 * Rank a flexible block: urgency (deadline/exam proximity), consequence of delay
 * (pre-lab before a lab, protecting a weekly minimum), importance (priority),
 * minus a penalty for optional work. Higher = keep first.
 */
export function scoreSession(s: Session, ctx: ReplanContext): Scored {
  const why: string[] = [];
  let score = 0;
  const ws = ctx.workstreams.find((w) => w.id === s.workstreamId);
  // urgency: something due within 48 h
  const linked = s.assessmentId ? ctx.assessments.find((a) => a.id === s.assessmentId) : null;
  const due = linked
    ? { days: diffDays(linked.date, ctx.today), assessment: linked }
    : daysToNextAssessment(s.workstreamId, ctx.today, ctx.assessments, DUE_KINDS);
  if (due && due.days >= 0 && due.days <= 2) {
    score += 50;
    why.push(`${due.assessment.title} is due ${due.days === 0 ? 'today' : due.days === 1 ? 'tomorrow' : 'in 2 days'}`);
  } else if (due && due.days <= 7) {
    score += 20;
    why.push(`${due.assessment.title} is due in ${due.days} days`);
  }
  // exam relevance
  const exam = daysToNextAssessment(s.workstreamId, ctx.today, ctx.assessments, EXAM_KINDS);
  if (exam && exam.days <= 14) {
    score += Math.round(((15 - exam.days) / 15) * 30);
    why.push(`${exam.assessment.title} in ${exam.days} day${exam.days === 1 ? '' : 's'}`);
  }
  // consequence: pre-lab before a lab today/tomorrow
  if (s.kind === 'prelab') {
    const labSoon = [ctx.today, addDays(ctx.today, 1)].some((d) =>
      occurrencesOn(d, ctx.commitments, ctx.changes, ctx.exceptions).some(
        (o) => o.commitment.kind === 'lab' && (!s.workstreamId || o.commitment.workstreamId === s.workstreamId),
      ),
    );
    if (labSoon) {
      score += 35;
      why.push('the lab it prepares for is today or tomorrow');
    }
  }
  // consequence: weekly minimum at risk
  if (ws && ws.minWeeklyMinutes > 0) {
    const wk = startOfWeek(ctx.today, ctx.rules.weekStartsOn);
    const mine = ctx.sessions.filter((x) => x.workstreamId === ws.id && x.date >= wk && x.date <= addDays(wk, 6));
    const done = mine.reduce((a, x) => a + creditedMinutes(x, ctx.rules.partialWeight), 0);
    const otherPlanned = mine.filter((x) => x.id !== s.id && x.status === 'planned' && x.date >= ctx.today).reduce((a, x) => a + x.durationMin, 0);
    if (done < ws.minWeeklyMinutes && done + otherPlanned < ws.minWeeklyMinutes) {
      score += 20;
      why.push(`it protects ${ws.code ?? ws.name}'s weekly minimum`);
    }
  }
  // importance
  const pr = ws?.priority ?? 3;
  score += (6 - pr) * 5;
  if (s.tier === 'optional') {
    score -= 30;
    why.push('optional work');
  }
  return { session: s, score, why };
}

export function rank(sessions: Session[], ctx: ReplanContext): Scored[] {
  return sessions
    .map((s) => scoreSession(s, ctx))
    .sort((a, b) => b.score - a.score || (a.session.startTime ?? '').localeCompare(b.session.startTime ?? ''));
}

function wsLabel(ctx: ReplanContext, id: string | null): string {
  const w = ctx.workstreams.find((x) => x.id === id);
  return w ? w.code ?? w.name : 'General';
}

function weekBounds(ctx: ReplanContext) {
  const start = startOfWeek(ctx.today, ctx.rules.weekStartsOn);
  return { start, end: addDays(start, 6) };
}

function alreadyDisplaced(ctx: ReplanContext, exclude: Set<string>): number {
  const { start, end } = weekBounds(ctx);
  return ctx.sessions.filter(
    (s) => s.date >= start && s.date <= end && !exclude.has(s.id) && (s.status === 'moved' || s.status === 'dropped' || s.status === 'missed'),
  ).length;
}

/** Tracks how many moved blocks each future day absorbs, including existing replans. */
class DayLoad {
  private moved = new Map<string, number>();
  constructor(private ctx: ReplanContext) {
    for (const s of ctx.sessions) {
      if (s.origin === 'replan' && s.status === 'planned' && s.movedFromId) this.bump(s.date);
    }
  }
  bump(d: ISODate) {
    this.moved.set(d, (this.moved.get(d) ?? 0) + 1);
  }
  movedOn(d: ISODate) {
    return this.moved.get(d) ?? 0;
  }
  plannedMinutes(d: ISODate) {
    return this.ctx.sessions.filter((s) => s.date === d && s.status === 'planned').reduce((a, s) => a + s.durationMin, 0);
  }
}

/** Best day this week to absorb one moved block, or null. */
function pickDay(s: Session, ctx: ReplanContext, load: DayLoad, latest: ISODate | null): ISODate | null {
  const { end } = weekBounds(ctx);
  const tomorrow = addDays(ctx.today, 1);
  let best: ISODate | null = null;
  for (let d = tomorrow; d <= end; d = addDays(d, 1)) {
    if (latest && d >= latest) break;
    if (studySuppressedOn(d, ctx.exceptions)) continue;
    if (ctx.assessments.some((a) => a.date === d && EXAM_KINDS.includes(a.kind))) continue; // keep exam days clear
    if (load.movedOn(d) >= ctx.rules.backlog.nextDayMaxMoved) continue;
    if (!best || load.plannedMinutes(d) < load.plannedMinutes(best)) best = d;
  }
  void s;
  return best;
}

function continuityAction(notKept: Session[], ctx: ReplanContext, date: ISODate): Action | null {
  const minutes = ctx.rules.disruptedDay.continuityMinutes;
  if (minutes <= 0) return null;
  const longTerm = notKept
    .map((s) => ctx.workstreams.find((w) => w.id === s.workstreamId))
    .filter((w): w is Workstream => !!w && LONG_TERM.has(w.type))
    .sort((a, b) => a.priority - b.priority)[0];
  if (!longTerm) return null;
  return {
    type: 'add',
    draft: {
      workstreamId: longTerm.id,
      assessmentId: null,
      date,
      startTime: null,
      durationMin: minutes,
      title: `Write the next concrete step: ${longTerm.name}`,
      kind: 'other',
      tier: 'core',
      movedFromId: null,
    },
    reason: `Keeps ${longTerm.name} moving with ${minutes} minutes instead of a full block.`,
  };
}

/** Disrupted day: keep at most N flexible items, move a few within budget, drop the rest. */
function disruptedDay(ctx: ReplanContext, mode: 'low_energy' | 'concentration' | 'lost_time', lostMinutes = 0): Proposal {
  const r = ctx.rules;
  const todays = ctx.sessions.filter((s) => s.date === ctx.today && s.status === 'planned');
  const ranked = rank(todays, ctx);
  const actions: Action[] = [];
  const warnings: string[] = [];
  const max = r.disruptedDay.maxFlexibleItems;
  const totalPlanned = todays.reduce((a, s) => a + s.durationMin, 0);
  let budget = mode === 'lost_time' ? Math.max(0, totalPlanned - lostMinutes) : Infinity;
  const kept: Session[] = [];
  const notKept: Session[] = [];

  for (const item of ranked) {
    const s = item.session;
    const because = item.why.length ? ` because ${item.why.join(', ')}` : '';
    if (kept.length < max && s.tier === 'core' && budget > 0) {
      let minutes = s.durationMin;
      if (mode !== 'lost_time') minutes = Math.min(s.durationMin, r.disruptedDay.shortenToMinutes);
      minutes = Math.min(minutes, budget);
      budget -= minutes;
      kept.push(s);
      if (mode === 'low_energy' && (s.kind === 'timed_set' || s.kind === 'deep')) {
        actions.push({
          type: 'swap',
          sessionId: s.id,
          title: `Retest logged errors: ${wsLabel(ctx, s.workstreamId)}`,
          kind: 'retest',
          toMinutes: minutes,
          reason: `Kept${because}. On a low-energy day, retesting earlier mistakes replaces new problem-solving.`,
        });
      } else if (minutes < s.durationMin) {
        actions.push({ type: 'shorten', sessionId: s.id, toMinutes: minutes, reason: `Kept${because}, shortened to ${minutes} min.` });
      } else {
        actions.push({ type: 'keep', sessionId: s.id, reason: `Kept${because}.` });
      }
    } else {
      notKept.push(s);
    }
  }

  const handled = new Set(notKept.map((s) => s.id));
  let displaced = alreadyDisplaced(ctx, handled);
  const load = new DayLoad(ctx);
  let reduce = false;
  for (const s of notKept) {
    displaced++;
    if (s.tier === 'optional') {
      actions.push({ type: 'set_status', sessionId: s.id, status: 'dropped', reason: 'Optional work is the first to go on a disrupted day.' });
      continue;
    }
    const day = displaced <= r.backlog.maxDisplacedPerWeek ? pickDay(s, ctx, load, null) : null;
    if (day) {
      load.bump(day);
      actions.push({ type: 'move', sessionId: s.id, toDate: day, reason: `Moved to ${formatDate(day)}, which has room for one moved block.` });
    } else {
      if (displaced > r.backlog.maxDisplacedPerWeek) reduce = true;
      actions.push({
        type: 'set_status',
        sessionId: s.id,
        status: 'dropped',
        reason:
          displaced > r.backlog.maxDisplacedPerWeek
            ? `Dropped for this week: more than ${r.backlog.maxDisplacedPerWeek} blocks are already displaced, so next week's scope shrinks instead of building a backlog.`
            : 'Dropped for this week: no remaining day this week can take another moved block. The workstream continues with its next regular block.',
      });
    }
  }
  const cont = continuityAction(notKept, ctx, ctx.today);
  if (cont) actions.push(cont);

  if (mode === 'low_energy') warnings.push(`Stop deep work by ${formatTime(r.sleep.noDeepWorkAfter)}. Sleep (${formatTime(r.sleep.lightsOut)}–${formatTime(r.sleep.wake)}) is protected.`);
  const dueSoon = ctx.assessments.filter((a) => DUE_KINDS.includes(a.kind) && diffDays(a.date, ctx.today) >= 0 && diffDays(a.date, ctx.today) <= 2);
  for (const a of dueSoon) {
    if (!todays.some((s) => s.assessmentId === a.id)) warnings.push(`${a.title} is due ${formatDate(a.date)} and has no block today.`);
  }
  if (!todays.length) warnings.push('Nothing flexible is planned today. Fixed classes, labs and exams stay as they are.');

  const title =
    mode === 'low_energy' ? 'Low-energy day' : mode === 'concentration' ? 'Hard to concentrate' : `Lost ${lostMinutes} minutes`;
  const keptNames = kept.map((s) => s.title).join(' and ');
  const summary = [
    kept.length ? `Today keeps ${kept.length} item${kept.length > 1 ? 's' : ''}: ${keptNames}.` : 'No flexible items kept today.',
    notKept.length ? `${notKept.length} other block${notKept.length > 1 ? 's are' : ' is'} moved or dropped, never all pushed to tomorrow.` : '',
    'Classes, labs, exams and sleep are unchanged.',
  ].filter(Boolean);
  return { scenario: mode, title, actions, warnings, reduceNextWeek: reduce, summary };
}

function missed(ctx: ReplanContext, ids: string[]): Proposal {
  const r = ctx.rules;
  const targets = ctx.sessions.filter((s) => ids.includes(s.id) && (s.status === 'planned' || s.status === 'missed'));
  const actions: Action[] = [];
  const warnings: string[] = [];
  const load = new DayLoad(ctx);
  const handled = new Set(targets.map((s) => s.id));
  let displaced = alreadyDisplaced(ctx, handled);
  let reduce = false;
  let madeUp = 0;
  for (const item of rank(targets, ctx)) {
    const s = item.session;
    displaced++;
    if (s.status === 'planned') actions.push({ type: 'set_status', sessionId: s.id, status: 'missed', reason: 'Recorded as missed (not done, not cancelled).' });
    if (s.tier === 'optional') continue;
    const exam = daysToNextAssessment(s.workstreamId, ctx.today, ctx.assessments, EXAM_KINDS);
    const latest = exam ? exam.assessment.date : null;
    const allowMove = displaced <= r.backlog.maxDisplacedPerWeek && (item.score >= 30 || madeUp === 0);
    const day = allowMove ? pickDay(s, ctx, load, latest) : null;
    if (day) {
      load.bump(day);
      madeUp++;
      const why = item.why.length ? ` because ${item.why.join(', ')}` : '';
      actions.push({ type: 'makeup', sessionId: s.id, toDate: day, reason: `Make-up on ${formatDate(day)}${why}.` });
    } else {
      if (displaced > r.backlog.maxDisplacedPerWeek) reduce = true;
      actions.push({
        type: 'keep',
        sessionId: s.id,
        reason:
          displaced > r.backlog.maxDisplacedPerWeek
            ? 'Not rescheduled: the weekly limit for displaced blocks is reached, so next week is trimmed instead.'
            : `Not rescheduled: ${wsLabel(ctx, s.workstreamId)} continues with its next regular block.`,
      });
    }
  }
  if (!targets.length) warnings.push('No planned blocks were selected.');
  const summary = [
    `${targets.length} block${targets.length === 1 ? '' : 's'} recorded as missed.`,
    madeUp ? `${madeUp} make-up block${madeUp > 1 ? 's' : ''} added, at most ${r.backlog.nextDayMaxMoved} per day.` : 'No make-up blocks added.',
    reduce ? 'More than the weekly limit is displaced, so next week will be trimmed.' : '',
  ].filter(Boolean);
  return { scenario: 'missed', title: 'Missed sessions', actions, warnings, reduceNextWeek: reduce, summary };
}

function newDeadline(ctx: ReplanContext, sc: Extract<Scenario, { type: 'new_deadline' }>): Proposal {
  const actions: Action[] = [];
  const warnings: string[] = [];
  const tempId = 'new-assessment';
  if (sc.dueDate < ctx.today) {
    return { scenario: 'new_deadline', title: 'New deadline', actions, warnings: ['The due date is in the past.'], reduceNextWeek: false, summary: [] };
  }
  actions.push({
    type: 'add_assessment',
    tempId,
    draft: {
      termId: ctx.termId,
      workstreamId: sc.workstreamId,
      kind: sc.kind,
      title: sc.title,
      date: sc.dueDate,
      startTime: sc.dueTime,
      endTime: null,
      confirmed: true,
      notes: sc.unexpected ? 'Added as an unexpected assignment' : null,
    },
    reason: 'Recorded as a confirmed deadline; it will not be moved silently.',
  });
  const chunk = 60;
  let remaining = Math.max(0, sc.estimateMin);
  const lastDay = sc.dueDate === ctx.today ? ctx.today : addDays(sc.dueDate, -1);
  const days: ISODate[] = [];
  for (let d = ctx.today; d <= lastDay; d = addDays(d, 1)) {
    if (studySuppressedOn(d, ctx.exceptions)) continue;
    if (ctx.assessments.some((a) => a.date === d && EXAM_KINDS.includes(a.kind))) continue;
    days.push(d);
  }
  const plannedMin = (d: ISODate) => ctx.sessions.filter((s) => s.date === d && s.status === 'planned').reduce((a, s) => a + s.durationMin, 0);
  const order = days.slice().sort((a, b) => plannedMin(a) - plannedMin(b) || a.localeCompare(b));
  const ws = ctx.workstreams.find((w) => w.id === sc.workstreamId);
  const myPriority = ws?.priority ?? 2;
  const touched = new Set<string>();
  let blocks = 0;
  let pass = 0;
  while (remaining > 0 && order.length && pass < 3) {
    for (const d of order) {
      if (remaining <= 0) break;
      const len = Math.min(chunk, remaining);
      remaining -= len;
      blocks++;
      actions.push({
        type: 'add',
        draft: {
          workstreamId: sc.workstreamId,
          assessmentId: tempId,
          date: d,
          startTime: null,
          durationMin: len,
          title: `${sc.title}: work block`,
          kind: 'deep',
          tier: 'core',
          movedFromId: null,
        },
        reason: `Work toward ${sc.title} (due ${formatDate(sc.dueDate)}).`,
      });
      // make room: cut one lower-value block that day (optional first, then lower priority above floor)
      const candidates = ctx.sessions
        .filter((s) => s.date === d && s.status === 'planned' && !touched.has(s.id))
        .map((s) => scoreSession(s, ctx))
        .filter((x) => {
          if (x.session.tier === 'optional') return true;
          const w = ctx.workstreams.find((y) => y.id === x.session.workstreamId);
          return !!w && w.priority > myPriority && x.session.kind !== 'prelab';
        })
        .sort((a, b) => a.score - b.score);
      const victim = candidates[0];
      if (victim) {
        touched.add(victim.session.id);
        const v = victim.session;
        if (v.tier === 'optional') {
          actions.push({ type: 'set_status', sessionId: v.id, status: 'dropped', reason: `Dropped to make room for ${sc.title} (optional work goes first).` });
        } else {
          const floor = Math.min(30, v.durationMin);
          actions.push({
            type: 'shorten',
            sessionId: v.id,
            toMinutes: floor,
            reason: `Cut to ${floor} min to make room for ${sc.title}; it returns to normal length next week.`,
          });
        }
      } else {
        warnings.push(`${formatDate(d)}: the new block uses that day's unallocated buffer.`);
      }
    }
    pass++;
  }
  if (remaining > 0) warnings.push(`About ${remaining} more minutes are needed than the remaining days allow. Consider asking for an extension or reducing scope.`);
  if (!days.length) warnings.push('There is no free day before the deadline. Only the deadline is recorded.');
  return {
    scenario: 'new_deadline',
    title: sc.unexpected ? 'Unexpected assignment' : 'New deadline',
    actions,
    warnings,
    reduceNextWeek: false,
    summary: [
      `${sc.title} is due ${formatDate(sc.dueDate)}.`,
      blocks ? `${blocks} work block${blocks > 1 ? 's' : ''} added before it, one per day where possible.` : 'No work blocks could be added.',
      'Lower-priority blocks are shortened or optional ones dropped to make room. Sleep and fixed classes are untouched.',
    ],
  };
}

function cancelledClass(ctx: ReplanContext, sc: Extract<Scenario, { type: 'cancelled_class' }>): Proposal {
  const c = ctx.commitments.find((x) => x.id === sc.commitmentId);
  const actions: Action[] = [];
  const warnings: string[] = [];
  if (!c) return { scenario: 'cancelled_class', title: 'Cancelled class', actions, warnings: ['Class not found.'], reduceNextWeek: false, summary: [] };
  if (!c.weekdays.includes(weekday(sc.date))) warnings.push(`${c.title} does not normally meet on ${formatDate(sc.date)}.`);
  actions.push({ type: 'cancel_occurrence', commitmentId: c.id, date: sc.date, reason: sc.reason || 'Cancelled by instructor' });
  const deps = ctx.templates.filter((t) => t.dependsOnCommitmentId === c.id);
  for (const s of ctx.sessions) {
    if (s.status !== 'planned' || !s.templateId) continue;
    const t = deps.find((x) => x.id === s.templateId);
    if (!t || t.dependsOnWeekday === null) continue;
    const dep = addDays(s.date, (t.dependsOnWeekday - weekday(s.date) + 7) % 7);
    if (dep === sc.date) {
      actions.push({ type: 'set_status', sessionId: s.id, status: 'cancelled', reason: `Not scheduled: it depends on ${c.title}, which is cancelled. Not counted as missed.` });
    }
  }
  const todays = ctx.sessions.filter((s) => s.date === sc.date && s.status === 'planned');
  const top = rank(todays, ctx)[0];
  return {
    scenario: 'cancelled_class',
    title: 'Cancelled class',
    actions,
    warnings,
    reduceNextWeek: false,
    summary: [
      `${c.title} on ${formatDate(sc.date)} is marked cancelled.`,
      `${formatTime(c.startTime)}–${formatTime(c.endTime)} is now free buffer${top ? `; the most urgent use is ${top.session.title}` : ''}.`,
    ],
  };
}

function examChange(ctx: ReplanContext, sc: Extract<Scenario, { type: 'exam_change' }>): Proposal {
  const a = ctx.assessments.find((x) => x.id === sc.assessmentId);
  const actions: Action[] = [];
  const warnings: string[] = [];
  if (!a) return { scenario: 'exam_change', title: 'Exam date change', actions, warnings: ['Exam not found.'], reduceNextWeek: false, summary: [] };
  actions.push({
    type: 'update_assessment',
    assessmentId: a.id,
    date: sc.newDate,
    startTime: sc.newStart,
    endTime: sc.newEnd,
    reason: 'Confirmed change entered by you.',
  });
  if (sc.newStart && sc.newEnd) {
    const toM = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    for (const o of occurrencesOn(sc.newDate, ctx.commitments, ctx.changes, ctx.exceptions)) {
      if (toM(o.startTime) < toM(sc.newEnd) && toM(sc.newStart) < toM(o.endTime)) {
        warnings.push(`Conflict: ${o.commitment.title} (${o.startTime}–${o.endTime}) overlaps the new time. Check with your department; the class is not moved automatically.`);
      }
    }
    for (const b of ctx.assessments) {
      if (b.id !== a.id && b.date === sc.newDate && b.startTime && b.endTime && toM(b.startTime) < toM(sc.newEnd) && toM(sc.newStart) < toM(b.endTime)) {
        warnings.push(`Conflict: overlaps ${b.title}.`);
      }
    }
  }
  if (ctx.exceptions.some((e) => e.cancelsClasses && sc.newDate >= e.startDate && sc.newDate <= e.endDate)) {
    warnings.push('The new date is marked as a holiday in this semester.');
  }
  const label = `Before ${a.title}`;
  for (const r of ctx.retests) {
    if (!r.doneDate && r.label === label) {
      actions.push({ type: 'update_retest', retestId: r.id, dueDate: addDays(sc.newDate, -1), reason: 'Pre-exam retest follows the new exam date.' });
    }
  }
  for (const s of ctx.sessions) {
    if (s.assessmentId === a.id && s.status === 'planned' && s.date >= sc.newDate) {
      actions.push({ type: 'set_status', sessionId: s.id, status: 'dropped', reason: 'Preparation block now falls after the exam.' });
    }
  }
  return {
    scenario: 'exam_change',
    title: 'Exam date change',
    actions,
    warnings,
    reduceNextWeek: false,
    summary: [`${a.title} moves from ${formatDate(a.date)} to ${formatDate(sc.newDate)}.`, 'Pre-exam retests follow the new date.'],
  };
}

export function propose(scenario: Scenario, ctx: ReplanContext): Proposal {
  switch (scenario.type) {
    case 'missed':
      return missed(ctx, scenario.sessionIds);
    case 'low_energy':
      return disruptedDay(ctx, 'low_energy');
    case 'concentration':
      return disruptedDay(ctx, 'concentration');
    case 'lost_time':
      return disruptedDay(ctx, 'lost_time', scenario.minutes);
    case 'new_deadline':
      return newDeadline(ctx, scenario);
    case 'cancelled_class':
      return cancelledClass(ctx, scenario);
    case 'exam_change':
      return examChange(ctx, scenario);
  }
}

/**
 * Scope reduction for the next week (after a review decision or the backlog cap):
 * optional blocks are dropped, and lower-priority workstreams are trimmed down to
 * their minimum weekly minutes. Returns status actions for next week's sessions.
 */
export function reduceScope(nextWeek: Session[], workstreams: Workstream[]): Action[] {
  const actions: Action[] = [];
  for (const s of nextWeek) {
    if (s.status === 'planned' && s.tier === 'optional') {
      actions.push({ type: 'set_status', sessionId: s.id, status: 'dropped', reason: 'Scope reduced: optional blocks removed.' });
    }
  }
  for (const w of workstreams) {
    const mine = nextWeek.filter((s) => s.workstreamId === w.id && s.status === 'planned' && s.tier === 'core').sort((a, b) => a.date.localeCompare(b.date));
    let total = mine.reduce((a, s) => a + s.durationMin, 0);
    if (total <= w.minWeeklyMinutes) continue;
    // keep the earliest blocks up to the floor, trim the rest
    let kept = 0;
    for (const s of mine) {
      if (kept >= w.minWeeklyMinutes) {
        if (s.kind === 'prelab' || s.kind === 'lablog') {
          kept += s.durationMin; // labs are never reduced
          continue;
        }
        actions.push({ type: 'set_status', sessionId: s.id, status: 'dropped', reason: `Scope reduced: ${w.code ?? w.name} kept at its ${w.minWeeklyMinutes}-minute minimum.` });
        total -= s.durationMin;
      } else if (kept + s.durationMin > w.minWeeklyMinutes && s.kind !== 'prelab' && s.kind !== 'lablog' && w.minWeeklyMinutes - kept >= 15) {
        const to = w.minWeeklyMinutes - kept;
        actions.push({ type: 'shorten', sessionId: s.id, toMinutes: to, reason: `Scope reduced: shortened to keep ${w.code ?? w.name} at its minimum.` });
        kept += to;
      } else {
        kept += s.durationMin;
      }
    }
  }
  return actions;
}
