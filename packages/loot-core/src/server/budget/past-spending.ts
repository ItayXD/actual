import * as db from '#server/db';
import * as monthUtils from '#shared/months';
import type { CategoryEntity } from '#types/models';
import type { PastSpending, SpendingBasis } from '#types/models/targets';

import {
  getAverageMonths,
  getAverageStartMonth,
  getSheetValue,
  isTrackingBudget,
} from './actions';
/**
 * How many months back a basis looks, counted from the month before `month`.
 *
 * `year-to-date` stops at January of the start month's year rather than
 * spilling into the previous year. `all-time` is bounded in practice by each
 * category's first activity month, which `getCategoryAverage` already applies.
 */
function monthsForBasis(basis: SpendingBasis, startMonth: string): number {
  switch (basis) {
    case 'last-month':
      return 1;
    case 'last-3-months':
      return 3;
    case 'year-to-date':
      // e.g. a start month of 2026-08 covers Jan..Aug, so 8 months.
      return Number(startMonth.slice(5, 7));
    case 'all-time':
    default:
      return 1200;
  }
}

/**
 * What each category actually cost per month, what was budgeted for it, and
 * what income actually was, all averaged over the chosen window.
 *
 * Read-only: it reads cached sheet values and writes nothing.
 *
 * Per-category averages use the same window logic as the budget menu's
 * "N-month average" (bounded by the category's first activity, so a new
 * category is not averaged against months it did not exist for). The income
 * figure is a straight average over the window, since it is not tied to any
 * one category.
 */
export async function getPastSpending({
  month,
  basis,
}: {
  month: string;
  basis: SpendingBasis;
}): Promise<PastSpending> {
  const startMonth = getAverageStartMonth(month);
  const maxMonths = monthsForBasis(basis, startMonth);
  const isTracking = isTrackingBudget();

  const categories = (await db.getCategories()).filter(
    c => !c.hidden && (isTracking || !c.is_income),
  );

  const byCategory: Record<CategoryEntity['id'], number> = {};
  const budgetedByCategory: Record<CategoryEntity['id'], number> = {};
  for (const category of categories) {
    // One month list drives both averages, so "spent" and "budgeted" always
    // cover exactly the same months for a given category.
    const months = await getAverageMonths({
      month,
      maxMonths,
      categoryId: category.id,
    });

    byCategory[category.id] = 0;
    budgetedByCategory[category.id] = 0;
    if (months.length === 0) {
      continue;
    }

    let spent = 0;
    let budgeted = 0;
    for (const prevMonth of months) {
      const sheetName = monthUtils.sheetForMonth(prevMonth);
      spent += await getSheetValue(sheetName, `sum-amount-${category.id}`);
      budgeted += await getSheetValue(sheetName, `budget-${category.id}`);
    }

    const spentAverage = Math.round(spent / months.length);
    // `sum-amount` is negative for an expense; report spending as positive so
    // it lines up with the planned column. `|| 0` collapses negative zero,
    // which would otherwise format as "-0.00".
    byCategory[category.id] =
      (category.is_income ? spentAverage : -spentAverage) || 0;
    // `budget-` is already signed the way the plan is, so it needs no flip.
    budgetedByCategory[category.id] = Math.round(budgeted / months.length) || 0;
  }

  let incomeTotal = 0;
  let incomeMonths = 0;
  for (let i = 0; i < maxMonths; i++) {
    const prevMonth = monthUtils.subMonths(startMonth, i);
    if (
      basis === 'year-to-date' &&
      prevMonth.slice(0, 4) !== startMonth.slice(0, 4)
    ) {
      break;
    }
    const value = await getSheetValue(
      monthUtils.sheetForMonth(prevMonth),
      'total-income',
    );
    // An all-time window runs past the start of the budget; stop once the
    // months are empty rather than dragging the average down with zeroes.
    if (basis === 'all-time' && value === 0 && incomeMonths > 0) {
      break;
    }
    incomeTotal += value;
    incomeMonths++;
  }

  return {
    basis,
    income: incomeMonths > 0 ? Math.round(incomeTotal / incomeMonths) : 0,
    byCategory,
    budgetedByCategory,
  };
}
