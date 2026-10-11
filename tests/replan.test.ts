import { describe, expect, it } from 'vitest';
import { propose, reduceScope, type ReplanContext } from '../src/domain/replan';
import { defaultRules } from '../src/domain/rules';
import type { Session, Workstream } from '../src/domain/types';
import { T, seededRepo } from './helpers';

async function ctxFor(today: string): Promise<{ ctx: ReplanContext; repo: Awaited<ReturnType<typeof seededRepo>>['repo'] }> {
  const { repo } = await seededRepo();
  await repo.ensureSessions(T, '2030-10-20', '2030-11-16');
  const term = (await repo.getTerm(T))!;
  const ctx: ReplanContext = {
    termId: T,
    today,
    rules: term.rules,
    sessions: await repo.listSessions(T, '2030-10-20', '2030-11-16'),
    workstreams: await repo.listWorkstreams(T),
    assessments: await repo.listAssessments(T),
    commitments: await repo.listCommitments(T),
    changes: await repo.listChanges(T),
    exceptions: await repo.listExceptions(T),
    templates: await repo.listTemplates(T),
    retests: await repo.listRetests(T),
  };
  return { ctx, repo };
}

describe('12. disrupted-day prioritisation and backlog cap', () => {
  it('low-energy Tuesday keeps at most two items, pre-lab first, and swaps problem-solving for retests', async () => {
    const { ctx } = await ctxFor('2030-10-29'); // Tue: PHY110 timed set, recall, PHY110L pre-lab
    const p = propose({ type: 'low_energy' }, ctx);
    const kept = p.actions.filter((a) => a.type === 'keep' || a.type === 'shorten' || a.type === 'swap');
    expect(kept.length).toBeLessThanOrEqual(2);
    const keptTitles = kept.map((a) => ctx.sessions.find((s) => s.id === (a as { sessionId: string }).sessionId)!.title);
    expect(keptTitles[0]).toBe('PHY110L pre-lab'); // lab tomorrow
    const swap = p.actions.find((a) => a.type === 'swap');
    if (swap && swap.type === 'swap') expect(swap.kind).toBe('retest');
    // nothing dumps every leftover into tomorrow
    const toTomorrow = p.actions.filter((a) => a.type === 'move' && a.toDate === '2030-10-30');
    expect(toTomorrow.length).toBeLessThanOrEqual(ctx.rules.backlog.nextDayMaxMoved);
    expect(p.summary.join(' ')).toMatch(/Classes, labs, exams and sleep are unchanged/);
    // every action explains itself
    for (const a of p.actions) expect('reason' in a && a.reason.length > 10).toBe(true);
  });

  it('applies the backlog cap: after more than three displaced blocks, the rest are dropped and next week is reduced', async () => {
    const { ctx, repo } = await ctxFor('2030-10-28'); // Monday
    // both Sunday blocks already missed this week
    const sunday = ctx.sessions.filter((s) => s.date === '2030-10-27' && s.status === 'planned');
    for (const s of sunday) await repo.setSessionStatus(s.id, 'missed');
    ctx.sessions = await repo.listSessions(T, '2030-10-20', '2030-11-16');
    const p = propose({ type: 'lost_time', minutes: 120, cause: 'lab_overrun' }, ctx);
    expect(p.reduceNextWeek).toBe(true);
    expect(p.actions.some((a) => a.type === 'set_status' && a.status === 'dropped' && a.reason.includes('more than 3'))).toBe(true);
    // Monday's two blocks are displaced: 2 missed + 1 moved reaches the limit of 3, so the other one is dropped, not carried
    expect(p.actions.filter((a) => a.type === 'move')).toHaveLength(1);
    expect(p.actions.filter((a) => a.type === 'set_status' && a.status === 'dropped')).toHaveLength(1);
  });

  it('missed sessions are recorded as missed, never as done, and make-ups are limited to one per day', async () => {
    const { ctx, repo } = await ctxFor('2030-10-29');
    const mon = ctx.sessions.filter((s) => s.date === '2030-10-28' && s.status === 'planned').map((s) => s.id);
    const p = propose({ type: 'missed', sessionIds: mon }, ctx);
    const makeups = p.actions.filter((a) => a.type === 'makeup');
    const perDay = new Map<string, number>();
    for (const m of makeups) if (m.type === 'makeup') perDay.set(m.toDate, (perDay.get(m.toDate) ?? 0) + 1);
    expect([...perDay.values()].every((n) => n <= 1)).toBe(true);
    await repo.applyProposal(T, '2030-10-29', p);
    const after = await repo.listSessions(T, '2030-10-28', '2030-10-28');
    expect(after.filter((s) => mon.includes(s.id)).every((s) => s.status === 'missed')).toBe(true);
    expect((await repo.listChangesLog(T)).length).toBe(1);
  });

  it('an unexpected assignment adds work blocks before the due date and cuts lower-priority work first', async () => {
    const { ctx, repo } = await ctxFor('2030-10-29');
    const p = propose(
      { type: 'new_deadline', title: 'ALG101 assignment 2', workstreamId: `${T}:alg`, kind: 'assignment', dueDate: '2030-11-01', dueTime: '23:59', estimateMin: 150, unexpected: true },
      ctx,
    );
    const adds = p.actions.filter((a) => a.type === 'add');
    expect(adds.length).toBe(3);
    for (const a of adds) if (a.type === 'add') expect(a.draft.date < '2030-11-01').toBe(true);
    await repo.applyProposal(T, '2030-10-29', p);
    const asg = (await repo.listAssessments(T)).find((a) => a.title === 'ALG101 assignment 2');
    expect(asg?.confirmed).toBe(true);
    const linked = (await repo.listSessions(T, '2030-10-29', '2030-11-01')).filter((s) => s.assessmentId === asg?.id);
    expect(linked).toHaveLength(3);
  });

  it('cancelled class: dependent recall becomes not scheduled; exam change re-dates pre-exam retests and warns on conflicts', async () => {
    const { ctx } = await ctxFor('2030-11-03');
    const p = propose({ type: 'cancelled_class', commitmentId: `${T}:cALG`, date: '2030-11-05', reason: 'Instructor away' }, ctx);
    expect(p.actions.some((a) => a.type === 'cancel_occurrence')).toBe(true);
    expect(p.actions.some((a) => a.type === 'set_status' && a.status === 'cancelled')).toBe(true);
    const e = propose({ type: 'exam_change', assessmentId: `${T}:mPHY`, newDate: '2030-11-26', newStart: '10:00', newEnd: '12:00' }, ctx);
    expect(e.warnings.some((w) => w.includes('PHY110 lecture') || w.includes('ALG101 lecture'))).toBe(true);
  });
});

describe('scope reduction keeps every workstream at its floor and never cuts labs', () => {
  it('drops optional and trims to minimum minutes', () => {
    const w: Workstream = { id: 'ml', termId: 't', type: 'ml', code: null, name: 'ML', color: '', priority: 5, deadline: null, minWeeklyMinutes: 30, targetWeeklyMinutes: 75, extensionWeeklyMinutes: 60, floorRule: null, archived: false, notes: null, createdAt: '', updatedAt: '' };
    const s = (id: string, kind: Session['kind'], tier: Session['tier'], dur: number): Session => ({
      id, termId: 't', workstreamId: 'ml', templateId: null, assessmentId: null, date: '2030-11-08', startTime: null, durationMin: dur, title: id, output: null, kind, tier,
      status: 'planned', actualMinutes: null, outputNote: null, origin: 'template', movedFromId: null, reason: null, createdAt: '', updatedAt: '',
    });
    const acts = reduceScope([s('impl', 'deep', 'core', 75), s('concept', 'deep', 'optional', 60)], [w]);
    expect(acts).toContainEqual(expect.objectContaining({ type: 'set_status', sessionId: 'concept', status: 'dropped' }));
    expect(acts).toContainEqual(expect.objectContaining({ type: 'shorten', sessionId: 'impl', toMinutes: 30 }));
    void defaultRules;
  });
});
