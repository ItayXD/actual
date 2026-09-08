import { payeeNameOf } from '#server/insights/lookup';
import { magnitude, recency } from '#server/insights/scale';
import { DUPLICATE } from '#server/insights/thresholds';
import type { InsightContext, InsightTxn } from '#server/insights/types';
import * as monthUtils from '#shared/months';
import type { PossibleDuplicateInsight } from '#types/models/insights';

/**
 * "Two similar charges from the same payee appeared within one day."
 *
 * The hard part is not finding pairs — it is telling a double-charge from a
 * legitimate repeat. Two coffees and one duplicated coffee look identical in a
 * single row, so the discriminator has to be the *payee's own history*.
 *
 * The obvious metric — "how often does this payee charge twice in one day" —
 * does not work: a shop charged once a day, every day, at the same price scores
 * zero on it and every consecutive pair gets reported. So instead we ask how
 * much of this payee's history *already consists of* look-alike adjacent
 * charges. A daily coffee is almost entirely made of them; a utility has none.
 *
 * That ratio is only meaningful with enough history behind it. With two
 * transactions total, one adjacent pair is 50% — which says nothing about
 * whether the payee is routine, and is exactly the shape of a genuine
 * double-charge. So the suppressor only applies once a payee has enough
 * transactions to establish a habit.
 *
 * The pair test mirrors the import de-duplicator in `server/accounts/sync.ts`
 * (same account, equal amount, a few days apart), tightened to one day and with
 * the suppressors below added. That function is deliberately not imported: it is
 * async and lives in the write path, and this module must stay pure.
 *
 * Transfers never reach here — `context.ts` filters them out of the transaction
 * pull, since the two halves of a transfer are the same amount on the same day
 * by construction.
 */

function isCandidate(txn: InsightTxn): boolean {
  return (
    !txn.isParent &&
    txn.payeeId !== null &&
    // A schedule already reasoned about this occurrence.
    txn.scheduleId === null
  );
}

type PayeeHabit = {
  transactions: number;
  /** Look-alike charges no more than a day apart, across all history. */
  adjacentPairs: number;
};

/**
 * How much of each payee's history is already made of look-alike adjacent
 * charges. This is the measure of "routine" that the suppressor needs.
 */
function payeeHabits(txns: InsightTxn[]): Map<string, PayeeHabit> {
  const byPayeeAmount = new Map<string, string[]>();
  const habits = new Map<string, PayeeHabit>();

  for (const txn of txns) {
    if (!isCandidate(txn)) {
      continue;
    }
    const payeeId = txn.payeeId as string;
    const habit = habits.get(payeeId) ?? { transactions: 0, adjacentPairs: 0 };
    habit.transactions++;
    habits.set(payeeId, habit);

    const key = `${payeeId}:${txn.amount}`;
    const dates = byPayeeAmount.get(key);
    if (dates) {
      dates.push(txn.date);
    } else {
      byPayeeAmount.set(key, [txn.date]);
    }
  }

  for (const [key, dates] of byPayeeAmount) {
    const payeeId = key.slice(0, key.lastIndexOf(':'));
    const sorted = [...dates].sort();
    let pairs = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (
        monthUtils.differenceInCalendarDays(sorted[i], sorted[i - 1]) <=
        DUPLICATE.MAX_DAYS_APART
      ) {
        pairs++;
      }
    }
    const habit = habits.get(payeeId);
    if (habit) {
      habit.adjacentPairs += pairs;
    }
  }

  return habits;
}

/** True when adjacent look-alike charges are simply how this payee behaves. */
function isRoutineRepeater(habit: PayeeHabit | undefined): boolean {
  if (habit === undefined) {
    return false;
  }
  // Too little history to call anything a habit. A payee with two
  // transactions that happen to be a pair is the classic double-charge.
  if (habit.transactions < DUPLICATE.MIN_HISTORY_FOR_HABIT) {
    return false;
  }
  return (
    habit.adjacentPairs / habit.transactions >= DUPLICATE.MAX_PAYEE_REPEAT_RATE
  );
}

export function detectPossibleDuplicate(
  ctx: InsightContext,
): PossibleDuplicateInsight[] {
  const windowStart = monthUtils.subDays(ctx.today, DUPLICATE.WINDOW_DAYS);

  // Group on the things a duplicate necessarily shares. Amount is matched
  // *exactly*: an approximate match is a legitimate repeat far more often than
  // it is a duplicate.
  const groups = new Map<string, InsightTxn[]>();
  for (const txn of ctx.txns) {
    if (!isCandidate(txn) || txn.date < windowStart || txn.date > ctx.today) {
      continue;
    }
    if (Math.abs(txn.amount) < ctx.scale.floor) {
      continue;
    }
    const key = `${txn.accountId}:${txn.payeeId}:${txn.amount}`;
    const group = groups.get(key);
    if (group) {
      group.push(txn);
    } else {
      groups.set(key, [txn]);
    }
  }

  const habits = payeeHabits(ctx.txns);
  const insights: PossibleDuplicateInsight[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const sorted = [...group].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );

    for (let i = 1; i < sorted.length; i++) {
      const earlier = sorted[i - 1];
      const later = sorted[i];
      const daysApart = monthUtils.differenceInCalendarDays(
        later.date,
        earlier.date,
      );
      if (daysApart > DUPLICATE.MAX_DAYS_APART) {
        continue;
      }

      const payeeId = later.payeeId as string;
      const habit = habits.get(payeeId);
      // A payee whose history is largely look-alike adjacent charges is a
      // coffee shop, not a fault.
      if (isRoutineRepeater(habit)) {
        continue;
      }
      const repeatRate =
        habit && habit.transactions > 0
          ? habit.adjacentPairs / habit.transactions
          : 0;

      // If both rows came from the bank with different ids, the bank considers
      // them two distinct charges — and it has better information than we do.
      const bothImported =
        earlier.importedId !== null && later.importedId !== null;
      if (bothImported && earlier.importedId !== later.importedId) {
        continue;
      }

      const bothManual =
        earlier.importedId === null && later.importedId === null;
      const ids = [earlier.id, later.id].sort() as [string, string];

      insights.push({
        kind: 'possible-duplicate',
        id: `possible-duplicate:${ids.join('~')}`,
        // Identity *is* the pair, so a dismissal here is permanent and correct:
        // the user has adjudicated those two specific rows.
        fingerprint: `possible-duplicate:${ids.join('~')}`,
        // Never critical. This is "look at this", not an emergency.
        severity: 'warning',
        score:
          0.4 * magnitude(later.amount, ctx.scale.floor) +
          0.3 *
            recency(
              monthUtils.differenceInCalendarDays(ctx.today, later.date),
            ) +
          0.3 *
            (1 - Math.min(1, repeatRate / DUPLICATE.MAX_PAYEE_REPEAT_RATE)) +
          (bothManual ? 0.05 : 0),
        subjects: [
          { type: 'transaction', id: later.id },
          { type: 'account', id: later.accountId },
          { type: 'payee', id: payeeId },
        ],
        date: later.date,
        amount: later.amount,
        expiresAt: null,
        data: {
          transactionIds: ids,
          payeeId,
          payeeName: payeeNameOf(ctx, payeeId),
          accountId: later.accountId,
          chargeAmount: later.amount,
          dates: [earlier.date, later.date],
          daysApart: daysApart as 0 | 1,
          payeeRepeatRate: Math.round(repeatRate * 100) / 100,
          bothManual,
        },
      });
    }
  }

  return insights;
}
