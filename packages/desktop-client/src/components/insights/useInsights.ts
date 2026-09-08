import { useMemo } from 'react';

import type { InsightsWidget } from '@actual-app/core/types/models';
import type { Insight } from '@actual-app/core/types/models/insights';
import { useQuery } from '@tanstack/react-query';

import {
  meetsMinSeverity,
  requestedKinds,
  resolveInsightsMeta,
} from './insightsMeta';
import { insightQueries } from './queries';
import { useInsightDismissals } from './useInsightDismissals';
import { useInsightsInvalidation } from './useInsightsInvalidation';

export type UseInsightsResult = {
  visible: Insight[];
  snoozed: Insight[];
  /** Produced by the server but dropped by its own caps. */
  suppressedCount: number;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
  asOf: string | null;
  hasInsufficientHistory: boolean;
  snooze: (insight: Insight) => void;
  restore: (insightId: string) => void;
  restoreAll: () => void;
  snoozedTotal: number;
};

/**
 * How many insights beyond the visible cap to fetch.
 *
 * Snoozing filters client-side, so without headroom the card would simply
 * shrink: snooze three of twelve and you are left with nine, with the
 * thirteenth-ranked insight never revealed. That defeats the point of both the
 * cap and the snooze. Asking for a margin means a snooze promotes the next
 * insight instead of leaving a gap. Detection cost is unchanged — every
 * detector runs regardless; only the final ranking keeps a few more rows.
 */
const SNOOZE_HEADROOM = 10;

/**
 * Everything the card needs, in one hook: fetch, filter, snooze, cap.
 *
 * Ranking already happened on the server, which is where the scores are, so
 * this preserves the order it returned rather than re-sorting.
 */
export function useInsights(
  meta: InsightsWidget['meta'],
  enabled: boolean,
): UseInsightsResult {
  const resolved = useMemo(() => resolveInsightsMeta(meta), [meta]);

  useInsightsInvalidation(enabled);

  const { data, isPending, isError, refetch } = useQuery({
    ...insightQueries.list({
      kinds: requestedKinds(resolved.mutedKinds),
      accountIds: resolved.accountIds,
      maxInsights: resolved.maxItems + SNOOZE_HEADROOM,
      horizonDays: resolved.horizonDays,
      lowBalanceThresholds: resolved.lowBalanceThresholds,
    }),
    enabled,
  });

  const { suppressed, dismiss, restore, restoreAll, count } =
    useInsightDismissals();

  const { visible, snoozed } = useMemo(() => {
    const all = data?.insights ?? [];
    const eligible = all.filter(
      insight =>
        !resolved.mutedKinds.has(insight.kind) &&
        meetsMinSeverity(insight.severity, resolved.minSeverity),
    );

    return {
      visible: eligible
        .filter(insight => !suppressed(insight))
        .slice(0, resolved.maxItems),
      snoozed: eligible.filter(insight => suppressed(insight)),
    };
  }, [data, resolved, suppressed]);

  const suppressedCount = Object.values(data?.suppressedByKind ?? {}).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );

  return {
    visible,
    snoozed,
    suppressedCount,
    isPending,
    isError,
    refetch: () => void refetch(),
    asOf: data?.asOf ?? null,
    hasInsufficientHistory: Object.values(data?.unavailable ?? {}).some(
      reason => reason === 'insufficient-history',
    ),
    // Surfaced here so the card wires row actions from one hook.
    snooze: dismiss,
    restore,
    restoreAll,
    snoozedTotal: count,
  };
}
