import * as monthUtils from '#shared/months';
import type {
  Insight,
  InsightKind,
  InsightSeverity,
} from '#types/models/insights';

/**
 * Turning what the detectors found into what the card shows.
 *
 * Caps, supersession and ordering live together on purpose: they interact. A
 * superseded item must not consume a diversity slot, and a capped item must
 * still be counted so the card can be honest about what it is not showing.
 * Splitting them across modules invites a bug at the seam.
 */

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 2,
  warning: 1,
  info: 0,
};

/**
 * Stable presentation order within a severity band, used as a tie-break. Roughly
 * "money about to go wrong" before "money trending wrong" before "housekeeping".
 */
export const KIND_ORDER: readonly InsightKind[] = [
  'negative-balance',
  'low-balance',
  'category-overspend-risk',
  'upcoming-commitments',
  'missing-recurring',
  'possible-duplicate',
  'underfunded-category',
  'spending-pace',
  'subscription-change',
  'bill-increase',
  'unusual-transaction',
  'stale-schedule',
  'trend-change',
  'month-end-projection',
  'income-volatility',
  'data-quality',
];

type SupersessionRule = {
  winner: InsightKind;
  loser: InsightKind;
  /** True when these two are describing the same thing. */
  conflicts: (winner: Insight, loser: Insight) => boolean;
};

/**
 * Pairs that would otherwise put two rows on the card saying the same thing.
 *
 * The more specific statement wins. "Your subscription went from $9.99 to
 * $12.99" is strictly more useful than "this bill is 30% above its median", so
 * the former suppresses the latter rather than both appearing.
 */
const SUPERSESSION_RULES: readonly SupersessionRule[] = [
  {
    /**
     * A projected overdraft is the thing to act on, and it makes a warning about
     * merely being low on the same account redundant — even when the low-balance
     * crossing comes first, since the overdraft date is what matters.
     *
     * The exception is a threshold the *user* set. If they asked to hear when
     * Checking drops below a specific figure, suppressing that is overriding an
     * explicit instruction; a threshold we derived ourselves carries no such
     * promise. This mirrors the same distinction the detector makes when
     * deciding whether to apply a materiality floor.
     */
    winner: 'negative-balance',
    loser: 'low-balance',
    conflicts: (w, l) =>
      w.kind === 'negative-balance' &&
      l.kind === 'low-balance' &&
      w.data.accountId === l.data.accountId &&
      l.data.thresholdSource === 'derived',
  },
  {
    // "will exceed its balance" subsumes "is running above pace".
    winner: 'category-overspend-risk',
    loser: 'spending-pace',
    conflicts: (w, l) =>
      w.kind === 'category-overspend-risk' &&
      l.kind === 'spending-pace' &&
      w.data.categoryId === l.data.categoryId &&
      w.data.month === l.data.month,
  },
  {
    winner: 'subscription-change',
    loser: 'bill-increase',
    conflicts: (w, l) =>
      w.kind === 'subscription-change' &&
      l.kind === 'bill-increase' &&
      w.data.payeeId === l.data.payeeId,
  },
  {
    // Chronically unmatched outranks "this one is late".
    winner: 'stale-schedule',
    loser: 'missing-recurring',
    conflicts: (w, l) =>
      w.kind === 'stale-schedule' &&
      l.kind === 'missing-recurring' &&
      l.data.scheduleId !== null &&
      w.data.scheduleId === l.data.scheduleId,
  },
  {
    // Ground truth beats inference: a schedule knows more than a payee series.
    winner: 'missing-recurring',
    loser: 'missing-recurring',
    conflicts: (w, l) =>
      w.kind === 'missing-recurring' &&
      l.kind === 'missing-recurring' &&
      w.data.source === 'schedule' &&
      l.data.source === 'series' &&
      w.data.payeeId !== null &&
      w.data.payeeId === l.data.payeeId,
  },
  {
    // A duplicate pair explains why one of them looks unusually large.
    winner: 'possible-duplicate',
    loser: 'unusual-transaction',
    conflicts: (w, l) =>
      w.kind === 'possible-duplicate' &&
      l.kind === 'unusual-transaction' &&
      w.data.transactionIds.includes(l.data.transactionId),
  },
];

export function applySupersession(insights: Insight[]): {
  kept: Insight[];
  suppressed: Insight[];
} {
  const suppressedIds = new Set<string>();

  for (const rule of SUPERSESSION_RULES) {
    const winners = insights.filter(i => i.kind === rule.winner);
    if (winners.length === 0) {
      continue;
    }
    for (const loser of insights) {
      if (loser.kind !== rule.loser || suppressedIds.has(loser.id)) {
        continue;
      }
      const beaten = winners.some(
        w => w.id !== loser.id && rule.conflicts(w, loser),
      );
      if (beaten) {
        suppressedIds.add(loser.id);
      }
    }
  }

  return {
    kept: insights.filter(i => !suppressedIds.has(i.id)),
    suppressed: insights.filter(i => suppressedIds.has(i.id)),
  };
}

/** Days from `today` to the insight's date; far future when it has none. */
function urgencyKey(insight: Insight, today: string): number {
  if (insight.date === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  return monthUtils.differenceInCalendarDays(insight.date, today);
}

/**
 * A **total** order. The final fingerprint tie-break is not cosmetic: without
 * it, two equal-scoring rows can swap places between renders, the card visibly
 * flickers, and a user aiming at a snooze button hits the wrong row.
 */
export function compareInsights(a: Insight, b: Insight, today: string): number {
  const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severity !== 0) {
    return severity;
  }

  if (b.score !== a.score) {
    return b.score - a.score;
  }

  const urgency = urgencyKey(a, today) - urgencyKey(b, today);
  if (urgency !== 0) {
    return urgency;
  }

  const amount = Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0);
  if (amount !== 0) {
    return amount;
  }

  const kindOrder = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (kindOrder !== 0) {
    return kindOrder;
  }

  return a.fingerprint < b.fingerprint
    ? -1
    : a.fingerprint > b.fingerprint
      ? 1
      : 0;
}

export function sortInsights(insights: Insight[], today: string): Insight[] {
  return [...insights].sort((a, b) => compareInsights(a, b, today));
}

/** Keeps at most `cap` of each kind, by rank. */
export function capPerKind(
  insights: Insight[],
  caps: Record<InsightKind, number>,
  today: string,
): { kept: Insight[]; dropped: Insight[] } {
  const sorted = sortInsights(insights, today);
  const counts = new Map<InsightKind, number>();
  const kept: Insight[] = [];
  const dropped: Insight[] = [];

  for (const insight of sorted) {
    const seen = counts.get(insight.kind) ?? 0;
    if (seen < (caps[insight.kind] ?? Number.MAX_SAFE_INTEGER)) {
      counts.set(insight.kind, seen + 1);
      kept.push(insight);
    } else {
      dropped.push(insight);
    }
  }

  return { kept, dropped };
}

/**
 * Fills the visible slots, preferring variety.
 *
 * A first pass admits at most a quarter of the slots from any one kind, so nine
 * at-risk accounts cannot fill the card with low-balance warnings while a
 * subscription hike waits behind them. Anything passed over then backfills the
 * slots the first pass left empty, so variety never costs a slot.
 */
export function selectWithDiversity(
  sorted: Insight[],
  maxInsights: number,
): { visible: Insight[]; dropped: Insight[] } {
  if (maxInsights <= 0) {
    return { visible: [], dropped: [...sorted] };
  }

  const perKindLimit = Math.max(1, Math.ceil(maxInsights / 4));
  const counts = new Map<InsightKind, number>();
  const visible: Insight[] = [];
  const spill: Insight[] = [];

  for (const insight of sorted) {
    if (visible.length >= maxInsights) {
      spill.push(insight);
      continue;
    }
    const seen = counts.get(insight.kind) ?? 0;
    if (seen < perKindLimit) {
      counts.set(insight.kind, seen + 1);
      visible.push(insight);
    } else {
      spill.push(insight);
    }
  }

  const dropped: Insight[] = [];
  for (const insight of spill) {
    if (visible.length < maxInsights) {
      visible.push(insight);
    } else {
      dropped.push(insight);
    }
  }

  // Backfilling appends out of rank order, so restore it.
  return { visible, dropped };
}

export type RankResult = {
  visible: Insight[];
  suppressedByKind: Partial<Record<InsightKind, number>>;
};

/** Supersede, cap, sort, then fill. */
export function rankInsights({
  insights,
  caps,
  maxInsights,
  today,
}: {
  insights: Insight[];
  caps: Record<InsightKind, number>;
  maxInsights: number;
  today: string;
}): RankResult {
  const { kept: afterSupersession, suppressed } = applySupersession(insights);
  const { kept: afterCaps, dropped: cappedOut } = capPerKind(
    afterSupersession,
    caps,
    today,
  );
  const { visible, dropped } = selectWithDiversity(
    sortInsights(afterCaps, today),
    maxInsights,
  );

  const suppressedByKind: Partial<Record<InsightKind, number>> = {};
  for (const insight of [...suppressed, ...cappedOut, ...dropped]) {
    suppressedByKind[insight.kind] = (suppressedByKind[insight.kind] ?? 0) + 1;
  }

  return { visible: sortInsights(visible, today), suppressedByKind };
}
