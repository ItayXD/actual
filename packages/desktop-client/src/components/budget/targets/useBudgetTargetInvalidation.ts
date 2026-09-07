import { useEffect } from 'react';

import { listen } from '@actual-app/core/platform/client/connection';
import { useQueryClient } from '@tanstack/react-query';

import { budgetTargetQueries } from './queries';
import { useBudgetTargetsEnabled } from './useBudgetTargetsEnabled';

/**
 * Cells whose value feeds a projected target. A budget edit changes what is
 * assigned, a transaction changes what was spent, income drives percentage
 * templates, and all of them roll into next month's carryover — so any of them
 * can move a target.
 */
const TARGET_INPUT_CELL =
  /^budget\d{6}!(budget|sum-amount|leftover|total-income)/;

const INVALIDATE_DEBOUNCE_MS = 250;

/**
 * Keeps projected targets fresh. Mount once on any page that shows them —
 * the projection queries themselves are cached with `staleTime: Infinity`, so
 * this listener is the only thing that refreshes them.
 */
export function useBudgetTargetInvalidation() {
  const enabled = useBudgetTargetsEnabled();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unlisten = listen('cells-changed', event => {
      if (!event.some(node => TARGET_INPUT_CELL.test(node.name))) {
        return;
      }
      // Budget edits arrive as a burst of cell changes; recomputing once at the
      // end of the burst is enough.
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: budgetTargetQueries.all(),
        });
      }, INVALIDATE_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timeout);
      unlisten();
    };
  }, [enabled, queryClient]);
}
