import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Insight } from '@actual-app/core/types/models/insights';

import { useSyncedPref } from '#hooks/useSyncedPref';

import type { DismissalEntry } from './dismissals';
import {
  addDismissal,
  indexDismissals,
  isSuppressed,
  nowSeconds,
  parseDismissals,
  pruneDismissals,
  removeDismissal,
  serializeDismissals,
} from './dismissals';

const WRITE_DEBOUNCE_MS = 300;

/**
 * Reads and writes the snooze set.
 *
 * The write is debounced so that snoozing several rows in a row produces one
 * sync message rather than five, and pruning happens on write only — pruning on
 * read would mean merely opening the Reports page emits a preference write.
 */
export function useInsightDismissals() {
  const [raw, setRaw] = useSyncedPref('fork.insights.dismissals');
  const [pending, setPending] = useState<DismissalEntry[] | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stored = useMemo(() => parseDismissals(raw), [raw]);
  const entries = pending ?? stored;
  const byId = useMemo(() => indexDismissals(entries), [entries]);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const commit = useCallback(
    (next: DismissalEntry[]) => {
      const pruned = pruneDismissals(next, nowSeconds());
      setPending(pruned);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => {
        setRaw(serializeDismissals(pruned));
        setPending(null);
      }, WRITE_DEBOUNCE_MS);
    },
    [setRaw],
  );

  const dismiss = useCallback(
    (insight: Insight) => commit(addDismissal(entries, insight, nowSeconds())),
    [commit, entries],
  );

  const restore = useCallback(
    (insightId: string) => commit(removeDismissal(entries, insightId)),
    [commit, entries],
  );

  const restoreAll = useCallback(() => commit([]), [commit]);

  const suppressed = useCallback(
    (insight: Insight) => isSuppressed(insight, byId, nowSeconds()),
    [byId],
  );

  return { suppressed, dismiss, restore, restoreAll, count: entries.length };
}
