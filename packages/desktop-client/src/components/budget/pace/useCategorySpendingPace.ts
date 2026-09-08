import * as monthUtils from '@actual-app/core/shared/months';
import type { SpendingForecast } from '@actual-app/core/shared/spending-pace';
import { forecastSpendingPace } from '@actual-app/core/shared/spending-pace';
import type { CategoryEntity } from '@actual-app/core/types/models';
import type {
  SpendingPaceConfidence,
  SpendingPacePhase,
} from '@actual-app/core/types/models/spending-pace';
import { useQuery } from '@tanstack/react-query';

import { useSheetValue } from '#hooks/useSheetValue';
import type { Binding, SheetFields } from '#spreadsheet';
import { envelopeBudget } from '#spreadsheet/bindings';

import { spendingPaceQueries } from './queries';
import { useSpendingPaceEnabled } from './useSpendingPaceEnabled';

/**
 * Pins the sheet so `FieldName` can be inferred from a parametrized binding.
 * `parametrizedField` renders a bare `<field>-<id>` cell name, which on its own
 * gives TypeScript nothing to infer the sheet from.
 */
function useBudgetSheetValue<FieldName extends SheetFields<'envelope-budget'>>(
  binding: Binding<'envelope-budget', FieldName>,
) {
  return useSheetValue(binding);
}

/**
 * Below this much development, a category with no history has nothing worth
 * projecting from: "at this rate" on the 2nd is arithmetic, not a forecast.
 */
const MIN_DEVELOPMENT_WITHOUT_HISTORY = 1 / 3;

/** How the usage bar should read. */
export type SpendingPaceStatus =
  /** Everything available has been spent. */
  | 'exhausted'
  /** Projected to overspend by month end. */
  | 'ahead'
  /** Projected to come in at or under what is available. */
  | 'on-pace';

export type CategorySpendingPaceResult = {
  /** Budgeted this month plus anything carried in, in minor units. */
  available: number;
  /** Spent this month, in minor units and positive. */
  spent: number;
  /** True when carryover means `available` is more than this month's budget. */
  hasCarryover: boolean;
  forecast: SpendingForecast;
  phase: SpendingPacePhase;
  confidence: SpendingPaceConfidence;
  historyMonths: number;
  /** False when the month is over, or too early to say anything useful. */
  hasForecast: boolean;
  status: SpendingPaceStatus;
  /** Date the balance is projected to reach zero, or null. */
  runOutDate: string | null;
  daysInMonth: number;
  dayOfMonth: number;
};

/**
 * How much of a category's month is used up, and how long the rest will last.
 *
 * The rhythm and the history come from the server; the amount available is read
 * live from the spreadsheet, so changing the budgeted amount re-forecasts on
 * the spot instead of waiting for a round trip.
 *
 * Returns null when the flag is off, when there is nothing available to measure
 * against, or when the month has nothing to say — an untouched future month.
 */
export function useCategorySpendingPace(
  category: CategoryEntity,
  month: string,
): CategorySpendingPaceResult | null {
  const enabled = useSpendingPaceEnabled();
  // React Query dedupes by key, so every category row in a given month shares
  // one request and one cache entry rather than fetching per row.
  const { data: pace } = useQuery(spendingPaceQueries.month(month, enabled));

  // `sum-amount` is negative for an expense, and `leftover` already has it
  // added in, so subtracting it back out gives what the month started with.
  const sumAmount =
    useBudgetSheetValue(envelopeBudget.catSumAmount(category.id)) ?? 0;
  const balance =
    useBudgetSheetValue(envelopeBudget.catBalance(category.id)) ?? 0;
  const budgeted =
    useBudgetSheetValue(envelopeBudget.catBudgeted(category.id)) ?? 0;

  if (!enabled || category.is_income) {
    return null;
  }

  const categoryPace = pace?.categories.find(c => c.categoryId === category.id);
  if (!pace || !categoryPace) {
    return null;
  }

  const available = balance - sumAmount;
  const spent = categoryPace.spentToDate + categoryPace.committedLater;

  // Nothing to show a fraction of, and nothing yet to show for a month that
  // has not started.
  if (available <= 0 || (pace.phase === 'future' && spent <= 0)) {
    return null;
  }

  const forecast = forecastSpendingPace({
    available,
    spentToDate: categoryPace.spentToDate,
    committedLater: categoryPace.committedLater,
    development: categoryPace.development,
    remainingDevelopment: categoryPace.remainingDevelopment,
    priorMonthlyTotal: categoryPace.priorMonthlyTotal,
    historyMonths: categoryPace.historyMonths,
    daysInMonth: pace.daysInMonth,
    dayOfMonth: pace.dayOfMonth,
  });

  const hasForecast =
    pace.phase === 'current' &&
    (categoryPace.priorMonthlyTotal !== null ||
      categoryPace.development >= MIN_DEVELOPMENT_WITHOUT_HISTORY);

  const status: SpendingPaceStatus = forecast.isExhausted
    ? 'exhausted'
    : hasForecast && forecast.projectedLeftover < 0
      ? 'ahead'
      : 'on-pace';

  // The crossing happens partway through a day, so the money is gone on the
  // day the running total passes zero rather than the one before it.
  const runOutDay =
    hasForecast && forecast.runOutDay !== null
      ? Math.min(
          pace.daysInMonth,
          Math.max(pace.dayOfMonth, Math.ceil(forecast.runOutDay)),
        )
      : null;

  return {
    available,
    spent,
    hasCarryover: available !== budgeted,
    forecast,
    phase: pace.phase,
    confidence: categoryPace.confidence,
    historyMonths: categoryPace.historyMonths,
    hasForecast,
    status,
    runOutDate:
      runOutDay === null
        ? null
        : monthUtils.addDays(`${month}-01`, runOutDay - 1),
    daysInMonth: pace.daysInMonth,
    dayOfMonth: pace.dayOfMonth,
  };
}
