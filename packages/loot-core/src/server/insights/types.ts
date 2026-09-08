import type { ForecastDataPoint } from '#types/models/forecast';
import type {
  Insight,
  InsightKind,
  InsightUnavailableReason,
  RecurrenceCadence,
} from '#types/models/insights';
import type { CategoryTargetProjection } from '#types/models/targets';

/**
 * Everything the detectors read, gathered once.
 *
 * This type is pure data on purpose. A detector receives no db handle, no
 * `send`, and no sheet reference, so it *cannot* write — it has nothing to write
 * with. That is the structural half of the read-only guarantee (`FORK.md` rule
 * 8); `read-only.test.ts` is the other half.
 *
 * It is also why every detector is trivially testable: build one of these with
 * `Partial` overrides, call `detect`, assert. No DB harness, no mocks.
 */

export type InsightAccount = {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  /** Current cleared+uncleared balance, minor units. */
  balance: number;
};

export type InsightCategory = {
  id: string;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  groupId: string | null;
};

export type InsightTxn = {
  id: string;
  date: string;
  /** Signed minor units. Negative is an expense. */
  amount: number;
  payeeId: string | null;
  categoryId: string | null;
  accountId: string;
  /** Non-null when a schedule already claimed this transaction. */
  scheduleId: string | null;
  /** Non-null when it arrived from a bank import. */
  importedId: string | null;
  cleared: boolean;
  isParent: boolean;
};

/** One month of budget figures, read from the sheet. */
export type InsightMonth = {
  month: string;
  income: number;
  /** Signed as the sheet stores it: negative for spending. */
  spent: number;
  byCategory: Record<
    string,
    {
      budgeted: number;
      /** Negative for an expense, as `sum-amount-<cat>` stores it. */
      sumAmount: number;
      /** `leftover-<cat>`: what is still available. */
      leftover: number;
      carryover: boolean;
    }
  >;
};

export type InsightSchedule = {
  id: string;
  name: string | null;
  nextDate: string | null;
  /** Signed minor units, already resolved through `getScheduledAmount`. */
  amount: number;
  accountId: string | null;
  payeeId: string | null;
  categoryId: string | null;
  completed: boolean;
  postsTransaction: boolean;
  isRecurring: boolean;
  cadence: RecurrenceCadence | null;
  /** From `getStatus` in `#shared/schedules`. */
  status: string;
  /** Occurrence dates at or before `today`, newest last. */
  pastOccurrences: string[];
  /** True when this schedule has ever matched a transaction. */
  everMatched: boolean;
  /** Trailing occurrences with no matching transaction. */
  consecutiveUnmatched: number;
  lastMatchedDate: string | null;
};

/** A future scheduled movement, taken from the forecast. */
export type InsightOccurrence = {
  scheduleId: string;
  date: string;
  /** Signed minor units. */
  amount: number;
  accountId: string;
  categoryId: string | null;
};

/**
 * A payee's recurring transaction stream. Built once from the single transaction
 * pull, grouped by `(payeeId, sign)` so a refund stream cannot pollute a bill
 * stream.
 */
export type PayeeSeries = {
  key: string;
  payeeId: string;
  payeeName: string;
  sign: 1 | -1;
  /** Set when every occurrence links to the same schedule. */
  scheduleId: string | null;
  /** Oldest first. */
  occurrences: { id: string; date: string; amount: number }[];
  medianGapDays: number;
  gapMad: number;
  cadence: RecurrenceCadence;
  regular: boolean;
  expectedNextDate: string;
};

/**
 * The file's own sense of "how big is a number here", in minor units. Every
 * absolute floor derives from this rather than from a currency literal.
 */
export type InsightScale = {
  /** Robust monthly throughput. */
  month: number;
  /** Median |amount| of an ordinary recent transaction. */
  txn: number;
  /** The global materiality floor. */
  floor: number;
  /** Median monthly spend per category. */
  byCategory: Record<string, number>;
};

export type InsightContext = {
  /** Never read the clock inside a detector; read this. */
  today: string;
  month: string;
  dayOfMonth: number;
  daysInMonth: number;
  daysElapsed: number;
  daysRemaining: number;

  accounts: InsightAccount[];
  categories: InsightCategory[];
  payeeNames: Record<string, string>;

  schedules: InsightSchedule[];
  /** Future occurrences inside the forecast horizon. */
  occurrences: InsightOccurrence[];

  forecastByAccount: Record<string, ForecastDataPoint[]>;
  /** Next material projected inflow, or null. */
  nextIncome: { date: string; amount: number; accountId: string } | null;
  horizonEnd: string;

  /** Complete months only, oldest first. */
  months: InsightMonth[];
  /** The in-progress month, kept apart so it cannot pollute a trend. */
  currentMonth: InsightMonth;
  /**
   * Resolved bounds of real budget data. Reading a sheet cell outside this
   * silently returns 0 rather than "missing", which would fabricate a collapse
   * in spending; every historical window is clamped to it.
   */
  monthsAvailable: { first: string; last: string };

  txns: InsightTxn[];
  /** `${categoryId}:${month}` -> cumulative spend by day index (1-based). */
  cumulativeByCategoryMonth: Record<string, number[]>;
  series: PayeeSeries[];

  targets: CategoryTargetProjection[] | null;

  scale: InsightScale;
  truncated: { transactions: boolean };
};

export type ResolvedInsightsConfig = {
  horizonDays: number;
  historyMonths: number;
  maxInsights: number;
  kinds: Set<InsightKind>;
  lowBalanceThresholds: Record<string, number>;
};

export type Detector = {
  kind: InsightKind;
  /** Most items this detector may contribute before global ranking. */
  cap: number;
  /** Kinds this detector's output outranks when they describe the same thing. */
  supersedes?: readonly InsightKind[];
  /** Pure and synchronous. No db, no aql, no sheet, no clock. */
  detect(
    ctx: InsightContext,
    cfg: ResolvedInsightsConfig,
  ): Insight[] | { insights: Insight[]; unavailable: InsightUnavailableReason };
};
