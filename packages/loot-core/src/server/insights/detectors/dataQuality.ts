import { magnitude } from '#server/insights/scale';
import { DATA_QUALITY } from '#server/insights/thresholds';
import type { InsightContext, InsightTxn } from '#server/insights/types';
import * as monthUtils from '#shared/months';
import type {
  DataQualityInsight,
  DataQualityIssue,
} from '#types/models/insights';

/**
 * Housekeeping that actually distorts the numbers elsewhere on this card.
 *
 * Three issues share one `kind` so the per-kind cap applies across all of them:
 * a messy file should not be able to flood the list with hygiene rows while a
 * projected overdraft waits behind them. Everything here is scored low and
 * weighted down in the registry for the same reason.
 *
 * **On-budget accounts only.** A transaction on an off-budget account is
 * *supposed* to have no category — that is what off-budget means — so counting
 * those would report a problem that is not one. The app's own uncategorized
 * query (`uncategorizedTransactions()` in the client) draws exactly the same
 * line, and an insight that disagreed with the count in the title bar would be
 * worse than no insight.
 */

function build(
  ctx: InsightContext,
  issue: DataQualityIssue,
  rows: InsightTxn[],
  windowDays: number,
): DataQualityInsight | null {
  if (rows.length === 0) {
    return null;
  }

  const totalAmount = rows.reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
  const distortsForecast =
    totalAmount >=
    DATA_QUALITY.UNCATEGORIZED_WARNING_MONTH_RATIO * ctx.scale.month;

  return {
    kind: 'data-quality',
    id: `data-quality:${issue}`,
    // The count is bucketed to fives: clearing one of seven should not re-raise
    // a dismissed row, but letting five more pile up should.
    fingerprint: `data-quality:${issue}:${Math.ceil(rows.length / 5) * 5}`,
    severity:
      issue === 'uncategorized' && distortsForecast ? 'warning' : 'info',
    score:
      0.25 +
      0.4 * magnitude(totalAmount, ctx.scale.floor) +
      0.2 * Math.min(1, rows.length / 20),
    // Only the uncategorized issue has a screen to send the user to. The
    // others would otherwise link to /categories/uncategorized, which has
    // nothing to do with an uncleared or future-dated row.
    subjects:
      issue === 'uncategorized' ? [{ type: 'uncategorized' as const }] : [],
    date: null,
    amount: totalAmount,
    expiresAt: null,
    data: {
      issue,
      count: rows.length,
      totalAmount,
      sampleTransactionIds: rows
        .slice(0, DATA_QUALITY.MAX_SAMPLES)
        .map(txn => txn.id),
      windowDays,
    },
  };
}

export function detectDataQuality(ctx: InsightContext): DataQualityInsight[] {
  const insights: DataQualityInsight[] = [];

  const onBudget = new Set(
    ctx.accounts.filter(a => !a.offbudget).map(a => a.id),
  );
  const budgetRows = ctx.txns.filter(
    txn => !txn.isParent && onBudget.has(txn.accountId),
  );

  const uncategorizedFrom = monthUtils.subDays(
    ctx.today,
    DATA_QUALITY.UNCATEGORIZED_WINDOW_DAYS,
  );
  const uncategorized = budgetRows.filter(
    txn =>
      txn.categoryId === null &&
      txn.date >= uncategorizedFrom &&
      txn.date <= ctx.today,
  );
  if (uncategorized.length >= DATA_QUALITY.UNCATEGORIZED_MIN_COUNT) {
    const insight = build(
      ctx,
      'uncategorized',
      uncategorized,
      DATA_QUALITY.UNCATEGORIZED_WINDOW_DAYS,
    );
    if (insight) {
      insights.push(insight);
    }
  }

  const unclearedBefore = monthUtils.subDays(
    ctx.today,
    DATA_QUALITY.UNCLEARED_MIN_AGE_DAYS,
  );
  const uncleared = budgetRows.filter(
    txn => !txn.cleared && txn.date < unclearedBefore,
  );
  if (uncleared.length >= DATA_QUALITY.UNCLEARED_MIN_COUNT) {
    const insight = build(
      ctx,
      'uncleared-stale',
      uncleared,
      DATA_QUALITY.UNCLEARED_MIN_AGE_DAYS,
    );
    if (insight) {
      insights.push(insight);
    }
  }

  // Future-dated rows silently distort every balance and projection on this
  // card, so even one is worth surfacing once it is material.
  const futureDated = budgetRows.filter(
    txn => txn.date > ctx.today && txn.scheduleId === null,
  );
  if (futureDated.length > 0) {
    const total = futureDated.reduce(
      (sum, txn) => sum + Math.abs(txn.amount),
      0,
    );
    if (total >= ctx.scale.floor) {
      const insight = build(ctx, 'future-dated', futureDated, 0);
      if (insight) {
        insights.push(insight);
      }
    }
  }

  return insights;
}
