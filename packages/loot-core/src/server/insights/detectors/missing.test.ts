import { describe, expect, it } from 'vitest';

import { makeContext } from '#server/insights/fixtures';
import { buildPayeeSeries } from '#server/insights/recurring';
import type { InsightSchedule, InsightTxn } from '#server/insights/types';

import { detectMissingRecurring } from './missing';

function schedule(overrides: Partial<InsightSchedule> = {}): InsightSchedule {
  return {
    id: 's1',
    name: 'Rent',
    nextDate: '2026-09-01',
    amount: -120_000,
    accountId: 'a1',
    payeeId: 'p1',
    categoryId: 'c1',
    completed: false,
    postsTransaction: false,
    isRecurring: true,
    cadence: 'monthly',
    status: 'missed',
    pastOccurrences: ['2026-07-01', '2026-08-01', '2026-09-01'],
    everMatched: true,
    consecutiveUnmatched: 1,
    lastMatchedDate: '2026-08-01',
    ...overrides,
  };
}

let seq = 0;
function txn(overrides: Partial<InsightTxn> = {}): InsightTxn {
  seq++;
  return {
    id: `t${seq}`,
    date: '2026-05-01',
    amount: 400_000,
    payeeId: 'p2',
    categoryId: 'c2',
    accountId: 'a1',
    scheduleId: null,
    importedId: null,
    cleared: true,
    isParent: false,
    ...overrides,
  };
}

describe('detectMissingRecurring — from a schedule', () => {
  it('reports a missed schedule', () => {
    const insights = detectMissingRecurring(
      makeContext({ schedules: [schedule()] }),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data).toMatchObject({
      source: 'schedule',
      scheduleId: 's1',
      scheduleName: 'Rent',
      daysLate: 14,
      isIncome: false,
    });
    expect(insights[0].severity).toBe('warning');
  });

  it('treats a missing paycheck as critical', () => {
    const insights = detectMissingRecurring(
      makeContext({
        schedules: [schedule({ amount: 400_000, name: 'Salary' })],
      }),
    );
    expect(insights[0].severity).toBe('critical');
    expect(insights[0].data.isIncome).toBe(true);
  });

  it('leaves a chronically unmatched schedule to stale-schedule', () => {
    const insights = detectMissingRecurring(
      makeContext({ schedules: [schedule({ consecutiveUnmatched: 4 })] }),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a schedule that is not missed', () => {
    const insights = detectMissingRecurring(
      makeContext({
        schedules: [schedule({ status: 'upcoming', nextDate: '2026-09-20' })],
      }),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a completed schedule', () => {
    const insights = detectMissingRecurring(
      makeContext({ schedules: [schedule({ completed: true })] }),
    );
    expect(insights).toEqual([]);
  });

  it('ignores an immaterial amount', () => {
    const insights = detectMissingRecurring(
      makeContext({ schedules: [schedule({ amount: -100 })] }),
    );
    expect(insights).toEqual([]);
  });
});

describe('detectMissingRecurring — from an inferred series', () => {
  function withSeries(dates: string[], amount = 400_000) {
    seq = 0;
    const txns = dates.map(date => txn({ date, amount }));
    const names = { p2: 'Employer' };
    const base = makeContext({ txns, payeeNames: names });
    return { ...base, series: buildPayeeSeries(txns, names) };
  }

  it('reports a monthly inflow that has not arrived', () => {
    // Paid on the 1st every month; the September one never appeared.
    const insights = detectMissingRecurring(
      withSeries(['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data).toMatchObject({
      source: 'series',
      payeeName: 'Employer',
      isIncome: true,
    });
    expect(insights[0].severity).toBe('critical');
  });

  it('waits out a tolerance before calling a series late', () => {
    // Expected around 2026-09-14, and today is the 15th — inside tolerance.
    const insights = detectMissingRecurring(
      withSeries(['2026-05-15', '2026-06-15', '2026-07-15', '2026-08-15']),
    );
    expect(insights).toEqual([]);
  });

  it('does not chase a stream that has clearly ended', () => {
    // Last seen in February. This is a cancelled subscription, not a late one.
    const insights = detectMissingRecurring(
      withSeries(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a series that a schedule already covers', () => {
    seq = 0;
    const txns = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'].map(
      date => txn({ date, scheduleId: 's9' }),
    );
    const names = { p2: 'Employer' };
    const base = makeContext({ txns, payeeNames: names });
    const withScheduleSeries = {
      ...base,
      series: buildPayeeSeries(txns, names, { s9: 'monthly' }),
    };

    expect(detectMissingRecurring(withScheduleSeries)).toEqual([]);
  });
});
