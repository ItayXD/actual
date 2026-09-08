import { send } from '@actual-app/core/platform/client/connection';
import type {
  InsightKind,
  InsightsResult,
} from '@actual-app/core/types/models/insights';
import { queryOptions } from '@tanstack/react-query';

export type InsightsQueryParams = {
  kinds?: InsightKind[];
  accountIds?: string[];
  maxInsights?: number;
  horizonDays?: number;
  lowBalanceThresholds?: Record<string, number>;
};

export const insightQueries = {
  all: () => ['insights'],
  /**
   * Insights for the current file.
   *
   * `staleTime: Infinity` with explicit invalidation, matching the fork's budget
   * targets. Deliberately no refetch on window focus and no polling: the card
   * must change when the user's *data* changes, not because they came back to
   * the tab. An alert feed that quietly re-shuffles itself is exactly the
   * attention-grabbing behaviour this feature is supposed to avoid.
   */
  list: (params: InsightsQueryParams = {}) =>
    queryOptions<InsightsResult>({
      queryKey: [...insightQueries.all(), 'list', params],
      queryFn: async () => await send('insights/generate', params),
      staleTime: Infinity,
    }),
};
