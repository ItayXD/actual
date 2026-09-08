import { categoryNameOf, payeeNameOf } from '#server/insights/lookup';
import { magnitude, recency } from '#server/insights/scale';
import { median, robustZScore } from '#server/insights/stats';
import { UNUSUAL } from '#server/insights/thresholds';
import type { InsightContext, InsightTxn } from '#server/insights/types';
import * as monthUtils from '#shared/months';
import type { UnusualTransactionInsight } from '#types/models/insights';

/**
 * "This purchase is much larger than your normal transactions for this payee."
 *
 * Uses a **robust** z-score: `(|amount| - median) / (1.4826 * MAD)`, computed
 * against a baseline that excludes the transaction under test. Both details
 * matter on samples this small — a plain z-score lets an outlier inflate its own
 * denominator and then fails to flag itself, which is the classic way this
 * detector silently does nothing.
 *
 * The category fallback is the case that matters most in practice: a large
 * one-off at a brand-new payee, where a payee-only detector is blind.
 */

function eligible(txn: InsightTxn): boolean {
  return (
    !txn.isParent &&
    // A schedule explains its own amount.
    txn.scheduleId === null &&
    txn.amount < 0
  );
}

export function detectUnusualTransaction(
  ctx: InsightContext,
): UnusualTransactionInsight[] {
  const cutoff = monthUtils.subDays(ctx.today, UNUSUAL.MAX_AGE_DAYS);

  const byPayee = new Map<string, number[]>();
  const byCategory = new Map<string, number[]>();
  for (const txn of ctx.txns) {
    if (!eligible(txn)) {
      continue;
    }
    const amount = Math.abs(txn.amount);
    if (txn.payeeId !== null) {
      const list = byPayee.get(txn.payeeId);
      if (list) {
        list.push(amount);
      } else {
        byPayee.set(txn.payeeId, [amount]);
      }
    }
    if (txn.categoryId !== null) {
      const list = byCategory.get(txn.categoryId);
      if (list) {
        list.push(amount);
      } else {
        byCategory.set(txn.categoryId, [amount]);
      }
    }
  }

  const insights: UnusualTransactionInsight[] = [];

  for (const txn of ctx.txns) {
    if (!eligible(txn) || txn.date < cutoff || txn.date > ctx.today) {
      continue;
    }

    const amount = Math.abs(txn.amount);
    const payeePool =
      txn.payeeId === null ? [] : (byPayee.get(txn.payeeId) ?? []);

    let basis: 'payee' | 'category' | null = null;
    let pool: number[] = [];
    let minZ = 0;

    if (payeePool.length >= UNUSUAL.MIN_PAYEE_SAMPLE) {
      basis = 'payee';
      pool = payeePool;
      minZ = UNUSUAL.PAYEE_MIN_Z;
    } else if (txn.categoryId !== null) {
      const categoryPool = byCategory.get(txn.categoryId) ?? [];
      if (categoryPool.length >= UNUSUAL.MIN_CATEGORY_SAMPLE) {
        basis = 'category';
        pool = categoryPool;
        minZ = UNUSUAL.CATEGORY_MIN_Z;
      }
    }

    if (basis === null) {
      continue;
    }

    // Exclude this transaction from its own baseline.
    const baseline = [...pool];
    const at = baseline.indexOf(amount);
    if (at !== -1) {
      baseline.splice(at, 1);
    }
    if (baseline.length === 0) {
      continue;
    }

    const typicalAmount = median(baseline);
    if (typicalAmount <= 0) {
      continue;
    }

    const z = robustZScore(amount, baseline, UNUSUAL.SIGMA_FLOOR_MEDIAN_RATIO);
    const ratio = amount / typicalAmount;

    if (z < minZ || ratio < UNUSUAL.PAYEE_MIN_RATIO) {
      continue;
    }
    if (amount - typicalAmount < ctx.scale.floor) {
      continue;
    }

    insights.push({
      kind: 'unusual-transaction',
      id: `unusual-transaction:${txn.id}`,
      // Keyed on the transaction, so a dismissal is permanent — which is right:
      // the user has looked at that specific row and accepted it.
      fingerprint: `unusual-transaction:${txn.id}`,
      severity: z >= UNUSUAL.WARNING_Z ? 'warning' : 'info',
      score:
        0.5 * Math.min(1, z / 10) +
        0.3 * magnitude(amount - typicalAmount, ctx.scale.floor) +
        0.2 * recency(monthUtils.differenceInCalendarDays(ctx.today, txn.date)),
      subjects: [
        { type: 'transaction', id: txn.id },
        ...(txn.payeeId !== null
          ? [{ type: 'payee' as const, id: txn.payeeId }]
          : []),
      ],
      date: txn.date,
      amount: txn.amount,
      expiresAt: null,
      data: {
        transactionId: txn.id,
        payeeId: txn.payeeId,
        payeeName: payeeNameOf(ctx, txn.payeeId),
        categoryId: txn.categoryId,
        categoryName:
          txn.categoryId === null ? null : categoryNameOf(ctx, txn.categoryId),
        chargeAmount: txn.amount,
        txDate: txn.date,
        basis,
        typicalAmount: Math.round(typicalAmount),
        ratio: Math.round(ratio * 10) / 10,
        z: Math.round(z * 10) / 10,
        sampleSize: baseline.length,
      },
    });
  }

  return insights;
}
