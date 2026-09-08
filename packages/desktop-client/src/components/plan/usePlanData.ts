import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import type {
  PastSpending,
  SpendingBasis,
} from '@actual-app/core/types/models/targets';
import { useQuery } from '@tanstack/react-query';

import { budgetTargetQueries } from '#components/budget/targets/queries';
import { useCategories } from '#hooks/useCategories';
import { useSyncedPref } from '#hooks/useSyncedPref';

import type { PlanData, PlanMonthValues } from './planData';
import { buildPlanData } from './planData';

type MonthCell = { name: string; value: unknown };

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * Reads a whole month of budget cells in one round trip.
 *
 * The alternative — binding a sheet cell per category per figure — would be
 * well over a hundred subscriptions for a page that only needs a snapshot.
 */
function parseMonthValues(cells: MonthCell[], month: string): PlanMonthValues {
  const prefix = `${monthUtils.sheetForMonth(month)}!`;
  const budgeted: Record<string, number> = {};
  const balance: Record<string, number> = {};

  for (const cell of cells) {
    const name = cell.name.startsWith(prefix)
      ? cell.name.slice(prefix.length)
      : cell.name;

    if (name.startsWith('budget-')) {
      budgeted[name.slice('budget-'.length)] = toNumber(cell.value);
    } else if (name.startsWith('leftover-')) {
      balance[name.slice('leftover-'.length)] = toNumber(cell.value);
    }
  }

  return { budgeted, balance };
}

export const planQueries = {
  all: () => ['plan'],
  monthValues: (month: string, isTracking: boolean) => ({
    queryKey: [
      ...planQueries.all(),
      'month-values',
      month,
      isTracking,
    ] as const,
    queryFn: async (): Promise<PlanMonthValues> => {
      const cells = (await send(
        isTracking ? 'tracking-budget-month' : 'envelope-budget-month',
        { month },
      )) as MonthCell[];
      return parseMonthValues(cells, month);
    },
  }),
  pastSpending: (month: string, basis: SpendingBasis) => ({
    queryKey: [...planQueries.all(), 'past-spending', month, basis] as const,
    queryFn: async (): Promise<PastSpending> =>
      await send('budget/past-spending', { month, basis }),
  }),
};

export function usePlanData(
  month: string,
  basis: SpendingBasis,
): { data: PlanData | null; isLoading: boolean } {
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  const isTracking = budgetType === 'tracking';

  const { data: projections, isLoading: projectionsLoading } = useQuery(
    budgetTargetQueries.month(month),
  );
  const { data: values, isLoading: valuesLoading } = useQuery(
    planQueries.monthValues(month, isTracking),
  );
  const { data: past, isLoading: pastLoading } = useQuery(
    planQueries.pastSpending(month, basis),
  );
  const { data: { grouped: categoryGroups } = { grouped: [] } } =
    useCategories();

  const isLoading = projectionsLoading || valuesLoading || pastLoading;
  if (!projections || !values || !past) {
    return { data: null, isLoading };
  }

  return {
    data: buildPlanData(projections.categories, values, past, categoryGroups),
    isLoading,
  };
}

export { parseMonthValues };
