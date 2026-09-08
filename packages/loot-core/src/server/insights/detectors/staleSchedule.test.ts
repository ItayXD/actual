import { describe, expect, it } from 'vitest';

import { makeContext } from '#server/insights/fixtures';
import type { InsightSchedule } from '#server/insights/types';

import { detectStaleSchedule } from './staleSchedule';

function schedule(overrides: Partial<InsightSchedule> = {}): InsightSchedule {
  return {
    id: 's1',
    name: 'Gym membership',
    nextDate: '2026-09-01',
    amount: -5_000,
    accountId: 'a1',
    payeeId: 'p1',
    categoryId: 'c1',
    completed: false,
    postsTransaction: false,
    isRecurring: true,
    cadence: 'monthly',
    status: 'missed',
    pastOccurrences: [
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ],
    everMatched: true,
    consecutiveUnmatched: 3,
    lastMatchedDate: '2026-06-01',
    ...overrides,
  };
}

describe('detectStaleSchedule', () => {
  it('reports three consecutive unmatched occurrences', () => {
    const insights = detectStaleSchedule(
      makeContext({ schedules: [schedule()] }),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data).toMatchObject({
      scheduleName: 'Gym membership',
      pattern: 'unmatched-run',
      consecutiveUnmatched: 3,
      lastMatchedDate: '2026-06-01',
    });
  });

  it('stays quiet at two misses', () => {
    const insights = detectStaleSchedule(
      makeContext({ schedules: [schedule({ consecutiveUnmatched: 2 })] }),
    );
    expect(insights).toEqual([]);
  });

  it('does not call a brand-new schedule stale', () => {
    // No creation date exists on a schedule, so a young one looks identical to
    // a long-broken one. Requiring a past match or enough elapsed occurrences
    // is what separates them.
    const insights = detectStaleSchedule(
      makeContext({
        schedules: [
          schedule({
            everMatched: false,
            pastOccurrences: ['2026-08-01', '2026-09-01'],
            consecutiveUnmatched: 3,
          }),
        ],
      }),
    );
    expect(insights).toEqual([]);
  });

  it('does call an unproven schedule stale once enough occurrences have passed', () => {
    const insights = detectStaleSchedule(
      makeContext({
        schedules: [schedule({ everMatched: false, lastMatchedDate: null })],
      }),
    );
    expect(insights).toHaveLength(1);
  });

  it('reports an overdue one-time schedule', () => {
    const insights = detectStaleSchedule(
      makeContext({
        schedules: [
          schedule({
            isRecurring: false,
            consecutiveUnmatched: 1,
            nextDate: '2026-05-01',
          }),
        ],
      }),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.pattern).toBe('overdue-one-time');
  });

  it('does not suppress an auto-posting schedule, but flags it as one', () => {
    // An auto-posting schedule with nothing to show for it means something is
    // genuinely broken.
    const insights = detectStaleSchedule(
      makeContext({ schedules: [schedule({ postsTransaction: true })] }),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].data.postsTransaction).toBe(true);
  });

  it('ignores a completed schedule', () => {
    const insights = detectStaleSchedule(
      makeContext({ schedules: [schedule({ completed: true })] }),
    );
    expect(insights).toEqual([]);
  });

  it('brings the insight back when the miss count grows', () => {
    const three = detectStaleSchedule(
      makeContext({ schedules: [schedule({ consecutiveUnmatched: 3 })] }),
    )[0];
    const four = detectStaleSchedule(
      makeContext({ schedules: [schedule({ consecutiveUnmatched: 4 })] }),
    )[0];

    expect(three.fingerprint).not.toBe(four.fingerprint);
  });
});
