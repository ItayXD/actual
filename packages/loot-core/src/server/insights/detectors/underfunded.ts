import { categoryNameOf } from '#server/insights/lookup';
import { bucket, categoryFloor, magnitude } from '#server/insights/scale';
import { UNDERFUNDED } from '#server/insights/thresholds';
import type { InsightContext } from '#server/insights/types';
import type {
  InsightUnavailableReason,
  UnderfundedCategoryInsight,
} from '#types/models/insights';

/**
 * "The annual insurance category needs another $46 per month to cover the next
 * payment."
 *
 * Built entirely on the fork's own `budget/project-targets`, which runs the
 * budget-automation engine **read-only**. That handler exists precisely so a
 * view can see what the templates are aiming at without applying them —
 * `FORK.md` rule 8 forbids writing `goal`/`long_goal` as a side effect of
 * looking at the budget, and this detector is the reason that rule needed a
 * read-only path in the first place.
 */
export function detectUnderfundedCategory(ctx: InsightContext):
  | UnderfundedCategoryInsight[]
  | {
      insights: UnderfundedCategoryInsight[];
      unavailable: InsightUnavailableReason;
    } {
  if (ctx.targets === null) {
    return { insights: [], unavailable: 'no-targets' };
  }

  const insights: UnderfundedCategoryInsight[] = [];

  for (const target of ctx.targets) {
    // An elastic template ("whatever is left") has no fixed number to be under
    // or over funded against, and a broken template is not the user's problem
    // to hear about here.
    if (
      target.error !== null ||
      target.isElastic ||
      target.targetMonth === null ||
      target.monthsRemaining === null ||
      target.monthsRemaining < 1 ||
      target.totalTargetAmount === null
    ) {
      continue;
    }

    const budgetedThisMonth =
      ctx.currentMonth.byCategory[target.categoryId]?.budgeted ?? 0;
    const stillNeeded = target.totalTargetAmount - target.savedTowardTarget;
    if (stillNeeded <= 0) {
      continue;
    }

    // For a dated template the engine has already divided the remainder across
    // the remaining months. Recomputing that here would drift from what the
    // budget table itself would do, so prefer its number and only fall back to
    // dividing for a `#goal`-driven long target.
    const requiredPerMonth = target.longGoal
      ? Math.ceil(stillNeeded / (target.monthsRemaining + 1))
      : target.budgeted;

    const shortfallPerMonth = requiredPerMonth - budgetedThisMonth;
    if (shortfallPerMonth <= 0) {
      continue;
    }

    const floor = categoryFloor(ctx.scale, target.categoryId);
    if (shortfallPerMonth < floor) {
      continue;
    }

    const neverFunded = ctx.months.every(
      month => (month.byCategory[target.categoryId]?.budgeted ?? 0) === 0,
    );

    insights.push({
      kind: 'underfunded-category',
      id: `underfunded-category:${target.categoryId}`,
      fingerprint: `underfunded-category:${target.categoryId}:${target.targetMonth}:${bucket(ctx.scale, shortfallPerMonth)}`,
      // An automation nobody has ever funded is usually an abandoned template
      // rather than a crisis, so it informs instead of warning.
      severity:
        !neverFunded &&
        target.monthsRemaining <= UNDERFUNDED.WARNING_MONTHS_REMAINING
          ? 'warning'
          : 'info',
      score:
        (0.45 * magnitude(shortfallPerMonth, floor) +
          0.35 * (1 / (1 + target.monthsRemaining)) +
          0.2) *
        (neverFunded ? 0.5 : 1),
      subjects: [{ type: 'category', id: target.categoryId }],
      date: target.targetMonth,
      amount: -shortfallPerMonth,
      expiresAt: null,
      data: {
        categoryId: target.categoryId,
        categoryName: categoryNameOf(ctx, target.categoryId),
        month: ctx.month,
        targetMonth: target.targetMonth,
        monthsRemaining: target.monthsRemaining,
        totalTargetAmount: target.totalTargetAmount,
        savedTowardTarget: target.savedTowardTarget,
        stillNeeded,
        requiredPerMonth,
        budgetedThisMonth,
        shortfallPerMonth,
        neverFunded,
      },
    });
  }

  return insights;
}
