import { describe, expect, it } from 'vitest';

import { makeContext, makeMonth } from './fixtures';
import {
  dayForSlot,
  expectedSpendToDate,
  paceRemainingThisMonth,
  projectCategory,
  scheduledRemainingThisMonth,
  slotForDay,
} from './monthPace';
import type { InsightTxn } from './types';

/** A 1-based cumulative-by-day curve; index 0 is unused padding. */
function curve(daysInMonth: number, spendByDay: Record<number, number>) {
  const out = [0];
  let running = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    running += spendByDay[day] ?? 0;
    out.push(running);
  }
  return out;
}

/** Same total, all of it on day 1 — the shape of rent. */
function frontLoaded(daysInMonth: number, total: number) {
  return curve(daysInMonth, { 1: total });
}

/** Same total, spread evenly — the shape of groceries. */
function even(daysInMonth: number, total: number) {
  const perDay: Record<number, number> = {};
  for (let day = 1; day <= daysInMonth; day++) {
    perDay[day] = total / daysInMonth;
  }
  return curve(daysInMonth, perDay);
}

describe('slot mapping', () => {
  it('anchors day 1 to the first slot and the last day to the last slot', () => {
    expect(slotForDay(1, 30)).toBe(1);
    expect(slotForDay(30, 30)).toBe(30);
    expect(slotForDay(1, 28)).toBe(1);
    expect(slotForDay(28, 28)).toBe(30);
    expect(slotForDay(31, 31)).toBe(30);
  });

  it('round-trips through dayForSlot at the edges', () => {
    for (const daysInMonth of [28, 29, 30, 31]) {
      expect(dayForSlot(slotForDay(1, daysInMonth), daysInMonth)).toBe(1);
      expect(
        dayForSlot(slotForDay(daysInMonth, daysInMonth), daysInMonth),
      ).toBe(daysInMonth);
    }
  });

  it('puts mid-month near the middle slot regardless of month length', () => {
    expect(slotForDay(15, 30)).toBe(15);
    expect(slotForDay(14, 28)).toBe(15);
  });
});

describe('expectedSpendToDate', () => {
  const months = ['2026-06', '2026-07', '2026-08'].map(m => makeMonth(m));

  it('returns null without enough history, rather than guessing', () => {
    const ctx = makeContext({
      months: months.slice(0, 2),
      cumulativeByCategoryMonth: {
        'c1:2026-06': even(30, 30_000),
        'c1:2026-07': even(31, 30_000),
      },
    });

    expect(expectedSpendToDate(ctx, 'c1')).toBeNull();
  });

  it('expects roughly half of an evenly-spent category by mid-month', () => {
    const ctx = makeContext({
      months,
      cumulativeByCategoryMonth: {
        'c1:2026-06': even(30, 30_000),
        'c1:2026-07': even(31, 30_000),
        'c1:2026-08': even(31, 30_000),
      },
    });

    const result = expectedSpendToDate(ctx, 'c1');
    expect(result).not.toBeNull();
    expect(result!.basisMonths).toBe(3);
    // Day 15 of 30 is about halfway through the curve.
    expect(result!.expectedToDate).toBeGreaterThan(14_000);
    expect(result!.expectedToDate).toBeLessThan(16_500);
  });

  it('expects a front-loaded category to be fully spent by mid-month', () => {
    // This is the case a linear model gets catastrophically wrong: rent is paid
    // on the 1st, so by the 15th "on pace" means 100% spent, not 50%.
    const ctx = makeContext({
      months,
      cumulativeByCategoryMonth: {
        'c1:2026-06': frontLoaded(30, 120_000),
        'c1:2026-07': frontLoaded(31, 120_000),
        'c1:2026-08': frontLoaded(31, 120_000),
      },
    });

    expect(expectedSpendToDate(ctx, 'c1')!.expectedToDate).toBe(120_000);
  });

  it('skips months where the category was unused instead of averaging in zeros', () => {
    const ctx = makeContext({
      months,
      cumulativeByCategoryMonth: {
        'c1:2026-06': even(30, 0),
        'c1:2026-07': even(31, 30_000),
        'c1:2026-08': even(31, 30_000),
      },
    });

    // Only two usable months, which is under the minimum.
    expect(expectedSpendToDate(ctx, 'c1')).toBeNull();
  });
});

describe('scheduledRemainingThisMonth', () => {
  it('sums only future outflows in this category and month', () => {
    const ctx = makeContext({
      occurrences: [
        {
          scheduleId: 's1',
          date: '2026-09-20',
          amount: -5_000,
          accountId: 'a1',
          categoryId: 'c1',
        },
        {
          scheduleId: 's2',
          date: '2026-09-25',
          amount: -3_000,
          accountId: 'a1',
          categoryId: 'c1',
        },
        // Already past.
        {
          scheduleId: 's3',
          date: '2026-09-10',
          amount: -9_000,
          accountId: 'a1',
          categoryId: 'c1',
        },
        // Next month.
        {
          scheduleId: 's4',
          date: '2026-10-02',
          amount: -9_000,
          accountId: 'a1',
          categoryId: 'c1',
        },
        // Another category.
        {
          scheduleId: 's5',
          date: '2026-09-22',
          amount: -9_000,
          accountId: 'a1',
          categoryId: 'c2',
        },
        // An inflow.
        {
          scheduleId: 's6',
          date: '2026-09-22',
          amount: 9_000,
          accountId: 'a1',
          categoryId: 'c1',
        },
      ],
    });

    expect(scheduledRemainingThisMonth(ctx, 'c1')).toBe(8_000);
  });
});

describe('paceRemainingThisMonth', () => {
  function txn(overrides: Partial<InsightTxn>): InsightTxn {
    return {
      id: 't',
      date: '2026-09-05',
      amount: -1_000,
      payeeId: 'p1',
      categoryId: 'c1',
      accountId: 'a1',
      scheduleId: null,
      importedId: null,
      cleared: true,
      isParent: false,
      ...overrides,
    };
  }

  it('extrapolates discretionary spend over the remaining days', () => {
    // 15,000 over 15 elapsed days = 1,000/day, 15 days left.
    const ctx = makeContext({
      txns: [
        txn({ id: 't1', date: '2026-09-03', amount: -5_000 }),
        txn({ id: 't2', date: '2026-09-08', amount: -5_000 }),
        txn({ id: 't3', date: '2026-09-14', amount: -5_000 }),
      ],
    });

    expect(paceRemainingThisMonth(ctx, 'c1')).toBe(15_000);
  });

  it('excludes schedule-linked spend, so one big bill cannot skew the rate', () => {
    const ctx = makeContext({
      txns: [
        txn({
          id: 't1',
          date: '2026-09-01',
          amount: -120_000,
          scheduleId: 's1',
        }),
        txn({ id: 't2', date: '2026-09-14', amount: -15_000 }),
      ],
    });

    expect(paceRemainingThisMonth(ctx, 'c1')).toBe(15_000);
  });

  it('ignores income, other categories and split parents', () => {
    const ctx = makeContext({
      txns: [
        txn({ id: 't1', amount: 50_000 }),
        txn({ id: 't2', categoryId: 'c2', amount: -50_000 }),
        txn({ id: 't3', amount: -50_000, isParent: true }),
      ],
    });

    expect(paceRemainingThisMonth(ctx, 'c1')).toBe(0);
  });
});

describe('projectCategory', () => {
  it('reports a scheduled basis when no discretionary spend has happened', () => {
    const ctx = makeContext({
      currentMonth: makeMonth('2026-09', {
        byCategory: {
          c1: {
            budgeted: 10_000,
            sumAmount: 0,
            leftover: 10_000,
            carryover: false,
          },
        },
      }),
      occurrences: [
        {
          scheduleId: 's1',
          date: '2026-09-20',
          amount: -14_000,
          accountId: 'a1',
          categoryId: 'c1',
        },
      ],
    });

    const projection = projectCategory(ctx, 'c1');
    expect(projection.basis).toBe('scheduled');
    expect(projection.scheduledRemaining).toBe(14_000);
    expect(projection.projectedOverspend).toBe(4_000);
  });

  it('suppresses the run-rate in the first days of the month', () => {
    const ctx = makeContext({
      dayOfMonth: 2,
      daysElapsed: 2,
      daysRemaining: 28,
      txns: [
        {
          id: 't1',
          date: '2026-09-01',
          amount: -120_000,
          payeeId: 'p1',
          categoryId: 'c1',
          accountId: 'a1',
          scheduleId: null,
          importedId: null,
          cleared: true,
          isParent: false,
        },
      ],
      currentMonth: makeMonth('2026-09', {
        byCategory: {
          c1: {
            budgeted: 120_000,
            sumAmount: -120_000,
            leftover: 0,
            carryover: false,
          },
        },
      }),
    });

    // A run-rate on two days would project 1.68m of further spend. Refusing to
    // extrapolate is the whole point.
    const projection = projectCategory(ctx, 'c1');
    expect(projection.paceRemaining).toBe(0);
    expect(projection.projectedOverspend).toBe(0);
  });
});
