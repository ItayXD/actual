import { describe, expect, it } from 'vitest';

import * as monthUtils from '#shared/months';
import type { ForecastDataPoint } from '#types/models/forecast';

import { makeContext, makeMonth } from './fixtures';
import { buildPayeeSeries } from './recurring';
import { runDetectors } from './registry';
import { computeScale } from './scale';
import type {
  InsightContext,
  InsightMonth,
  InsightTxn,
  ResolvedInsightsConfig,
} from './types';

/**
 * The mechanical proof that the engine contains no currency literal.
 *
 * Amounts are integer minor units, so `500` means $5.00, ¥500 and 5.00 EUR at
 * once. Any absolute threshold hardcoded in a detector would therefore be
 * correct for exactly one currency and wrong for the rest — and would be
 * invisible in review, especially when hidden inside a ratio.
 *
 * So: build a fixture, run every detector, multiply every amount by 1000, run
 * again, and require the same insights. A literal anywhere fails this.
 */

const CONFIG: ResolvedInsightsConfig = {
  horizonDays: 90,
  historyMonths: 13,
  maxInsights: 50,
  kinds: new Set(),
  lowBalanceThresholds: {},
};

const FACTOR = 1000;

function scaleMonth(month: InsightMonth, k: number): InsightMonth {
  return {
    ...month,
    income: month.income * k,
    spent: month.spent * k,
    byCategory: Object.fromEntries(
      Object.entries(month.byCategory).map(([id, cell]) => [
        id,
        {
          ...cell,
          budgeted: cell.budgeted * k,
          sumAmount: cell.sumAmount * k,
          leftover: cell.leftover * k,
        },
      ]),
    ),
  };
}

/** Multiplies every minor-unit field in a context. */
function scaleContext(ctx: InsightContext, k: number): InsightContext {
  const txns = ctx.txns.map(t => ({ ...t, amount: t.amount * k }));

  return {
    ...ctx,
    accounts: ctx.accounts.map(a => ({ ...a, balance: a.balance * k })),
    txns,
    schedules: ctx.schedules.map(s => ({ ...s, amount: s.amount * k })),
    occurrences: ctx.occurrences.map(o => ({ ...o, amount: o.amount * k })),
    forecastByAccount: Object.fromEntries(
      Object.entries(ctx.forecastByAccount).map(([id, points]) => [
        id,
        points.map(p => ({
          ...p,
          balance: p.balance * k,
          transactions: p.transactions.map(t => ({
            ...t,
            amount: t.amount * k,
          })),
        })),
      ]),
    ),
    nextIncome:
      ctx.nextIncome === null
        ? null
        : { ...ctx.nextIncome, amount: ctx.nextIncome.amount * k },
    months: ctx.months.map(m => scaleMonth(m, k)),
    currentMonth: scaleMonth(ctx.currentMonth, k),
    cumulativeByCategoryMonth: Object.fromEntries(
      Object.entries(ctx.cumulativeByCategoryMonth).map(([key, curve]) => [
        key,
        curve.map(v => v * k),
      ]),
    ),
    series: buildPayeeSeries(txns, ctx.payeeNames),
    scale: computeScale({
      monthlyTotals: ctx.months.map(m =>
        Math.max(m.income * k, Math.abs(m.spent * k)),
      ),
      transactionAmounts: txns.map(t => Math.abs(t.amount)),
      categoryMonthlySpend: Object.fromEntries(
        Object.entries(ctx.scale.byCategory).map(([id, v]) => [id, [v * k]]),
      ),
    }),
  };
}

let seq = 0;
function txn(overrides: Partial<InsightTxn> = {}): InsightTxn {
  seq++;
  return {
    id: `t${seq}`,
    date: '2026-09-05',
    amount: -4_000,
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

function forecast(points: [string, number][]): ForecastDataPoint[] {
  return points.map(([date, balance]) => ({
    date,
    balance,
    accountId: 'a1',
    accountName: 'Checking',
    transactions: [],
  }));
}

/**
 * A fixture rich enough that several detectors fire: an overdraft, a low
 * balance, an escalating bill, a duplicate pair, uncategorized rows, a spending
 * trend and volatile income.
 */
function buildFixture(): InsightContext {
  seq = 0;

  const categories = [
    {
      id: 'c1',
      name: 'Groceries',
      isIncome: false,
      hidden: false,
      groupId: 'g1',
    },
    {
      id: 'c2',
      name: 'Transport',
      isIncome: false,
      hidden: false,
      groupId: 'g1',
    },
  ];

  // Twelve complete months: Transport climbing, income wobbling.
  const months: InsightMonth[] = [];
  for (let i = 0; i < 12; i++) {
    // Roll over the year properly: 2025-09 .. 2026-08.
    const month = monthUtils.addMonths('2025-09', i);
    months.push(
      makeMonth(month, {
        income: i % 2 === 0 ? 400_000 : 600_000,
        spent: -350_000,
        byCategory: {
          c1: {
            budgeted: 40_000,
            sumAmount: -38_000,
            leftover: 2_000,
            carryover: false,
          },
          c2: {
            budgeted: 20_000,
            // Climbing steadily, to trip the trend detector.
            sumAmount: -(10_000 + i * 3_000),
            leftover: 1_000,
            carryover: false,
          },
        },
      }),
    );
  }

  const txns: InsightTxn[] = [
    // A monthly bill that just jumped, for bill-increase / subscription-change.
    ...[0, 1, 2, 3].map(i =>
      txn({
        payeeId: 'p2',
        categoryId: 'c1',
        amount: -20_000,
        date: `2026-0${i + 4}-10`,
      }),
    ),
    txn({
      payeeId: 'p2',
      categoryId: 'c1',
      amount: -26_000,
      date: '2026-09-10',
    }),

    // A duplicate pair on a payee that never repeats otherwise.
    txn({
      payeeId: 'p3',
      categoryId: 'c1',
      amount: -15_000,
      date: '2026-09-08',
    }),
    txn({
      payeeId: 'p3',
      categoryId: 'c1',
      amount: -15_000,
      date: '2026-09-08',
    }),

    // Uncategorized rows, for data-quality.
    ...[1, 2, 3, 4].map(i =>
      txn({ categoryId: null, amount: -6_000, date: `2026-09-0${i}` }),
    ),

    // Ordinary discretionary spend, so the pace machinery has something to use.
    ...Array.from({ length: 10 }, (_, i) =>
      txn({
        amount: -4_000,
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      }),
    ),
  ];

  const cumulativeByCategoryMonth: Record<string, number[]> = {};
  for (const month of [...months.map(m => m.month), '2026-09']) {
    // A flat, evenly-spread curve for Groceries in every month.
    const days = 30;
    const curve = [0];
    for (let day = 1; day <= days; day++) {
      curve.push(Math.round((38_000 * day) / days));
    }
    cumulativeByCategoryMonth[`c1:${month}`] = curve;
  }

  const base = makeContext({
    categories,
    accounts: [
      {
        id: 'a1',
        name: 'Checking',
        offbudget: false,
        closed: false,
        balance: 120_000,
      },
    ],
    payeeNames: { p1: 'Corner Shop', p2: 'Acme Power', p3: 'Hardware Co' },
    months,
    currentMonth: makeMonth('2026-09', {
      income: 500_000,
      spent: -300_000,
      byCategory: {
        c1: {
          budgeted: 40_000,
          // Well past the historical curve, to trip spending-pace.
          sumAmount: -70_000,
          leftover: -30_000,
          carryover: false,
        },
        c2: {
          budgeted: 20_000,
          sumAmount: -5_000,
          leftover: 15_000,
          carryover: false,
        },
      },
    }),
    txns,
    cumulativeByCategoryMonth,
    forecastByAccount: {
      a1: forecast([
        ['2026-09-15', 120_000],
        ['2026-09-20', 40_000],
        ['2026-09-26', -30_000],
      ]),
    },
    occurrences: [
      {
        scheduleId: 's1',
        date: '2026-09-18',
        amount: -60_000,
        accountId: 'a1',
        categoryId: 'c1',
      },
      {
        scheduleId: 's2',
        date: '2026-09-22',
        amount: -30_000,
        accountId: 'a1',
        categoryId: 'c1',
      },
    ],
    nextIncome: { date: '2026-09-30', amount: 500_000, accountId: 'a1' },
  });

  return {
    ...base,
    series: buildPayeeSeries(txns, base.payeeNames),
    scale: computeScale({
      monthlyTotals: months.map(m => Math.max(m.income, Math.abs(m.spent))),
      transactionAmounts: txns.map(t => Math.abs(t.amount)),
      categoryMonthlySpend: {
        c1: months.map(m => -m.byCategory.c1.sumAmount),
        c2: months.map(m => -m.byCategory.c2.sumAmount),
      },
    }),
  };
}

describe('scale invariance', () => {
  const original = buildFixture();
  const scaled = scaleContext(buildFixture(), FACTOR);

  const fromOriginal = runDetectors(original, CONFIG);
  const fromScaled = runDetectors(scaled, CONFIG);

  it('produces insights at all, so the proof is not vacuous', () => {
    expect(fromOriginal.insights.length).toBeGreaterThan(3);
  });

  it('exercises a broad spread of detectors', () => {
    const kinds = new Set(fromOriginal.insights.map(i => i.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('emits exactly the same insights when every amount is 1000x larger', () => {
    const ids = (result: typeof fromOriginal) =>
      result.insights.map(i => i.id).sort();

    expect(ids(fromScaled)).toEqual(ids(fromOriginal));
  });

  it('reports the same unavailable reasons', () => {
    expect(fromScaled.unavailable).toEqual(fromOriginal.unavailable);
  });

  it('scales the reported amounts by exactly the same factor', () => {
    const byId = new Map(fromScaled.insights.map(i => [i.id, i]));

    for (const insight of fromOriginal.insights) {
      const counterpart = byId.get(insight.id);
      expect(counterpart).toBeDefined();
      if (insight.amount !== null && counterpart!.amount !== null) {
        expect(counterpart!.amount).toBeCloseTo(insight.amount * FACTOR, -2);
      }
    }
  });

  it('keeps every score identical, so ranking does not depend on currency', () => {
    const byId = new Map(fromScaled.insights.map(i => [i.id, i]));

    for (const insight of fromOriginal.insights) {
      expect(byId.get(insight.id)!.score).toBeCloseTo(insight.score, 6);
    }
  });
});
