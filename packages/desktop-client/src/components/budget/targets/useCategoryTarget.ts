import type { CategoryEntity } from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

import { useSheetValue } from '#hooks/useSheetValue';
import type { Binding, SheetFields } from '#spreadsheet';
import { envelopeBudget } from '#spreadsheet/bindings';

import { budgetTargetQueries } from './queries';
import type { TargetStatus } from './targetStatus';
import { getPlanProgress, getPlanStatus } from './targetStatus';
import { useBudgetTargetsEnabled } from './useBudgetTargetsEnabled';

/**
 * Pins the sheet so `FieldName` can be inferred from a parametrized binding.
 * `parametrizedField` renders a bare `<field>-<id>` cell name, which on its own
 * gives TypeScript nothing to infer the sheet from.
 *
 * Declared locally rather than reused from `EnvelopeBudgetComponents` to avoid
 * an import cycle: that module consumes this hook.
 */
function useBudgetSheetValue<FieldName extends SheetFields<'envelope-budget'>>(
  binding: Binding<'envelope-budget', FieldName>,
) {
  return useSheetValue(binding);
}

export type CategoryTarget = {
  /** How this month's assignment compares to the plan. */
  status: TargetStatus;
  /** Amount the plan asks for this month, in minor units. */
  target: number | null;
  /** Amount assigned this month, in minor units. */
  assigned: number;
  /** Assigned as a fraction of the plan; null when there is no fixed plan. */
  progress: number | null;
  isLongGoal: boolean;
  isElastic: boolean;
  targetMonth: string | null;
  monthsRemaining: number | null;
  /**
   * `derived` when computed live from the category's automations, `persisted`
   * when falling back to the `goal` column written the last time a template was
   * applied.
   */
  source: 'derived' | 'persisted';
  error: string | null;
};

/**
 * The target for one category in one month.
 *
 * Prefers the live projection over the persisted `goal` column: that column is
 * only a snapshot from the last time a template was applied, so it is stale
 * whenever the automation has changed since — and stale colours are worse than
 * none. Falls back to the persisted value when there is no projection at all
 * (a note-based `#goal` parsed long ago, or another client's write) or when the
 * category's templates failed, so a typo shows last-known-good rather than
 * blanking the row.
 *
 * Returns null when the flag is off or nothing defines a target, which keeps
 * untargeted categories on exactly the styling they have always had.
 */
export function useCategoryTarget(
  category: CategoryEntity,
  month: string,
): CategoryTarget | null {
  const enabled = useBudgetTargetsEnabled();
  // React Query dedupes by key, so every category row in a given month shares
  // one request and one cache entry rather than fetching per row.
  const { data: projections } = useQuery(
    budgetTargetQueries.month(month, enabled),
  );
  // The envelope and tracking bindings differ only in their TypeScript brand:
  // `parametrizedField` renders both as the same `<field>-<id>` cell name, and
  // the sheet itself (`budget<YYYYMM>!`) comes from the ambient
  // `SheetNameProvider`. So one set of bindings reads correctly under either
  // budget type, and a union of the two would not typecheck under strict mode.
  const budgeted =
    useBudgetSheetValue(envelopeBudget.catBudgeted(category.id)) ?? 0;
  const persistedGoal = useBudgetSheetValue(
    envelopeBudget.catGoal(category.id),
  );
  const persistedLongGoal = useBudgetSheetValue(
    envelopeBudget.catLongGoal(category.id),
  );

  if (!enabled) {
    return null;
  }

  const projection =
    projections?.categories.find(c => c.categoryId === category.id) ?? null;
  const usePersisted =
    projection === null ||
    projection.error !== null ||
    projection.goal === null;

  const target = usePersisted ? (persistedGoal ?? null) : projection.goal;
  const isElastic = projection?.isElastic ?? false;

  if (target === null && !isElastic) {
    return null;
  }

  const isLongGoal = usePersisted
    ? persistedLongGoal === 1
    : projection.longGoal;

  // A persisted goal carries no deadline information, so pacing is only
  // available from a live projection.
  const monthsRemaining = usePersisted
    ? null
    : (projection.monthsRemaining ?? null);

  // The budget table judges the Budgeted column only: assigned vs this month's
  // plan. Overspending is shown in the Balance column and pacing toward a
  // deadline on the Plan page, so neither is folded in here.
  return {
    status: getPlanStatus(budgeted, target, isElastic),
    target,
    assigned: budgeted,
    progress: getPlanProgress(budgeted, target, isElastic),
    isLongGoal,
    isElastic,
    targetMonth: usePersisted ? null : (projection.targetMonth ?? null),
    monthsRemaining,
    source: usePersisted ? 'persisted' : 'derived',
    error: projection?.error ?? null,
  };
}
