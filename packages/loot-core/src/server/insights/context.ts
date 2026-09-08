import { aqlQuery } from '#server/aql';
import { getSheetValue } from '#server/budget/actions';
import { projectTargets } from '#server/budget/goal-template';
import * as db from '#server/db';
import { generateForecast } from '#server/forecast/app';
import { getAccounts as getForecastAccounts } from '#server/forecast/forecast-accounts';
import * as sheet from '#server/sheet';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import {
  extractScheduleConds,
  getScheduledAmount,
  getStatus,
  indexPostedScheduleTransactions,
  scheduleIsRecurring,
} from '#shared/schedules';
import type { RuleConditionEntity } from '#types/models';
import type { RecurrenceCadence } from '#types/models/insights';

import { buildPayeeSeries } from './recurring';
import { computeScale } from './scale';
import { resolvePastOccurrences } from './scheduleOccurrences';
import { DEFAULTS } from './thresholds';
import type {
  InsightAccount,
  InsightCategory,
  InsightContext,
  InsightMonth,
  InsightOccurrence,
  InsightSchedule,
  InsightTxn,
  ResolvedInsightsConfig,
} from './types';

/**
 * The only file in the engine that touches the database.
 *
 * Everything the sixteen detectors need is gathered here, once, into plain data.
 * The alternative — each detector fetching what it needs — would issue the same
 * queries a dozen times over and make every detector untestable. It is also the
 * structural half of the read-only guarantee: detectors receive data, not
 * handles, so they have nothing to write with.
 */

function cadenceForRecurConfig(dateValue: unknown): RecurrenceCadence | null {
  if (dateValue === null || typeof dateValue !== 'object') {
    return null;
  }
  const config = dateValue as { frequency?: string; interval?: number };
  const interval = config.interval ?? 1;

  switch (config.frequency) {
    case 'weekly':
      return interval === 1 ? 'weekly' : interval === 2 ? 'biweekly' : null;
    case 'monthly':
      if (interval === 1) return 'monthly';
      if (interval === 3) return 'quarterly';
      if (interval === 12) return 'annual';
      return null;
    case 'yearly':
      return interval === 1 ? 'annual' : null;
    default:
      // Daily and everything else is too fast to read as a bill cadence.
      return null;
  }
}

type RawSchedule = {
  id: string;
  name: string | null;
  next_date: string | null;
  completed: boolean;
  posts_transaction: boolean;
  custom_upcoming_length: string | null;
  _payee: string | null;
  _account: string | null;
  _amount: unknown;
  _date: unknown;
  _conditions: RuleConditionEntity[] | null;
  _actions: { op: string; field: string; value: unknown }[] | null;
};

/** The category a schedule assigns, from its rule's `set category` action. */
function scheduleCategory(schedule: RawSchedule): string | null {
  const action = (schedule._actions ?? []).find(
    a => a.op === 'set' && a.field === 'category',
  );
  return typeof action?.value === 'string' ? action.value : null;
}

export async function buildInsightContext(
  cfg: ResolvedInsightsConfig & { today: string; month: string },
): Promise<InsightContext> {
  const { today, month } = cfg;
  const dayOfMonth = monthUtils.getDay(today);
  const daysInMonth = monthUtils.getDay(monthUtils.lastDayOfMonth(month));
  const horizonEnd = monthUtils.addDays(today, cfg.horizonDays);
  const historyStart = monthUtils.subMonths(month, cfg.historyMonths);

  const [rawAccounts, rawCategories, rawPayees, scheduleResult, txnResult] =
    await Promise.all([
      getForecastAccounts(),
      db.getCategories(),
      db.getPayees(),
      aqlQuery(q('schedules').filter({ tombstone: false }).select('*')),
      aqlQuery(
        q('transactions')
          .options({ splits: 'none' })
          .filter({
            'payee.transfer_acct': null,
            starting_balance_flag: false,
            $and: [{ date: { $gte: `${historyStart}-01` } }],
          })
          .select([
            'id',
            'date',
            'amount',
            'payee',
            'category',
            'account',
            'schedule',
            'imported_id',
            'cleared',
            'is_parent',
          ])
          .limit(DEFAULTS.TXN_LIMIT),
      ),
    ]);

  const accounts: InsightAccount[] = rawAccounts.map(account => ({
    id: account.id,
    name: account.name,
    offbudget: account.offbudget === 1,
    closed: account.closed === 1,
    balance: account.balance_current,
  }));

  const categories: InsightCategory[] = rawCategories.map(category => ({
    id: category.id,
    name: category.name,
    isIncome: Boolean(category.is_income),
    hidden: Boolean(category.hidden),
    groupId: category.cat_group ?? null,
  }));

  const payeeNames: Record<string, string> = {};
  for (const payee of rawPayees) {
    payeeNames[payee.id] = payee.name ?? '';
  }

  type RawTxn = {
    id: string;
    date: string;
    amount: number;
    payee: string | null;
    category: string | null;
    account: string;
    schedule: string | null;
    imported_id: string | null;
    cleared: boolean;
    is_parent: boolean;
  };

  const rawTxns = txnResult.data as RawTxn[];
  const txns: InsightTxn[] = rawTxns.map(txn => ({
    id: txn.id,
    date: txn.date,
    amount: txn.amount,
    payeeId: txn.payee,
    categoryId: txn.category,
    accountId: txn.account,
    scheduleId: txn.schedule,
    importedId: txn.imported_id,
    cleared: Boolean(txn.cleared),
    isParent: Boolean(txn.is_parent),
  }));

  // Months. Reading a budget cell for a month with no sheet returns 0 rather
  // than "missing" — `Spreadsheet._getNode` inserts an empty node on a miss —
  // and those fabricated zeros read as a dramatic collapse in spending to the
  // trend and volatility detectors. So only months the budget actually created
  // are read, and `monthsAvailable` records the real bounds.
  const createdMonths = sheet.get().meta().createdMonths as Set<string>;
  const allMonths = monthUtils
    .rangeInclusive(historyStart, month)
    .filter(m => createdMonths.has(m));

  const monthData: InsightMonth[] = [];
  for (const m of allMonths) {
    const sheetName = monthUtils.sheetForMonth(m);
    const byCategory: InsightMonth['byCategory'] = {};

    for (const category of categories) {
      byCategory[category.id] = {
        budgeted: await getSheetValue(sheetName, `budget-${category.id}`),
        sumAmount: await getSheetValue(sheetName, `sum-amount-${category.id}`),
        leftover: await getSheetValue(sheetName, `leftover-${category.id}`),
        carryover: false,
      };
    }

    monthData.push({
      month: m,
      income: await getSheetValue(sheetName, 'total-income'),
      spent: await getSheetValue(sheetName, 'total-spent'),
      byCategory,
    });
  }

  const currentMonth =
    monthData.find(m => m.month === month) ??
    ({ month, income: 0, spent: 0, byCategory: {} } satisfies InsightMonth);
  // Complete months only. Including the in-progress month would make every
  // category look like it just collapsed.
  const completeMonths = monthData.filter(m => m.month !== month);

  // Scale, from the file's own throughput. Every materiality decision derives
  // from this rather than from a currency literal.
  const categoryMonthlySpend: Record<string, number[]> = {};
  for (const m of completeMonths) {
    for (const category of categories) {
      const spent = -(m.byCategory[category.id]?.sumAmount ?? 0);
      if (spent <= 0) {
        continue;
      }
      (categoryMonthlySpend[category.id] ??= []).push(spent);
    }
  }

  const recentTxnCutoff = monthUtils.subDays(today, 90);
  const scale = computeScale({
    monthlyTotals: completeMonths.map(m =>
      Math.max(m.income, Math.abs(m.spent)),
    ),
    transactionAmounts: txns
      .filter(t => !t.isParent && t.date >= recentTxnCutoff && t.amount !== 0)
      .map(t => Math.abs(t.amount)),
    categoryMonthlySpend,
  });

  // Cumulative spend by day, per category per month, for the intra-month pace
  // curve. Index 0 is unused padding so day numbers index directly.
  const cumulativeByCategoryMonth: Record<string, number[]> = {};
  for (const txn of txns) {
    if (txn.categoryId === null || txn.isParent || txn.amount >= 0) {
      continue;
    }
    const txnMonth = txn.date.slice(0, 7);
    const key = `${txn.categoryId}:${txnMonth}`;
    let curve = cumulativeByCategoryMonth[key];
    if (!curve) {
      const days = monthUtils.getDay(monthUtils.lastDayOfMonth(txnMonth));
      curve = new Array(days + 1).fill(0);
      cumulativeByCategoryMonth[key] = curve;
    }
    const day = monthUtils.getDay(txn.date);
    for (let i = day; i < curve.length; i++) {
      curve[i] += -txn.amount;
    }
  }

  // Schedules, with occurrence matching resolved.
  const rawSchedules = scheduleResult.data as RawSchedule[];
  const postedIndex = indexPostedScheduleTransactions(
    rawTxns.map(txn => ({ schedule: txn.schedule, date: txn.date })),
  );
  const scheduleCategories: Record<string, string | null> = {};
  const scheduleCadences: Record<string, RecurrenceCadence | null> = {};

  const schedules: InsightSchedule[] = rawSchedules.map(raw => {
    const conditions = extractScheduleConds(raw._conditions ?? []);
    const dateCond = conditions.date ?? null;
    const amountValue = raw._amount ?? conditions.amount?.value ?? 0;
    const amount = getScheduledAmount(amountValue);
    const dateValue = raw._date ?? dateCond?.value ?? null;
    const cadence = cadenceForRecurConfig(dateValue);
    const posted = postedIndex.get(raw.id) ?? [];

    const {
      pastOccurrences,
      consecutiveUnmatched,
      lastMatchedDate,
      everMatched,
    } = resolvePastOccurrences({
      schedule: raw,
      dateCond: dateCond as { op: string; value: unknown } | null,
      today,
      postedTransactions: posted,
    });

    scheduleCategories[raw.id] = scheduleCategory(raw);
    scheduleCadences[raw.id] = cadence;

    return {
      id: raw.id,
      name: raw.name,
      nextDate: raw.next_date,
      amount,
      accountId: raw._account ?? null,
      payeeId: raw._payee ?? null,
      categoryId: scheduleCategories[raw.id],
      completed: Boolean(raw.completed),
      postsTransaction: Boolean(raw.posts_transaction),
      isRecurring: scheduleIsRecurring(dateCond),
      cadence,
      status:
        raw.next_date === null
          ? 'scheduled'
          : getStatus(
              raw.next_date,
              Boolean(raw.completed),
              consecutiveUnmatched === 0 && everMatched,
              raw.custom_upcoming_length ?? undefined,
            ),
      pastOccurrences,
      everMatched,
      consecutiveUnmatched,
      lastMatchedDate,
    };
  });

  // The forecast: one call, every account, already per-day per-account.
  const eligibleAccountIds = accounts
    .filter(a => !a.closed && !a.offbudget)
    .map(a => a.id);

  const forecastByAccount: InsightContext['forecastByAccount'] = {};
  const occurrences: InsightOccurrence[] = [];

  if (eligibleAccountIds.length > 0) {
    const forecast = await generateForecast({
      accountIds: eligibleAccountIds,
      startDate: today,
      endDate: horizonEnd,
      source: 'schedules',
    });

    for (const point of forecast.dataPoints) {
      (forecastByAccount[point.accountId] ??= []).push(point);

      for (const transaction of point.transactions) {
        occurrences.push({
          scheduleId: transaction.scheduleId,
          date: point.date,
          amount: transaction.amount,
          accountId: point.accountId,
          categoryId: scheduleCategories[transaction.scheduleId] ?? null,
        });
      }
    }
  }

  // The next material inflow. A refund is not a payday, so require it to be a
  // meaningful fraction of a month before treating it as one.
  const incomeFloor = 0.25 * scale.month;
  const nextIncome =
    occurrences
      .filter(o => o.amount >= incomeFloor && o.date > today)
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null;

  const series = buildPayeeSeries(txns, payeeNames, scheduleCadences);

  // Targets are only computed when something actually asks for them: this runs
  // the whole automation engine across every category.
  let targets: InsightContext['targets'] = null;
  if (cfg.kinds.size === 0 || cfg.kinds.has('underfunded-category')) {
    const projections = await projectTargets({ months: [month] });
    targets = projections[0]?.categories ?? [];
  }

  return {
    today,
    month,
    dayOfMonth,
    daysInMonth,
    daysElapsed: dayOfMonth,
    daysRemaining: daysInMonth - dayOfMonth,

    accounts,
    categories,
    payeeNames,

    schedules,
    occurrences,

    forecastByAccount,
    nextIncome: nextIncome
      ? {
          date: nextIncome.date,
          amount: nextIncome.amount,
          accountId: nextIncome.accountId,
        }
      : null,
    horizonEnd,

    months: completeMonths,
    currentMonth,
    monthsAvailable: {
      first: allMonths[0] ?? month,
      last: allMonths.at(-1) ?? month,
    },

    txns,
    cumulativeByCategoryMonth,
    series,

    targets,

    scale,
    truncated: { transactions: rawTxns.length >= DEFAULTS.TXN_LIMIT },
  };
}
