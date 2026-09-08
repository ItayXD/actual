import { describe, expect, it } from 'vitest';

import * as monthUtils from '#shared/months';

import type {
  PostedTransaction,
  ScheduleMatchShape,
} from './scheduleOccurrences';
import { resolvePastOccurrences } from './scheduleOccurrences';

const TODAY = '2026-09-15';

function schedule(
  overrides: Partial<ScheduleMatchShape> = {},
): ScheduleMatchShape {
  return {
    id: 's1',
    next_date: '2026-09-01',
    posts_transaction: false,
    _conditions: [],
    ...overrides,
  };
}

/** A real recurrence rule, in the shape `getNextDate` consumes. */
function recur(
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
  interval = 1,
  start = '2024-01-15',
) {
  return {
    op: 'isapprox',
    value: { start, frequency, interval, patterns: [] },
  };
}

function walk(
  dateCond: { op: string; value: unknown } | null,
  posted: PostedTransaction[] = [],
  overrides: Partial<ScheduleMatchShape> = {},
) {
  return resolvePastOccurrences({
    schedule: schedule(overrides),
    dateCond,
    today: TODAY,
    postedTransactions: posted,
  });
}

describe('resolvePastOccurrences', () => {
  /**
   * The bug this suite exists for: the walk used to start a fixed 400 days back
   * with a capped iteration count. A daily schedule needed 400 steps to reach
   * today, so it stopped roughly a year short and reported year-old occurrences
   * as recent misses. An annual schedule had the opposite problem — only one
   * occurrence in 400 days, so it could never reach the three consecutive
   * misses `stale-schedule` looks for.
   */
  const CADENCES: [string, ReturnType<typeof recur>][] = [
    ['daily', recur('daily')],
    ['weekly', recur('weekly')],
    ['fortnightly', recur('weekly', 2)],
    ['monthly', recur('monthly')],
    ['quarterly', recur('monthly', 3)],
    ['annual', recur('yearly')],
  ];

  it.each(CADENCES)(
    'a %s schedule walks right up to today',
    (_name, dateCond) => {
      const { pastOccurrences } = walk(dateCond);

      expect(pastOccurrences.length).toBeGreaterThan(0);
      // Every occurrence is in the past...
      for (const date of pastOccurrences) {
        expect(date <= TODAY).toBe(true);
      }
      // ...and the most recent one is genuinely recent, not stranded a year
      // back by an exhausted iteration budget.
      const newest = pastOccurrences[pastOccurrences.length - 1];
      const staleness = monthUtils.differenceInCalendarDays(TODAY, newest);
      expect(staleness).toBeLessThanOrEqual(370);
    },
  );

  it.each(CADENCES)(
    'a %s schedule can accumulate enough occurrences to look stale',
    (_name, dateCond) => {
      // Without this, `stale-schedule` is silently dead for long cadences.
      const { consecutiveUnmatched } = walk(dateCond);
      expect(consecutiveUnmatched).toBeGreaterThanOrEqual(3);
    },
  );

  it('reports a daily schedule against recent days, not a year ago', () => {
    const { pastOccurrences } = walk(recur('daily'));
    const newest = pastOccurrences[pastOccurrences.length - 1];

    // The old fixed-window walk stopped around 2025-10, ~336 days short.
    expect(
      monthUtils.differenceInCalendarDays(TODAY, newest),
    ).toBeLessThanOrEqual(2);
  });

  it('counts the trailing run of unmatched occurrences', () => {
    const { pastOccurrences, consecutiveUnmatched, lastMatchedDate } = walk(
      recur('monthly'),
      // Match the third-from-last occurrence only.
      [],
    );
    expect(pastOccurrences.length).toBeGreaterThanOrEqual(3);
    expect(consecutiveUnmatched).toBe(pastOccurrences.length);
    expect(lastMatchedDate).toBeNull();
  });

  it('stops counting at the most recent match', () => {
    const monthly = recur('monthly');
    const { pastOccurrences } = walk(monthly);
    const newest = pastOccurrences[pastOccurrences.length - 1];

    const { consecutiveUnmatched, everMatched, lastMatchedDate } = walk(
      monthly,
      [{ schedule: 's1', date: newest }],
    );

    expect(consecutiveUnmatched).toBe(0);
    expect(everMatched).toBe(true);
    expect(lastMatchedDate).toBe(newest);
  });

  it('ignores transactions belonging to a different schedule', () => {
    const { consecutiveUnmatched } = walk(recur('monthly'), [
      { schedule: 'other', date: TODAY },
    ]);
    expect(consecutiveUnmatched).toBeGreaterThan(0);
  });

  it('treats a one-time schedule as its single next_date', () => {
    // `getNextDate` returns the same date forever for an `is` condition, so
    // there is no series to walk and the loop must not spin.
    const { pastOccurrences, consecutiveUnmatched } = walk(
      { op: 'is', value: '2026-05-01' },
      [],
      { next_date: '2026-05-01' },
    );

    expect(pastOccurrences).toEqual(['2026-05-01']);
    expect(consecutiveUnmatched).toBe(1);
  });

  it('reports nothing for a one-time schedule still in the future', () => {
    const { pastOccurrences, consecutiveUnmatched } = walk(
      { op: 'is', value: '2027-01-01' },
      [],
      { next_date: '2027-01-01' },
    );

    expect(pastOccurrences).toEqual([]);
    expect(consecutiveUnmatched).toBe(0);
  });

  it('handles a missing date condition without throwing', () => {
    const result = walk(null, [{ schedule: 's1', date: '2026-08-01' }]);

    expect(result.pastOccurrences).toEqual([]);
    expect(result.consecutiveUnmatched).toBe(0);
    expect(result.everMatched).toBe(true);
    expect(result.lastMatchedDate).toBe('2026-08-01');
  });

  it('keeps the window bounded so long histories cannot blow up', () => {
    const { pastOccurrences } = walk(recur('daily'));
    expect(pastOccurrences.length).toBeLessThanOrEqual(6);
  });
});
