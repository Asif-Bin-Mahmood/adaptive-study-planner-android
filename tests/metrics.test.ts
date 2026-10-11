import { describe, expect, it } from 'vitest';
import { accuracy, completionStats, recommend, weeklyReport } from '../src/domain/metrics';
import { defaultRules } from '../src/domain/rules';
import type { Session } from '../src/domain/types';

function sess(id: string, date: string, status: Session['status'], extra: Partial<Session> = {}): Session {
  return {
    id, termId: 't', workstreamId: 'w', templateId: null, assessmentId: null, date, startTime: '08:00', durationMin: 60,
    title: id, output: null, kind: 'deep', tier: 'core', status, actualMinutes: null, outputNote: null, origin: 'template',
    movedFromId: null, reason: null, createdAt: '', updatedAt: '', ...extra,
  };
}

describe('1. timed-set accuracy', () => {
  it('computes correct / attempted × 100', () => {
    expect(accuracy(10, 7)).toBe(70);
    expect(accuracy(3, 2)).toBe(66.7);
  });
  it('handles zero or missing attempts without dividing by zero', () => {
    expect(accuracy(0, 0)).toBeNull();
    expect(accuracy(null, 3)).toBeNull();
    expect(accuracy(5, null)).toBeNull();
    expect(accuracy(Number.NaN, 1)).toBeNull();
  });
  it('clamps impossible correct counts', () => {
    expect(accuracy(4, 9)).toBe(100);
  });
});

describe('2-3. weekly completion with partial and missed sessions', () => {
  const today = '2030-10-27';
  it('counts done fully, partial at the configured weight, missed as zero', () => {
    const s = [sess('a', '2030-10-20', 'done'), sess('b', '2030-10-21', 'partial'), sess('c', '2030-10-22', 'missed'), sess('d', '2030-10-23', 'done')];
    const c = completionStats(s, today, 0.5);
    expect(c.scheduled).toBe(4);
    expect(c.completion).toBeCloseTo((2 + 0.5) / 4);
  });
  it('treats past planned blocks as missed (not logged) but excludes future ones', () => {
    const c = completionStats([sess('a', '2030-10-20', 'planned'), sess('b', '2030-10-28', 'planned'), sess('c', '2030-10-21', 'done')], today, 0.5);
    expect(c.notLogged).toBe(1);
    expect(c.missed).toBe(1);
    expect(c.upcoming).toBe(1);
    expect(c.completion).toBe(0.5);
  });
  it('never counts cancelled or dropped blocks as missed', () => {
    const c = completionStats([sess('a', '2030-10-22', 'cancelled'), sess('b', '2030-10-23', 'dropped'), sess('c', '2030-10-24', 'done')], today, 0.5);
    expect(c.scheduled).toBe(1);
    expect(c.missed).toBe(0);
    expect(c.completion).toBe(1);
  });
  it('a completed make-up replaces the missed original; moved blocks count once', () => {
    const c = completionStats(
      [
        sess('orig', '2030-10-21', 'missed'),
        sess('mk', '2030-10-23', 'done', { movedFromId: 'orig', origin: 'replan' }),
        sess('mv', '2030-10-22', 'moved'),
        sess('mv2', '2030-10-24', 'partial', { movedFromId: 'mv', origin: 'replan' }),
      ],
      today,
      0.5,
    );
    expect(c.scheduled).toBe(2);
    expect(c.completion).toBeCloseTo(0.75);
  });
  it('returns null completion when nothing is scheduled', () => {
    expect(completionStats([], today, 0.5).completion).toBeNull();
  });
});

describe('weekly review recommendation', () => {
  const rules = defaultRules();
  const base = (statuses: Session['status'][], sleep: number) =>
    weeklyReport({
      weekStart: '2030-10-20',
      today: '2030-10-27',
      rules,
      sessions: statuses.map((st, i) => sess(`s${i}`, '2030-10-21', st)),
      checkins: [{ date: '2030-10-21', sleepHours: sleep, concentration: 3, lowEnergy: false, note: null, updatedAt: '' }],
      timedSets: [],
      weekErrors: [],
      retests: [],
      workstreams: [],
    });
  it('allows one optional block only when completion ≥ 85% and sleep ≥ 7 h', () => {
    const r = base(['done', 'done', 'done', 'done', 'done', 'done', 'done'], 7.2);
    expect(recommend(r, null, rules, [], 4, 0).decision).toBe('add_optional');
    expect(recommend(base(['done', 'done', 'done', 'done', 'done', 'done', 'done'], 6.5), null, rules, [], 4, 0).decision).not.toBe('add_optional');
  });
  it('removes optional blocks below 70% completion', () => {
    const r = base(['done', 'missed', 'missed'], 7.5);
    expect(recommend(r, null, rules, [], 2, 2).decision).toBe('remove_optional');
    expect(recommend(r, null, rules, [], 4, 0).decision).toBe('keep');
    expect(recommend(base(['done', 'missed', 'missed', 'missed', 'missed'], 7.5), null, rules, [], 4, 0).decision).toBe('reduce_scope');
  });
  it('flags a weak course by accuracy or a recurring error type', () => {
    const r = weeklyReport({
      weekStart: '2030-10-20', today: '2030-10-27', rules, sessions: [], checkins: [], weekErrors: [], retests: [], workstreams: [],
      timedSets: [{ id: 'x', termId: 't', workstreamId: 'math', sessionId: null, date: '2030-10-21', topic: null, attempted: 10, correct: 5, minutes: 30, targetMinutes: null, notes: null, createdAt: '' }],
    });
    const errs = ['a', 'b', 'c'].map((id) => ({ id, termId: 't', workstreamId: 'other', timedSetId: null, date: '2030-10-21', question: 'q', category: 'Execution error', cause: null, correctionRule: null, similarRef: null, status: 'open' as const, createdAt: '', updatedAt: '' }));
    expect(recommend(r, null, rules, errs, 0, 0).weakCourseIds.sort()).toEqual(['math', 'other']);
  });
});
