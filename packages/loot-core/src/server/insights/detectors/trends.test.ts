import { describe, expect, it } from 'vitest';

import { makeContext, makeMonth } from '#server/insights/fixtures';
import type {
  InsightCategory,
  InsightContext,
  InsightMonth,
} from '#server/insights/types';

import { detectIncomeVolatility, detectTrendChange } from './trends';

const CATEGORIES: InsightCategory[] = [
  {
    id: 'c1',
    name: 'Transport',
    isIncome: false,
    hidden: false,
    groupId: 'g1',
  },
];

/** Complete months ending 2026-08, with the given per-month spend (positive). */
function monthsWithSpend(spend: number[]): InsightMonth[] {
  return spend.map((amount, i) => {
    const monthIndex = 8 - spend.length + i + 1;
    return makeMonth(`2026-${String(monthIndex).padStart(2, '0')}`, {
      byCategory: {
        c1: {
          budgeted: 20_000,
          sumAmount: -amount,
          leftover: 0,
          carryover: false,
        },
      },
    });
  });
}

function ctx(months: InsightMonth[], overrides: Partial<InsightContext> = {}) {
  return makeContext({ categories: CATEGORIES, months, ...overrides });
}

describe('detectTrendChange', () => {
  it('reports a run of consecutive increases', () => {
    // Six months, the last four each clearly above the one before.
    const insights = detectTrendChange(
      ctx(monthsWithSpend([20_000, 20_000, 30_000, 40_000, 52_000, 68_000])),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data).toMatchObject({
      categoryName: 'Transport',
      direction: 'up',
      pattern: 'run',
      months: 4,
    });
    expect(insights[0].severity).toBe('warning');
  });

  it('ignores month-to-month jitter under the dead band', () => {
    // Each step is about 2%, well inside the 5% dead band.
    const insights = detectTrendChange(
      ctx(monthsWithSpend([20_000, 20_400, 20_800, 21_200, 21_600, 22_000])),
    );
    expect(insights).toEqual([]);
  });

  it('catches a step change that a monotone-run test would miss', () => {
    // Flat, then flat at a new level: no run of increases anywhere, but the
    // level plainly shifted. This is a rent rise or a new car payment.
    const insights = detectTrendChange(
      ctx(
        monthsWithSpend([
          20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 40_000, 40_000,
          40_000,
        ]),
      ),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.pattern).toBe('level-shift');
    expect(insights[0].data.fromAmount).toBe(20_000);
    expect(insights[0].data.toAmount).toBe(40_000);
  });

  it('reports a decline quietly', () => {
    const insights = detectTrendChange(
      ctx(monthsWithSpend([68_000, 52_000, 40_000, 30_000, 22_000, 16_000])),
    );

    expect(insights[0].data.direction).toBe('down');
    expect(insights[0].severity).toBe('info');
  });

  it('needs a real history before claiming a trend', () => {
    const insights = detectTrendChange(
      ctx(monthsWithSpend([20_000, 30_000, 40_000, 52_000])),
    );
    expect(insights).toEqual([]);
  });

  it('does not read months with no activity as a collapse to zero', () => {
    // A budget cell for a month outside the budget's range reads as 0 rather
    // than "missing". Treating those as observations would report a dramatic
    // decline in every young file.
    const insights = detectTrendChange(
      ctx(monthsWithSpend([0, 0, 0, 20_000, 20_000, 20_000])),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a run whose total change is too small to matter', () => {
    const insights = detectTrendChange(
      ctx(monthsWithSpend([20_000, 21_500, 23_100, 24_900, 26_800, 28_900])),
    );
    // Consecutive rises, but only ~44% over six months of a small category and
    // each step is inside the run test's requirements — check it is not a
    // warning about nothing.
    for (const insight of insights) {
      expect(Math.abs(insight.amount!)).toBeGreaterThanOrEqual(2_500);
    }
  });

  it('scopes the fingerprint to the month, so a snooze lasts one month', () => {
    const [insight] = detectTrendChange(
      ctx(monthsWithSpend([20_000, 20_000, 30_000, 40_000, 52_000, 68_000])),
    );
    expect(insight.fingerprint).toContain('2026-08');
  });
});

describe('detectIncomeVolatility', () => {
  /** Narrows past the "unavailable" arm, which these cases do not exercise. */
  function volatilityInsights(months: InsightMonth[]) {
    const result = detectIncomeVolatility(ctx(months));
    if (!Array.isArray(result)) {
      throw new Error(`expected insights, got ${result.unavailable}`);
    }
    return result;
  }

  function monthsWithIncome(incomes: number[]): InsightMonth[] {
    return incomes.map((income, i) =>
      makeMonth(`2026-${String(i + 3).padStart(2, '0')}`, { income }),
    );
  }

  it('says nothing for steady income', () => {
    const result = detectIncomeVolatility(
      ctx(
        monthsWithIncome([
          500_000, 500_000, 500_000, 500_000, 500_000, 500_000,
        ]),
      ),
    );
    expect(result).toEqual([]);
  });

  it('reports genuinely variable income', () => {
    const insights = volatilityInsights(
      monthsWithIncome([300_000, 700_000, 400_000, 800_000, 350_000, 750_000]),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.cvPct).toBeGreaterThanOrEqual(20);
    expect(insights[0].data.minIncome).toBe(300_000);
    expect(insights[0].data.maxIncome).toBe(800_000);
  });

  it('is not fooled by a single bonus month', () => {
    // A steady salary plus one bonus. A standard-deviation CV lands near 60%
    // here and would warn about volatility that does not exist.
    const result = detectIncomeVolatility(
      ctx(
        monthsWithIncome([
          300_000, 300_000, 300_000, 300_000, 300_000, 900_000,
        ]),
      ),
    );
    expect(result).toEqual([]);
  });

  it('reports itself unavailable without six complete months', () => {
    const result = detectIncomeVolatility(
      ctx(monthsWithIncome([500_000, 400_000, 600_000])),
    );
    expect(result).toEqual({
      insights: [],
      unavailable: 'insufficient-history',
    });
  });

  it('ignores months with no income rather than averaging in zeros', () => {
    const result = detectIncomeVolatility(
      ctx(monthsWithIncome([0, 0, 500_000, 500_000, 500_000, 500_000])),
    );
    expect(result).toEqual({
      insights: [],
      unavailable: 'insufficient-history',
    });
  });
});
