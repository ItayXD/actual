/**
 * Every detection threshold, in one place.
 *
 * Deliberately contains **no currency amount**. Amounts are integer minor units,
 * so a literal like `500` would mean $5.00, ¥500 and 5.00 EUR at once — and
 * would be wrong for a zero-decimal currency or a high-inflation one. Absolute
 * floors are derived from the file's own throughput instead; see `scale.ts`.
 *
 * `scale-invariance.test.ts` mechanically proves this: multiply every amount in
 * a fixture by 1000 and the same insights must come out. A currency literal
 * anywhere — including one hidden inside a ratio — fails that test.
 */

/** Fraction of a typical month that an amount must reach to be worth saying. */
export const FLOOR_MONTH_RATIO = 0.005;
/** ...or this fraction of a typical single transaction, whichever is larger. */
export const FLOOR_TXN_RATIO = 0.5;
/** A claim about a category must be worth this much of that category's norm. */
export const CATEGORY_FLOOR_RATIO = 0.1;

/** `magnitude()` saturates at this multiple of the floor. */
export const MAGNITUDE_SATURATION = 20;
/** `urgency()` reaches zero this many days out. */
export const URGENCY_HORIZON_DAYS = 60;
/** `recency()` reaches zero this many days back. */
export const RECENCY_HORIZON_DAYS = 45;

export const LOW_BALANCE = {
  /** Derived floor, as a fraction of a typical month, when the user sets none. */
  DERIVED_THRESHOLD_MONTH_RATIO: 0.25,
  CRITICAL_DAYS: 7,
  WARNING_DAYS: 30,
} as const;

export const NEGATIVE_BALANCE = {
  CRITICAL_DAYS: 14,
  /** An inflow must reach this fraction of a month to count as "income". */
  INCOME_MONTH_RATIO: 0.25,
} as const;

export const OVERSPEND = {
  /** Below this many days elapsed, a run-rate is untrustworthy. */
  MIN_DAYS_FOR_PACE: 5,
  /** Overspend beyond this fraction of the category norm is critical. */
  CRITICAL_CATEGORY_RATIO: 0.5,
} as const;

export const PACE = {
  MIN_BASIS_MONTHS: 3,
  MAX_BASIS_MONTHS: 6,
  /** Slots into which a month is normalised, so 28/30/31 compare. */
  SLOTS: 30,
  /** Below this slot the month is too young to judge. */
  MIN_SLOT: 7,
  MIN_PCT: 15,
  WARNING_PCT: 25,
  CRITICAL_PCT: 60,
} as const;

export const COMMITMENTS = {
  MIN_COUNT: 2,
  /** Above this coverage the money is plainly there; saying so is noise. */
  MAX_COVERAGE_RATIO: 1.5,
  WARNING_COVERAGE_RATIO: 1.25,
} as const;

export const MONTH_END = {
  MIN_DAYS_ELAPSED: 10,
  /** A whole-budget claim must clear a whole-budget bar. */
  NET_MONTH_RATIO: 0.01,
} as const;

export const UNDERFUNDED = {
  WARNING_MONTHS_REMAINING: 2,
} as const;

export const BILL_INCREASE = {
  MIN_OCCURRENCES: 4,
  MAX_BASELINE: 6,
  MIN_PCT: 10,
  WARNING_PCT: 20,
  CRITICAL_PCT: 50,
  MAX_AGE_DAYS: 45,
  /** The bill must have been stable before: MAD within this of its median. */
  MAX_PRIOR_MAD_RATIO: 0.05,
} as const;

export const SUBSCRIPTION = {
  MIN_PRIOR_RUN: 3,
  MAX_AGE_DAYS: 45,
  /** A price move this large is worth saying even below the global floor. */
  MIN_PCT: 5,
  WARNING_PCT: 10,
  /** ...but never below this fraction of a typical transaction. */
  MIN_DELTA_TXN_RATIO: 0.05,
} as const;

export const DUPLICATE = {
  WINDOW_DAYS: 45,
  MAX_DAYS_APART: 1,
  /**
   * A payee that routinely charges twice in a day is a coffee shop, not a
   * double-charge. This is the discriminator that makes the detector usable.
   */
  /**
   * Above this share of a payee's history being look-alike adjacent charges,
   * adjacency is that payee's normal behaviour rather than a fault.
   *
   * Set high deliberately. A payee that genuinely behaves this way — a daily
   * coffee at a fixed price — scores near 1.0, whereas an ordinary payee with
   * one or two coincidental adjacencies over a year scores well under 0.2. A low
   * bar here would suppress real duplicates at perfectly normal payees.
   */
  MAX_PAYEE_REPEAT_RATE: 0.4,
  /** Transactions needed before that share means anything at all. */
  MIN_HISTORY_FOR_HABIT: 6,
} as const;

export const MISSING_RECURRING = {
  MIN_OCCURRENCES: 4,
  /** Fraction of the cadence to wait before speaking up. */
  TOLERANCE_CADENCE_RATIO: 0.25,
  MIN_TOLERANCE_DAYS: 3,
  MAX_DAYS_LATE: 90,
  /** Beyond this the series is dead, not late. */
  ALIVE_CADENCE_MULTIPLE: 2,
  INCOME_CRITICAL_DAYS: 3,
  /** 3+ consecutive misses is chronic; that is `stale-schedule`. */
  MAX_SCHEDULE_MISSES: 2,
} as const;

export const UNUSUAL = {
  MIN_PAYEE_SAMPLE: 6,
  PAYEE_MIN_Z: 4,
  PAYEE_MIN_RATIO: 2,
  MIN_CATEGORY_SAMPLE: 20,
  CATEGORY_MIN_Z: 5,
  WARNING_Z: 6,
  MAX_AGE_DAYS: 30,
  /** Stops a perfectly constant payee producing z = infinity. */
  SIGMA_FLOOR_MEDIAN_RATIO: 0.05,
} as const;

export const TREND = {
  MIN_BASIS_MONTHS: 6,
  MAX_BASIS_MONTHS: 12,
  MIN_RUN: 3,
  /** Dead-band, so month-to-month jitter is not "increasing". */
  RUN_DEAD_BAND: 0.05,
  MIN_RUN_CHANGE_RATIO: 1.25,
  LEVEL_SHIFT_RECENT: 3,
  LEVEL_SHIFT_PRIOR: 6,
  LEVEL_SHIFT_RATIO: 1.4,
} as const;

export const INCOME_VOLATILITY = {
  BASIS_MONTHS: 6,
  MIN_CV_PCT: 20,
  WARNING_CV_PCT: 35,
} as const;

export const DATA_QUALITY = {
  UNCATEGORIZED_WINDOW_DAYS: 60,
  UNCATEGORIZED_MIN_COUNT: 3,
  /** Uncategorized spend past this fraction of a month really moves a forecast. */
  UNCATEGORIZED_WARNING_MONTH_RATIO: 0.02,
  UNCLEARED_MIN_AGE_DAYS: 30,
  UNCLEARED_MIN_COUNT: 3,
  MAX_SAMPLES: 5,
} as const;

export const STALE_SCHEDULE = {
  LOOKBACK_OCCURRENCES: 6,
  MIN_UNMATCHED: 3,
  ONE_TIME_OVERDUE_DAYS: 60,
  /** Schedules have no created_at, so a young one needs this many elapsed. */
  MIN_ELAPSED_FOR_UNPROVEN: 5,
} as const;

/**
 * Registry weights. Background context must never outrank an alarm.
 *
 * `unusual-transaction` is here because its raw score saturates easily — a large
 * charge at a very regular payee produces a huge z-score — and it was ranking
 * above a projected overdraft a month out. It is a notice about something that
 * already happened, not something to act on, so it is capped below the
 * forward-looking detectors.
 */
export const KIND_WEIGHT = {
  'income-volatility': 0.7,
  'month-end-projection': 0.75,
  'data-quality': 0.7,
  'unusual-transaction': 0.75,
} as const;

export const DEFAULTS = {
  HORIZON_DAYS: 90,
  HISTORY_MONTHS: 13,
  MAX_INSIGHTS: 12,
  TXN_LIMIT: 20000,
} as const;
