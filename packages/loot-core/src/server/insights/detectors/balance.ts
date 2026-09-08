import {
  bucket,
  derivedLowBalanceThreshold,
  magnitude,
  urgency,
} from '#server/insights/scale';
import { LOW_BALANCE, NEGATIVE_BALANCE } from '#server/insights/thresholds';
import type {
  InsightAccount,
  InsightContext,
  ResolvedInsightsConfig,
} from '#server/insights/types';
import * as monthUtils from '#shared/months';
import type {
  LowBalanceInsight,
  NegativeBalanceInsight,
} from '#types/models/insights';

/**
 * Account balance insights, read off the schedule-driven forecast.
 *
 * Both are **deterministic**: they walk the projection day by day and report the
 * first day it crosses a line. No probability is claimed, because none can
 * honestly be — the forecast knows about scheduled transactions and nothing
 * else. "Projected to go negative on Sep 24" is arithmetic; "35% chance of going
 * negative" would be a number we made up.
 *
 * `income-volatility` is the honest counterpart: it tells the user how much to
 * trust these, without inventing a distribution.
 */

function eligibleAccounts(ctx: InsightContext): InsightAccount[] {
  return ctx.accounts.filter(
    account =>
      !account.closed &&
      !account.offbudget &&
      ctx.forecastByAccount[account.id],
  );
}

/** Forecast points for an account, oldest first. */
function seriesFor(ctx: InsightContext, accountId: string) {
  return [...(ctx.forecastByAccount[accountId] ?? [])].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

export function detectLowBalance(
  ctx: InsightContext,
  cfg: ResolvedInsightsConfig,
): LowBalanceInsight[] {
  const insights: LowBalanceInsight[] = [];

  for (const account of eligibleAccounts(ctx)) {
    const userThreshold = cfg.lowBalanceThresholds[account.id];
    const thresholdSource = userThreshold === undefined ? 'derived' : 'user';
    const threshold =
      userThreshold ??
      derivedLowBalanceThreshold(
        ctx.scale,
        LOW_BALANCE.DERIVED_THRESHOLD_MONTH_RATIO,
      );

    if (threshold <= 0) {
      continue;
    }

    const series = seriesFor(ctx, account.id);
    // A balance below zero is a different, worse story; `negative-balance`
    // reports it and supersedes this insight for the same account.
    const crossing = series.find(
      point => point.balance < threshold && point.balance >= 0,
    );
    if (!crossing) {
      continue;
    }

    const depth = threshold - crossing.balance;

    // A threshold the *user* chose is honoured exactly — they asked to hear
    // about this line. One we invented gets a materiality floor, because we
    // should be conservative about alarms nobody asked for.
    if (thresholdSource === 'derived' && depth < ctx.scale.floor) {
      continue;
    }

    const daysAway = monthUtils.differenceInCalendarDays(
      crossing.date,
      ctx.today,
    );
    const severity =
      daysAway <= LOW_BALANCE.CRITICAL_DAYS
        ? 'critical'
        : daysAway <= LOW_BALANCE.WARNING_DAYS
          ? 'warning'
          : 'info';

    insights.push({
      kind: 'low-balance',
      id: `low-balance:${account.id}`,
      fingerprint: `low-balance:${account.id}:${crossing.date}:${bucket(ctx.scale, crossing.balance)}`,
      severity,
      score:
        0.4 * urgency(daysAway) + 0.4 * magnitude(depth, ctx.scale.floor) + 0.2,
      subjects: [{ type: 'account', id: account.id }],
      date: crossing.date,
      amount: crossing.balance,
      expiresAt: crossing.date,
      data: {
        accountId: account.id,
        accountName: account.name,
        threshold,
        thresholdSource,
        projectedBalance: crossing.balance,
        daysAway,
        alreadyBelow: daysAway <= 0,
      },
    });
  }

  return insights;
}

export function detectNegativeBalance(
  ctx: InsightContext,
): NegativeBalanceInsight[] {
  const insights: NegativeBalanceInsight[] = [];

  for (const account of eligibleAccounts(ctx)) {
    const crossing = seriesFor(ctx, account.id).find(
      point => point.balance < 0,
    );
    if (!crossing) {
      continue;
    }

    // Deliberately no materiality floor. An overdraft is categorically
    // different from a small number: the fee a bank charges for it is flat, so
    // going one cent negative costs the same as going a hundred negative.
    const shortfall = -crossing.balance;
    const daysAway = monthUtils.differenceInCalendarDays(
      crossing.date,
      ctx.today,
    );

    const nextIncomeDate = ctx.nextIncome?.date ?? null;
    const daysUntilIncome =
      nextIncomeDate === null
        ? null
        : monthUtils.differenceInCalendarDays(nextIncomeDate, ctx.today);
    const incomeArrivesTooLate =
      nextIncomeDate === null || nextIncomeDate > crossing.date;

    insights.push({
      kind: 'negative-balance',
      id: `negative-balance:${account.id}`,
      // No amount in the fingerprint: the date going negative *at all* is the
      // fact. Re-alerting because the projected shortfall drifted by a bucket
      // would be exactly the nagging the snooze exists to prevent.
      fingerprint: `negative-balance:${account.id}:${crossing.date}`,
      severity:
        daysAway <= NEGATIVE_BALANCE.CRITICAL_DAYS ? 'critical' : 'warning',
      score:
        0.45 * urgency(daysAway) +
        0.45 * magnitude(shortfall, ctx.scale.floor) +
        (incomeArrivesTooLate ? 0.1 : 0),
      subjects: [{ type: 'account', id: account.id }],
      date: crossing.date,
      amount: crossing.balance,
      expiresAt: crossing.date,
      data: {
        accountId: account.id,
        accountName: account.name,
        projectedBalance: crossing.balance,
        shortfall,
        daysAway,
        nextIncomeDate,
        daysUntilIncome,
        incomeArrivesTooLate,
      },
    });
  }

  return insights;
}
