import type { InsightsWidget } from '@actual-app/core/types/models';
import type {
  InsightKind,
  InsightSeverity,
} from '@actual-app/core/types/models/insights';

/** Static metadata about the insight kinds, shared by the list and the settings. */

/** Presentation grouping for the settings popover. */
export const KIND_GROUPS: { id: string; kinds: InsightKind[] }[] = [
  {
    id: 'cash-flow',
    kinds: [
      'negative-balance',
      'low-balance',
      'upcoming-commitments',
      'month-end-projection',
    ],
  },
  {
    id: 'budget',
    kinds: ['category-overspend-risk', 'spending-pace', 'underfunded-category'],
  },
  {
    id: 'bills',
    kinds: [
      'bill-increase',
      'subscription-change',
      'missing-recurring',
      'stale-schedule',
    ],
  },
  {
    id: 'transactions',
    kinds: ['possible-duplicate', 'unusual-transaction'],
  },
  {
    id: 'trends',
    kinds: ['trend-change', 'income-volatility', 'data-quality'],
  },
];

export const ALL_KINDS: InsightKind[] = KIND_GROUPS.flatMap(
  group => group.kinds,
);

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export const DEFAULT_MAX_ITEMS = 12;

export type ResolvedInsightsMeta = {
  mutedKinds: Set<InsightKind>;
  minSeverity: InsightSeverity;
  maxItems: number;
  accountIds: string[] | undefined;
  lowBalanceThresholds: Record<string, number>;
  horizonDays: number | undefined;
  showSnoozed: boolean;
};

export function resolveInsightsMeta(
  meta: InsightsWidget['meta'],
): ResolvedInsightsMeta {
  return {
    // Stored as an opt-*out* list, so a detector added in a later build shows up
    // automatically instead of being silently muted on every existing card.
    mutedKinds: new Set(meta?.mutedKinds ?? []),
    minSeverity: meta?.minSeverity ?? 'info',
    maxItems: meta?.maxItems ?? DEFAULT_MAX_ITEMS,
    accountIds:
      meta?.accountIds && meta.accountIds.length > 0
        ? meta.accountIds
        : undefined,
    lowBalanceThresholds: meta?.thresholds?.lowBalanceThresholds ?? {},
    horizonDays: meta?.thresholds?.horizonDays,
    showSnoozed: meta?.showSnoozed ?? false,
  };
}

export function meetsMinSeverity(
  severity: InsightSeverity,
  minSeverity: InsightSeverity,
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minSeverity];
}

/** The kinds to ask the server for, given what this card has muted. */
export function requestedKinds(
  mutedKinds: Set<InsightKind>,
): InsightKind[] | undefined {
  if (mutedKinds.size === 0) {
    return undefined;
  }
  return ALL_KINDS.filter(kind => !mutedKinds.has(kind));
}
