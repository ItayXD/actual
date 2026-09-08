import { spendingCategories } from '#server/insights/lookup';
import { categoryFloor, magnitude } from '#server/insights/scale';
import {
  median,
  percentChange,
  robustCvPct,
  terminalRun,
} from '#server/insights/stats';
import { INCOME_VOLATILITY, TREND } from '#server/insights/thresholds';
import type { InsightContext } from '#server/insights/types';
import type {
  IncomeVolatilityInsight,
  InsightUnavailableReason,
  TrendChangeInsight,
} from '#types/models/insights';

/**
 * Slow-moving insights, computed from **complete months only**.
 *
 * Two traps here, both of which produce confident nonsense if missed:
 *
 *  1. Including the in-progress month makes every category look like it just
 *     collapsed. `ctx.months` holds complete months only for this reason;
 *     `ctx.currentMonth` is kept separate.
 *  2. Reading a budget sheet cell for a month outside the budget's range returns
 *     `0` rather than "missing" (`Spreadsheet._getNode` inserts an empty node on
 *     a miss). Those fabricated zeros would read as a dramatic decline in
 *     spending, or as wild income volatility, in every young file. `context.ts`
 *     clamps the window to real data, and the guards below drop empty months
 *     rather than treating them as observations.
 */

/** Per-month spend for a category, positive, oldest first; empty months dropped. */
function categorySeries(ctx: InsightContext, categoryId: string): number[] {
  return ctx.months
    .slice(-TREND.MAX_BASIS_MONTHS)
    .map(month => {
      const cell = month.byCategory[categoryId];
      return cell ? -cell.sumAmount : 0;
    })
    .filter(amount => amount > 0);
}

export function detectTrendChange(ctx: InsightContext): TrendChangeInsight[] {
  const insights: TrendChangeInsight[] = [];
  const throughMonth = ctx.months[ctx.months.length - 1]?.month;
  if (throughMonth === undefined) {
    return [];
  }

  for (const category of spendingCategories(ctx)) {
    const series = categorySeries(ctx, category.id);
    if (series.length < TREND.MIN_BASIS_MONTHS) {
      continue;
    }

    const floor = categoryFloor(ctx.scale, category.id);
    let pattern: 'run' | 'level-shift' | null = null;
    let direction: 'up' | 'down' = 'up';
    let months = 0;
    let fromAmount = 0;
    let toAmount = 0;

    for (const candidate of ['up', 'down'] as const) {
      const run = terminalRun(series, candidate, TREND.RUN_DEAD_BAND);
      if (run < TREND.MIN_RUN) {
        continue;
      }
      const start = series[series.length - 1 - run];
      const end = series[series.length - 1];
      const enoughChange =
        candidate === 'up'
          ? end >= start * TREND.MIN_RUN_CHANGE_RATIO
          : end <= start / TREND.MIN_RUN_CHANGE_RATIO;
      if (!enoughChange || Math.abs(end - start) < floor) {
        continue;
      }
      pattern = 'run';
      direction = candidate;
      months = run;
      fromAmount = start;
      toAmount = end;
      break;
    }

    // A step change — a rent rise, a new car payment — leaves the series flat,
    // then flat at a new level. A monotone-run test misses that entirely, which
    // is why this second pattern exists.
    if (pattern === null) {
      const recent = series.slice(-TREND.LEVEL_SHIFT_RECENT);
      const prior = series.slice(
        -(TREND.LEVEL_SHIFT_RECENT + TREND.LEVEL_SHIFT_PRIOR),
        -TREND.LEVEL_SHIFT_RECENT,
      );
      if (
        recent.length === TREND.LEVEL_SHIFT_RECENT &&
        prior.length >= TREND.MIN_RUN
      ) {
        const recentMedian = median(recent);
        const priorMedian = median(prior);
        const shiftedUp =
          priorMedian > 0 &&
          recentMedian >= priorMedian * TREND.LEVEL_SHIFT_RATIO;
        const shiftedDown =
          priorMedian > 0 &&
          recentMedian <= priorMedian / TREND.LEVEL_SHIFT_RATIO;

        if (
          (shiftedUp || shiftedDown) &&
          Math.abs(recentMedian - priorMedian) >= floor
        ) {
          pattern = 'level-shift';
          direction = shiftedUp ? 'up' : 'down';
          months = recent.length + prior.length;
          fromAmount = Math.round(priorMedian);
          toAmount = Math.round(recentMedian);
        }
      }
    }

    if (pattern === null) {
      continue;
    }

    const changePct = percentChange(fromAmount, toAmount) ?? 0;

    insights.push({
      kind: 'trend-change',
      id: `trend-change:${category.id}`,
      // Includes the month, so a dismissal lasts exactly one month and the
      // insight returns if the run extends.
      fingerprint: `trend-change:${category.id}:${direction}:${throughMonth}:${months}`,
      severity: direction === 'up' ? 'warning' : 'info',
      score:
        0.4 * Math.min(1, months / TREND.LEVEL_SHIFT_PRIOR) +
        0.35 * magnitude(toAmount - fromAmount, floor) +
        0.25 * Math.min(1, Math.abs(changePct) / 100),
      subjects: [{ type: 'category', id: category.id }],
      date: null,
      amount: toAmount - fromAmount,
      expiresAt: null,
      data: {
        categoryId: category.id,
        categoryName: category.name,
        direction,
        pattern,
        months,
        fromAmount: Math.round(fromAmount),
        toAmount: Math.round(toAmount),
        changePct,
        throughMonth,
        basisMonths: series.length,
      },
    });
  }

  return insights;
}

/**
 * "Monthly income has varied by 28% over the last six months."
 *
 * This is the honest counterpart to the deterministic balance projections: it
 * tells the user how much to trust a schedule-driven forecast without inventing
 * a probability distribution to do it.
 */
export function detectIncomeVolatility(ctx: InsightContext):
  | IncomeVolatilityInsight[]
  | {
      insights: IncomeVolatilityInsight[];
      unavailable: InsightUnavailableReason;
    } {
  const recent = ctx.months.slice(-INCOME_VOLATILITY.BASIS_MONTHS);
  const incomes = recent
    .map(month => month.income)
    .filter(income => income > 0);

  if (incomes.length < INCOME_VOLATILITY.BASIS_MONTHS) {
    return { insights: [], unavailable: 'insufficient-history' };
  }

  const cvPct = robustCvPct(incomes);
  if (cvPct === null || cvPct < INCOME_VOLATILITY.MIN_CV_PCT) {
    return [];
  }

  const throughMonth = recent[recent.length - 1].month;

  return [
    {
      kind: 'income-volatility',
      id: 'income-volatility',
      fingerprint: `income-volatility:${throughMonth}:${Math.round(cvPct / 5) * 5}`,
      severity: cvPct >= INCOME_VOLATILITY.WARNING_CV_PCT ? 'warning' : 'info',
      // Background context. The registry weight pushes it below every alarm.
      score: 0.3 + 0.5 * Math.min(1, cvPct / 100),
      subjects: [],
      date: null,
      amount: null,
      expiresAt: null,
      data: {
        cvPct,
        medianIncome: Math.round(median(incomes)),
        minIncome: Math.min(...incomes),
        maxIncome: Math.max(...incomes),
        basisMonths: incomes.length,
        throughMonth,
      },
    },
  ];
}
