import type {
  Insight,
  InsightKind,
  InsightSeverity,
} from '#types/models/insights';

import type { InsightContext, InsightMonth, InsightScale } from './types';

/**
 * Builders for tests only.
 *
 * Every detector is a pure function of an `InsightContext`, so a test builds one
 * of these with `Partial` overrides and asserts on the result. No database, no
 * mocks, no clock — `ctx.today` is just a field.
 */

export const TEST_TODAY = '2026-09-15';
export const TEST_MONTH = '2026-09';

export function makeScale(overrides: Partial<InsightScale> = {}): InsightScale {
  return {
    month: 500_000,
    txn: 4_000,
    // max(0.005 * 500000, 0.5 * 4000) = max(2500, 2000) = 2500
    floor: 2_500,
    byCategory: {},
    ...overrides,
  };
}

export function makeMonth(
  month: string,
  overrides: Partial<InsightMonth> = {},
): InsightMonth {
  return {
    month,
    income: 500_000,
    spent: -450_000,
    byCategory: {},
    ...overrides,
  };
}

export function makeContext(
  overrides: Partial<InsightContext> = {},
): InsightContext {
  const currentMonth = overrides.currentMonth ?? makeMonth(TEST_MONTH);

  return {
    today: TEST_TODAY,
    month: TEST_MONTH,
    dayOfMonth: 15,
    daysInMonth: 30,
    daysElapsed: 15,
    daysRemaining: 15,

    accounts: [],
    categories: [],
    payeeNames: {},

    schedules: [],
    occurrences: [],

    forecastByAccount: {},
    nextIncome: null,
    horizonEnd: '2026-12-14',

    months: [],
    currentMonth,
    monthsAvailable: { first: '2025-09', last: TEST_MONTH },

    txns: [],
    cumulativeByCategoryMonth: {},
    series: [],

    targets: null,

    scale: makeScale(),
    truncated: { transactions: false },
    ...overrides,
  };
}

/**
 * A minimal, kind-agnostic insight for ranking tests. `data` is deliberately
 * cast: ranking never reads it, and building a real payload for each of sixteen
 * kinds would obscure what these tests are actually about.
 */
export function makeInsight({
  kind,
  id,
  severity = 'warning',
  score = 0.5,
  date = null,
  amount = null,
  fingerprint,
  data = {},
}: {
  kind: InsightKind;
  id?: string;
  severity?: InsightSeverity;
  score?: number;
  date?: string | null;
  amount?: number | null;
  fingerprint?: string;
  data?: Record<string, unknown>;
}): Insight {
  const resolvedId = id ?? `${kind}:x`;
  return {
    kind,
    id: resolvedId,
    fingerprint: fingerprint ?? `${resolvedId}:fp`,
    severity,
    score,
    subjects: [],
    date,
    amount,
    expiresAt: null,
    data,
  } as unknown as Insight;
}
