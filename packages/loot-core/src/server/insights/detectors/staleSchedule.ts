import { payeeNameOf } from '#server/insights/lookup';
import { magnitude } from '#server/insights/scale';
import { STALE_SCHEDULE } from '#server/insights/thresholds';
import type { InsightContext } from '#server/insights/types';
import type { StaleScheduleInsight } from '#types/models/insights';

/**
 * "This scheduled bill has not matched a transaction for three occurrences."
 *
 * Occurrence matching is resolved during context assembly using the app's own
 * `isScheduleOccurrencePosted`, so this insight cannot disagree with what the
 * Schedules page shows. Reimplementing the match rules here would eventually
 * drift from them, and a warning that contradicts the rest of the app is worse
 * than no warning.
 *
 * A schedule that auto-posts is *not* suppressed — an auto-posting schedule with
 * nothing to show for it means something is genuinely broken — but the flag is
 * carried through so the client can word it differently.
 */
export function detectStaleSchedule(
  ctx: InsightContext,
): StaleScheduleInsight[] {
  const insights: StaleScheduleInsight[] = [];

  for (const schedule of ctx.schedules) {
    if (schedule.completed) {
      continue;
    }

    // Schedules carry no creation date, so a brand-new one looks identical to a
    // long-broken one. Require either a past match or enough elapsed
    // occurrences before calling it stale.
    const proven =
      schedule.everMatched ||
      schedule.pastOccurrences.length >=
        STALE_SCHEDULE.MIN_ELAPSED_FOR_UNPROVEN;
    if (!proven) {
      continue;
    }

    const isOverdueOneTime =
      !schedule.isRecurring &&
      schedule.consecutiveUnmatched >= 1 &&
      schedule.nextDate !== null;

    const hasUnmatchedRun =
      schedule.isRecurring &&
      schedule.consecutiveUnmatched >= STALE_SCHEDULE.MIN_UNMATCHED;

    if (!hasUnmatchedRun && !isOverdueOneTime) {
      continue;
    }

    const pattern = hasUnmatchedRun ? 'unmatched-run' : 'overdue-one-time';

    insights.push({
      kind: 'stale-schedule',
      id: `stale-schedule:${schedule.id}`,
      // Includes the miss count, so dismissing at three brings it back at four.
      fingerprint: `stale-schedule:${schedule.id}:${schedule.consecutiveUnmatched}`,
      severity: 'warning',
      score:
        0.3 +
        0.4 *
          Math.min(
            1,
            schedule.consecutiveUnmatched / STALE_SCHEDULE.LOOKBACK_OCCURRENCES,
          ) +
        0.3 * magnitude(schedule.amount, ctx.scale.floor),
      subjects: [{ type: 'schedule', id: schedule.id }],
      date: schedule.nextDate,
      amount: schedule.amount,
      expiresAt: null,
      data: {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        payeeId: schedule.payeeId,
        payeeName: payeeNameOf(ctx, schedule.payeeId),
        pattern,
        consecutiveUnmatched: schedule.consecutiveUnmatched,
        occurrenceDates: schedule.pastOccurrences.slice(
          -STALE_SCHEDULE.LOOKBACK_OCCURRENCES,
        ),
        lastMatchedDate: schedule.lastMatchedDate,
        expectedAmount: schedule.amount,
        postsTransaction: schedule.postsTransaction,
      },
    });
  }

  return insights;
}
