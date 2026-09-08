import { describe, expect, it } from 'vitest';

import { makeContext } from '#server/insights/fixtures';
import type { InsightCategory, InsightTxn } from '#server/insights/types';

import { detectUnusualTransaction } from './unusual';

const CATEGORIES: InsightCategory[] = [
  { id: 'c1', name: 'Shopping', isIncome: false, hidden: false, groupId: 'g1' },
];

let seq = 0;
function txn(overrides: Partial<InsightTxn> = {}): InsightTxn {
  seq++;
  return {
    id: `t${seq}`,
    date: '2026-09-10',
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

function ctx(txns: InsightTxn[]) {
  seq = 0;
  return makeContext({
    txns,
    categories: CATEGORIES,
    payeeNames: { p1: 'Corner Shop', p2: 'New Payee' },
  });
}

/** A payee's steady history: n charges at `amount`, spread over past months. */
function history(n: number, amount: number, payeeId = 'p1'): InsightTxn[] {
  return Array.from({ length: n }, (_, i) =>
    txn({
      payeeId,
      amount,
      date: `2026-0${(i % 8) + 1}-1${i % 9}`,
    }),
  );
}

describe('detectUnusualTransaction', () => {
  it('flags a charge far above what this payee normally costs', () => {
    const insights = detectUnusualTransaction(
      ctx([
        ...history(8, -4_000),
        txn({ id: 'big', amount: -80_000, date: '2026-09-12' }),
      ]),
    );

    const flagged = insights.filter(i => i.data.transactionId === 'big');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].data.basis).toBe('payee');
    expect(flagged[0].data.typicalAmount).toBe(4_000);
    expect(flagged[0].data.ratio).toBe(20);
  });

  it('does not flag an ordinary charge', () => {
    const insights = detectUnusualTransaction(
      ctx([
        ...history(8, -4_000),
        txn({ id: 'normal', amount: -4_200, date: '2026-09-12' }),
      ]),
    );
    expect(insights.map(i => i.data.transactionId)).not.toContain('normal');
  });

  it('does not let an outlier inflate its own baseline', () => {
    // The baseline excludes the row under test. With a plain z-score computed
    // over the whole sample, a single huge charge raises the spread enough to
    // hide itself.
    const insights = detectUnusualTransaction(
      ctx([
        ...history(8, -4_000),
        txn({ id: 'huge', amount: -400_000, date: '2026-09-12' }),
      ]),
    );
    expect(insights.map(i => i.data.transactionId)).toContain('huge');
  });

  it('falls back to the category for a brand-new payee', () => {
    // The case a payee-only detector is blind to: a large one-off somewhere
    // you have never shopped before.
    const insights = detectUnusualTransaction(
      ctx([
        ...history(24, -4_000),
        txn({
          id: 'newbig',
          payeeId: 'p2',
          amount: -90_000,
          date: '2026-09-12',
        }),
      ]),
    );

    const flagged = insights.filter(i => i.data.transactionId === 'newbig');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].data.basis).toBe('category');
  });

  it('stays quiet when there is neither payee nor category history', () => {
    const insights = detectUnusualTransaction(
      ctx([txn({ id: 'lonely', amount: -90_000, date: '2026-09-12' })]),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a schedule-linked charge, which explains its own amount', () => {
    const insights = detectUnusualTransaction(
      ctx([
        ...history(8, -4_000),
        txn({
          id: 'sched',
          amount: -80_000,
          date: '2026-09-12',
          scheduleId: 's1',
        }),
      ]),
    );
    expect(insights.map(i => i.data.transactionId)).not.toContain('sched');
  });

  it('ignores anything older than the recent window', () => {
    const insights = detectUnusualTransaction(
      ctx([
        ...history(8, -4_000),
        txn({ id: 'old', amount: -80_000, date: '2026-05-12' }),
      ]),
    );
    expect(insights.map(i => i.data.transactionId)).not.toContain('old');
  });

  it('ignores inflows', () => {
    const insights = detectUnusualTransaction(
      ctx([...history(8, -4_000), txn({ id: 'refund', amount: 80_000 })]),
    );
    expect(insights.map(i => i.data.transactionId)).not.toContain('refund');
  });

  it('handles a perfectly constant payee without producing an infinite score', () => {
    const insights = detectUnusualTransaction(
      ctx([
        ...history(8, -4_000),
        txn({ id: 'step', amount: -20_000, date: '2026-09-12' }),
      ]),
    );

    const flagged = insights.find(i => i.data.transactionId === 'step');
    expect(flagged).toBeDefined();
    expect(Number.isFinite(flagged!.data.z)).toBe(true);
    expect(flagged!.score).toBeLessThanOrEqual(1);
  });
});
