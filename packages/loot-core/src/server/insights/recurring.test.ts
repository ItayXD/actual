import { describe, expect, it } from 'vitest';

import {
  buildPayeeSeries,
  cadenceForGap,
  isStableRun,
  segmentRuns,
  toleranceDays,
} from './recurring';
import type { InsightTxn } from './types';

let seq = 0;
function txn(overrides: Partial<InsightTxn> = {}): InsightTxn {
  seq++;
  return {
    id: `t${seq}`,
    date: '2026-01-15',
    amount: -1000,
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

/** N monthly transactions on the 15th, oldest first, at the given amounts. */
function monthly(amounts: number[], payeeId = 'p1'): InsightTxn[] {
  return amounts.map((amount, i) =>
    txn({
      payeeId,
      amount,
      date: `2026-${String(i + 1).padStart(2, '0')}-15`,
    }),
  );
}

const NAMES = { p1: 'Acme Power', p2: 'Streamly' };

describe('cadenceForGap', () => {
  const cases: [number, string | null][] = [
    [7, 'weekly'],
    [5, 'weekly'],
    [14, 'biweekly'],
    [30, 'monthly'],
    [31, 'monthly'],
    [91, 'quarterly'],
    [365, 'annual'],
    [20, null],
    [50, null],
    [200, null],
  ];

  it.each(cases)('a %s-day gap is %s', (gap, expected) => {
    expect(cadenceForGap(gap)).toBe(expected);
  });
});

describe('toleranceDays', () => {
  it('is a quarter of the cadence for a long cadence', () => {
    expect(toleranceDays(30)).toBe(8);
    expect(toleranceDays(365)).toBe(91);
  });

  it('never drops below the minimum, so a weekly series is not hair-trigger', () => {
    expect(toleranceDays(7)).toBe(3);
  });
});

describe('buildPayeeSeries', () => {
  it('finds a clean monthly series', () => {
    const series = buildPayeeSeries(
      monthly([-1000, -1000, -1000, -1000]),
      NAMES,
    );

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      payeeId: 'p1',
      payeeName: 'Acme Power',
      sign: -1,
      cadence: 'monthly',
      regular: true,
    });
    expect(series[0].occurrences.map(o => o.date)).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('rejects a payee with too few occurrences', () => {
    expect(buildPayeeSeries(monthly([-1000, -1000, -1000]), NAMES)).toEqual([]);
  });

  it('accepts a couple of days of jitter', () => {
    const txns = [
      txn({ date: '2026-01-15', amount: -1000 }),
      txn({ date: '2026-02-16', amount: -1000 }),
      txn({ date: '2026-03-14', amount: -1000 }),
      txn({ date: '2026-04-15', amount: -1000 }),
    ];
    const series = buildPayeeSeries(txns, NAMES);
    expect(series).toHaveLength(1);
    expect(series[0].regular).toBe(true);
  });

  it('rejects an irregular cadence as not a series', () => {
    const txns = [
      txn({ date: '2026-01-02', amount: -1000 }),
      txn({ date: '2026-01-09', amount: -1000 }),
      txn({ date: '2026-03-20', amount: -1000 }),
      txn({ date: '2026-06-01', amount: -1000 }),
    ];
    expect(buildPayeeSeries(txns, NAMES)).toEqual([]);
  });

  it('splits one payee into separate charge and refund streams', () => {
    const txns = [
      ...monthly([-1000, -1000, -1000, -1000]),
      ...monthly([500, 500, 500, 500]),
    ];
    const series = buildPayeeSeries(txns, NAMES);

    expect(series).toHaveLength(2);
    expect(series.map(s => s.sign).sort((a, b) => a - b)).toEqual([-1, 1]);
    // Both are clean monthly streams once separated; mixed together the gaps
    // would have collapsed to zero and matched no cadence.
    expect(series.every(s => s.cadence === 'monthly')).toBe(true);
  });

  it('trusts a schedule link over inferred regularity', () => {
    // Wildly irregular posting dates, but the user has declared the schedule.
    const txns = [
      txn({ date: '2026-01-03', amount: -1000, scheduleId: 's1' }),
      txn({ date: '2026-02-27', amount: -1000, scheduleId: 's1' }),
      txn({ date: '2026-03-05', amount: -1000, scheduleId: 's1' }),
      txn({ date: '2026-04-22', amount: -1000, scheduleId: 's1' }),
    ];
    const series = buildPayeeSeries(txns, NAMES, { s1: 'monthly' });

    expect(series).toHaveLength(1);
    expect(series[0].scheduleId).toBe('s1');
    expect(series[0].cadence).toBe('monthly');
    expect(series[0].regular).toBe(true);
    // Projected from the declared cadence, not from the erratic 48-day median
    // gap those posting dates produce.
    expect(series[0].expectedNextDate).toBe('2026-05-22');
  });

  it('still rejects a wobbly stream when no schedule declares the cadence', () => {
    const txns = [
      txn({ date: '2026-01-03', amount: -1000, scheduleId: 's1' }),
      txn({ date: '2026-02-27', amount: -1000, scheduleId: 's1' }),
      txn({ date: '2026-03-05', amount: -1000, scheduleId: 's1' }),
      txn({ date: '2026-04-22', amount: -1000, scheduleId: 's1' }),
    ];
    expect(buildPayeeSeries(txns, NAMES, { s1: null })).toEqual([]);
  });

  it('projects the next expected date from the median gap', () => {
    const series = buildPayeeSeries(
      monthly([-1000, -1000, -1000, -1000]),
      NAMES,
    );
    expect(series[0].expectedNextDate).toBe('2026-05-16');
  });

  it('ignores split parents and payee-less rows', () => {
    const txns = [
      ...monthly([-1000, -1000, -1000, -1000]).map(t => ({
        ...t,
        isParent: true,
      })),
      ...monthly([-1000, -1000, -1000, -1000], 'p2').map(t => ({
        ...t,
        payeeId: null,
      })),
    ];
    expect(buildPayeeSeries(txns, NAMES)).toEqual([]);
  });
});

describe('segmentRuns', () => {
  function occ(amounts: number[]) {
    return amounts.map((amount, i) => ({
      id: `o${i}`,
      date: `2026-${String(i + 1).padStart(2, '0')}-15`,
      amount,
    }));
  }

  it('finds a single run for a fixed price', () => {
    const runs = segmentRuns(occ([-999, -999, -999, -999]));
    expect(runs).toHaveLength(1);
    expect(runs[0].amount).toBe(-999);
  });

  it('splits a subscription price change into two stable runs', () => {
    const runs = segmentRuns(occ([-999, -999, -999, -1299, -1299]));

    expect(runs).toHaveLength(2);
    expect(runs[0].amount).toBe(-999);
    expect(runs[0].occurrences).toHaveLength(3);
    expect(runs[1].amount).toBe(-1299);
    expect(runs[1].occurrences).toHaveLength(2);
    expect(runs.every(isStableRun)).toBe(true);
  });

  it('keeps a price within the tolerance in the same run', () => {
    // 5% apart, inside the ±7.5% threshold, so this is not a price change.
    const runs = segmentRuns(occ([-1000, -1050, -1000, -1040]));
    expect(runs).toHaveLength(1);
  });

  it('produces a ragged split for a noisy bill, not a clean step', () => {
    // A utility that wanders 30% month to month. The point is that this does
    // NOT look like a two-run step, which is what keeps bill-increase and
    // subscription-change from both firing on the same payee.
    const runs = segmentRuns(occ([-1000, -1300, -900, -1400, -1100]));
    expect(runs.length).toBeGreaterThan(2);
  });

  it('returns nothing for an empty series', () => {
    expect(segmentRuns([])).toEqual([]);
  });
});
