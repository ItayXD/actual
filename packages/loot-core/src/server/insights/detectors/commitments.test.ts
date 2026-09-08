import { describe, expect, it } from 'vitest';

import { makeContext } from '#server/insights/fixtures';
import type {
  InsightAccount,
  InsightContext,
  InsightOccurrence,
} from '#server/insights/types';

import { detectUpcomingCommitments } from './commitments';

function account(balance: number): InsightAccount {
  return {
    id: 'a1',
    name: 'Checking',
    offbudget: false,
    closed: false,
    balance,
  };
}

function bill(date: string, amount: number, id: string): InsightOccurrence {
  return {
    scheduleId: id,
    date,
    amount: -amount,
    accountId: 'a1',
    categoryId: 'c1',
  };
}

function ctx(
  balance: number,
  occurrences: InsightOccurrence[],
  overrides: Partial<InsightContext> = {},
) {
  return makeContext({
    accounts: [account(balance)],
    occurrences,
    nextIncome: { date: '2026-09-30', amount: 400_000, accountId: 'a1' },
    ...overrides,
  });
}

describe('detectUpcomingCommitments', () => {
  it('reports bills arriving before the next income', () => {
    const result = detectUpcomingCommitments(
      ctx(80_000, [
        bill('2026-09-18', 50_000, 's1'),
        bill('2026-09-22', 36_000, 's2'),
      ]),
    );
    const insights = Array.isArray(result) ? result : result.insights;

    expect(insights).toHaveLength(1);
    expect(insights[0].data).toMatchObject({
      count: 2,
      total: 86_000,
      nextIncomeDate: '2026-09-30',
      daysUntilIncome: 15,
      available: 80_000,
    });
    // The money is not quite there.
    expect(insights[0].severity).toBe('critical');
  });

  it('stays quiet when the money is plainly there', () => {
    // "Three bills totalling $860 arrive, and you are holding $9,000" is not an
    // insight.
    const result = detectUpcomingCommitments(
      ctx(900_000, [
        bill('2026-09-18', 50_000, 's1'),
        bill('2026-09-22', 36_000, 's2'),
      ]),
    );
    expect(Array.isArray(result) ? result : result.insights).toEqual([]);
  });

  it('warns when coverage is thin but sufficient', () => {
    const result = detectUpcomingCommitments(
      ctx(100_000, [
        bill('2026-09-18', 50_000, 's1'),
        bill('2026-09-22', 36_000, 's2'),
      ]),
    );
    const insights = Array.isArray(result) ? result : result.insights;
    expect(insights[0].severity).toBe('warning');
  });

  it('needs at least two bills to be worth a sentence', () => {
    const result = detectUpcomingCommitments(
      ctx(10_000, [bill('2026-09-18', 50_000, 's1')]),
    );
    expect(Array.isArray(result) ? result : result.insights).toEqual([]);
  });

  it('ignores bills after the next income', () => {
    const result = detectUpcomingCommitments(
      ctx(80_000, [
        bill('2026-09-18', 50_000, 's1'),
        bill('2026-10-05', 36_000, 's2'),
      ]),
    );
    expect(Array.isArray(result) ? result : result.insights).toEqual([]);
  });

  it('ignores inflows in the window', () => {
    const result = detectUpcomingCommitments(
      ctx(80_000, [
        bill('2026-09-18', 50_000, 's1'),
        { ...bill('2026-09-20', 0, 's2'), amount: 30_000 },
      ]),
    );
    expect(Array.isArray(result) ? result : result.insights).toEqual([]);
  });

  it('reports itself unavailable when no payday can be identified', () => {
    // The whole sentence is relative to the next income; without one there is
    // nothing true to say, so it does not fall back to an arbitrary window.
    const result = detectUpcomingCommitments(
      ctx(
        80_000,
        [bill('2026-09-18', 50_000, 's1'), bill('2026-09-22', 36_000, 's2')],
        { nextIncome: null },
      ),
    );
    expect(result).toEqual({
      insights: [],
      unavailable: 'insufficient-history',
    });
  });
});
