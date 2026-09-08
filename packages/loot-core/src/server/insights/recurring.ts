import * as monthUtils from '#shared/months';
import { getApproxNumberThreshold } from '#shared/rules';
import type { RecurrenceCadence } from '#types/models/insights';

import { mad, median } from './stats';
import { MISSING_RECURRING } from './thresholds';
import type { InsightTxn, PayeeSeries } from './types';

/**
 * Recurring payee streams, built once from the single transaction pull.
 *
 * Four detectors need "is this payee regular, and what does it usually cost":
 * bill increase, subscription change, missing recurring item, and unusual
 * transaction. They share this.
 *
 * Deliberately **not** built on `server/schedules/find-schedules.ts`. That works
 * the other way round — it proposes candidate recur configs and queries the
 * database for each candidate start date to see what matches, which is hundreds
 * of round trips. Fine for an interactive "discover my schedules" flow, fatal
 * for a dashboard render. Only its ideas are reused: amount tolerance via
 * `getApproxNumberThreshold` (±7.5%).
 */

/** Inclusive day-gap windows that count as a cadence. */
const CADENCE_WINDOWS: {
  cadence: RecurrenceCadence;
  min: number;
  max: number;
}[] = [
  { cadence: 'weekly', min: 5, max: 9 },
  { cadence: 'biweekly', min: 12, max: 16 },
  { cadence: 'monthly', min: 26, max: 35 },
  { cadence: 'quarterly', min: 85, max: 95 },
  { cadence: 'annual', min: 355, max: 375 },
];

/** Gap jitter beyond this fraction of the cadence means "not regular". */
const REGULARITY_MAD_RATIO = 0.25;

export const CADENCE_DAYS: Record<RecurrenceCadence, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  annual: 365,
};

export const OCCURRENCES_PER_YEAR: Record<RecurrenceCadence, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

export function cadenceForGap(gapDays: number): RecurrenceCadence | null {
  const window = CADENCE_WINDOWS.find(
    w => gapDays >= w.min && gapDays <= w.max,
  );
  return window ? window.cadence : null;
}

/** How long to wait past the expected date before calling a series late. */
export function toleranceDays(medianGapDays: number): number {
  return Math.max(
    MISSING_RECURRING.MIN_TOLERANCE_DAYS,
    Math.round(medianGapDays * MISSING_RECURRING.TOLERANCE_CADENCE_RATIO),
  );
}

/**
 * Groups transactions into recurring streams.
 *
 * Grouped by `(payeeId, sign)`, not just payee: a payee that both charges and
 * refunds would otherwise look wildly irregular in both amount and cadence.
 */
export function buildPayeeSeries(
  txns: InsightTxn[],
  payeeNames: Record<string, string>,
  /**
   * Cadence declared by each schedule, when it has one. A schedule-linked
   * stream trusts this over anything inferred from posting dates.
   */
  scheduleCadences: Record<string, RecurrenceCadence | null> = {},
): PayeeSeries[] {
  const groups = new Map<string, InsightTxn[]>();

  for (const txn of txns) {
    if (txn.payeeId === null || txn.amount === 0 || txn.isParent) {
      continue;
    }
    const key = `${txn.payeeId}:${txn.amount > 0 ? 1 : -1}`;
    const group = groups.get(key);
    if (group) {
      group.push(txn);
    } else {
      groups.set(key, [txn]);
    }
  }

  const series: PayeeSeries[] = [];

  for (const [key, group] of groups) {
    if (group.length < MISSING_RECURRING.MIN_OCCURRENCES) {
      continue;
    }

    const occurrences = [...group]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map(txn => ({ id: txn.id, date: txn.date, amount: txn.amount }));

    const gaps: number[] = [];
    for (let i = 1; i < occurrences.length; i++) {
      gaps.push(
        monthUtils.differenceInCalendarDays(
          occurrences[i].date,
          occurrences[i - 1].date,
        ),
      );
    }

    const medianGapDays = median(gaps);
    const gapMad = mad(gaps);
    const [payeeId] = key.split(':');

    // Resolve the schedule link first. When every occurrence links to the same
    // schedule the user has *declared* the cadence, so it must not be gated on
    // what the posting dates happen to look like — a bill paid on the 3rd, then
    // the 27th, then the 5th is still monthly, and inferring from those gaps
    // would reject it outright.
    const scheduleIds = new Set(group.map(txn => txn.scheduleId));
    const singleSchedule =
      scheduleIds.size === 1 && !scheduleIds.has(null)
        ? ([...scheduleIds][0] as string)
        : null;
    const declaredCadence =
      singleSchedule !== null ? scheduleCadences[singleSchedule] : null;

    const cadence = declaredCadence ?? cadenceForGap(medianGapDays);
    if (cadence === null) {
      continue;
    }

    // Project from the nominal cadence when it was declared, since the observed
    // gaps are exactly what we just decided not to trust.
    const projectionGap =
      declaredCadence !== null ? CADENCE_DAYS[declaredCadence] : medianGapDays;

    series.push({
      key,
      payeeId,
      payeeName: payeeNames[payeeId] ?? '',
      sign: group[0].amount > 0 ? 1 : -1,
      scheduleId: singleSchedule,
      occurrences,
      medianGapDays,
      gapMad,
      cadence,
      regular:
        declaredCadence !== null ||
        gapMad <= REGULARITY_MAD_RATIO * medianGapDays,
      expectedNextDate: monthUtils.addDays(
        occurrences[occurrences.length - 1].date,
        Math.round(projectionGap),
      ),
    });
  }

  return series.sort((a, b) => (a.key < b.key ? -1 : 1));
}

export type AmountRun = {
  /** Median amount over the run, signed as the transactions are. */
  amount: number;
  occurrences: { id: string; date: string; amount: number }[];
};

/**
 * Splits a series into consecutive runs of roughly-equal amounts.
 *
 * This is what separates a subscription price change from a noisy bill: a
 * subscription is a fixed price, then a different fixed price. A utility bill
 * wanders every month and produces one long ragged run, or many one-element
 * runs, neither of which looks like a step.
 */
export function segmentRuns(
  occurrences: { id: string; date: string; amount: number }[],
): AmountRun[] {
  const runs: AmountRun[] = [];
  let current: { id: string; date: string; amount: number }[] = [];
  let anchor = 0;

  for (const occurrence of occurrences) {
    if (current.length === 0) {
      current = [occurrence];
      anchor = occurrence.amount;
      continue;
    }

    const threshold = getApproxNumberThreshold(anchor);
    const withinRun = Math.abs(occurrence.amount - anchor) <= threshold;

    if (withinRun) {
      current.push(occurrence);
    } else {
      runs.push({
        amount: median(current.map(o => o.amount)),
        occurrences: current,
      });
      current = [occurrence];
      anchor = occurrence.amount;
    }
  }

  if (current.length > 0) {
    runs.push({
      amount: median(current.map(o => o.amount)),
      occurrences: current,
    });
  }

  return runs;
}

/** True when every amount sits within the tolerance of the run's median. */
export function isStableRun(run: AmountRun): boolean {
  const threshold = getApproxNumberThreshold(run.amount);
  return run.occurrences.every(
    o => Math.abs(o.amount - run.amount) <= threshold,
  );
}
