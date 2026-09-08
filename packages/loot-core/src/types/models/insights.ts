import type { AccountEntity } from './account';
import type { CategoryEntity } from './category';
import type { PayeeEntity } from './payee';
import type { ScheduleEntity } from './schedule';
import type { TransactionEntity } from './transaction';

/**
 * Structured observations about a budget, computed read-only from data that is
 * already in the file.
 *
 * Deliberately carries **no user-facing English**. loot-core has no i18n, so an
 * insight is a `kind` discriminant plus numbers, ids and ISO dates; the client
 * maps `kind` to a translated sentence. This mirrors how
 * `TemplateNotificationMessage` is rendered by
 * `translateBudgetTemplateNotification` in the desktop client.
 *
 * Every amount is in integer minor units. Every percentage is a pre-rounded
 * integer, because the client's `format(v, 'percentage')` only appends `%` —
 * rounding belongs here, where it can be tested.
 */

export type InsightSeverity = 'critical' | 'warning' | 'info';

/** Deep-link target. `subjects[0]` is the primary subject. */
export type InsightSubject =
  | { type: 'account'; id: AccountEntity['id'] }
  | { type: 'category'; id: CategoryEntity['id'] }
  | { type: 'payee'; id: PayeeEntity['id'] }
  | { type: 'schedule'; id: ScheduleEntity['id'] }
  | { type: 'transaction'; id: TransactionEntity['id'] }
  | { type: 'month'; id: string }
  | { type: 'uncategorized' };

/** How often a payee series or schedule recurs. */
export type RecurrenceCadence =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'annual';

type InsightBase<Kind extends string, Data> = {
  kind: Kind;
  /**
   * Stable identity, `${kind}:${primarySubjectId}`. A dismissal is keyed on
   * this, so it survives recomputation.
   */
  id: string;
  /**
   * Hash of the *facts* that produced this insight. A dismissal is only honoured
   * while the fingerprint still matches, so a changed fact resurfaces the
   * insight on its own. Amounts inside a fingerprint are bucketed (see
   * `scale.ts#bucket`) so a one-cent wobble does not resurrect a dismissal.
   */
  fingerprint: string;
  severity: InsightSeverity;
  /** 0..1, deliberately comparable across kinds. Ranking only. */
  score: number;
  subjects: InsightSubject[];
  /** The calendar date this is about, or null. Drives urgency sorting. */
  date: string | null;
  /** Signed minor units this insight is "worth", or null. */
  amount: number | null;
  /**
   * Latest moment this insight can still be true, ISO date. A snooze is capped
   * by it, because there is no point holding a snooze past the point the fact
   * stops applying.
   */
  expiresAt: string | null;
  data: Data;
};

export type LowBalanceInsight = InsightBase<
  'low-balance',
  {
    accountId: AccountEntity['id'];
    accountName: string;
    /** The floor being crossed, minor units. */
    threshold: number;
    thresholdSource: 'user' | 'derived';
    projectedBalance: number;
    daysAway: number;
    /** True when the account is already under the threshold today. */
    alreadyBelow: boolean;
  }
>;

export type NegativeBalanceInsight = InsightBase<
  'negative-balance',
  {
    accountId: AccountEntity['id'];
    accountName: string;
    /** Always < 0. */
    projectedBalance: number;
    /** -projectedBalance, positive minor units. */
    shortfall: number;
    daysAway: number;
    /** Next projected material inflow, or null when none is in the horizon. */
    nextIncomeDate: string | null;
    daysUntilIncome: number | null;
    /** True when income does not arrive before the negative day. */
    incomeArrivesTooLate: boolean;
  }
>;

export type CategoryOverspendRiskInsight = InsightBase<
  'category-overspend-risk',
  {
    categoryId: CategoryEntity['id'];
    categoryName: string;
    month: string;
    /** `leftover-<cat>` today. Includes carryover. */
    available: number;
    spentSoFar: number;
    /** Unposted schedule occurrences left this month. */
    scheduledRemaining: number;
    /** Discretionary run-rate projection for the rest of the month. */
    paceRemaining: number;
    /** scheduledRemaining + paceRemaining - available. Always > 0. */
    projectedOverspend: number;
    /**
     * 'scheduled' needs no run-rate: the remaining bills alone exceed the
     * balance, which is arithmetic rather than a projection. The client words
     * the two cases differently.
     */
    basis: 'scheduled' | 'pace';
    daysRemaining: number;
  }
>;

export type SpendingPaceInsight = InsightBase<
  'spending-pace',
  {
    categoryId: CategoryEntity['id'];
    categoryName: string;
    month: string;
    spentToDate: number;
    /** Median historical spend through this point in the month. */
    expectedToDate: number;
    /** Signed integer percent. */
    pacePct: number;
    direction: 'above' | 'below';
    /** Complete months of history the median was taken over. */
    basisMonths: number;
  }
>;

export type UpcomingCommitmentsInsight = InsightBase<
  'upcoming-commitments',
  {
    /** Scheduled outflows in (today, nextIncomeDate). */
    count: number;
    /** Positive minor units. */
    total: number;
    scheduleIds: ScheduleEntity['id'][];
    nextIncomeDate: string;
    daysUntilIncome: number;
    /** Combined current balance of the in-scope accounts. */
    available: number;
    /** available / total, rounded to 2dp. < 1 means the money is not there. */
    coverageRatio: number;
    accountIds: AccountEntity['id'][];
  }
>;

export type MonthEndProjectionInsight = InsightBase<
  'month-end-projection',
  {
    month: string;
    /** Sum of positive projected remainders. */
    surplus: number;
    /** Sum of |negative projected remainders|. */
    deficit: number;
    /** surplus - deficit. */
    net: number;
    /** Categories contributing to `surplus`. */
    categoryCount: number;
    /** Largest contributors, at most three, for "across these categories". */
    topCategoryIds: CategoryEntity['id'][];
    daysRemaining: number;
  }
>;

export type UnderfundedCategoryInsight = InsightBase<
  'underfunded-category',
  {
    categoryId: CategoryEntity['id'];
    categoryName: string;
    month: string;
    targetMonth: string;
    monthsRemaining: number;
    totalTargetAmount: number;
    savedTowardTarget: number;
    /** totalTargetAmount - savedTowardTarget. */
    stillNeeded: number;
    requiredPerMonth: number;
    budgetedThisMonth: number;
    /** requiredPerMonth - budgetedThisMonth. Always > 0. The "another $46". */
    shortfallPerMonth: number;
    /** True when the category has never been funded in the basis window. */
    neverFunded: boolean;
  }
>;

export type BillIncreaseInsight = InsightBase<
  'bill-increase',
  {
    payeeId: PayeeEntity['id'];
    payeeName: string;
    transactionId: TransactionEntity['id'];
    /** Positive minor units. */
    latestAmount: number;
    /** Median of the preceding occurrences, excluding `latestAmount`. */
    trailingMedian: number;
    /** Integer percent, > 0. */
    deltaPct: number;
    latestDate: string;
    occurrences: number;
    cadence: RecurrenceCadence;
  }
>;

export type SubscriptionChangeInsight = InsightBase<
  'subscription-change',
  {
    payeeId: PayeeEntity['id'];
    payeeName: string;
    /** Exact prices, positive minor units. Deliberately not bucketed. */
    oldAmount: number;
    newAmount: number;
    /** Signed integer percent. */
    deltaPct: number;
    direction: 'increase' | 'decrease';
    changedOn: string;
    priorRunLength: number;
    newRunLength: number;
    cadence: RecurrenceCadence;
    /** (newAmount - oldAmount) * occurrencesPerYear. Drives the score. */
    annualizedDelta: number;
  }
>;

export type PossibleDuplicateInsight = InsightBase<
  'possible-duplicate',
  {
    /** Exactly two, sorted by id so the fingerprint is stable. */
    transactionIds: [TransactionEntity['id'], TransactionEntity['id']];
    payeeId: PayeeEntity['id'];
    payeeName: string;
    accountId: AccountEntity['id'];
    /** Identical on both rows, signed minor units. */
    chargeAmount: number;
    dates: [string, string];
    daysApart: 0 | 1;
    /** Fraction of this payee's active days that already carry >1 charge. */
    payeeRepeatRate: number;
    /** True when neither row came from a bank import. */
    bothManual: boolean;
  }
>;

export type MissingRecurringInsight = InsightBase<
  'missing-recurring',
  {
    source: 'schedule' | 'series';
    scheduleId: ScheduleEntity['id'] | null;
    scheduleName: string | null;
    payeeId: PayeeEntity['id'] | null;
    payeeName: string | null;
    expectedDate: string;
    daysLate: number;
    /** Signed: positive for an expected inflow. */
    expectedAmount: number;
    isIncome: boolean;
    cadence: RecurrenceCadence;
    /** Days late before we speak up, so the UI can explain itself. */
    toleranceDays: number;
  }
>;

export type UnusualTransactionInsight = InsightBase<
  'unusual-transaction',
  {
    transactionId: TransactionEntity['id'];
    payeeId: PayeeEntity['id'] | null;
    payeeName: string | null;
    categoryId: CategoryEntity['id'] | null;
    categoryName: string | null;
    /** Signed minor units. */
    chargeAmount: number;
    txDate: string;
    /** Which distribution the comparison used. */
    basis: 'payee' | 'category';
    /** Median |amount| of that distribution. */
    typicalAmount: number;
    /** |amount| / typicalAmount, rounded to 1dp. */
    ratio: number;
    /** Robust z: (|amt| - median) / (1.4826 * MAD). */
    z: number;
    sampleSize: number;
  }
>;

export type TrendChangeInsight = InsightBase<
  'trend-change',
  {
    categoryId: CategoryEntity['id'];
    categoryName: string;
    direction: 'up' | 'down';
    /**
     * 'run' is N consecutive moves in one direction. 'level-shift' is a step
     * change that a monotone-run test misses because the series is flat, then
     * flat at a new level.
     */
    pattern: 'run' | 'level-shift';
    /** Consecutive months for 'run'; window size for 'level-shift'. */
    months: number;
    fromAmount: number;
    toAmount: number;
    /** Signed integer percent. */
    changePct: number;
    /** Last complete month in the series. */
    throughMonth: string;
    basisMonths: number;
  }
>;

export type IncomeVolatilityInsight = InsightBase<
  'income-volatility',
  {
    /**
     * Robust coefficient of variation as an integer percent:
     * 1.4826 * MAD(income) / median(income) * 100. Robust rather than
     * stddev-based, so one annual bonus does not manufacture a warning.
     */
    cvPct: number;
    medianIncome: number;
    minIncome: number;
    maxIncome: number;
    basisMonths: number;
    throughMonth: string;
  }
>;

export type DataQualityIssue =
  | 'uncategorized'
  | 'uncleared-stale'
  | 'future-dated';

export type DataQualityInsight = InsightBase<
  'data-quality',
  {
    issue: DataQualityIssue;
    count: number;
    /** Sum of |amount| over the affected rows. */
    totalAmount: number;
    /** At most five, for a "show me" link. */
    sampleTransactionIds: TransactionEntity['id'][];
    windowDays: number;
  }
>;

export type StaleScheduleInsight = InsightBase<
  'stale-schedule',
  {
    scheduleId: ScheduleEntity['id'];
    scheduleName: string | null;
    payeeId: PayeeEntity['id'] | null;
    payeeName: string | null;
    pattern: 'unmatched-run' | 'overdue-one-time';
    /** Trailing occurrences with no matching transaction. */
    consecutiveUnmatched: number;
    occurrenceDates: string[];
    lastMatchedDate: string | null;
    expectedAmount: number;
    postsTransaction: boolean;
  }
>;

export type Insight =
  | LowBalanceInsight
  | NegativeBalanceInsight
  | CategoryOverspendRiskInsight
  | SpendingPaceInsight
  | UpcomingCommitmentsInsight
  | MonthEndProjectionInsight
  | UnderfundedCategoryInsight
  | BillIncreaseInsight
  | SubscriptionChangeInsight
  | PossibleDuplicateInsight
  | MissingRecurringInsight
  | UnusualTransactionInsight
  | TrendChangeInsight
  | IncomeVolatilityInsight
  | DataQualityInsight
  | StaleScheduleInsight;

export type InsightKind = Insight['kind'];

/** Why a detector produced nothing, so the card can say so instead of guessing. */
export type InsightUnavailableReason =
  | 'insufficient-history'
  | 'no-schedules'
  | 'no-forecast'
  | 'no-targets'
  | 'disabled';

export type InsightsResult = {
  /** The day every relative phrase in the UI is relative to. */
  asOf: string;
  month: string;
  insights: Insight[];
  /** Produced then dropped by caps, so the card can be honest about it. */
  suppressedByKind: Partial<Record<InsightKind, number>>;
  unavailable: Partial<Record<InsightKind, InsightUnavailableReason>>;
  truncated: { transactions: boolean };
};

export type InsightsParams = {
  /** Overridable so tests never touch the clock. */
  today?: string;
  month?: string;
  accountIds?: AccountEntity['id'][];
  /** How far the balance projection looks ahead. Default 90. */
  horizonDays?: number;
  /** Transaction history window. Default 13. */
  historyMonths?: number;
  /** Hard cap on returned insights. Default 12. */
  maxInsights?: number;
  /** Absent means every kind. */
  kinds?: InsightKind[];
  /** User-set floors, minor units, keyed by account id. */
  lowBalanceThresholds?: Record<AccountEntity['id'], number>;
};
