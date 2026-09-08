import { describe, expect, it } from 'vitest';

import { makeContext, makeMonth } from '#server/insights/fixtures';
import type {
  InsightCategory,
  InsightContext,
  InsightMonth,
  InsightTxn,
} from '#server/insights/types';

import {
  detectCategoryOverspendRisk,
  detectMonthEndProjection,
  detectSpendingPace,
} from './budget';

const CATEGORIES: InsightCategory[] = [
  {
    id: 'c1',
    name: 'Groceries',
    isIncome: false,
    hidden: false,
    groupId: 'g1',
  },
];

function cell(
  budgeted: number,
  sumAmount: number,
  leftover: number,
): InsightMonth['byCategory'][string] {
  return { budgeted, sumAmount, leftover, carryover: false };
}

/** An evenly-spread cumulative curve totalling `total` over `days`. */
function evenCurve(total: number, days = 30): number[] {
  const curve = [0];
  for (let day = 1; day <= days; day++) {
    curve.push(Math.round((total * day) / days));
  }
  return curve;
}

/** A curve where the whole month's spend lands on day 1 — the shape of rent. */
function frontLoadedCurve(total: number, days = 30): number[] {
  return [0, ...new Array(days).fill(total)];
}

function historyMonths(): InsightMonth[] {
  return ['2026-06', '2026-07', '2026-08'].map(m =>
    makeMonth(m, { byCategory: { c1: cell(40_000, -38_000, 2_000) } }),
  );
}

function ctx(overrides: Partial<InsightContext> = {}): InsightContext {
  return makeContext({
    categories: CATEGORIES,
    months: historyMonths(),
    ...overrides,
  });
}

describe('detectCategoryOverspendRisk', () => {
  it('says nothing when the category is on track', () => {
    const insights = detectCategoryOverspendRisk(
      ctx({
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(40_000, -10_000, 30_000) },
        }),
      }),
    );
    expect(insights).toEqual([]);
  });

  it('reports remaining bills that alone exceed the balance, as a fact', () => {
    const insights = detectCategoryOverspendRisk(
      ctx({
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(40_000, 0, 10_000) },
        }),
        occurrences: [
          {
            scheduleId: 's1',
            date: '2026-09-20',
            amount: -25_000,
            accountId: 'a1',
            categoryId: 'c1',
          },
        ],
      }),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.basis).toBe('scheduled');
    expect(insights[0].data.projectedOverspend).toBe(15_000);
  });

  it('reports a run-rate overshoot once the month is far enough along', () => {
    const txns: InsightTxn[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      date: `2026-09-0${i + 1}`,
      amount: -12_000,
      payeeId: 'p1',
      categoryId: 'c1',
      accountId: 'a1',
      scheduleId: null,
      importedId: null,
      cleared: true,
      isParent: false,
    }));

    const insights = detectCategoryOverspendRisk(
      ctx({
        txns,
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(70_000, -60_000, 10_000) },
        }),
      }),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.basis).toBe('pace');
  });

  it('refuses to extrapolate in the first days of a month', () => {
    const insights = detectCategoryOverspendRisk(
      ctx({
        dayOfMonth: 2,
        daysElapsed: 2,
        daysRemaining: 28,
        txns: [
          {
            id: 't1',
            date: '2026-09-01',
            amount: -60_000,
            payeeId: 'p1',
            categoryId: 'c1',
            accountId: 'a1',
            scheduleId: null,
            importedId: null,
            cleared: true,
            isParent: false,
          },
        ],
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(70_000, -60_000, 10_000) },
        }),
      }),
    );

    // A run-rate off two days would project a huge overshoot. Staying quiet is
    // the point.
    expect(insights).toEqual([]);
  });

  it('ignores hidden categories', () => {
    const insights = detectCategoryOverspendRisk(
      ctx({
        categories: [{ ...CATEGORIES[0], hidden: true }],
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(0, 0, -50_000) },
        }),
        occurrences: [
          {
            scheduleId: 's1',
            date: '2026-09-20',
            amount: -25_000,
            accountId: 'a1',
            categoryId: 'c1',
          },
        ],
      }),
    );
    expect(insights).toEqual([]);
  });
});

describe('detectSpendingPace', () => {
  const curves = {
    'c1:2026-06': evenCurve(38_000),
    'c1:2026-07': evenCurve(38_000),
    'c1:2026-08': evenCurve(38_000),
  };

  it('reports a category running well above its usual shape', () => {
    const insights = detectSpendingPace(
      ctx({
        cumulativeByCategoryMonth: curves,
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(40_000, -34_000, 6_000) },
        }),
      }),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.direction).toBe('above');
    // Expected about half of 38,000 by mid-month.
    expect(insights[0].data.expectedToDate).toBeGreaterThan(17_000);
    expect(insights[0].data.pacePct).toBeGreaterThan(70);
  });

  it('does not fire on a rent-shaped category paid on the 1st', () => {
    // This is the case a linear model gets catastrophically wrong: fully spent
    // by mid-month is exactly on pace here, not 100% over.
    const insights = detectSpendingPace(
      ctx({
        cumulativeByCategoryMonth: {
          'c1:2026-06': frontLoadedCurve(120_000),
          'c1:2026-07': frontLoadedCurve(120_000),
          'c1:2026-08': frontLoadedCurve(120_000),
        },
        months: ['2026-06', '2026-07', '2026-08'].map(m =>
          makeMonth(m, { byCategory: { c1: cell(120_000, -120_000, 0) } }),
        ),
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(120_000, -120_000, 0) },
        }),
      }),
    );

    expect(insights).toEqual([]);
  });

  it('stays quiet without enough history', () => {
    const insights = detectSpendingPace(
      ctx({
        months: historyMonths().slice(0, 2),
        cumulativeByCategoryMonth: {
          'c1:2026-07': evenCurve(38_000),
          'c1:2026-08': evenCurve(38_000),
        },
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(40_000, -34_000, 6_000) },
        }),
      }),
    );
    expect(insights).toEqual([]);
  });

  it('stays quiet in the first days of a month', () => {
    const insights = detectSpendingPace(
      ctx({
        dayOfMonth: 3,
        daysElapsed: 3,
        daysRemaining: 27,
        cumulativeByCategoryMonth: curves,
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(40_000, -34_000, 6_000) },
        }),
      }),
    );
    expect(insights).toEqual([]);
  });

  it('escalates to critical only when the balance is already negative', () => {
    const overspent = detectSpendingPace(
      ctx({
        cumulativeByCategoryMonth: curves,
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(40_000, -70_000, -30_000) },
        }),
      }),
    );
    const withHeadroom = detectSpendingPace(
      ctx({
        cumulativeByCategoryMonth: curves,
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(120_000, -70_000, 50_000) },
        }),
      }),
    );

    expect(overspent[0].severity).toBe('critical');
    expect(withHeadroom[0].severity).toBe('warning');
  });

  it('reports running under pace, quietly', () => {
    const insights = detectSpendingPace(
      ctx({
        cumulativeByCategoryMonth: curves,
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(40_000, -5_000, 35_000) },
        }),
      }),
    );

    expect(insights[0].data.direction).toBe('below');
    expect(insights[0].severity).toBe('info');
  });
});

describe('detectMonthEndProjection', () => {
  it('projects a surplus across categories', () => {
    const insights = detectMonthEndProjection(
      ctx({
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(60_000, -10_000, 50_000) },
        }),
      }),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.net).toBe(50_000);
    expect(insights[0].data.topCategoryIds).toEqual(['c1']);
    expect(insights[0].severity).toBe('info');
  });

  it('warns when the projection is a deficit', () => {
    const insights = detectMonthEndProjection(
      ctx({
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(10_000, -40_000, -30_000) },
        }),
      }),
    );

    expect(insights[0].data.net).toBe(-30_000);
    expect(insights[0].severity).toBe('warning');
  });

  it('stays quiet early in the month', () => {
    const insights = detectMonthEndProjection(
      ctx({
        dayOfMonth: 5,
        daysElapsed: 5,
        daysRemaining: 25,
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(60_000, -10_000, 50_000) },
        }),
      }),
    );
    expect(insights).toEqual([]);
  });

  it('stays quiet when the net is immaterial for the whole budget', () => {
    // 1,000 against a 500,000 month is under the 1% whole-budget bar, even
    // though it clears the per-category floor.
    const insights = detectMonthEndProjection(
      ctx({
        currentMonth: makeMonth('2026-09', {
          byCategory: { c1: cell(10_000, -9_000, 1_000) },
        }),
      }),
    );
    expect(insights).toEqual([]);
  });
});
