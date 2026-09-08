import { median, roundToNice } from './stats';
import {
  CATEGORY_FLOOR_RATIO,
  FLOOR_MONTH_RATIO,
  FLOOR_TXN_RATIO,
  MAGNITUDE_SATURATION,
  RECENCY_HORIZON_DAYS,
  URGENCY_HORIZON_DAYS,
} from './thresholds';
import type { InsightScale } from './types';

/**
 * How big is a number in *this* file?
 *
 * Amounts are integer minor units, so there is no such thing as a portable
 * absolute floor: 500 is $5.00, ¥500 and 5.00 EUR at once. Every materiality
 * decision therefore derives from the file's own throughput, which also means
 * the whole engine is scale-invariant — multiply every amount by 1000 and the
 * same insights come out. `scale-invariance.test.ts` proves it.
 */

export function computeScale({
  monthlyTotals,
  transactionAmounts,
  categoryMonthlySpend,
}: {
  /** Per complete month: max(income, |spent|). */
  monthlyTotals: number[];
  /** |amount| of ordinary recent transactions. */
  transactionAmounts: number[];
  /** Per category, its monthly spend across the basis window. */
  categoryMonthlySpend: Record<string, number[]>;
}): InsightScale {
  const txn = median(transactionAmounts);

  // Median, not mean: one bonus or one house purchase must not raise the bar
  // for everything else for the rest of the year.
  let month = median(monthlyTotals);
  if (month <= 0) {
    // A young file has no complete months yet. 30 typical transactions is a
    // crude but honest stand-in, and it keeps the ratios below meaningful.
    month = txn * 30;
  }

  const byCategory: Record<string, number> = {};
  for (const [categoryId, amounts] of Object.entries(categoryMonthlySpend)) {
    byCategory[categoryId] = median(amounts);
  }

  return {
    month,
    txn,
    // Two legs. The month leg is the general bar; the transaction leg protects a
    // low-throughput file with many small transactions, where 0.5% of a month
    // would sit below the price of a coffee.
    floor: Math.max(FLOOR_MONTH_RATIO * month, FLOOR_TXN_RATIO * txn),
    byCategory,
  };
}

/**
 * The bar a claim about one category must clear. A category-scoped insight has
 * to be worth something relative to that category, or a big budget drowns in
 * rows about rounding.
 */
export function categoryFloor(scale: InsightScale, categoryId: string): number {
  const norm = scale.byCategory[categoryId] ?? 0;
  return Math.max(scale.floor, CATEGORY_FLOOR_RATIO * norm);
}

/** True when an amount is worth mentioning at all. */
export function isMaterial(scale: InsightScale, amount: number): boolean {
  return Math.abs(amount) >= scale.floor;
}

/**
 * Quantises an amount for a fingerprint. One floor of drift changes the
 * fingerprint and resurfaces a dismissed insight; a cent does not.
 */
export function bucket(scale: InsightScale, amount: number): number {
  if (scale.floor <= 0) {
    return 0;
  }
  return Math.round(amount / scale.floor);
}

/** A derived low-balance floor, rounded so it reads like a chosen number. */
export function derivedLowBalanceThreshold(
  scale: InsightScale,
  monthRatio: number,
): number {
  return roundToNice(scale.month * monthRatio);
}

/**
 * 0 at the floor, saturating at `MAGNITUDE_SATURATION` times it. Log-shaped so
 * that "twice the floor" and "three times the floor" stay distinguishable while
 * a genuinely huge amount cannot dominate every other ranking term.
 */
export function magnitude(amount: number, floor: number): number {
  if (floor <= 0) {
    return 0;
  }
  const ratio = Math.abs(amount) / floor;
  const scaled = Math.log1p(ratio) / Math.log1p(MAGNITUDE_SATURATION);
  return Math.min(1, Math.max(0, scaled));
}

/** 1 today, reaching 0 at the urgency horizon. */
export function urgency(days: number): number {
  return Math.min(1, Math.max(0, 1 - days / URGENCY_HORIZON_DAYS));
}

/** 1 today, reaching 0 at the recency horizon. */
export function recency(daysAgo: number): number {
  return Math.min(1, Math.max(0, 1 - daysAgo / RECENCY_HORIZON_DAYS));
}

/** Confidence from sample size: 0 with nothing, 1 at a full window. */
export function evidence(n: number, full: number): number {
  if (full <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, n / full));
}
