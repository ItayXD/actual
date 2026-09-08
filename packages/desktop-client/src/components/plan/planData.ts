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
};

export type PlanData = {
  groups: PlanGroup[];
  /** Average monthly income over the chosen window. */
  income: number;
  /** Everything the plan asks for this month, across all groups. */
  totalTarget: number;
  /** Average monthly spend over the chosen window, across all groups. */
  totalPastSpending: number;
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
      const pastSpending = past.byCategory[category.id] ?? 0;
      const planCategory: PlanCategory = {
        category,
        target,
        assigned: values.budgeted[category.id] ?? 0,
        balance: values.balance[category.id] ?? 0,
        pastSpending,
        vsPastSpending: target === null ? null : target - pastSpending,
        isLongGoal: projection?.longGoal ?? false,
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
    });
  }

  const totalTarget = groups.reduce((sum, g) => sum + g.target, 0);
  const totalPastSpending = groups.reduce((sum, g) => sum + g.pastSpending, 0);

  return {
    groups,
    income: past.income,
    totalTarget,
    totalPastSpending,
    unplanned: past.income - totalTarget,
    longTerm,
    elastic,
    errors,
  };
}

/**
 * Elastic categories ("whatever is left") have no fixed number, so including
 * them would make the monthly total depend on how much happened to be
 * available rather than on the plan.
 */
function sumTargets(categories: PlanCategory[]): number {
  return categories.reduce((sum, c) => sum + (c.target ?? 0), 0);
}
