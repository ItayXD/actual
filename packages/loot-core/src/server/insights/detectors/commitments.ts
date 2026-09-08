import { bucket, urgency } from '#server/insights/scale';
import { COMMITMENTS } from '#server/insights/thresholds';
import type { InsightContext } from '#server/insights/types';
import * as monthUtils from '#shared/months';
import type {
  InsightUnavailableReason,
  UpcomingCommitmentsInsight,
} from '#types/models/insights';

/**
 * "Three scheduled bills totalling $860 arrive before your next expected
 * income."
 *
 * The sentence only means anything relative to the next payday, so when we
 * cannot identify one this reports itself unavailable rather than falling back
 * to an arbitrary window and saying something less true.
 */
export function detectUpcomingCommitments(ctx: InsightContext):
  | UpcomingCommitmentsInsight[]
  | {
      insights: UpcomingCommitmentsInsight[];
      unavailable: InsightUnavailableReason;
    } {
  if (ctx.nextIncome === null) {
    return { insights: [], unavailable: 'insufficient-history' };
  }

  const nextIncomeDate = ctx.nextIncome.date;
  const outflows = ctx.occurrences.filter(
    occurrence =>
      occurrence.amount < 0 &&
      occurrence.date > ctx.today &&
      occurrence.date < nextIncomeDate,
  );

  if (outflows.length < COMMITMENTS.MIN_COUNT) {
    return [];
  }

  const total = outflows.reduce((sum, o) => sum + -o.amount, 0);
  if (total < ctx.scale.floor) {
    return [];
  }

  const accounts = ctx.accounts.filter(a => !a.closed && !a.offbudget);
  const available = accounts.reduce((sum, a) => sum + a.balance, 0);
  const coverageRatio = total > 0 ? available / total : 0;

  // The noise control that makes this detector bearable: "three bills totalling
  // $860 arrive, and you are holding $9,000" is not an insight.
  if (coverageRatio >= COMMITMENTS.MAX_COVERAGE_RATIO) {
    return [];
  }

  const daysUntilIncome = monthUtils.differenceInCalendarDays(
    nextIncomeDate,
    ctx.today,
  );

  const severity =
    coverageRatio < 1
      ? 'critical'
      : coverageRatio < COMMITMENTS.WARNING_COVERAGE_RATIO
        ? 'warning'
        : 'info';

  return [
    {
      kind: 'upcoming-commitments',
      id: `upcoming-commitments:${nextIncomeDate}`,
      fingerprint: `upcoming-commitments:${nextIncomeDate}:${outflows.length}:${bucket(ctx.scale, total)}`,
      severity,
      score:
        0.6 *
          (1 -
            Math.min(
              1,
              Math.max(0, coverageRatio / COMMITMENTS.MAX_COVERAGE_RATIO),
            )) +
        0.4 * urgency(daysUntilIncome),
      subjects: accounts
        .slice(0, 1)
        .map(a => ({ type: 'account' as const, id: a.id })),
      date: nextIncomeDate,
      amount: -total,
      expiresAt: nextIncomeDate,
      data: {
        count: outflows.length,
        total,
        scheduleIds: [...new Set(outflows.map(o => o.scheduleId))],
        nextIncomeDate,
        daysUntilIncome,
        available,
        coverageRatio: Math.round(coverageRatio * 100) / 100,
        accountIds: accounts.map(a => a.id),
      },
    },
  ];
}
