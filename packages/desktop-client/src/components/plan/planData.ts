import type {
  CategoryEntity,
  CategoryGroupEntity,
} from '@actual-app/core/types/models';
import type { CategoryTargetProjection } from '@actual-app/core/types/models/targets';

export type PlanCategory = {
  category: CategoryEntity;
  /** What the automations want assigned this month, in minor units. */
  target: number | null;
  /** What is actually assigned this month. */
  assigned: number;
  balance: number;
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
  assigned: number;
};

export type PlanData = {
  groups: PlanGroup[];
  /** Income received this month. */
  income: number;
  /** Everything the plan asks for this month, across all groups. */
  totalTarget: number;
  totalAssigned: number;
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
  income: number;
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
      const planCategory: PlanCategory = {
        category,
        target: projection?.goal ?? null,
        assigned: values.budgeted[category.id] ?? 0,
        balance: values.balance[category.id] ?? 0,
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

    // A group with nothing planned and nothing assigned is noise on a page
    // about the plan.
    if (categories.some(c => c.target !== null || c.assigned !== 0)) {
      groups.push({
        group,
        categories,
        target: sumTargets(categories),
        assigned: categories.reduce((sum, c) => sum + c.assigned, 0),
      });
    }
  }

  const totalTarget = groups.reduce((sum, g) => sum + g.target, 0);
  const totalAssigned = groups.reduce((sum, g) => sum + g.assigned, 0);

  return {
    groups,
    income: values.income,
    totalTarget,
    totalAssigned,
    unplanned: values.income - totalTarget,
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
