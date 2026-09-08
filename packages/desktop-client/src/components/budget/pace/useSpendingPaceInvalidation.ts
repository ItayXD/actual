import { useEffect } from 'react';

import { listen } from '@actual-app/core/platform/client/connection';
import { useQueryClient } from '@tanstack/react-query';

import { spendingPaceQueries } from './queries';
import { useSpendingPaceEnabled } from './useSpendingPaceEnabled';

/**
 * Cells that mean the spending rhythm has changed. Only transactions feed it:
 * the budgeted amount and the balance are read live from the spreadsheet by
 * `useCategorySpendingPace`, so a budget edit needs no refetch.
 */
const PACE_INPUT_CELL = /^budget\d{6}!sum-amount/;

const INVALIDATE_DEBOUNCE_MS = 250;

/**
 * Keeps spending pace fresh. Mount once on any page that shows it — the
 * queries are cached with `staleTime: Infinity`, so this listener is the only
 * thing that refreshes them.
 */
export function useSpendingPaceInvalidation() {
  const enabled = useSpendingPaceEnabled();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unlisten = listen('cells-changed', event => {
      if (!event.some(node => PACE_INPUT_CELL.test(node.name))) {
        return;
      }
      // An import or a rule run arrives as a burst; recomputing once at the
      // end of it is enough.
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: spendingPaceQueries.all(),
        });
      }, INVALIDATE_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timeout);
      unlisten();
    };
  }, [enabled, queryClient]);
}
