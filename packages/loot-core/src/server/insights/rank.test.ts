import { describe, expect, it } from 'vitest';

import type { Insight, InsightKind } from '#types/models/insights';

import { makeInsight, TEST_TODAY } from './fixtures';
import {
  applySupersession,
  capPerKind,
  compareInsights,
  KIND_ORDER,
  rankInsights,
  selectWithDiversity,
  sortInsights,
} from './rank';

const NO_CAPS = {} as Record<InsightKind, number>;

function ids(insights: Insight[]): string[] {
  return insights.map(i => i.id);
}

describe('KIND_ORDER', () => {
  it('covers every kind exactly once, so the tie-break is total', () => {
    expect(new Set(KIND_ORDER).size).toBe(KIND_ORDER.length);
    expect(KIND_ORDER).toHaveLength(16);
  });
});

describe('ordering', () => {
  it('puts critical above warning above info regardless of score', () => {
    const sorted = sortInsights(
      [
        makeInsight({
          kind: 'data-quality',
          id: 'info',
          severity: 'info',
          score: 0.99,
        }),
        makeInsight({
          kind: 'low-balance',
          id: 'crit',
          severity: 'critical',
          score: 0.01,
        }),
        makeInsight({
          kind: 'bill-increase',
          id: 'warn',
          severity: 'warning',
          score: 0.5,
        }),
      ],
      TEST_TODAY,
    );

    expect(ids(sorted)).toEqual(['crit', 'warn', 'info']);
  });

  it('ranks by score within a severity band', () => {
    const sorted = sortInsights(
      [
        makeInsight({ kind: 'bill-increase', id: 'low', score: 0.2 }),
        makeInsight({ kind: 'bill-increase', id: 'high', score: 0.8 }),
      ],
      TEST_TODAY,
    );

    expect(ids(sorted)).toEqual(['high', 'low']);
  });

  it('breaks a score tie by urgency, soonest first', () => {
    const sorted = sortInsights(
      [
        makeInsight({ kind: 'low-balance', id: 'later', date: '2026-10-01' }),
        makeInsight({ kind: 'low-balance', id: 'sooner', date: '2026-09-18' }),
      ],
      TEST_TODAY,
    );

    expect(ids(sorted)).toEqual(['sooner', 'later']);
  });

  it('sorts a dateless insight after a dated one', () => {
    const sorted = sortInsights(
      [
        makeInsight({ kind: 'income-volatility', id: 'undated', date: null }),
        makeInsight({ kind: 'low-balance', id: 'dated', date: '2026-12-01' }),
      ],
      TEST_TODAY,
    );

    expect(ids(sorted)).toEqual(['dated', 'undated']);
  });

  it('breaks a remaining tie by amount, largest first', () => {
    const sorted = sortInsights(
      [
        makeInsight({ kind: 'bill-increase', id: 'small', amount: 100 }),
        makeInsight({ kind: 'bill-increase', id: 'big', amount: -9000 }),
      ],
      TEST_TODAY,
    );

    expect(ids(sorted)).toEqual(['big', 'small']);
  });

  it('is a total order, so equal insights never swap between renders', () => {
    const a = makeInsight({
      kind: 'bill-increase',
      id: 'a',
      fingerprint: 'aaa',
    });
    const b = makeInsight({
      kind: 'bill-increase',
      id: 'b',
      fingerprint: 'bbb',
    });

    expect(compareInsights(a, b, TEST_TODAY)).toBeLessThan(0);
    expect(compareInsights(b, a, TEST_TODAY)).toBeGreaterThan(0);
    expect(compareInsights(a, a, TEST_TODAY)).toBe(0);
    // Same input in either order yields the same output.
    expect(ids(sortInsights([a, b], TEST_TODAY))).toEqual(['a', 'b']);
    expect(ids(sortInsights([b, a], TEST_TODAY))).toEqual(['a', 'b']);
  });
});

describe('applySupersession', () => {
  it('lets a projected overdraft suppress a derived low-balance warning', () => {
    const negative = makeInsight({
      kind: 'negative-balance',
      id: 'neg',
      date: '2026-09-20',
      data: { accountId: 'a1' },
    });
    const low = makeInsight({
      kind: 'low-balance',
      id: 'low',
      date: '2026-09-24',
      data: { accountId: 'a1', thresholdSource: 'derived' },
    });

    const { kept, suppressed } = applySupersession([negative, low]);
    expect(ids(kept)).toEqual(['neg']);
    expect(ids(suppressed)).toEqual(['low']);
  });

  it('suppresses a derived warning even when its crossing comes first', () => {
    // The overdraft date is the actionable one; "also low a few days earlier"
    // adds nothing the user can act on separately.
    const negative = makeInsight({
      kind: 'negative-balance',
      id: 'neg',
      date: '2026-09-24',
      data: { accountId: 'a1' },
    });
    const low = makeInsight({
      kind: 'low-balance',
      id: 'low',
      date: '2026-09-18',
      data: { accountId: 'a1', thresholdSource: 'derived' },
    });

    expect(ids(applySupersession([negative, low]).kept)).toEqual(['neg']);
  });

  it('leaves a low-balance warning on a different account alone', () => {
    const negative = makeInsight({
      kind: 'negative-balance',
      id: 'neg',
      date: '2026-09-20',
      data: { accountId: 'a1' },
    });
    const low = makeInsight({
      kind: 'low-balance',
      id: 'low',
      date: '2026-09-24',
      data: { accountId: 'a2', thresholdSource: 'derived' },
    });

    expect(ids(applySupersession([negative, low]).kept).sort()).toEqual([
      'low',
      'neg',
    ]);
  });

  it('keeps a low-balance warning the user explicitly asked for', () => {
    // Suppressing a threshold the user set themselves would override an
    // explicit instruction; a threshold we derived carries no such promise.
    const negative = makeInsight({
      kind: 'negative-balance',
      id: 'neg',
      date: '2026-09-24',
      data: { accountId: 'a1' },
    });
    const low = makeInsight({
      kind: 'low-balance',
      id: 'low',
      date: '2026-09-18',
      data: { accountId: 'a1', thresholdSource: 'user' },
    });

    expect(applySupersession([negative, low]).kept).toHaveLength(2);
  });

  it('lets overspend risk suppress spending pace for the same category and month', () => {
    const overspend = makeInsight({
      kind: 'category-overspend-risk',
      id: 'over',
      data: { categoryId: 'c1', month: '2026-09' },
    });
    const pace = makeInsight({
      kind: 'spending-pace',
      id: 'pace',
      data: { categoryId: 'c1', month: '2026-09' },
    });

    expect(ids(applySupersession([overspend, pace]).kept)).toEqual(['over']);
  });

  it('lets a subscription change suppress a bill increase for the same payee', () => {
    const sub = makeInsight({
      kind: 'subscription-change',
      id: 'sub',
      data: { payeeId: 'p1' },
    });
    const bill = makeInsight({
      kind: 'bill-increase',
      id: 'bill',
      data: { payeeId: 'p1' },
    });

    expect(ids(applySupersession([sub, bill]).kept)).toEqual(['sub']);
  });

  it('lets a stale schedule suppress a missing recurring item for that schedule', () => {
    const stale = makeInsight({
      kind: 'stale-schedule',
      id: 'stale',
      data: { scheduleId: 's1' },
    });
    const missing = makeInsight({
      kind: 'missing-recurring',
      id: 'missing',
      data: { scheduleId: 's1', source: 'schedule', payeeId: 'p1' },
    });

    expect(ids(applySupersession([stale, missing]).kept)).toEqual(['stale']);
  });

  it('prefers a schedule-sourced missing item over the inferred one for the same payee', () => {
    const fromSchedule = makeInsight({
      kind: 'missing-recurring',
      id: 'sched',
      data: { source: 'schedule', payeeId: 'p1', scheduleId: 's1' },
    });
    const fromSeries = makeInsight({
      kind: 'missing-recurring',
      id: 'series',
      data: { source: 'series', payeeId: 'p1', scheduleId: null },
    });

    expect(ids(applySupersession([fromSchedule, fromSeries]).kept)).toEqual([
      'sched',
    ]);
  });

  it('lets a duplicate pair suppress the unusual-transaction row it explains', () => {
    const dup = makeInsight({
      kind: 'possible-duplicate',
      id: 'dup',
      data: { transactionIds: ['t1', 't2'] },
    });
    const unusual = makeInsight({
      kind: 'unusual-transaction',
      id: 'unusual',
      data: { transactionId: 't2' },
    });
    const unrelated = makeInsight({
      kind: 'unusual-transaction',
      id: 'other',
      data: { transactionId: 't9' },
    });

    const { kept } = applySupersession([dup, unusual, unrelated]);
    expect(ids(kept).sort()).toEqual(['dup', 'other']);
  });

  it('never suppresses an insight with itself', () => {
    const only = makeInsight({
      kind: 'missing-recurring',
      id: 'solo',
      data: { source: 'schedule', payeeId: 'p1', scheduleId: 's1' },
    });
    expect(applySupersession([only]).kept).toHaveLength(1);
  });
});

describe('capPerKind', () => {
  it('keeps only the best N of a kind and reports the rest', () => {
    const insights = [0.9, 0.8, 0.7, 0.6].map((score, i) =>
      makeInsight({ kind: 'low-balance', id: `l${i}`, score }),
    );

    const { kept, dropped } = capPerKind(
      insights,
      { 'low-balance': 2 } as Record<InsightKind, number>,
      TEST_TODAY,
    );

    expect(ids(kept)).toEqual(['l0', 'l1']);
    expect(ids(dropped)).toEqual(['l2', 'l3']);
  });

  it('leaves uncapped kinds untouched', () => {
    const insights = [
      makeInsight({ kind: 'bill-increase', id: 'b1' }),
      makeInsight({ kind: 'bill-increase', id: 'b2' }),
    ];
    expect(capPerKind(insights, NO_CAPS, TEST_TODAY).dropped).toEqual([]);
  });
});

describe('selectWithDiversity', () => {
  it('stops one noisy kind from filling the card while others wait', () => {
    // Eight low-balance rows outrank one subscription change, but with 8 slots
    // the per-kind limit is 2, so the subscription change still gets in.
    const sorted = sortInsights(
      [
        ...Array.from({ length: 8 }, (_, i) =>
          makeInsight({ kind: 'low-balance', id: `l${i}`, score: 0.9 }),
        ),
        makeInsight({ kind: 'subscription-change', id: 'sub', score: 0.1 }),
      ],
      TEST_TODAY,
    );

    const { visible } = selectWithDiversity(sorted, 8);
    expect(visible).toHaveLength(8);
    expect(ids(visible)).toContain('sub');
    expect(ids(visible).filter(id => id.startsWith('l'))).toHaveLength(7);
  });

  it('backfills passed-over items so variety never costs a slot', () => {
    const sorted = sortInsights(
      Array.from({ length: 5 }, (_, i) =>
        makeInsight({ kind: 'low-balance', id: `l${i}`, score: 0.9 - i / 100 }),
      ),
      TEST_TODAY,
    );

    // Per-kind limit is 1, but nothing else competes, so all 4 slots fill.
    const { visible, dropped } = selectWithDiversity(sorted, 4);
    expect(visible).toHaveLength(4);
    expect(dropped).toHaveLength(1);
  });

  it('returns everything as dropped when there are no slots', () => {
    const { visible, dropped } = selectWithDiversity(
      [makeInsight({ kind: 'low-balance' })],
      0,
    );
    expect(visible).toEqual([]);
    expect(dropped).toHaveLength(1);
  });
});

describe('rankInsights', () => {
  it('supersedes, caps, fills and returns in rank order', () => {
    const result = rankInsights({
      insights: [
        makeInsight({
          kind: 'negative-balance',
          id: 'neg',
          severity: 'critical',
          score: 0.9,
          date: '2026-09-20',
          data: { accountId: 'a1' },
        }),
        makeInsight({
          kind: 'low-balance',
          id: 'low',
          score: 0.8,
          date: '2026-09-24',
          data: { accountId: 'a1', thresholdSource: 'derived' },
        }),
        makeInsight({
          kind: 'data-quality',
          id: 'dq',
          severity: 'info',
          score: 0.3,
        }),
      ],
      caps: { 'data-quality': 2 } as Record<InsightKind, number>,
      maxInsights: 5,
      today: TEST_TODAY,
    });

    expect(ids(result.visible)).toEqual(['neg', 'dq']);
    // The superseded low-balance row is counted, not silently vanished.
    expect(result.suppressedByKind).toEqual({ 'low-balance': 1 });
  });

  it('counts everything it does not show', () => {
    const result = rankInsights({
      insights: Array.from({ length: 6 }, (_, i) =>
        makeInsight({
          kind: 'bill-increase',
          id: `b${i}`,
          score: 0.9 - i / 100,
        }),
      ),
      caps: { 'bill-increase': 3 } as Record<InsightKind, number>,
      maxInsights: 2,
      today: TEST_TODAY,
    });

    expect(result.visible).toHaveLength(2);
    expect(result.suppressedByKind['bill-increase']).toBe(4);
  });

  it('is empty in, empty out', () => {
    const result = rankInsights({
      insights: [],
      caps: NO_CAPS,
      maxInsights: 12,
      today: TEST_TODAY,
    });
    expect(result.visible).toEqual([]);
    expect(result.suppressedByKind).toEqual({});
  });
});
