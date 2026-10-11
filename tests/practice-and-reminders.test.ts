import { describe, expect, it } from 'vitest';
import { diffReminders, planReminders, reminderId } from '../src/domain/notifications';
import { buildRetests, isMastered } from '../src/domain/retest';
import { defaultRules } from '../src/domain/rules';
import type { Retest, Session } from '../src/domain/types';
import { T, seededRepo } from './helpers';


describe('retests and mastery', () => {
  it('schedules about 2 days, 1 week, and the day before the next exam', () => {
    const r = buildRetests('2030-11-03', defaultRules(), { date: '2030-11-23', title: 'ALG101 midterm' });
    expect(r.map((x) => x.dueDate)).toEqual(['2030-11-05', '2030-11-10', '2030-11-22']);
    // exam sooner than the spacing: offsets after the exam are replaced by one pre-exam retest
    const soon = buildRetests('2030-11-20', defaultRules(), { date: '2030-11-23', title: 'ALG101 midterm' });
    expect(soon.map((x) => x.dueDate)).toEqual(['2030-11-22']);
  });
  it('requires two independent passes on separate days; assisted never counts', () => {
    const rules = defaultRules();
    const rt = (id: string, date: string, outcome: Retest['outcome']): Retest => ({ id, errorId: 'e', dueDate: date, label: '', doneDate: date, outcome });
    expect(isMastered([rt('a', '2030-11-05', 'pass'), rt('b', '2030-11-05', 'pass')], rules)).toBe(false);
    expect(isMastered([rt('a', '2030-11-05', 'pass'), rt('b', '2030-11-10', 'assisted')], rules)).toBe(false);
    expect(isMastered([rt('a', '2030-11-05', 'pass'), rt('b', '2030-11-10', 'pass')], rules)).toBe(true);
  });
  it('end to end: an error is mastered only after two independent retests, and a failed retest schedules a retry', async () => {
    const { repo } = await seededRepo();
    const rules = (await repo.getTerm(T))!.rules;
    const id = await repo.addError({ termId: T, workstreamId: `${T}:alg`, timedSetId: null, date: '2030-11-03', question: 'Q3 page table', category: 'Misunderstanding', cause: null, correctionRule: null, similarRef: null }, rules);
    let r = await repo.retestsForError(id);
    expect(r).toHaveLength(3);
    await repo.recordRetest(r[0].id, 'fail', '2030-11-05', rules);
    await repo.recordRetest(r[1].id, 'pass', '2030-11-10', rules);
    expect((await repo.listErrors(T, 'open')).length).toBe(1);
    r = await repo.retestsForError(id);
    await repo.recordRetest(r.find((x) => !x.doneDate)!.id, 'pass', '2030-11-22', rules);
    expect((await repo.listErrors(T, 'mastered')).map((e) => e.id)).toEqual([id]);
  });
  it('timed sets reject impossible scores', async () => {
    const { repo } = await seededRepo();
    await expect(repo.saveTimedSet({ termId: T, workstreamId: `${T}:phy`, sessionId: null, date: '2030-10-22', topic: null, attempted: 5, correct: 6, minutes: 20, targetMinutes: null, notes: null })).rejects.toThrow();
  });
});

describe('13. notification rescheduling after task changes', () => {
  const rules = { ...defaultRules(), notifications: { enabled: true, minutesBefore: 10 } };
  const now = new Date(2030, 9, 20, 6, 0);
  const s = (id: string, date: string, time: string | null, status: Session['status'] = 'planned'): Session => ({
    id, termId: 't', workstreamId: null, templateId: null, assessmentId: null, date, startTime: time, durationMin: 60, title: `Block ${id}`, output: null,
    kind: 'deep', tier: 'core', status, actualMinutes: null, outputNote: null, origin: 'template', movedFromId: null, reason: null, createdAt: '', updatedAt: '',
  });
  it('plans one reminder per planned block, none in sleep or the past, none when disabled', () => {
    const plan = planReminders([s('a', '2030-10-20', '08:00'), s('b', '2030-10-20', '05:00'), s('c', '2030-10-20', '06:40'), s('d', '2030-10-20', '09:00', 'done'), s('e', '2030-10-20', null)], rules, now);
    expect(plan.map((p) => p.sessionId)).toEqual(['a', 'c']);
    expect(planReminders([s('a', '2030-10-20', '08:00')], defaultRules(), now)).toEqual([]);
    // 06:20 start -> 06:10 reminder; sleep window ends 06:15 -> skipped
    expect(planReminders([s('z', '2030-10-21', '06:20')], rules, now)).toEqual([]);
  });
  it('editing a block cancels the old reminder and schedules one replacement (no duplicates)', () => {
    const first = planReminders([s('a', '2030-10-20', '08:00'), s('b', '2030-10-21', '19:00')], rules, now);
    const existing = new Map(first.map((r) => [r.id, r.fingerprint]));
    const after = planReminders([s('a', '2030-10-20', '09:00'), s('b', '2030-10-21', '19:00', 'dropped')], rules, now);
    const d = diffReminders(existing, after);
    expect(d.cancel.sort()).toEqual([reminderId('a'), reminderId('b')].sort());
    expect(d.schedule.map((x) => x.sessionId)).toEqual(['a']);
    const applied = new Map(after.map((r) => [r.id, r.fingerprint]));
    expect(diffReminders(applied, after)).toEqual({ cancel: [], schedule: [] });
  });
});
