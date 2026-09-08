import {
  isStableRun,
  OCCURRENCES_PER_YEAR,
  segmentRuns,
} from '#server/insights/recurring';
import { evidence, magnitude, recency } from '#server/insights/scale';
import { mad, median, percentChange } from '#server/insights/stats';
import { BILL_INCREASE, SUBSCRIPTION } from '#server/insights/thresholds';
import type { InsightContext, PayeeSeries } from '#server/insights/types';
import * as monthUtils from '#shared/months';
import type {
  BillIncreaseInsight,
  SubscriptionChangeInsight,
} from '#types/models/insights';

/**
 * Two insights about a recurring charge going up, and the line between them.
 *
 * `bill-increase` fires when a *roughly* stable bill jumps once — an electricity
 * bill 18% above its trailing median. `subscription-change` fires when a *fixed*
 * price moves to a new fixed price and stays there — 9.99 to 12.99.
 *
 * Keeping them apart matters, because the naive version of either one reports
 * both on every payee. The discriminators are:
 *   - `bill-increase` requires the prior amounts to be nearly identical
 *     (`MAX_PRIOR_MAD_RATIO`), so a grocery run that varies 30% weekly never
 *     qualifies;
 *   - `subscription-change` requires two *stable runs* either side of a step,
 *     which a wandering utility bill cannot produce.
 * When both would fire anyway, `rank.ts` lets the subscription statement
 * supersede the bill one, since naming both prices is strictly more useful.
 */

/** Cadences slow enough that a single jump is meaningful. */
const BILL_CADENCES = new Set(['monthly', 'quarterly', 'annual']);

function daysAgo(ctx: InsightContext, date: string): number {
  return monthUtils.differenceInCalendarDays(ctx.today, date);
}

function eligibleSeries(ctx: InsightContext): PayeeSeries[] {
  return ctx.series.filter(
    series =>
      series.regular &&
      series.sign === -1 &&
      BILL_CADENCES.has(series.cadence) &&
      series.occurrences.length >= BILL_INCREASE.MIN_OCCURRENCES,
  );
}

export function detectBillIncrease(ctx: InsightContext): BillIncreaseInsight[] {
  const insights: BillIncreaseInsight[] = [];

  for (const series of eligibleSeries(ctx)) {
    const { occurrences } = series;
    const latest = occurrences[occurrences.length - 1];
    if (daysAgo(ctx, latest.date) > BILL_INCREASE.MAX_AGE_DAYS) {
      continue;
    }

    // The baseline excludes the latest occurrence. That is not cosmetic: with a
    // four-point window, including it drags the median toward the new value and
    // halves the apparent jump.
    const prior = occurrences
      .slice(0, -1)
      .slice(-BILL_INCREASE.MAX_BASELINE)
      .map(o => Math.abs(o.amount));
    if (prior.length < BILL_INCREASE.MIN_OCCURRENCES - 1) {
      continue;
    }

    const trailingMedian = median(prior);
    if (trailingMedian <= 0) {
      continue;
    }

    // Was it stable before? A bill that always wanders has no meaningful
    // "trailing median" to be above.
    if (mad(prior) > BILL_INCREASE.MAX_PRIOR_MAD_RATIO * trailingMedian) {
      continue;
    }

    const latestAmount = Math.abs(latest.amount);
    const deltaPct = percentChange(trailingMedian, latestAmount);
    if (deltaPct === null || deltaPct < BILL_INCREASE.MIN_PCT) {
      continue;
    }

    const delta = latestAmount - trailingMedian;
    if (delta < ctx.scale.floor) {
      continue;
    }

    insights.push({
      kind: 'bill-increase',
      id: `bill-increase:${series.payeeId}`,
      fingerprint: `bill-increase:${series.payeeId}:${Math.round(trailingMedian)}:${Math.round(latestAmount)}`,
      severity:
        deltaPct > BILL_INCREASE.CRITICAL_PCT
          ? 'critical'
          : deltaPct >= BILL_INCREASE.WARNING_PCT
            ? 'warning'
            : 'info',
      score:
        0.5 * Math.min(1, deltaPct / 100) +
        0.3 * magnitude(delta, ctx.scale.floor) +
        0.2 * evidence(prior.length, BILL_INCREASE.MAX_BASELINE),
      subjects: [
        { type: 'payee', id: series.payeeId },
        { type: 'transaction', id: latest.id },
      ],
      date: latest.date,
      amount: -delta,
      expiresAt: null,
      data: {
        payeeId: series.payeeId,
        payeeName: series.payeeName,
        transactionId: latest.id,
        latestAmount,
        trailingMedian: Math.round(trailingMedian),
        deltaPct,
        latestDate: latest.date,
        occurrences: occurrences.length,
        cadence: series.cadence,
      },
    });
  }

  return insights;
}

export function detectSubscriptionChange(
  ctx: InsightContext,
): SubscriptionChangeInsight[] {
  const insights: SubscriptionChangeInsight[] = [];

  for (const series of ctx.series) {
    if (!series.regular || series.sign !== -1) {
      continue;
    }

    const runs = segmentRuns(series.occurrences);
    if (runs.length < 2) {
      continue;
    }

    const priorRun = runs[runs.length - 2];
    const newRun = runs[runs.length - 1];

    // A genuine fixed price either side of the step, not a drift.
    if (
      priorRun.occurrences.length < SUBSCRIPTION.MIN_PRIOR_RUN ||
      !isStableRun(priorRun)
    ) {
      continue;
    }

    const newestDate = newRun.occurrences[newRun.occurrences.length - 1].date;
    // Two occurrences at the new price prove it stuck. One is enough only while
    // it is fresh news; an old single outlier is a job for `unusual-transaction`.
    const newRunEstablished =
      newRun.occurrences.length >= 2 ||
      daysAgo(ctx, newestDate) <= SUBSCRIPTION.MAX_AGE_DAYS;
    if (!newRunEstablished) {
      continue;
    }

    const oldAmount = Math.abs(priorRun.amount);
    const newAmount = Math.abs(newRun.amount);
    if (oldAmount === newAmount || oldAmount === 0) {
      continue;
    }

    const delta = newAmount - oldAmount;
    const deltaPct = percentChange(oldAmount, newAmount);
    if (deltaPct === null) {
      continue;
    }

    // The one place the global floor is deliberately relaxed. A 9.99 -> 12.99
    // hike sits under most files' floor, yet it is exactly the insight people
    // want; annualising it is what justifies the exception. A hard sub-floor on
    // a fraction of a typical transaction still keeps cent-noise out.
    const materialByPct = Math.abs(deltaPct) >= SUBSCRIPTION.MIN_PCT;
    const materialByAmount = Math.abs(delta) >= ctx.scale.floor;
    const aboveNoise =
      Math.abs(delta) >= SUBSCRIPTION.MIN_DELTA_TXN_RATIO * ctx.scale.txn;
    if (!aboveNoise || !(materialByPct || materialByAmount)) {
      continue;
    }

    const direction = delta > 0 ? 'increase' : 'decrease';
    const annualizedDelta = delta * OCCURRENCES_PER_YEAR[series.cadence];

    insights.push({
      kind: 'subscription-change',
      id: `subscription-change:${series.payeeId}`,
      // Exact prices, deliberately unbucketed: these are the two numbers the
      // sentence names, so the fingerprint should be exact too.
      fingerprint: `subscription-change:${series.payeeId}:${oldAmount}:${newAmount}`,
      severity:
        direction === 'increase' && deltaPct >= SUBSCRIPTION.WARNING_PCT
          ? 'warning'
          : 'info',
      score:
        0.45 * Math.min(1, Math.abs(deltaPct) / 100) +
        0.25 * magnitude(annualizedDelta / 12, ctx.scale.floor) +
        0.3 * recency(daysAgo(ctx, newRun.occurrences[0].date)),
      subjects: [{ type: 'payee', id: series.payeeId }],
      date: newRun.occurrences[0].date,
      amount: -delta,
      expiresAt: null,
      data: {
        payeeId: series.payeeId,
        payeeName: series.payeeName,
        oldAmount,
        newAmount,
        deltaPct,
        direction,
        changedOn: newRun.occurrences[0].date,
        priorRunLength: priorRun.occurrences.length,
        newRunLength: newRun.occurrences.length,
        cadence: series.cadence,
        annualizedDelta,
      },
    });
  }

  return insights;
}
