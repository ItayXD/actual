import type {
  Insight,
  InsightKind,
  InsightUnavailableReason,
} from '#types/models/insights';

import { detectLowBalance, detectNegativeBalance } from './detectors/balance';
import {
  detectBillIncrease,
  detectSubscriptionChange,
} from './detectors/bills';
import {
  detectCategoryOverspendRisk,
  detectMonthEndProjection,
  detectSpendingPace,
} from './detectors/budget';
import { detectUpcomingCommitments } from './detectors/commitments';
import { detectDataQuality } from './detectors/dataQuality';
import { detectPossibleDuplicate } from './detectors/duplicates';
import { detectMissingRecurring } from './detectors/missing';
import { detectStaleSchedule } from './detectors/staleSchedule';
import { detectIncomeVolatility, detectTrendChange } from './detectors/trends';
import { detectUnderfundedCategory } from './detectors/underfunded';
import { detectUnusualTransaction } from './detectors/unusual';
import { KIND_WEIGHT } from './thresholds';
import type { Detector, InsightContext, ResolvedInsightsConfig } from './types';

/**
 * Every detector, with how many rows it may contribute.
 *
 * The caps are the first line of noise control: an account-level detector that
 * fires on nine accounts, or a payee-level one that fires on forty payees, must
 * not be able to fill the card on its own. Total ceiling across all sixteen is
 * 37; realistic emission on a healthy file is two to six.
 */
export const DETECTORS: readonly Detector[] = [
  // One per at-risk account; most files have one or two.
  { kind: 'negative-balance', cap: 2, detect: detectNegativeBalance },
  { kind: 'low-balance', cap: 2, detect: detectLowBalance },

  // Singletons by construction.
  { kind: 'upcoming-commitments', cap: 1, detect: detectUpcomingCommitments },
  { kind: 'month-end-projection', cap: 1, detect: detectMonthEndProjection },
  { kind: 'income-volatility', cap: 1, detect: detectIncomeVolatility },

  // Category-level. Three is a scannable list.
  {
    kind: 'category-overspend-risk',
    cap: 3,
    detect: detectCategoryOverspendRisk,
  },
  { kind: 'spending-pace', cap: 3, detect: detectSpendingPace },
  { kind: 'underfunded-category', cap: 3, detect: detectUnderfundedCategory },

  // Payee and schedule level.
  { kind: 'subscription-change', cap: 3, detect: detectSubscriptionChange },
  { kind: 'bill-increase', cap: 3, detect: detectBillIncrease },
  { kind: 'missing-recurring', cap: 3, detect: detectMissingRecurring },
  { kind: 'stale-schedule', cap: 3, detect: detectStaleSchedule },
  { kind: 'unusual-transaction', cap: 3, detect: detectUnusualTransaction },

  // Each is a discrete, individually actionable pair.
  { kind: 'possible-duplicate', cap: 5, detect: detectPossibleDuplicate },

  // Slow-moving; more than two is a report, not an insight.
  { kind: 'trend-change', cap: 2, detect: detectTrendChange },

  // At most one row per issue.
  { kind: 'data-quality', cap: 2, detect: detectDataQuality },
];

export const CAPS = Object.fromEntries(
  DETECTORS.map(detector => [detector.kind, detector.cap]),
) as Record<InsightKind, number>;

export type DetectorRunResult = {
  insights: Insight[];
  unavailable: Partial<Record<InsightKind, InsightUnavailableReason>>;
};

/**
 * Runs every requested detector and applies its registry weight.
 *
 * A detector that cannot say anything useful reports *why* rather than
 * returning an empty list, so the card can distinguish "nothing is wrong" from
 * "not enough history to tell yet" — a difference that matters a great deal to
 * someone whose file is two months old.
 */
export function runDetectors(
  ctx: InsightContext,
  cfg: ResolvedInsightsConfig,
): DetectorRunResult {
  const insights: Insight[] = [];
  const unavailable: Partial<Record<InsightKind, InsightUnavailableReason>> =
    {};

  for (const detector of DETECTORS) {
    if (cfg.kinds.size > 0 && !cfg.kinds.has(detector.kind)) {
      continue;
    }

    const produced = detector.detect(ctx, cfg);
    const list = Array.isArray(produced) ? produced : produced.insights;
    if (!Array.isArray(produced)) {
      unavailable[detector.kind] = produced.unavailable;
    }

    const weight = KIND_WEIGHT[detector.kind] ?? 1;

    for (const insight of list) {
      insights.push(
        weight === 1 ? insight : { ...insight, score: insight.score * weight },
      );
    }
  }

  return { insights, unavailable };
}
