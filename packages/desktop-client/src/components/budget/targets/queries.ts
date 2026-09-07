import { send } from '@actual-app/core/platform/client/connection';
import type { MonthTargetProjection } from '@actual-app/core/types/models/targets';
import { queryOptions } from '@tanstack/react-query';

export const budgetTargetQueries = {
  all: () => ['budget-targets'],
  /**
   * Targets for a single month.
   *
   * Keyed per month rather than per visible window, so scrolling the budget
   * table from Jan–Mar to Feb–Apr reuses two of the three entries instead of
   * refetching all of them.
   */
  month: (month: string, enabled: boolean = true) =>
    queryOptions<MonthTargetProjection>({
      queryKey: [...budgetTargetQueries.all(), 'month', month],
      queryFn: async () => {
        const [projection] = await send('budget/project-targets', {
          months: [month],
        });
        return projection ?? { month, categories: [] };
      },
      // Targets only move when an automation, a budget, or a transaction
      // changes, and `BudgetTargetsProvider` invalidates on all three.
      staleTime: Infinity,
      enabled,
    }),
  /** Several months in one round trip, for the Plan page. */
  months: (months: string[], enabled: boolean = true) =>
    queryOptions<MonthTargetProjection[]>({
      queryKey: [...budgetTargetQueries.all(), 'months', ...months],
      queryFn: async () => await send('budget/project-targets', { months }),
      staleTime: Infinity,
      enabled: enabled && months.length > 0,
    }),
};
