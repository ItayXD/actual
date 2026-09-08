import type {
  CategoryEntity,
  CategoryGroupEntity,
} from '@actual-app/core/types/models';
import type {
  CategoryTargetProjection,
  PastSpending,
} from '@actual-app/core/types/models/targets';

export type PlanCategory = {
  category: CategoryEntity;
  /** What the automations want assigned this month, in minor units. */
  target: number | null;
  /**
   * What is actually assigned this month. Not shown as a column — the plan
   * screen compares the plan against history — but the long-term goal bars
   * need it to show where they will stand at month end.
   */
  assigned: number;
  balance: number;
  /** Average monthly spend over the chosen window, positive for an expense. */
  pastSpending: number;
  /** Average monthly amount budgeted over the chosen window. */
  pastBudgeted: number;
  /**
   * Plan minus history. Positive means the plan allows more than has been
   * spent; negative means the plan is below what this category usually costs.
   */
  vsPastSpending: number | null;
  isLongGoal: boolean;
  isElastic: boolean;
  targetMonth: string | null;
  monthsRemaining: number | null;
  totalTargetAmount: number | null;
  savedTowardTarget: number;
  error: string | null;
};

export type PlanGroup = {
  group: CategoryGroupEntity;
  categories: PlanCategory[];
  /** Sum of fixed targets in this group; elastic categories contribute 0. */
  target: number;
  pastSpending: number;
  pastBudgeted: number;
};

export type PlanData = {
  groups: PlanGroup[];
  /** Average monthly income over the chosen window. */
  income: number;
  /** Everything the plan asks for this month, across all groups. */
  totalTarget: number;
  /** Average monthly spend over the chosen window, across all groups. */
  totalPastSpending: number;
  /** Average monthly amount budgeted over the chosen window, across all groups. */
  totalPastBudgeted: number;
  /** Income minus what the plan asks for. Negative means the plan overcommits. */
  unplanned: number;
  /** Categories still saving toward a dated or long-term goal. */
  longTerm: PlanCategory[];
  /** Categories whose target is "whatever is left". */
  elastic: PlanCategory[];
  /** Categories with a broken automation, surfaced rather than hidden. */
  errors: PlanCategory[];
};

export type PlanMonthValues = {
  /** Per-category assigned amount, in minor units. */
  budgeted: Record<CategoryEntity['id'], number>;
  /** Per-category balance, in minor units. */
  balance: Record<CategoryEntity['id'], number>;
};

/**
 * Folds projections and month values into the shape the Plan page renders.
 *
 * Pure on purpose: all the arithmetic that matters — what the plan costs per
 * month, and whether income covers it — is testable without React or a
 * spreadsheet.
 */
export function buildPlanData(
  projections: CategoryTargetProjection[],
  values: PlanMonthValues,
  past: PastSpending,
  categoryGroups: CategoryGroupEntity[],
): PlanData {
  const byCategory = new Map(projections.map(p => [p.categoryId, p]));

  const groups: PlanGroup[] = [];
  const longTerm: PlanCategory[] = [];
  const elastic: PlanCategory[] = [];
  const errors: PlanCategory[] = [];

  for (const group of categoryGroups) {
    if (group.is_income) {
      continue;
    }

    const categories: PlanCategory[] = [];
    for (const category of group.categories ?? []) {
      if (category.hidden) {
        continue;
      }

      const projection = byCategory.get(category.id);
      const target = projection?.goal ?? null;
      const isLongGoal = projection?.longGoal ?? false;
      const pastSpending = past.byCategory[category.id] ?? 0;
      const pastBudgeted = past.budgetedByCategory[category.id] ?? 0;
      const planCategory: PlanCategory = {
        category,
        target,
        assigned: values.budgeted[category.id] ?? 0,
        balance: values.balance[category.id] ?? 0,
        isLongGoal,
        pastSpending,
        pastBudgeted,
        // A long-term goal's target is a lifetime total, so comparing it to a
        // month of history would be meaningless.
        vsPastSpending:
          target === null || isLongGoal ? null : target - pastSpending,
        isElastic: projection?.isElastic ?? false,
        targetMonth: projection?.targetMonth ?? null,
        monthsRemaining: projection?.monthsRemaining ?? null,
        totalTargetAmount: projection?.totalTargetAmount ?? null,
        savedTowardTarget: projection?.savedTowardTarget ?? 0,
        error: projection?.error ?? null,
      };

      categories.push(planCategory);

      if (planCategory.error !== null) {
        errors.push(planCategory);
      }
      if (planCategory.isElastic) {
        elastic.push(planCategory);
      }
      if (
        planCategory.isLongGoal ||
        (planCategory.monthsRemaining !== null &&
          planCategory.monthsRemaining > 0)
      ) {
        longTerm.push(planCategory);
      }
    }

    // Every non-income group is listed, because the plan screen is also where
    // categories get planned for the first time.
    groups.push({
      group,
      categories,
      target: sumTargets(categories),
      pastSpending: categories.reduce((sum, c) => sum + c.pastSpending, 0),
      pastBudgeted: categories.reduce((sum, c) => sum + c.pastBudgeted, 0),
    });
  }

  const totalTarget = groups.reduce((sum, g) => sum + g.target, 0);
  const totalPastSpending = groups.reduce((sum, g) => sum + g.pastSpending, 0);
  const totalPastBudgeted = groups.reduce((sum, g) => sum + g.pastBudgeted, 0);

  return {
    groups,
    income: past.income,
    totalTarget,
    totalPastSpending,
    totalPastBudgeted,
    unplanned: past.income - totalTarget,
    longTerm,
    elastic,
    errors,
  };
}

/**
 * Sums only the figures that are actually a monthly ask.
 *
 * Two kinds are left out:
 *
 * - **Long-term goals.** When a `#goal` drives a category the engine reports
 *   the *lifetime* target, not this month's contribution, so adding a 10,000
 *   emergency fund to a monthly plan would overstate it by 10,000. These are
 *   tracked in their own section, against what has been saved so far.
 * - **Elastic targets** ("whatever is left"), which have no fixed number at
 *   all; including them would make the total depend on how much happened to be
 *   available rather than on the plan.
 */
function sumTargets(categories: PlanCategory[]): number {
  return categories.reduce(
    (sum, c) => (c.isLongGoal ? sum : sum + (c.target ?? 0)),
    0,
  );
}
