import { describe, expect, it } from 'vitest';

import { makeContext } from '#server/insights/fixtures';
import { buildPayeeSeries } from '#server/insights/recurring';
import type { InsightTxn } from '#server/insights/types';

import { detectBillIncrease, detectSubscriptionChange } from './bills';

let seq = 0;
function txn(overrides: Partial<InsightTxn> = {}): InsightTxn {
  seq++;
  return {
    id: `t${seq}`,
    date: '2026-09-10',
    amount: -20_000,
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

/** Monthly charges on the 10th, ending 2026-09-10, oldest first. */
function monthly(amounts: number[], payeeId = 'p1'): InsightTxn[] {
  const startMonth = 10 - amounts.length; // e.g. 5 amounts -> May..Sep
  return amounts.map((amount, i) =>
    txn({
      payeeId,
      amount,
      date: `2026-${String(startMonth + i).padStart(2, '0')}-10`,
    }),
  );
}

const NAMES = { p1: 'Acme Power', p2: 'Streamly' };

function ctx(txns: InsightTxn[]) {
  seq = 0;
  const base = makeContext({ txns, payeeNames: NAMES });
  return { ...base, series: buildPayeeSeries(txns, NAMES) };
}

describe('detectBillIncrease', () => {
  it('reports a stable bill that jumped above its trailing median', () => {
    const insights = detectBillIncrease(
      ctx(monthly([-20_000, -20_000, -20_000, -20_000, -26_000])),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data).toMatchObject({
      payeeName: 'Acme Power',
      trailingMedian: 20_000,
      latestAmount: 26_000,
      deltaPct: 30,
      cadence: 'monthly',
    });
  });

  it('excludes the latest charge from its own baseline', () => {
    // Including it would pull the median to 20,000-ish and understate the jump.
    // With four priors at 20,000 the median must be exactly 20,000.
    const insights = detectBillIncrease(
      ctx(monthly([-20_000, -20_000, -20_000, -20_000, -40_000])),
    );
    expect(insights[0].data.trailingMedian).toBe(20_000);
    expect(insights[0].data.deltaPct).toBe(100);
  });

  it('ignores a bill that always wanders, which has no meaningful median', () => {
    // A grocery run varies 30% every month; "18% above median" would be noise.
    const insights = detectBillIncrease(
      ctx(monthly([-18_000, -25_000, -21_000, -30_000, -33_000])),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a jump below the materiality floor', () => {
    // A 10% rise, but only 1,500 of it — under the 2,500 floor this file's
    // throughput implies.
    const insights = detectBillIncrease(
      ctx(monthly([-15_000, -15_000, -15_000, -15_000, -16_500])),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a rise under the minimum percentage', () => {
    const insights = detectBillIncrease(
      ctx(monthly([-100_000, -100_000, -100_000, -100_000, -105_000])),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a stale jump', () => {
    const stale = [
      txn({ amount: -20_000, date: '2026-01-10' }),
      txn({ amount: -20_000, date: '2026-02-10' }),
      txn({ amount: -20_000, date: '2026-03-10' }),
      txn({ amount: -20_000, date: '2026-04-10' }),
      txn({ amount: -26_000, date: '2026-05-10' }),
    ];
    expect(detectBillIncrease(ctx(stale))).toEqual([]);
  });

  it('ignores an inflow series', () => {
    const insights = detectBillIncrease(
      ctx(monthly([20_000, 20_000, 20_000, 20_000, 26_000])),
    );
    expect(insights).toEqual([]);
  });

  it('escalates with the size of the rise', () => {
    const modest = detectBillIncrease(
      ctx(monthly([-20_000, -20_000, -20_000, -20_000, -23_000])),
    );
    const large = detectBillIncrease(
      ctx(monthly([-20_000, -20_000, -20_000, -20_000, -35_000])),
    );

    expect(modest[0].severity).toBe('info');
    expect(large[0].severity).toBe('critical');
  });
});

describe('detectSubscriptionChange', () => {
  it('names both prices when a fixed price steps to a new fixed price', () => {
    const insights = detectSubscriptionChange(
      ctx(monthly([-999, -999, -999, -1_299, -1_299], 'p2')),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data).toMatchObject({
      payeeName: 'Streamly',
      oldAmount: 999,
      newAmount: 1_299,
      deltaPct: 30,
      direction: 'increase',
      priorRunLength: 3,
      newRunLength: 2,
    });
  });

  it('annualises the change, which is what justifies reporting a small one', () => {
    const [insight] = detectSubscriptionChange(
      ctx(monthly([-999, -999, -999, -1_299, -1_299], 'p2')),
    );
    // 300 a month, twelve months.
    expect(insight.data.annualizedDelta).toBe(3_600);
  });

  it('reports a price move that sits below the global materiality floor', () => {
    // 3.00 is well under the 2,500 floor, yet a subscription hike is exactly
    // the insight people want. This is the one deliberate floor exception.
    const [insight] = detectSubscriptionChange(
      ctx(monthly([-999, -999, -999, -1_299, -1_299], 'p2')),
    );
    expect(Math.abs(insight.amount!)).toBeLessThan(2_500);
  });

  it('does not fire on a bill that merely wanders', () => {
    // The same series `bill-increase` rejects: no stable run either side, so
    // there is no step to report.
    const insights = detectSubscriptionChange(
      ctx(monthly([-18_000, -25_000, -21_000, -30_000, -33_000])),
    );
    expect(insights).toEqual([]);
  });

  it('requires an established prior price, not a drift', () => {
    const insights = detectSubscriptionChange(
      ctx(monthly([-999, -1_299, -1_299, -1_299], 'p2')),
    );
    // Only two occurrences at the old price is not an established price.
    expect(insights).toEqual([]);
  });

  it('reports a decrease, but only for information', () => {
    const insights = detectSubscriptionChange(
      ctx(monthly([-1_299, -1_299, -1_299, -999, -999], 'p2')),
    );

    expect(insights[0].data.direction).toBe('decrease');
    expect(insights[0].severity).toBe('info');
  });

  it('ignores a change too small to be a real price move', () => {
    // Under both the percentage bar and the transaction-noise floor.
    const insights = detectSubscriptionChange(
      ctx(monthly([-100_000, -100_000, -100_000, -101_000, -101_000], 'p2')),
    );
    expect(insights).toEqual([]);
  });

  it('keeps the exact prices in the fingerprint', () => {
    const [insight] = detectSubscriptionChange(
      ctx(monthly([-999, -999, -999, -1_299, -1_299], 'p2')),
    );
    expect(insight.fingerprint).toBe('subscription-change:p2:999:1299');
  });
});

describe('the line between the two detectors', () => {
  it('a small subscription hike is a subscription change and not a bill increase', () => {
    const series = ctx(monthly([-999, -999, -999, -1_299, -1_299], 'p2'));

    expect(detectSubscriptionChange(series)).toHaveLength(1);
    // The delta is under the materiality floor, so the bill detector stays out.
    expect(detectBillIncrease(series)).toEqual([]);
  });

  it('a wandering utility triggers neither', () => {
    const series = ctx(monthly([-18_000, -25_000, -21_000, -30_000, -33_000]));

    expect(detectBillIncrease(series)).toEqual([]);
    expect(detectSubscriptionChange(series)).toEqual([]);
  });

  it('a large step at a fixed-price payee triggers both, for rank to resolve', () => {
    // Both are legitimately true here. `rank.ts` lets the subscription
    // statement supersede the bill one, since naming both prices says more.
    const series = ctx(monthly([-20_000, -20_000, -20_000, -26_000, -26_000]));

    expect(detectBillIncrease(series)).toHaveLength(1);
    expect(detectSubscriptionChange(series)).toHaveLength(1);
  });
});
