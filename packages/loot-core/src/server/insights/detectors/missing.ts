import { payeeNameOf } from '#server/insights/lookup';
import { CADENCE_DAYS, toleranceDays } from '#server/insights/recurring';
import { magnitude } from '#server/insights/scale';
import { median } from '#server/insights/stats';
import { MISSING_RECURRING } from '#server/insights/thresholds';
import type { InsightContext } from '#server/insights/types';
import * as monthUtils from '#shared/months';
import type { MissingRecurringInsight } from '#types/models/insights';

/**
 * "A paycheck normally received by this date has not appeared."
 *
 * Two sources, and ground truth is preferred: a schedule the user created knows
 * more than a pattern we inferred. When both fire for the same payee, `rank.ts`
 * keeps the schedule-sourced one.
 *
 * A missing *inflow* is treated as categorically more urgent than a missing
 * outflow — a late paycheck changes what you can spend today, whereas a
 * bill that has not arrived is at worst tidiness.
 */
export function detectMissingRecurring(
  ctx: InsightContext,
): MissingRecurringInsight[] {
  const insights: MissingRecurringInsight[] = [];

  // (a) Schedules the app itself considers missed.
  for (const schedule of ctx.schedules) {
    if (
      schedule.completed ||
      schedule.status !== 'missed' ||
      schedule.nextDate === null
    ) {
      continue;
    }

    // Three or more consecutive misses is chronic, not late — that is
    // `stale-schedule`, which supersedes this.
    if (schedule.consecutiveUnmatched > MISSING_RECURRING.MAX_SCHEDULE_MISSES) {
      continue;
    }

    const daysLate = monthUtils.differenceInCalendarDays(
      ctx.today,
      schedule.nextDate,
    );
    if (daysLate <= 0 || daysLate > MISSING_RECURRING.MAX_DAYS_LATE) {
      continue;
    }
    if (Math.abs(schedule.amount) < ctx.scale.floor) {
      continue;
    }

    const isIncome = schedule.amount > 0;
    const cadence = schedule.cadence ?? 'monthly';
    const tolerance = toleranceDays(CADENCE_DAYS[cadence]);

    insights.push({
      kind: 'missing-recurring',
      id: `missing-recurring:s:${schedule.id}`,
      fingerprint: `missing-recurring:s:${schedule.id}:${schedule.nextDate}`,
      severity:
        isIncome && daysLate >= MISSING_RECURRING.INCOME_CRITICAL_DAYS
          ? 'critical'
          : 'warning',
      score:
        0.4 * Math.min(1, daysLate / Math.max(1, CADENCE_DAYS[cadence])) +
        0.3 * magnitude(schedule.amount, ctx.scale.floor) +
        0.3 * (isIncome ? 1 : 0.3),
      subjects: [
        { type: 'schedule', id: schedule.id },
        ...(schedule.payeeId !== null
          ? [{ type: 'payee' as const, id: schedule.payeeId }]
          : []),
      ],
      date: schedule.nextDate,
      amount: schedule.amount,
      expiresAt: null,
      data: {
        source: 'schedule',
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        payeeId: schedule.payeeId,
        payeeName: payeeNameOf(ctx, schedule.payeeId),
        expectedDate: schedule.nextDate,
        daysLate,
        expectedAmount: schedule.amount,
        isIncome,
        cadence,
        toleranceDays: tolerance,
      },
    });
  }

  // (b) Recurring payees with no schedule attached.
  for (const series of ctx.series) {
    if (!series.regular || series.scheduleId !== null) {
      continue;
    }
    if (series.occurrences.length < MISSING_RECURRING.MIN_OCCURRENCES) {
      continue;
    }

    const tolerance = toleranceDays(series.medianGapDays);
    const daysLate = monthUtils.differenceInCalendarDays(
      ctx.today,
      series.expectedNextDate,
    );
    if (daysLate < tolerance || daysLate > MISSING_RECURRING.MAX_DAYS_LATE) {
      continue;
    }

    // Is the stream still alive? This is what separates "your paycheck is late"
    // from "you cancelled this subscription six months ago".
    const lastDate = series.occurrences[series.occurrences.length - 1].date;
    const sinceLast = monthUtils.differenceInCalendarDays(ctx.today, lastDate);
    const aliveLimit =
      MISSING_RECURRING.ALIVE_CADENCE_MULTIPLE * series.medianGapDays +
      tolerance;
    if (sinceLast > aliveLimit) {
      continue;
    }

    const expectedAmount = median(series.occurrences.map(o => o.amount));
    if (Math.abs(expectedAmount) < ctx.scale.floor) {
      continue;
    }

    const isIncome = series.sign === 1;

    insights.push({
      kind: 'missing-recurring',
      id: `missing-recurring:p:${series.key}`,
      fingerprint: `missing-recurring:p:${series.key}:${series.expectedNextDate}`,
      severity:
        isIncome && daysLate >= MISSING_RECURRING.INCOME_CRITICAL_DAYS
          ? 'critical'
          : 'warning',
      score:
        0.4 * Math.min(1, daysLate / Math.max(1, series.medianGapDays)) +
        0.3 * magnitude(expectedAmount, ctx.scale.floor) +
        0.3 * (isIncome ? 1 : 0.3),
      subjects: [{ type: 'payee', id: series.payeeId }],
      date: series.expectedNextDate,
      amount: expectedAmount,
      expiresAt: null,
      data: {
        source: 'series',
        scheduleId: null,
        scheduleName: null,
        payeeId: series.payeeId,
        payeeName: series.payeeName,
        expectedDate: series.expectedNextDate,
        daysLate,
        expectedAmount: Math.round(expectedAmount),
        isIncome,
        cadence: series.cadence,
        toleranceDays: tolerance,
      },
    });
  }

  return insights;
}
