import { describe, expect, it } from 'vitest';

import { makeContext } from '#server/insights/fixtures';
import type { InsightTxn } from '#server/insights/types';

import { detectPossibleDuplicate } from './duplicates';

let seq = 0;
function txn(overrides: Partial<InsightTxn> = {}): InsightTxn {
  seq++;
  return {
    id: `t${seq}`,
    date: '2026-09-08',
    amount: -15_000,
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
    payeeNames: { p1: 'Hardware Co', p2: 'Corner Coffee' },
  });
}

describe('detectPossibleDuplicate', () => {
  it('flags two identical charges on the same day', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ id: 'a' }), txn({ id: 'b' })]),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.transactionIds).toEqual(['a', 'b']);
    expect(insights[0].data.daysApart).toBe(0);
    expect(insights[0].data.bothManual).toBe(true);
  });

  it('flags charges one day apart', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ date: '2026-09-08' }), txn({ date: '2026-09-09' })]),
    );
    expect(insights).toHaveLength(1);
    expect(insights[0].data.daysApart).toBe(1);
  });

  it('ignores charges more than a day apart', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ date: '2026-09-05' }), txn({ date: '2026-09-08' })]),
    );
    expect(insights).toEqual([]);
  });

  it('requires the amounts to match exactly', () => {
    // An approximate match is a legitimate repeat far more often than it is a
    // duplicate, so near-misses are not reported.
    const insights = detectPossibleDuplicate(
      ctx([txn({ amount: -15_000 }), txn({ amount: -15_100 })]),
    );
    expect(insights).toEqual([]);
  });

  it('ignores a payee whose history is mostly look-alike adjacent charges', () => {
    // A coffee bought every day at the same price. Note this payee never
    // charges twice in one *day* — which is why a "twice in a day" metric fails
    // here and every consecutive pair would be reported as a duplicate.
    const daily = Array.from({ length: 12 }, (_, i) =>
      txn({
        payeeId: 'p2',
        amount: -4_000,
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      }),
    );

    expect(detectPossibleDuplicate(ctx(daily))).toEqual([]);
  });

  it('still flags a pair at a payee with too little history to have a habit', () => {
    // Two transactions, both a pair, is 100% "routine" by ratio alone — and is
    // also exactly what a genuine double-charge looks like. Without enough
    // history there is no habit to appeal to, so it is reported.
    const insights = detectPossibleDuplicate(
      ctx([txn({ id: 'x' }), txn({ id: 'y' })]),
    );
    expect(insights).toHaveLength(1);
  });

  it('flags an anomalous pair at a payee with a long, clean history', () => {
    // One well-separated charge per month: no adjacency anywhere in the history.
    const monthly = Array.from({ length: 8 }, (_, i) =>
      txn({
        amount: -15_000,
        date: `2026-0${i + 1}-15`,
      }),
    );
    // Two on the same day, unlike the rest of the history.
    const pair = [
      txn({ id: 'dup1', amount: -22_000, date: '2026-09-10' }),
      txn({ id: 'dup2', amount: -22_000, date: '2026-09-10' }),
    ];

    const insights = detectPossibleDuplicate(ctx([...monthly, ...pair]));
    const ids = insights.flatMap(i => i.data.transactionIds);
    expect(ids).toContain('dup1');
    expect(ids).toContain('dup2');
  });

  it('does not treat a couple of coincidental adjacencies as a habit', () => {
    // 12 charges with two adjacent pairs is 17% — a coincidence, not a routine.
    // Suppressing at that level would hide real duplicates at normal payees.
    const history = [
      ...Array.from({ length: 8 }, (_, i) =>
        txn({ amount: -15_000, date: `2026-0${i + 1}-15` }),
      ),
      txn({ amount: -15_000, date: '2026-02-16' }),
      txn({ amount: -15_000, date: '2026-03-16' }),
    ];
    const pair = [
      txn({ id: 'dup1', amount: -22_000, date: '2026-09-10' }),
      txn({ id: 'dup2', amount: -22_000, date: '2026-09-10' }),
    ];

    const ids = detectPossibleDuplicate(ctx([...history, ...pair])).flatMap(
      i => i.data.transactionIds,
    );
    expect(ids).toContain('dup1');
  });

  it('trusts the bank when both rows carry different import ids', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ importedId: 'bank-1' }), txn({ importedId: 'bank-2' })]),
    );
    expect(insights).toEqual([]);
  });

  it('still flags a pair when only one row was imported', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ importedId: 'bank-1' }), txn({ importedId: null })]),
    );
    expect(insights).toHaveLength(1);
    expect(insights[0].data.bothManual).toBe(false);
  });

  it('ignores schedule-linked rows, which the matcher already reasoned about', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ scheduleId: 's1' }), txn({ scheduleId: 's1' })]),
    );
    expect(insights).toEqual([]);
  });

  it('ignores amounts below the materiality floor', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ amount: -100 }), txn({ amount: -100 })]),
    );
    expect(insights).toEqual([]);
  });

  it('ignores split parents and payee-less rows', () => {
    expect(
      detectPossibleDuplicate(
        ctx([txn({ isParent: true }), txn({ isParent: true })]),
      ),
    ).toEqual([]);
    expect(
      detectPossibleDuplicate(
        ctx([txn({ payeeId: null }), txn({ payeeId: null })]),
      ),
    ).toEqual([]);
  });

  it('never escalates past warning', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ amount: -900_000 }), txn({ amount: -900_000 })]),
    );
    expect(insights[0].severity).toBe('warning');
  });

  it('keys the fingerprint on the pair, so a dismissal is permanent', () => {
    const insights = detectPossibleDuplicate(
      ctx([txn({ id: 'b' }), txn({ id: 'a' })]),
    );
    // Sorted, so the fingerprint does not depend on row order.
    expect(insights[0].fingerprint).toBe('possible-duplicate:a~b');
  });
});
