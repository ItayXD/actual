import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as db from '#server/db';

import { getSpendingPace } from './spending-pace';

vi.mock('#server/db');

/**
 * Under test, `monthUtils.currentDay()` is pinned to the 1st, so "today" is
 * always day 1 of whichever month `global.currentMonth` names.
 */
const CURRENT_MONTH = '2025-10';

type CategoryRow = {
  id: string;
  name: string;
  hidden: boolean;
  is_income: boolean;
};

const GROCERIES: CategoryRow = {
  id: 'groceries',
  name: 'Groceries',
  hidden: false,
  is_income: false,
};

/** A transaction row as the daily-spend query returns it: expenses negative. */
function row(date: number, amount: number, category = 'groceries') {
  return { category, date, amount };
}

function setupDb({
  categories = [GROCERIES],
  rows = [] as ReturnType<typeof row>[],
}: {
  categories?: CategoryRow[];
  rows?: ReturnType<typeof row>[];
} = {}) {
  vi.mocked(db.getCategories).mockResolvedValue(categories as never);
  vi.mocked(db.all).mockImplementation(async (_sql, params) => {
    const [start, end] = (params ?? []) as number[];
    return rows.filter(r => r.date >= start && r.date <= end) as never;
  });
}

let originalCurrentMonth: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  originalCurrentMonth = global.currentMonth;
  global.currentMonth = CURRENT_MONTH;
});

afterEach(() => {
  global.currentMonth = originalCurrentMonth;
  vi.restoreAllMocks();
});

describe('getSpendingPace', () => {
  it('returns nothing for no months', async () => {
    setupDb();
    expect(await getSpendingPace({ months: [] })).toEqual([]);
  });

  it('marks a month before this one as fully developed', async () => {
    setupDb({ rows: [row(20250310, -5000)] });

    const [pace] = await getSpendingPace({ months: ['2025-03'] });

    expect(pace.phase).toBe('past');
    expect(pace.daysInMonth).toBe(31);
    expect(pace.dayOfMonth).toBe(31);
    expect(pace.categories[0].development).toBe(1);
    expect(pace.categories[0].remainingDevelopment).toEqual([]);
    // Signed positive: the query returns an expense as a negative amount.
    expect(pace.categories[0].spentToDate).toBe(5000);
    expect(pace.categories[0].committedLater).toBe(0);
  });

  it('marks a month after this one as undeveloped', async () => {
    setupDb({ rows: [row(20251115, -2500)] });

    const [pace] = await getSpendingPace({ months: ['2025-11'] });

    expect(pace.phase).toBe('future');
    expect(pace.dayOfMonth).toBe(0);
    expect(pace.categories[0].development).toBe(0);
    expect(pace.categories[0].spentToDate).toBe(0);
    // Everything in a month that has not started is still to come.
    expect(pace.categories[0].committedLater).toBe(2500);
    expect(pace.categories[0].remainingDevelopment).toHaveLength(30);
  });

  it('splits the current month into spent and still to come', async () => {
    setupDb({
      rows: [row(20251001, -1000), row(20251002, -2000), row(20251031, -700)],
    });

    const [pace] = await getSpendingPace({ months: [CURRENT_MONTH] });
    const groceries = pace.categories[0];

    expect(pace.phase).toBe('current');
    expect(pace.dayOfMonth).toBe(1);
    expect(groceries.spentToDate).toBe(1000);
    expect(groceries.committedLater).toBe(2700);
    expect(groceries.remainingDevelopment).toHaveLength(30);
  });

  it('averages history from the first month the category was active', async () => {
    setupDb({
      rows: [
        // Nothing before June, then $100, $200 and a quiet August.
        row(20250610, -10000),
        row(20250710, -20000),
        row(20250910, -30000),
      ],
    });

    const [pace] = await getSpendingPace({ months: [CURRENT_MONTH] });
    const groceries = pace.categories[0];

    // June through September is four months: 100 + 200 + 0 + 300 over 4.
    expect(groceries.historyMonths).toBe(4);
    expect(groceries.priorMonthlyTotal).toBe(15000);
    expect(groceries.confidence).toBe('medium');
  });

  it('reports no history for a category that has never been spent on', async () => {
    setupDb({ rows: [row(20250610, -10000, 'other')] });

    const [pace] = await getSpendingPace({ months: [CURRENT_MONTH] });

    expect(pace.categories[0].priorMonthlyTotal).toBeNull();
    expect(pace.categories[0].historyMonths).toBe(0);
    expect(pace.categories[0].confidence).toBe('none');
  });

  it('floors a refund-only month at zero rather than counting it as income', async () => {
    setupDb({
      rows: [
        row(20250810, -30000),
        // September was a net refund.
        row(20250910, 5000),
      ],
    });

    const [pace] = await getSpendingPace({ months: [CURRENT_MONTH] });

    // 300 in August, nothing counted for September, over two months.
    expect(pace.categories[0].priorMonthlyTotal).toBe(15000);
  });

  it('learns a front-loaded rhythm and reports it as development', async () => {
    const rows = [];
    for (let month = 1; month <= 9; month++) {
      // Everything on the 2nd, every month.
      rows.push(row(20250000 + month * 100 + 2, -30000));
    }
    setupDb({ rows });

    const [pace] = await getSpendingPace({ months: [CURRENT_MONTH] });
    const groceries = pace.categories[0];

    expect(groceries.profileMonths).toBe(9);
    expect(groceries.confidence).toBe('high');
    // Today is the 1st, so the first remaining day is the 2nd. A flat month
    // would put that at 2/31; this category is nearly done by then.
    expect(groceries.remainingDevelopment[0]).toBeGreaterThan(0.8);
  });

  it('skips hidden and income categories', async () => {
    setupDb({
      categories: [
        GROCERIES,
        { id: 'secret', name: 'Secret', hidden: true, is_income: false },
        { id: 'salary', name: 'Salary', hidden: false, is_income: true },
      ],
      rows: [row(20250310, -5000)],
    });

    const [pace] = await getSpendingPace({ months: ['2025-03'] });

    expect(pace.categories.map(c => c.categoryId)).toEqual(['groceries']);
  });

  it('answers several months from one query', async () => {
    setupDb({ rows: [row(20250310, -5000), row(20250410, -7000)] });

    const paces = await getSpendingPace({ months: ['2025-03', '2025-04'] });

    expect(paces.map(p => p.month)).toEqual(['2025-03', '2025-04']);
    expect(paces[0].categories[0].spentToDate).toBe(5000);
    expect(paces[1].categories[0].spentToDate).toBe(7000);
    expect(db.all).toHaveBeenCalledTimes(1);
  });
});
