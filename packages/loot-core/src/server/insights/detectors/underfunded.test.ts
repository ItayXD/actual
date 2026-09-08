import { describe, expect, it } from 'vitest';

import { makeContext, makeMonth } from '#server/insights/fixtures';
import type { InsightCategory } from '#server/insights/types';
import type { CategoryTargetProjection } from '#types/models/targets';

import { detectUnderfundedCategory } from './underfunded';

const CATEGORIES: InsightCategory[] = [
  {
    id: 'c1',
    name: 'Insurance',
    isIncome: false,
    hidden: false,
    groupId: 'g1',
  },
];

function target(
  overrides: Partial<CategoryTargetProjection> = {},
): CategoryTargetProjection {
  return {
    categoryId: 'c1',
    budgeted: 10_000,
    goal: 120_000,
    longGoal: false,
    perTemplate: [10_000],
    templateTypes: ['schedule'],
    targetMonth: '2027-03',
    monthsRemaining: 6,
    totalTargetAmount: 120_000,
    savedTowardTarget: 30_000,
    limit: null,
    isElastic: false,
    error: null,
    ...overrides,
  };
}

function ctx(
  targets: CategoryTargetProjection[] | null,
  budgetedThisMonth = 4_000,
) {
  return makeContext({
    categories: CATEGORIES,
    targets,
    currentMonth: makeMonth('2026-09', {
      byCategory: {
        c1: {
          budgeted: budgetedThisMonth,
          sumAmount: 0,
          leftover: budgetedThisMonth,
          carryover: false,
        },
      },
    }),
    months: ['2026-06', '2026-07', '2026-08'].map(m =>
      makeMonth(m, {
        byCategory: {
          c1: {
            budgeted: 4_000,
            sumAmount: 0,
            leftover: 4_000,
            carryover: false,
          },
        },
      }),
    ),
  });
}

describe('detectUnderfundedCategory', () => {
  it('reports how much more per month a dated target needs', () => {
    const result = detectUnderfundedCategory(ctx([target()]));
    const insights = Array.isArray(result) ? result : result.insights;

    expect(insights).toHaveLength(1);
    expect(insights[0].data).toMatchObject({
      categoryName: 'Insurance',
      stillNeeded: 90_000,
      requiredPerMonth: 10_000,
      budgetedThisMonth: 4_000,
      shortfallPerMonth: 6_000,
      targetMonth: '2027-03',
    });
  });

  it('trusts the automation engine slice rather than recomputing it', () => {
    // The engine already divides the remainder across remaining months; using
    // its number keeps the insight consistent with the budget table.
    const result = detectUnderfundedCategory(
      ctx([target({ budgeted: 17_500 })]),
    );
    const insights = Array.isArray(result) ? result : result.insights;
    expect(insights[0].data.requiredPerMonth).toBe(17_500);
  });

  it('divides for a long goal, which has no engine slice to trust', () => {
    const result = detectUnderfundedCategory(
      ctx([target({ longGoal: true, monthsRemaining: 5 })]),
    );
    const insights = Array.isArray(result) ? result : result.insights;
    // 90,000 still needed across 5 remaining months plus this one.
    expect(insights[0].data.requiredPerMonth).toBe(15_000);
  });

  it('says nothing when the category is already funded enough', () => {
    const result = detectUnderfundedCategory(ctx([target()], 12_000));
    expect(Array.isArray(result) ? result : result.insights).toEqual([]);
  });

  it('says nothing when the target is already met', () => {
    const result = detectUnderfundedCategory(
      ctx([target({ savedTowardTarget: 120_000 })]),
    );
    expect(Array.isArray(result) ? result : result.insights).toEqual([]);
  });

  it('skips an elastic template, which has no fixed number to miss', () => {
    const result = detectUnderfundedCategory(
      ctx([target({ isElastic: true })]),
    );
    expect(Array.isArray(result) ? result : result.insights).toEqual([]);
  });

  it('skips a template that failed to parse', () => {
    const result = detectUnderfundedCategory(
      ctx([target({ error: 'could not parse' })]),
    );
    expect(Array.isArray(result) ? result : result.insights).toEqual([]);
  });

  it('warns as the deadline closes in', () => {
    const distant = detectUnderfundedCategory(
      ctx([target({ monthsRemaining: 8 })]),
    );
    const imminent = detectUnderfundedCategory(
      ctx([target({ monthsRemaining: 2 })]),
    );

    const distantInsights = Array.isArray(distant) ? distant : distant.insights;
    const imminentInsights = Array.isArray(imminent)
      ? imminent
      : imminent.insights;

    expect(distantInsights[0].severity).toBe('info');
    expect(imminentInsights[0].severity).toBe('warning');
  });

  it('softens an automation nobody has ever funded', () => {
    const base = makeContext({
      categories: CATEGORIES,
      targets: [target({ monthsRemaining: 2 })],
      currentMonth: makeMonth('2026-09', {
        byCategory: {
          c1: { budgeted: 0, sumAmount: 0, leftover: 0, carryover: false },
        },
      }),
      months: ['2026-06', '2026-07', '2026-08'].map(m =>
        makeMonth(m, {
          byCategory: {
            c1: { budgeted: 0, sumAmount: 0, leftover: 0, carryover: false },
          },
        }),
      ),
    });

    const result = detectUnderfundedCategory(base);
    const insights = Array.isArray(result) ? result : result.insights;

    // Usually an abandoned template rather than a crisis.
    expect(insights[0].data.neverFunded).toBe(true);
    expect(insights[0].severity).toBe('info');
  });

  it('reports itself unavailable when targets were not computed', () => {
    expect(detectUnderfundedCategory(ctx(null))).toEqual({
      insights: [],
      unavailable: 'no-targets',
    });
  });
});
