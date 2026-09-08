import * as db from '#server/db';
import * as monthUtils from '#shared/months';
import type { MonthlySpendHistory } from '#shared/spending-pace';
import { buildDevelopmentProfile } from '#shared/spending-pace';
import type { CategoryEntity } from '#types/models';
import type {
  CategorySpendingPace,
  MonthSpendingPace,
  SpendingPaceConfidence,
  SpendingPacePhase,
} from '#types/models/spending-pace';

/**
 * How far back to look for a spending rhythm. A year covers annual seasonality
 * without letting a category's habits from two years ago outvote this year's.
 */
const HISTORY_MONTHS = 12;

type DailySpendRow = {
  category: string;
  /** `YYYYMMDD` as an integer, the way transactions store dates. */
  date: number;
  amount: number;
};

/** Spend per day of month for one category-month, positive for spending. */
type MonthDays = { daysInMonth: number; byDay: number[] };

function daysInMonth(month: string): number {
  return monthUtils.bounds(month).end % 100;
}

function confidenceFor(historyMonths: number): SpendingPaceConfidence {
  if (historyMonths >= 6) {
    return 'high';
  }
  if (historyMonths >= 3) {
    return 'medium';
  }
  if (historyMonths >= 1) {
    return 'low';
  }
  return 'none';
}

function phaseFor(month: string, currentMonth: string): SpendingPacePhase {
  if (month < currentMonth) {
    return 'past';
  }
  return month === currentMonth ? 'current' : 'future';
}

/**
 * Daily spend totals per category over the whole span, in one query.
 *
 * The filters mirror the `sum-amount` cell in `budget/base.ts` exactly — same
 * view, same off-budget exclusion — so the totals here always reconcile with
 * the Spent column rather than drifting from it by a rule nobody remembers.
 */
async function getDailySpend(
  rangeStart: number,
  rangeEnd: number,
): Promise<DailySpendRow[]> {
  return await db.all<DailySpendRow>(
    `SELECT t.category AS category,
            t.date AS date,
            SUM(t.amount) AS amount
       FROM v_transactions_internal_alive t
       LEFT JOIN accounts a ON a.id = t.account
      WHERE t.date >= ? AND t.date <= ?
        AND t.category IS NOT NULL
        AND a.offbudget = 0
      GROUP BY t.category, t.date`,
    [rangeStart, rangeEnd],
  );
}

/**
 * Reshapes flat daily rows into per-category, per-month day arrays with
 * spending signed positive.
 *
 * A category-month only appears once it has a transaction; a month with no
 * activity is absent rather than zero-filled, which is what lets the prior
 * distinguish "spent nothing" from "did not exist yet".
 */
function groupByCategoryMonth(
  rows: DailySpendRow[],
  includedCategories: Set<string>,
): Map<string, Map<string, MonthDays>> {
  const byCategory = new Map<string, Map<string, MonthDays>>();

  for (const row of rows) {
    if (!includedCategories.has(row.category)) {
      continue;
    }
    const year = Math.floor(row.date / 10000);
    const monthNumber = Math.floor(row.date / 100) % 100;
    const day = row.date % 100;
    const month = `${year}-${String(monthNumber).padStart(2, '0')}`;

    let months = byCategory.get(row.category);
    if (!months) {
      months = new Map();
      byCategory.set(row.category, months);
    }
    let entry = months.get(month);
    if (!entry) {
      const length = daysInMonth(month);
      entry = { daysInMonth: length, byDay: new Array(length).fill(0) };
      months.set(month, entry);
    }
    // Transactions store an expense as negative; the whole of this feature
    // talks in positive spending, so flip once here and never again.
    entry.byDay[day - 1] -= row.amount;
  }

  return byCategory;
}

/** Day arrays summed across every category, for the budget-wide rhythm. */
function budgetWideMonths(
  byCategory: Map<string, Map<string, MonthDays>>,
): Map<string, MonthDays> {
  const combined = new Map<string, MonthDays>();
  for (const months of byCategory.values()) {
    for (const [month, entry] of months) {
      let total = combined.get(month);
      if (!total) {
        total = {
          daysInMonth: entry.daysInMonth,
          byDay: new Array(entry.daysInMonth).fill(0),
        };
        combined.set(month, total);
      }
      for (let i = 0; i < entry.byDay.length; i++) {
        total.byDay[i] += entry.byDay[i];
      }
    }
  }
  return combined;
}

function sumDays(entry: MonthDays | undefined, fromDay = 1, toDay = 31) {
  if (!entry) {
    return 0;
  }
  let total = 0;
  for (let day = fromDay; day <= Math.min(toDay, entry.byDay.length); day++) {
    total += entry.byDay[day - 1];
  }
  return total;
}

function historyFor(
  months: Map<string, MonthDays> | undefined,
  historyMonthNames: string[],
): MonthlySpendHistory[] {
  if (!months) {
    return [];
  }
  return historyMonthNames
    .map(month => months.get(month))
    .filter((entry): entry is MonthDays => entry !== undefined);
}

/**
 * Average monthly spend to anchor the forecast to, counted from the category's
 * first activity in the window.
 *
 * Counting from first activity matters: a category started three months ago
 * would otherwise be averaged against nine months it did not exist for, and
 * the forecast would insist it costs a quarter of what it does. Months after
 * that with no spending are kept — "some months we buy none" is real
 * information — but a month that netted negative is floored at zero so a
 * refund cannot argue the category earns money.
 */
function priorMonthlyTotal(
  months: Map<string, MonthDays> | undefined,
  historyMonthNames: string[],
): { prior: number | null; historyMonths: number } {
  if (!months) {
    return { prior: null, historyMonths: 0 };
  }

  const firstActiveIndex = historyMonthNames.findIndex(month =>
    months.has(month),
  );
  if (firstActiveIndex === -1) {
    return { prior: null, historyMonths: 0 };
  }

  const active = historyMonthNames.slice(firstActiveIndex);
  const total = active.reduce(
    (sum, month) => sum + Math.max(0, sumDays(months.get(month))),
    0,
  );
  return {
    prior: Math.round(total / active.length),
    historyMonths: active.length,
  };
}

/**
 * Per-category spending rhythm and history for each requested month, so the
 * client can say how long a budget will last.
 *
 * Read-only: it queries transactions and writes nothing — no budget, no goal,
 * no sync message.
 */
export async function getSpendingPace({
  months,
}: {
  months: string[];
}): Promise<MonthSpendingPace[]> {
  if (months.length === 0) {
    return [];
  }

  const sorted = [...months].sort();
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  const rangeStart = monthUtils.bounds(
    monthUtils.subMonths(earliest, HISTORY_MONTHS),
  ).start;
  const rangeEnd = monthUtils.bounds(latest).end;

  const categories = (await db.getCategories()).filter(
    c => !c.hidden && !c.is_income,
  );
  const includedCategories = new Set(categories.map(c => c.id));

  const rows = await getDailySpend(rangeStart, rangeEnd);
  const byCategory = groupByCategoryMonth(rows, includedCategories);
  const budgetWide = budgetWideMonths(byCategory);

  const currentMonth = monthUtils.currentMonth();
  const today = monthUtils.getDay(monthUtils.currentDay());

  return months.map(month => {
    const phase = phaseFor(month, currentMonth);
    const length = daysInMonth(month);
    const dayOfMonth =
      phase === 'past'
        ? length
        : phase === 'future'
          ? 0
          : Math.min(today, length);

    const historyMonthNames = Array.from({ length: HISTORY_MONTHS }, (_, i) =>
      monthUtils.subMonths(month, HISTORY_MONTHS - i),
    );
    const budgetHistory = historyFor(budgetWide, historyMonthNames);

    const paces: CategorySpendingPace[] = categories.map(category => {
      const categoryMonths = byCategory.get(category.id);
      const thisMonth = categoryMonths?.get(month);

      const { profile, profileMonths } = buildDevelopmentProfile({
        daysInMonth: length,
        categoryHistory: historyFor(categoryMonths, historyMonthNames),
        budgetHistory,
      });
      const { prior, historyMonths } = priorMonthlyTotal(
        categoryMonths,
        historyMonthNames,
      );

      // A past month is fully developed and a future one not at all, so
      // neither reads its development off the profile.
      const development =
        phase === 'past' ? 1 : phase === 'future' ? 0 : profile[dayOfMonth - 1];

      return {
        categoryId: category.id as CategoryEntity['id'],
        spentToDate: dayOfMonth > 0 ? sumDays(thisMonth, 1, dayOfMonth) : 0,
        committedLater: sumDays(thisMonth, dayOfMonth + 1, length),
        development,
        remainingDevelopment: profile.slice(dayOfMonth),
        priorMonthlyTotal: prior,
        historyMonths,
        profileMonths,
        confidence: confidenceFor(historyMonths),
      };
    });

    return { month, phase, daysInMonth: length, dayOfMonth, categories: paces };
  });
}
