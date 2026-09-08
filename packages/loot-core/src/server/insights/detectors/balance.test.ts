import { describe, expect, it } from 'vitest';

import { makeContext, makeScale, TEST_TODAY } from '#server/insights/fixtures';
import type {
  InsightAccount,
  InsightContext,
  ResolvedInsightsConfig,
} from '#server/insights/types';
import type { ForecastDataPoint } from '#types/models/forecast';

import { detectLowBalance, detectNegativeBalance } from './balance';

const CONFIG: ResolvedInsightsConfig = {
  horizonDays: 90,
  historyMonths: 13,
  maxInsights: 12,
  kinds: new Set(),
  lowBalanceThresholds: {},
};

function account(overrides: Partial<InsightAccount> = {}): InsightAccount {
  return {
    id: 'a1',
    name: 'Checking',
    offbudget: false,
    closed: false,
    balance: 500_000,
    ...overrides,
  };
}

/** Forecast points from `2026-09-15` onward, one per entry. */
function forecast(
  balances: [date: string, balance: number][],
  accountId = 'a1',
): ForecastDataPoint[] {
  return balances.map(([date, balance]) => ({
    date,
    balance,
    accountId,
    accountName: 'Checking',
    transactions: [],
  }));
}

function ctxWith(
  balances: [string, number][],
  overrides: Partial<InsightContext> = {},
) {
  return makeContext({
    accounts: [account()],
    forecastByAccount: { a1: forecast(balances) },
    ...overrides,
  });
}

// Derived threshold is roundToNice(0.25 * 500_000) = 100_000; floor is 2_500.
const DERIVED_THRESHOLD = 100_000;

describe('detectLowBalance', () => {
  it('says nothing when the balance never dips', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-30', 380_000],
    ]);
    expect(detectLowBalance(ctx, CONFIG)).toEqual([]);
  });

  it('reports the first day the balance crosses the floor', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-18', 50_000],
      ['2026-09-25', 20_000],
    ]);

    const [insight] = detectLowBalance(ctx, CONFIG);
    expect(insight.date).toBe('2026-09-18');
    expect(insight.data.projectedBalance).toBe(50_000);
    expect(insight.data.threshold).toBe(DERIVED_THRESHOLD);
    expect(insight.data.thresholdSource).toBe('derived');
    expect(insight.data.daysAway).toBe(3);
  });

  it('honours a user threshold exactly, even for a shallow dip', () => {
    // 100 below a threshold the user chose. They asked to hear about this line,
    // so a second invisible materiality floor would be wrong.
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-20', 29_900],
    ]);

    const insights = detectLowBalance(ctx, {
      ...CONFIG,
      lowBalanceThresholds: { a1: 30_000 },
    });

    expect(insights).toHaveLength(1);
    expect(insights[0].data.thresholdSource).toBe('user');
    expect(insights[0].data.threshold).toBe(30_000);
  });

  it('requires a material dip for a threshold we invented ourselves', () => {
    // 100 below the derived threshold, which is under the 2,500 floor.
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-20', DERIVED_THRESHOLD - 100],
    ]);
    expect(detectLowBalance(ctx, CONFIG)).toEqual([]);
  });

  it('leaves a negative balance to the negative-balance detector', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-20', -5_000],
    ]);
    expect(detectLowBalance(ctx, CONFIG)).toEqual([]);
  });

  it('flags an account that is already below the line today', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 10_000],
      ['2026-09-30', 8_000],
    ]);

    const [insight] = detectLowBalance(ctx, CONFIG);
    expect(insight.data.alreadyBelow).toBe(true);
    expect(insight.data.daysAway).toBe(0);
  });

  const severityCases: [string, string, string][] = [
    ['within a week', '2026-09-20', 'critical'],
    ['within a month', '2026-10-10', 'warning'],
    ['further out', '2026-11-20', 'info'],
  ];

  it.each(severityCases)('is %s -> %s', (_name, date, expected) => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      [date, 10_000],
    ]);
    expect(detectLowBalance(ctx, CONFIG)[0].severity).toBe(expected);
  });

  it('skips closed and off-budget accounts', () => {
    const ctx = makeContext({
      accounts: [
        account({ id: 'a1', closed: true }),
        account({ id: 'a2', offbudget: true }),
      ],
      forecastByAccount: {
        a1: forecast([[TEST_TODAY, 1_000]], 'a1'),
        a2: forecast([[TEST_TODAY, 1_000]], 'a2'),
      },
    });
    expect(detectLowBalance(ctx, CONFIG)).toEqual([]);
  });

  it('says nothing when there is no scale to derive a threshold from', () => {
    const ctx = ctxWith(
      [
        [TEST_TODAY, 400_000],
        ['2026-09-20', 0],
      ],
      { scale: makeScale({ month: 0, txn: 0, floor: 0 }) },
    );
    expect(detectLowBalance(ctx, CONFIG)).toEqual([]);
  });

  it('changes fingerprint when the projection moves materially', () => {
    const near = detectLowBalance(
      ctxWith([
        [TEST_TODAY, 400_000],
        ['2026-09-18', 50_000],
      ]),
      CONFIG,
    )[0];
    const moved = detectLowBalance(
      ctxWith([
        [TEST_TODAY, 400_000],
        ['2026-09-18', 20_000],
      ]),
      CONFIG,
    )[0];

    expect(near.id).toBe(moved.id);
    expect(near.fingerprint).not.toBe(moved.fingerprint);
  });

  it('keeps the fingerprint stable under a sub-floor wobble', () => {
    const a = detectLowBalance(
      ctxWith([
        [TEST_TODAY, 400_000],
        ['2026-09-18', 50_000],
      ]),
      CONFIG,
    )[0];
    const b = detectLowBalance(
      ctxWith([
        [TEST_TODAY, 400_000],
        ['2026-09-18', 50_010],
      ]),
      CONFIG,
    )[0];

    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe('detectNegativeBalance', () => {
  it('says nothing when the balance stays positive', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-30', 10_000],
    ]);
    expect(detectNegativeBalance(ctx)).toEqual([]);
  });

  it('reports the first projected negative day', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-24', -12_000],
      ['2026-09-28', -40_000],
    ]);

    const [insight] = detectNegativeBalance(ctx);
    expect(insight.date).toBe('2026-09-24');
    expect(insight.data.shortfall).toBe(12_000);
    expect(insight.data.daysAway).toBe(9);
    expect(insight.severity).toBe('critical');
  });

  it('reports a tiny overdraft, because the fee for one is flat', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-24', -1],
    ]);
    expect(detectNegativeBalance(ctx)).toHaveLength(1);
  });

  it('notes when income arrives after the overdraft', () => {
    const ctx = ctxWith(
      [
        [TEST_TODAY, 400_000],
        ['2026-09-24', -12_000],
      ],
      { nextIncome: { date: '2026-09-30', amount: 300_000, accountId: 'a1' } },
    );

    const [insight] = detectNegativeBalance(ctx);
    expect(insight.data.nextIncomeDate).toBe('2026-09-30');
    expect(insight.data.daysUntilIncome).toBe(15);
    expect(insight.data.incomeArrivesTooLate).toBe(true);
  });

  it('notes when income arrives in time', () => {
    const ctx = ctxWith(
      [
        [TEST_TODAY, 400_000],
        ['2026-09-24', -12_000],
      ],
      { nextIncome: { date: '2026-09-20', amount: 300_000, accountId: 'a1' } },
    );

    expect(detectNegativeBalance(ctx)[0].data.incomeArrivesTooLate).toBe(false);
  });

  it('treats unknown income as arriving too late', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-09-24', -12_000],
    ]);

    const [insight] = detectNegativeBalance(ctx);
    expect(insight.data.nextIncomeDate).toBeNull();
    expect(insight.data.incomeArrivesTooLate).toBe(true);
  });

  it('drops to warning for a distant overdraft', () => {
    const ctx = ctxWith([
      [TEST_TODAY, 400_000],
      ['2026-11-20', -12_000],
    ]);
    expect(detectNegativeBalance(ctx)[0].severity).toBe('warning');
  });

  it('omits the amount from the fingerprint, so drift does not re-nag', () => {
    const a = detectNegativeBalance(
      ctxWith([
        [TEST_TODAY, 400_000],
        ['2026-09-24', -12_000],
      ]),
    )[0];
    const b = detectNegativeBalance(
      ctxWith([
        [TEST_TODAY, 400_000],
        ['2026-09-24', -90_000],
      ]),
    )[0];

    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
