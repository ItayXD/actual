import * as monthUtils from '#shared/months';
import { getNextDate, isScheduleOccurrencePosted } from '#shared/schedules';
import type { RuleConditionEntity } from '#types/models';

import { STALE_SCHEDULE } from './thresholds';

/** Just the fields the occurrence matcher needs from a schedule. */
export type ScheduleMatchShape = {
  id: string;
  next_date: string | null;
  posts_transaction: boolean;
  _conditions: RuleConditionEntity[] | null;
};

export type PostedTransaction = { schedule?: string | null; date: string };

/**
 * Walks a schedule's occurrences up to today and asks the app's own matcher
 * whether each one posted.
 *
 * Reusing `isScheduleOccurrencePosted` rather than reimplementing the match
 * rules is deliberate: it applies the same `posts_transaction` /
 * `dateCond.op === 'is'` / two-day-lookback logic as the Schedules page, so an
 * insight can never contradict what the rest of the app shows.
 */
export function resolvePastOccurrences({
  schedule,
  dateCond,
  today,
  postedTransactions,
}: {
  schedule: ScheduleMatchShape;
  dateCond: { op: string; value: unknown } | null;
  today: string;
  postedTransactions: PostedTransaction[];
}): {
  pastOccurrences: string[];
  consecutiveUnmatched: number;
  lastMatchedDate: string | null;
  everMatched: boolean;
} {
  const everMatched = postedTransactions.length > 0;
  const lastMatchedDate = everMatched
    ? (postedTransactions
        .map(tx => tx.date)
        .sort()
        .at(-1) ?? null)
    : null;

  if (dateCond === null) {
    return {
      pastOccurrences: [],
      consecutiveUnmatched: 0,
      lastMatchedDate,
      everMatched,
    };
  }

  const matchInput = {
    posts_transaction: schedule.posts_transaction,
    _conditions: schedule._conditions ?? [],
  };

  // Size the lookback by the schedule's *own* rhythm rather than a fixed number
  // of days. A fixed 400-day window with a capped iteration count is wrong at
  // both ends: a daily schedule needs 400 steps to reach today, so the walk
  // stops a year short and reports year-old occurrences as recent misses; while
  // an annual schedule only has one occurrence in 400 days and could never
  // accumulate the three misses the detector looks for.
  //
  // The rhythm is measured from the recur rule itself, so it works even for
  // rules `cadenceForRecurConfig` does not recognise.
  const occurrences: string[] = [];
  const firstAhead = getNextDate(dateCond, monthUtils.parseDate(today));
  const secondAhead =
    firstAhead === null
      ? null
      : getNextDate(
          dateCond,
          monthUtils.parseDate(monthUtils.addDays(firstAhead, 1)),
        );

  const stepDays =
    firstAhead !== null && secondAhead !== null
      ? monthUtils.differenceInCalendarDays(secondAhead, firstAhead)
      : 0;

  if (stepDays <= 0) {
    // A one-time schedule: `getNextDate` returns the same date forever, so
    // there is no series to walk. Its single occurrence is its next_date.
    if (schedule.next_date !== null && schedule.next_date <= today) {
      occurrences.push(schedule.next_date);
    }
  } else {
    const span = (STALE_SCHEDULE.LOOKBACK_OCCURRENCES + 2) * stepDays;
    let cursor = monthUtils.parseDate(monthUtils.subDays(today, span));
    const maxSteps = STALE_SCHEDULE.LOOKBACK_OCCURRENCES + 6;

    for (let i = 0; i < maxSteps; i++) {
      const next = getNextDate(dateCond, cursor);
      if (next === null || next > today) {
        break;
      }
      if (occurrences.at(-1) === next) {
        break;
      }
      occurrences.push(next);
      cursor = monthUtils.parseDate(monthUtils.addDays(next, 1));
    }
  }

  const window = occurrences.slice(-STALE_SCHEDULE.LOOKBACK_OCCURRENCES);
  let consecutiveUnmatched = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    const posted = isScheduleOccurrencePosted({
      schedule: matchInput,
      scheduleId: schedule.id,
      occurrenceDate: window[i],
      postedTransactions,
    });
    if (posted) {
      break;
    }
    consecutiveUnmatched++;
  }

  return {
    pastOccurrences: window,
    consecutiveUnmatched,
    lastMatchedDate,
    everMatched,
  };
}
