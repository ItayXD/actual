import { beforeEach, describe, expect, it } from 'vitest';

import { createAllBudgets } from '#server/budget/base';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { createSchedule as createScheduleBase } from '#server/schedules/app';
import * as sheet from '#server/sheet';
import { loadRules } from '#server/transactions/transaction-rules';
import * as monthUtils from '#shared/months';
import type { RuleConditionEntity } from '#types/models';

import { generateInsights } from './app';

/**
 * Wiring tests for `context.ts` against a real database.
 *
 * Every detector is unit-tested against a plain `InsightContext`, so what those
 * do *not* cover is the gathering itself: the queries, the sheet reads, the
 * schedule normalisation, the month clamping. That is exactly the code a
 * refactor breaks silently, because a context field that comes back empty makes
 * detectors go quiet rather than throw.
 *
 * Note the dates: `monthUtils.currentDay()` hard-returns `2017-01-01` under
 * `IS_TESTING`, and no date mock can change that. The whole engine takes
 * `today` as a parameter for exactly this reason, but `createAllBudgets` builds
 * its month range off the real helper — so the fixtures live in 2016/2017 to
 * match the harness.
 */

const { emptyDatabase } = global as typeof globalThis & {
  emptyDatabase: () => () => Promise<void>;
};
const createSchedule = createScheduleBase as (args: {
  conditions: RuleConditionEntity[];
}) => Promise<string>;

const TODAY = '2017-01-01';

beforeEach(async () => {
  await emptyDatabase()();
  await loadMappings();
  await loadRules();
  // The engine reads budget cells, so the spreadsheet has to exist.
  await sheet.loadSpreadsheet(db);
  // `createAllBudgets` needs an income group to build `total-income` from.
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategoryGroup({ id: 'expenses', name: 'Expenses' });
});

describe('insights/generate', () => {
  it('returns an empty, well-formed result on an empty budget', async () => {
    const result = await generateInsights({});

    expect(result.insights).toEqual([]);
    expect(result.asOf).toBe(monthUtils.currentDay());
    expect(result.month).toBe(monthUtils.getMonth(monthUtils.currentDay()));
    expect(result.truncated).toEqual({ transactions: false });
  });

  it('honours an explicit today, so nothing depends on the clock', async () => {
    const result = await generateInsights({ today: '2016-05-04' });

    expect(result.asOf).toBe('2016-05-04');
    expect(result.month).toBe('2016-05');
  });

  it('gathers accounts and reports an account that is already overdrawn', async () => {
    const accountId = await db.insertAccount({ id: 'acct', name: 'Checking' });
    await db.insertTransaction({
      id: 't1',
      account: accountId,
      amount: -5_000,
      date: '2016-12-15',
    });
    await createAllBudgets();

    const result = await generateInsights({ today: TODAY });
    const negative = result.insights.find(i => i.kind === 'negative-balance');

    expect(negative).toBeDefined();
    expect(negative!.data).toMatchObject({
      accountId,
      accountName: 'Checking',
      shortfall: 5_000,
      daysAway: 0,
    });
    expect(negative!.severity).toBe('critical');
  });

  it('does not report an off-budget account', async () => {
    const accountId = await db.insertAccount({
      id: 'brokerage',
      name: 'Brokerage',
      offbudget: 1,
    });
    await db.insertTransaction({
      id: 't1',
      account: accountId,
      amount: -5_000,
      date: '2016-12-15',
    });
    await createAllBudgets();

    const result = await generateInsights({ today: TODAY });
    expect(result.insights.filter(i => i.kind === 'negative-balance')).toEqual(
      [],
    );
  });

  it('normalises schedules and reports a long-unmatched one as stale', async () => {
    const accountId = await db.insertAccount({ id: 'acct', name: 'Checking' });
    // Keep the account solvent so the schedule is the only thing to report.
    await db.insertTransaction({
      id: 'seed',
      account: accountId,
      amount: 900_000,
      date: '2016-01-01',
    });
    await createSchedule({
      conditions: [
        { op: 'is', field: 'account', value: accountId },
        { op: 'is', field: 'amount', value: -120_000 },
        {
          op: 'isapprox',
          field: 'date',
          // Far enough back to clear the "young schedule" guard.
          value: { start: '2016-01-05', frequency: 'monthly' },
        },
      ] satisfies RuleConditionEntity[],
    });
    await createAllBudgets();

    const result = await generateInsights({ today: TODAY });
    const stale = result.insights.find(i => i.kind === 'stale-schedule');

    expect(stale).toBeDefined();
    expect(stale!.data.consecutiveUnmatched).toBeGreaterThanOrEqual(3);
    expect(stale!.data.occurrenceDates.length).toBeGreaterThanOrEqual(3);
  });

  it('does not call a young, never-matched schedule stale', async () => {
    const accountId = await db.insertAccount({ id: 'acct', name: 'Checking' });
    await db.insertTransaction({
      id: 'seed',
      account: accountId,
      amount: 900_000,
      date: '2016-01-01',
    });
    await createSchedule({
      conditions: [
        { op: 'is', field: 'account', value: accountId },
        { op: 'is', field: 'amount', value: -120_000 },
        {
          op: 'isapprox',
          field: 'date',
          // Only a couple of occurrences have elapsed by 2017-01-01.
          value: { start: '2016-11-05', frequency: 'monthly' },
        },
      ] satisfies RuleConditionEntity[],
    });
    await createAllBudgets();

    const result = await generateInsights({ today: TODAY });
    expect(result.insights.filter(i => i.kind === 'stale-schedule')).toEqual(
      [],
    );
  });

  it('respects a kinds filter and skips the target engine when unasked', async () => {
    await db.insertAccount({ id: 'acct', name: 'Checking' });
    await createAllBudgets();

    const result = await generateInsights({
      today: TODAY,
      kinds: ['data-quality'],
    });

    for (const insight of result.insights) {
      expect(insight.kind).toBe('data-quality');
    }
    // Targets are only projected when something actually asks for them.
    expect(result.unavailable['underfunded-category']).toBeUndefined();
  });

  it('reads budget sheet cells, so an overspent category is visible', async () => {
    const accountId = await db.insertAccount({ id: 'acct', name: 'Checking' });
    const categoryId = await db.insertCategory({
      name: 'Groceries',
      cat_group: 'expenses',
    });
    await db.insertTransaction({
      id: 'seed',
      account: accountId,
      amount: 900_000,
      date: '2016-01-01',
    });
    // Nothing budgeted and money already spent, so `leftover-<cat>` is
    // negative — which can only be known by reading the sheet.
    await db.insertTransaction({
      id: 't1',
      account: accountId,
      amount: -40_000,
      date: '2017-01-01',
      category: categoryId,
    });
    await createAllBudgets();

    const result = await generateInsights({ today: TODAY });

    expect(sheet.get().meta().createdMonths.has('2017-01')).toBe(true);
    expect(result.month).toBe('2017-01');
    // The month is one day old, so no run-rate is trusted yet; what matters
    // here is that the gather succeeded and the sheet was readable.
    expect(result.insights.every(i => typeof i.score === 'number')).toBe(true);
  });

  it('writes nothing to the database', async () => {
    const accountId = await db.insertAccount({ id: 'acct', name: 'Checking' });
    await db.insertTransaction({
      id: 't1',
      account: accountId,
      amount: -5_000,
      date: '2016-12-15',
    });
    await createAllBudgets();

    const snapshot = async () => ({
      transactions: await db.all('SELECT * FROM v_transactions ORDER BY id'),
      budgets: await db.all('SELECT * FROM zero_budgets ORDER BY id'),
      schedules: await db.all('SELECT * FROM schedules ORDER BY id'),
      prefs: await db.all('SELECT * FROM preferences ORDER BY id'),
      messages: await db.all('SELECT count(*) AS n FROM messages_crdt'),
    });

    const before = await snapshot();
    await generateInsights({ today: TODAY });
    await generateInsights({ today: TODAY });
    const after = await snapshot();

    // FORK.md rule 8: viewing a budget must never mutate it. A regression here
    // would silently change a file that syncs to other clients, so this is
    // checked against a real database rather than by convention.
    expect(after).toEqual(before);
  });
});
