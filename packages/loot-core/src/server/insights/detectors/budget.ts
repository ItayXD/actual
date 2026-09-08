import { spendingCategories } from '#server/insights/lookup';
import {
  expectedSpendToDate,
  projectCategory,
  slotForDay,
  spentThisMonth,
} from '#server/insights/monthPace';
import {
  bucket,
  categoryFloor,
  evidence,
  magnitude,
} from '#server/insights/scale';
import { percentChange } from '#server/insights/stats';
import { MONTH_END, OVERSPEND, PACE } from '#server/insights/thresholds';
import type { InsightContext } from '#server/insights/types';
import type {
  CategoryOverspendRiskInsight,
  MonthEndProjectionInsight,
  SpendingPaceInsight,
} from '#types/models/insights';

/**
 * Insights about where this month's budget is heading.
 *
 * All three share `monthPace.ts`, which learns each category's own shape across
 * the month rather than assuming spending is linear. See the note there for why
 * that matters: a linear model reports every rent-shaped category as wildly
 * overspent on the 2nd of the month.
 */

/** The last day of the context's month, as an ISO date. */
function monthEnd(ctx: InsightContext): string {
  return `${ctx.month}-${String(ctx.daysInMonth).padStart(2, '0')}`;
}

export function detectCategoryOverspendRisk(
  ctx: InsightContext,
): CategoryOverspendRiskInsight[] {
  const insights: CategoryOverspendRiskInsight[] = [];

  for (const category of spendingCategories(ctx)) {
    const projection = projectCategory(ctx, category.id);
    if (projection.projectedOverspend <= 0) {
      continue;
    }

    // Early in the month the run-rate is suppressed, so the only thing left is
    // the bills we can enumerate. That is a fact rather than a forecast, and
    // worth saying — but only if the bills alone overshoot.
    if (
      ctx.daysElapsed < OVERSPEND.MIN_DAYS_FOR_PACE &&
      projection.scheduledRemaining - projection.available <= 0
    ) {
      continue;
    }

    const floor = categoryFloor(ctx.scale, category.id);
    if (projection.projectedOverspend < floor) {
      continue;
    }

    const norm = ctx.scale.byCategory[category.id] ?? 0;
    const severity =
      norm > 0 &&
      projection.projectedOverspend >= OVERSPEND.CRITICAL_CATEGORY_RATIO * norm
        ? 'critical'
        : 'warning';

    insights.push({
      kind: 'category-overspend-risk',
      id: `category-overspend-risk:${category.id}`,
      fingerprint: `category-overspend-risk:${ctx.month}:${category.id}:${bucket(ctx.scale, projection.projectedOverspend)}`,
      severity,
      // Confidence rises through the month, which is exactly right: the same
      // projection made on the 25th is worth more than one made on the 6th.
      score:
        0.55 * magnitude(projection.projectedOverspend, floor) +
        0.3 * (ctx.daysElapsed / ctx.daysInMonth) +
        0.15,
      subjects: [{ type: 'category', id: category.id }],
      date: monthEnd(ctx),
      amount: -projection.projectedOverspend,
      expiresAt: monthEnd(ctx),
      data: {
        categoryId: category.id,
        categoryName: category.name,
        month: ctx.month,
        available: projection.available,
        spentSoFar: projection.spentSoFar,
        scheduledRemaining: projection.scheduledRemaining,
        paceRemaining: projection.paceRemaining,
        projectedOverspend: projection.projectedOverspend,
        basis: projection.basis,
        daysRemaining: ctx.daysRemaining,
      },
    });
  }

  return insights;
}

export function detectSpendingPace(ctx: InsightContext): SpendingPaceInsight[] {
  // Too early in the month for the shape to have separated from the noise.
  if (slotForDay(ctx.dayOfMonth, ctx.daysInMonth) < PACE.MIN_SLOT) {
    return [];
  }

  const insights: SpendingPaceInsight[] = [];

  for (const category of spendingCategories(ctx)) {
    const expectation = expectedSpendToDate(ctx, category.id);
    if (expectation === null || expectation.expectedToDate <= 0) {
      continue;
    }

    const spentToDate = spentThisMonth(ctx, category.id);
    const pacePct = percentChange(expectation.expectedToDate, spentToDate);
    if (pacePct === null || Math.abs(pacePct) < PACE.MIN_PCT) {
      continue;
    }

    const gap = Math.abs(spentToDate - expectation.expectedToDate);
    if (gap < categoryFloor(ctx.scale, category.id)) {
      continue;
    }

    const direction = pacePct > 0 ? 'above' : 'below';
    const available = ctx.currentMonth.byCategory[category.id]?.leftover ?? 0;

    // Running under pace is rarely news, so it stays at `info` and normally
    // loses its slot to something actionable. It exists because "you are
    // spending less than usual" is occasionally the answer to "why do I have
    // money left".
    let severity: 'info' | 'warning' | 'critical' = 'info';
    if (direction === 'above') {
      if (Math.abs(pacePct) > PACE.CRITICAL_PCT && available < 0) {
        severity = 'critical';
      } else if (Math.abs(pacePct) >= PACE.WARNING_PCT) {
        severity = 'warning';
      }
    }

    insights.push({
      kind: 'spending-pace',
      id: `spending-pace:${category.id}`,
      // Bucketed to 5 points, so the daily drift of a percentage does not keep
      // resurfacing a snoozed row. Only a genuinely worse pace comes back.
      fingerprint: `spending-pace:${ctx.month}:${category.id}:${Math.round(pacePct / 5) * 5}`,
      severity,
      score:
        0.5 * magnitude(gap, categoryFloor(ctx.scale, category.id)) +
        0.3 * Math.min(1, Math.abs(pacePct) / 100) +
        0.2 * evidence(expectation.basisMonths, PACE.MAX_BASIS_MONTHS),
      subjects: [{ type: 'category', id: category.id }],
      date: null,
      amount: spentToDate - expectation.expectedToDate,
      expiresAt: monthEnd(ctx),
      data: {
        categoryId: category.id,
        categoryName: category.name,
        month: ctx.month,
        spentToDate,
        expectedToDate: expectation.expectedToDate,
        pacePct,
        direction,
        basisMonths: expectation.basisMonths,
      },
    });
  }

  return insights;
}

export function detectMonthEndProjection(
  ctx: InsightContext,
): MonthEndProjectionInsight[] {
  // A whole-month claim made in the first days of a month is guesswork.
  if (ctx.daysElapsed < MONTH_END.MIN_DAYS_ELAPSED) {
    return [];
  }

  let surplus = 0;
  let deficit = 0;
  const contributors: { id: string; amount: number }[] = [];

  for (const category of spendingCategories(ctx)) {
    const { projectedRemaining } = projectCategory(ctx, category.id);
    if (projectedRemaining > 0) {
      surplus += projectedRemaining;
      contributors.push({ id: category.id, amount: projectedRemaining });
    } else if (projectedRemaining < 0) {
      deficit += -projectedRemaining;
    }
  }

  const net = surplus - deficit;

  // A statement about the whole budget has to clear a whole-budget bar, not the
  // per-category floor.
  if (Math.abs(net) < MONTH_END.NET_MONTH_RATIO * ctx.scale.month) {
    return [];
  }

  const topCategoryIds = contributors
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)
    .map(c => c.id);

  return [
    {
      kind: 'month-end-projection',
      id: `month-end-projection:${ctx.month}`,
      // A much coarser bucket than elsewhere: this number moves every single
      // day, and a snooze on it should survive that.
      fingerprint: `month-end-projection:${ctx.month}:${Math.round(net / Math.max(1, 0.05 * ctx.scale.month))}`,
      severity: net > 0 ? 'info' : 'warning',
      // Deliberately mid-ranked and weighted down in the registry. This is
      // orientation, not an alarm, and must never outrank a projected overdraft.
      score: 0.35 + 0.3 * magnitude(net, ctx.scale.floor),
      subjects: [{ type: 'month', id: ctx.month }],
      date: monthEnd(ctx),
      amount: net,
      expiresAt: monthEnd(ctx),
      data: {
        month: ctx.month,
        surplus,
        deficit,
        net,
        categoryCount: contributors.length,
        topCategoryIds,
        daysRemaining: ctx.daysRemaining,
      },
    },
  ];
}
