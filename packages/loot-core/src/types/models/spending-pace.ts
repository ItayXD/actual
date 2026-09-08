import type { CategoryEntity } from './index';

/**
 * How confident the forecast is, driven entirely by how many months of the
 * category's own history were available to build a spending shape from.
 *
 * Surfaced so the UI can hedge its wording rather than presenting a guess
 * built from one month as if it were a measurement.
 */
export type SpendingPaceConfidence = 'none' | 'low' | 'medium' | 'high';

/** Where the month sits relative to today, which decides what is knowable. */
export type SpendingPacePhase = 'past' | 'current' | 'future';

/**
 * Everything the client needs to forecast one category's month, apart from the
 * amount available — that is read live from the spreadsheet so the forecast
 * follows a budget edit without a round trip.
 *
 * Read-only: producing this never writes a budget, a goal, or a sync message.
 */
export type CategorySpendingPace = {
  categoryId: CategoryEntity['id'];
  /** Spent on or before today, in minor units, signed positive for spending. */
  spentToDate: number;
  /**
   * Already recorded for a date later this month (a posted schedule, a
   * post-dated entry), in minor units and positive. Known spending that has
   * not happened yet, so it is excluded from `spentToDate` but is a floor on
   * what is still to come.
   */
  committedLater: number;
  /**
   * Fraction of a typical month's spending for this category that has usually
   * happened by today — the development pattern the forecast is built on.
   *
   * 1 for a past month, 0 for a future one. This is what stops a big shop on
   * the 1st from reading as a month's worth of pace: if this category
   * historically spends 20% of its month in the first three days, then 20% of
   * the budget by the 3rd projects to exactly 100%, not 900%.
   */
  development: number;
  /**
   * Cumulative development for each remaining day of the month, from tomorrow
   * to the last day. Used to find the day the balance is projected to run out.
   */
  remainingDevelopment: number[];
  /**
   * Average monthly spend over the history window, in minor units and
   * positive. The prior the forecast is anchored to early in the month. null
   * when the category has no history to average.
   */
  priorMonthlyTotal: number | null;
  /** Months of history behind `priorMonthlyTotal`. */
  historyMonths: number;
  /** Months that contributed a shape to `development`. */
  profileMonths: number;
  confidence: SpendingPaceConfidence;
};

export type MonthSpendingPace = {
  month: string;
  phase: SpendingPacePhase;
  daysInMonth: number;
  /**
   * Day of the month reached so far, 1..daysInMonth. `daysInMonth` for a past
   * month and 0 for a future one.
   */
  dayOfMonth: number;
  categories: CategorySpendingPace[];
};
