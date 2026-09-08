import { describe, expect, it } from 'vitest';

import { makeContext } from '#server/insights/fixtures';
import type { InsightTxn } from '#server/insights/types';

import { detectDataQuality } from './dataQuality';

let seq = 0;
function txn(overrides: Partial<InsightTxn> = {}): InsightTxn {
  seq++;
  return {
    id: `t${seq}`,
    date: '2026-09-05',
    amount: -6_000,
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

const ACCOUNTS = [
  {
    id: 'a1',
    name: 'Checking',
    offbudget: false,
    closed: false,
    balance: 100_000,
  },
  {
    id: 'off1',
    name: 'Brokerage',
    offbudget: true,
    closed: false,
    balance: 900_000,
  },
];

function ctx(txns: InsightTxn[]) {
  seq = 0;
  return makeContext({ txns, accounts: ACCOUNTS });
}

describe('detectDataQuality', () => {
  it('reports uncategorized transactions once there are a few', () => {
    const insights = detectDataQuality(
      ctx(Array.from({ length: 7 }, () => txn({ categoryId: null }))),
    );

    const uncategorized = insights.find(i => i.data.issue === 'uncategorized');
    expect(uncategorized).toBeDefined();
    expect(uncategorized!.data.count).toBe(7);
    expect(uncategorized!.data.totalAmount).toBe(42_000);
    expect(uncategorized!.data.sampleTransactionIds).toHaveLength(5);
  });

  it('stays quiet about one or two uncategorized rows', () => {
    const insights = detectDataQuality(
      ctx([txn({ categoryId: null }), txn({ categoryId: null })]),
    );
    expect(insights.map(i => i.data.issue)).not.toContain('uncategorized');
  });

  it('warns only when the uncategorized total really moves the forecast', () => {
    const small = detectDataQuality(
      ctx(
        Array.from({ length: 3 }, () =>
          txn({ categoryId: null, amount: -3_000 }),
        ),
      ),
    );
    const large = detectDataQuality(
      ctx(
        Array.from({ length: 3 }, () =>
          txn({ categoryId: null, amount: -60_000 }),
        ),
      ),
    );

    expect(small.find(i => i.data.issue === 'uncategorized')!.severity).toBe(
      'info',
    );
    expect(large.find(i => i.data.issue === 'uncategorized')!.severity).toBe(
      'warning',
    );
  });

  it('ignores uncategorized rows outside the window', () => {
    const insights = detectDataQuality(
      ctx(
        Array.from({ length: 5 }, () =>
          txn({ categoryId: null, date: '2026-01-05' }),
        ),
      ),
    );
    expect(insights).toEqual([]);
  });

  it('reports long-uncleared transactions', () => {
    const insights = detectDataQuality(
      ctx(
        Array.from({ length: 4 }, () =>
          txn({ cleared: false, date: '2026-06-01' }),
        ),
      ),
    );
    expect(insights.map(i => i.data.issue)).toContain('uncleared-stale');
  });

  it('reports future-dated rows, which silently distort every balance', () => {
    const insights = detectDataQuality(
      ctx([txn({ date: '2026-12-01', amount: -50_000 })]),
    );
    expect(insights.map(i => i.data.issue)).toContain('future-dated');
  });

  it('ignores future-dated rows a schedule accounts for', () => {
    const insights = detectDataQuality(
      ctx([txn({ date: '2026-12-01', amount: -50_000, scheduleId: 's1' })]),
    );
    expect(insights.map(i => i.data.issue)).not.toContain('future-dated');
  });

  it('ignores off-budget accounts, where having no category is correct', () => {
    // Off-budget transactions are *supposed* to be uncategorized. Counting them
    // reported seven problems on a file whose title bar said one.
    const insights = detectDataQuality(
      ctx(
        Array.from({ length: 9 }, () =>
          txn({ categoryId: null, accountId: 'off1' }),
        ),
      ),
    );
    expect(insights).toEqual([]);
  });

  it('counts only the on-budget rows when both are present', () => {
    const insights = detectDataQuality(
      ctx([
        ...Array.from({ length: 4 }, () =>
          txn({ categoryId: null, accountId: 'a1' }),
        ),
        ...Array.from({ length: 9 }, () =>
          txn({ categoryId: null, accountId: 'off1' }),
        ),
      ]),
    );

    const uncategorized = insights.find(i => i.data.issue === 'uncategorized');
    expect(uncategorized!.data.count).toBe(4);
  });

  it('does not report future-dated rows on an off-budget account', () => {
    const insights = detectDataQuality(
      ctx([txn({ date: '2026-12-01', amount: -50_000, accountId: 'off1' })]),
    );
    expect(insights.map(i => i.data.issue)).not.toContain('future-dated');
  });

  it('only points the uncategorized issue at the uncategorized screen', () => {
    // The other issues have nothing to do with that screen, and linking them
    // there sent the user somewhere irrelevant.
    const uncategorized = detectDataQuality(
      ctx(Array.from({ length: 5 }, () => txn({ categoryId: null }))),
    ).find(i => i.data.issue === 'uncategorized');
    expect(uncategorized!.subjects).toEqual([{ type: 'uncategorized' }]);

    const uncleared = detectDataQuality(
      ctx(
        Array.from({ length: 4 }, () =>
          txn({ cleared: false, date: '2026-06-01' }),
        ),
      ),
    ).find(i => i.data.issue === 'uncleared-stale');
    expect(uncleared!.subjects).toEqual([]);

    const future = detectDataQuality(
      ctx([txn({ date: '2026-12-01', amount: -50_000 })]),
    ).find(i => i.data.issue === 'future-dated');
    expect(future!.subjects).toEqual([]);
  });

  it('buckets the count so clearing one row does not re-raise a snooze', () => {
    const seven = detectDataQuality(
      ctx(Array.from({ length: 7 }, () => txn({ categoryId: null }))),
    ).find(i => i.data.issue === 'uncategorized')!;
    const six = detectDataQuality(
      ctx(Array.from({ length: 6 }, () => txn({ categoryId: null }))),
    ).find(i => i.data.issue === 'uncategorized')!;

    expect(seven.fingerprint).toBe(six.fingerprint);
  });
});
