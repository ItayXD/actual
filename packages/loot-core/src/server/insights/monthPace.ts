import { combineProfiles, normalizeMonthProfile } from '#shared/spending-pace';

import { median } from './stats';
import { OVERSPEND, PACE } from './thresholds';
import type { InsightContext } from './types';

/**
 * "How much of this month's spending should have happened by now?"
 *
 * The naive answer — `spent / (dayOfMonth / daysInMonth)` — is wrong in a way
 * that matters: rent, insurance and subscriptions land on the 1st, so on the 2nd
 * of the month a linear model reports every fixed-cost category as several
 * hundred percent over pace. Every row would be a false alarm, every month.
 *
 * Instead we learn the category's own **shape** across the month from its
 * history: what fraction of a month's total had normally been spent by this
 * point. A rent category's curve jumps to ~1.0 on day 1 and stays flat, so being
 * "fully spent" on the 2nd is exactly on pace and produces no insight.
 *
 * The shape itself is built by `#shared/spending-pace`, which the budget
 * table's balance forecast uses too. Only one module should know how to
 * normalise a month's curve and combine several of them; what stays here is
 * what the detectors need on top — the median month total to scale by, the
 * minimum history to speak at all, and the schedule-aware projection below.
 */

/**
 * Maps a day to a fixed slot index so months of different lengths compare. Day 1
 * is always slot 1 and the last day is always slot `SLOTS`.
 */
export function slotForDay(day: number, daysInMonth: number): number {
  if (daysInMonth <= 1) {
    return 1;
  }
  const fraction = (day - 1) / (daysInMonth - 1);
  return Math.round(fraction * (PACE.SLOTS - 1)) + 1;
}

export type PaceExpectation = {
  /** What history says should have been spent by now. */
  expectedToDate: number;
  /** Complete months the estimate is based on. */
  basisMonths: number;
  /** Median of the whole-month totals over those months. */
  medianMonthTotal: number;
};

/**
 * What this category has normally cost by this point in the month.
 *
 * Returns null when there is not enough history to say anything, which the
 * detectors treat as "stay quiet" rather than guessing.
 */
export function expectedSpendToDate(
  ctx: InsightContext,
  categoryId: string,
): PaceExpectation | null {
  const recent = ctx.months.slice(-PACE.MAX_BASIS_MONTHS);
  const profiles: number[][] = [];
  const totals: number[] = [];

  for (const month of recent) {
    const curve = ctx.cumulativeByCategoryMonth[`${categoryId}:${month.month}`];
    if (!curve || curve.length <= 1) {
      continue;
    }
    // The context stores these 1-based, with padding at index 0.
    const profile = normalizeMonthProfile(curve.slice(1), ctx.daysInMonth);
    if (profile === null) {
      // The category did not exist or was unused. Including it as a zero would
      // drag the curve down and invent an "above pace" reading.
      continue;
    }
    profiles.push(profile);
    totals.push(curve[curve.length - 1]);
  }

  if (profiles.length < PACE.MIN_BASIS_MONTHS) {
    return null;
  }

  // Both medians, so one aberrant month cannot bend either the shape or the
  // level. Stretching each month onto this month's length happens inside
  // `normalizeMonthProfile`, which is finer than the slot mapping it replaced.
  const profile = combineProfiles(profiles);
  const medianMonthTotal = median(totals);
  const day = Math.min(Math.max(ctx.dayOfMonth, 1), ctx.daysInMonth);
  return {
    expectedToDate: Math.round(medianMonthTotal * profile[day - 1]),
    basisMonths: profiles.length,
    medianMonthTotal,
  };
}

/** Spend so far this month in a category, as a positive number. */
export function spentThisMonth(
  ctx: InsightContext,
  categoryId: string,
): number {
  const cell = ctx.currentMonth.byCategory[categoryId];
  return cell ? -cell.sumAmount : 0;
}

/** What is still available in a category, including carryover. */
export function availableThisMonth(
  ctx: InsightContext,
  categoryId: string,
): number {
  const cell = ctx.currentMonth.byCategory[categoryId];
  return cell ? cell.leftover : 0;
}

/**
 * Unposted scheduled outflows still to land in this category this month.
 *
 * This is arithmetic rather than projection, which is why a detector can speak
 * confidently about it on the 3rd of the month when a run-rate would be
 * meaningless.
 */
export function scheduledRemainingThisMonth(
  ctx: InsightContext,
  categoryId: string,
): number {
  const monthEnd = `${ctx.month}-${String(ctx.daysInMonth).padStart(2, '0')}`;
  let total = 0;

  for (const occurrence of ctx.occurrences) {
    if (
      occurrence.categoryId === categoryId &&
      occurrence.amount < 0 &&
      occurrence.date > ctx.today &&
      occurrence.date <= monthEnd
    ) {
      total += -occurrence.amount;
    }
  }

  return total;
}

/**
 * Discretionary run-rate for the rest of the month.
 *
 * Schedule-linked spend is excluded from the rate and counted separately by
 * `scheduledRemainingThisMonth`, so one large posted bill early in the month
 * cannot make the projection absurd.
 */
export function paceRemainingThisMonth(
  ctx: InsightContext,
  categoryId: string,
): number {
  if (ctx.daysElapsed <= 0) {
    return 0;
  }

  let discretionary = 0;
  for (const txn of ctx.txns) {
    if (
      txn.categoryId === categoryId &&
      txn.scheduleId === null &&
      txn.amount < 0 &&
      !txn.isParent &&
      txn.date >= `${ctx.month}-01` &&
      txn.date <= ctx.today
    ) {
      discretionary += -txn.amount;
    }
  }

  return Math.round((discretionary / ctx.daysElapsed) * ctx.daysRemaining);
}

export type CategoryProjection = {
  available: number;
  spentSoFar: number;
  scheduledRemaining: number;
  paceRemaining: number;
  /** Positive means the category is heading past its balance. */
  projectedOverspend: number;
  /** What is expected to be left at month end. Negative means overspent. */
  projectedRemaining: number;
  /**
   * 'scheduled' means the remaining bills alone exceed the balance — a fact, not
   * a forecast. The client words the two differently.
   */
  basis: 'scheduled' | 'pace';
};

export function projectCategory(
  ctx: InsightContext,
  categoryId: string,
): CategoryProjection {
  const available = availableThisMonth(ctx, categoryId);
  const spentSoFar = spentThisMonth(ctx, categoryId);
  const scheduledRemaining = scheduledRemainingThisMonth(ctx, categoryId);

  // Early in the month a run-rate is built on too few days to mean anything, so
  // fall back to the bills we can actually enumerate.
  const usePace = ctx.daysElapsed >= OVERSPEND.MIN_DAYS_FOR_PACE;
  const paceRemaining = usePace ? paceRemainingThisMonth(ctx, categoryId) : 0;

  const projectedRemaining = available - scheduledRemaining - paceRemaining;

  return {
    available,
    spentSoFar,
    scheduledRemaining,
    paceRemaining,
    // `|| 0` collapses negative zero, which would otherwise format as
    // "-0.00" — the same guard `budget/past-spending.ts` applies.
    projectedOverspend: -projectedRemaining || 0,
    projectedRemaining,
    basis: paceRemaining > 0 ? 'pace' : 'scheduled',
  };
}
