import type {
  Insight,
  InsightSeverity,
} from '@actual-app/core/types/models/insights';

/**
 * Snoozing an insight.
 *
 * "Dismiss" would be the wrong word for what this does, and the UI says
 * "Snooze" for that reason: an insight comes back the moment its facts change,
 * and otherwise after a severity-dependent backstop. Both halves matter. A
 * permanent dismissal would hide a projected overdraft that has since got worse;
 * a purely time-based snooze would keep re-raising something the user has
 * consciously accepted.
 *
 * The set lives in the synced preference `fork.insights.dismissals` rather than
 * in the widget's `dashboard.meta`. Three reasons, the first decisive:
 *
 *  1. `Overview.tsx`'s export writes every widget's `meta` into a downloadable
 *     `dashboard.json`, and copy-to-dashboard duplicates it. Dismissals in
 *     `meta` would carry "I hid the low-balance warning on my Checking account"
 *     into a file people paste into bug reports.
 *  2. A dismissal is a statement about a *fact*, not about a card, so two
 *     Insights cards on two dashboards must agree — and it should survive
 *     removing and re-adding the widget.
 *  3. `preferences` is one row per key, so a snooze cannot collide with the
 *     layout write that a drag produces. Both are last-write-wins rows on
 *     `dashboard` otherwise.
 *
 * `FORK.md` rule 4 nominates the `preferences` store as the sanctioned channel
 * for synced fork-only data, and unknown keys are inert in a vanilla client.
 */

export type DismissalEntry = {
  /** The insight's stable id, `${kind}:${subject}`. */
  i: string;
  /** Fingerprint of the facts that were dismissed. */
  f: string;
  /** Hidden until this instant, epoch **seconds**. */
  u: number;
};

type DismissalStore = {
  v: 1;
  d: DismissalEntry[];
};

const DAY_SECONDS = 86_400;

/**
 * How long a snooze lasts when the facts do not change.
 *
 * A stale snooze on a cash-flow warning is actively harmful, so critical items
 * come back quickly: long enough not to nag on consecutive daily check-ins,
 * short enough that a still-true overdraft warning returns before the overdraft.
 */
const BACKSTOP_DAYS: Record<InsightSeverity, number> = {
  critical: 3,
  warning: 14,
  info: 30,
};

/** Keeps the synced string bounded regardless of what pruning misses. */
export const MAX_ENTRIES = 200;

export function parseDismissals(
  raw: string | undefined | null,
): DismissalEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DismissalStore>;
    if (!Array.isArray(parsed?.d)) {
      return [];
    }
    return parsed.d.filter(
      (entry): entry is DismissalEntry =>
        typeof entry?.i === 'string' &&
        typeof entry?.f === 'string' &&
        typeof entry?.u === 'number',
    );
  } catch {
    // A malformed value should cost the user their snoozes, not the whole card.
    return [];
  }
}

export function serializeDismissals(entries: DismissalEntry[]): string {
  return JSON.stringify({ v: 1, d: entries } satisfies DismissalStore);
}

export function indexDismissals(
  entries: DismissalEntry[],
): Map<string, DismissalEntry> {
  return new Map(entries.map(entry => [entry.i, entry]));
}

/**
 * When a snooze on this insight should lapse.
 *
 * The server's `expiresAt` wins when it is sooner: there is no point holding a
 * snooze past the point the fact stops being true.
 */
export function expiryFor(insight: Insight, nowSeconds: number): number {
  const backstop = nowSeconds + BACKSTOP_DAYS[insight.severity] * DAY_SECONDS;

  const serverExpiry =
    insight.expiresAt === null
      ? Number.POSITIVE_INFINITY
      : Math.floor(Date.parse(`${insight.expiresAt}T23:59:59Z`) / 1000);

  const chosen = Math.min(backstop, serverExpiry);
  // Never snooze for less than a day; otherwise the click achieves nothing.
  return Math.max(chosen, nowSeconds + DAY_SECONDS);
}

/**
 * All three clauses must hold. The fingerprint check is what makes a changed
 * fact resurface immediately: a shortfall that grew from $74 to $210 is new
 * information, even though the user dismissed "the same" insight yesterday.
 */
export function isSuppressed(
  insight: Insight,
  byId: Map<string, DismissalEntry>,
  nowSeconds: number,
): boolean {
  const entry = byId.get(insight.id);
  return (
    entry !== undefined &&
    entry.f === insight.fingerprint &&
    nowSeconds < entry.u
  );
}

/**
 * Adds or replaces a snooze. Keyed on the insight id, so re-snoozing after a
 * fact change replaces the stale entry rather than accumulating beside it.
 */
export function addDismissal(
  entries: DismissalEntry[],
  insight: Insight,
  nowSeconds: number,
): DismissalEntry[] {
  const next = entries.filter(entry => entry.i !== insight.id);
  next.push({
    i: insight.id,
    f: insight.fingerprint,
    u: expiryFor(insight, nowSeconds),
  });
  return next;
}

export function removeDismissal(
  entries: DismissalEntry[],
  insightId: string,
): DismissalEntry[] {
  return entries.filter(entry => entry.i !== insightId);
}

/**
 * Trims the set. Run on **write only** — pruning on read would make merely
 * looking at the card emit a sync message.
 */
export function pruneDismissals(
  entries: DismissalEntry[],
  nowSeconds: number,
): DismissalEntry[] {
  return entries
    .filter(entry => entry.u > nowSeconds)
    .sort((a, b) => b.u - a.u)
    .slice(0, MAX_ENTRIES);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
