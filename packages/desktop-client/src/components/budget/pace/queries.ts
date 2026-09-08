import { send } from '@actual-app/core/platform/client/connection';
import type { MonthSpendingPace } from '@actual-app/core/types/models/spending-pace';
import { queryOptions } from '@tanstack/react-query';

export const spendingPaceQueries = {
  all: () => ['spending-pace'],
  /**
   * Spending rhythm for a single month.
   *
   * Keyed per month rather than per visible window, so scrolling the budget
   * table from Jan–Mar to Feb–Apr reuses two of the three entries instead of
   * refetching all of them.
   */
  month: (month: string, enabled: boolean = true) =>
    queryOptions<MonthSpendingPace>({
      queryKey: [...spendingPaceQueries.all(), 'month', month],
      queryFn: async () => {
        const [pace] = await send('budget/spending-pace', { months: [month] });
        return (
          pace ?? {
            month,
            phase: 'future' as const,
            daysInMonth: 30,
            dayOfMonth: 0,
            categories: [],
          }
        );
      },
      // The rhythm only moves when a transaction does, and
      // `useSpendingPaceInvalidation` watches for exactly that.
      staleTime: Infinity,
      enabled,
    }),
};
