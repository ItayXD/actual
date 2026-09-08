import { useEffect } from 'react';

import { listen } from '@actual-app/core/platform/client/connection';
import { useQueryClient } from '@tanstack/react-query';

import { insightQueries } from './queries';

/**
 * Cells whose value can move an insight. Budget edits change what is assigned,
 * transactions change what was spent and what balances are, income drives the
 * pace and volatility figures, and all of them roll into carryover.
 */
const INSIGHT_INPUT_CELL =
  /^budget\d{6}!(budget|sum-amount|leftover|total-income|total-spent)|^account-/;

const INVALIDATE_DEBOUNCE_MS = 400;

/**
 * Keeps the card fresh without polling.
 *
 * The queries are cached with `staleTime: Infinity`, so this listener is the
 * only thing that refreshes them — which is the point: the card should react to
 * the user's data changing and to nothing else.
 */
export function useInsightsInvalidation(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unlisten = listen('cells-changed', event => {
      if (!event.some(node => INSIGHT_INPUT_CELL.test(node.name))) {
        return;
      }
      // Budget edits and imports arrive as a burst; recomputing sixteen
      // detectors once at the end of it is enough.
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: insightQueries.all(),
        });
      }, INVALIDATE_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timeout);
      unlisten();
    };
  }, [enabled, queryClient]);
}
