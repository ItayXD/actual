import type { CSSProperties } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';

export type TargetStatus =
  /** No automation defines a fixed amount for this category. */
  | 'no-target'
  /** `remainder` / `% of available funds` — demand is "whatever is left". */
  | 'elastic'
  /** Balance has gone negative. Outranks every target-relative status. */
  | 'overspent'
  | 'unfunded'
  | 'partial'
  | 'funded'
  | 'overfunded'
  /** Dated target: this month's slice is covered. */
  | 'on-track'
  /** Dated target: partially funded, but short of this month's slice. */
  | 'behind';

export type TargetStatusInput = {
  balance: number;
  budgeted: number;
  /** Amount to measure funding against this month, in minor units. */
  target: number | null;
  /** True when a `#goal` drives the target, so progress is the balance. */
  isLongGoal: boolean;
  isElastic: boolean;
  /** Months until the deadline. 0 or null means "due this month". */
  monthsRemaining: number | null;
  /** Already put aside toward a multi-month target, in minor units. */
  savedTowardTarget: number;
  /** The full amount being saved toward, not this month's slice. */
  totalTargetAmount: number | null;
};

type DatedTarget = {
  monthsRemaining: number;
  totalTargetAmount: number;
};

/**
 * A target is "dated" when it still has months to run and a known total, which
 * is what makes pacing meaningful. Once `monthsRemaining` hits 0 the target is
 * due now and is judged like any monthly target.
 */
function datedTarget(input: TargetStatusInput): DatedTarget | null {
  const { monthsRemaining, totalTargetAmount } = input;
  if (
    monthsRemaining === null ||
    monthsRemaining <= 0 ||
    totalTargetAmount === null
  ) {
    return null;
  }
  return { monthsRemaining, totalTargetAmount };
}

/**
 * How much counts as funded this month. Long-term goals accumulate, so they are
 * measured against the running balance; monthly automations are measured
 * against what was assigned this month. This mirrors the comparison
 * `BalanceWithCarryover` has always made.
 */
function fundedAmount(input: TargetStatusInput): number {
  return input.isLongGoal ? input.balance : input.budgeted;
}

export function getTargetStatus(input: TargetStatusInput): TargetStatus {
  // Overspending is the most urgent thing in the row, target or not.
  if (input.balance < 0) {
    return 'overspent';
  }
  if (input.isElastic) {
    return 'elastic';
  }
  if (input.target === null) {
    return 'no-target';
  }

  const funded = fundedAmount(input);
  const dated = datedTarget(input);

  if (dated) {
    if (input.savedTowardTarget >= dated.totalTargetAmount) {
      return 'overfunded';
    }
    if (funded >= input.target) {
      return 'on-track';
    }
    return funded > 0 ? 'behind' : 'unfunded';
  }

  if (funded > input.target) {
    return 'overfunded';
  }
  if (funded === input.target) {
    return 'funded';
  }
  return funded > 0 ? 'partial' : 'unfunded';
}

/**
 * Status of what is assigned this month against what the plan asks for.
 *
 * Deliberately narrower than `getTargetStatus`: the budget table's Budgeted
 * column answers only "is this month's assignment at plan". Overspending is a
 * balance concept and is shown in the Balance column, and pacing toward a
 * deadline is shown on the Plan page — neither belongs here.
 */
export function getPlanStatus(
  assigned: number,
  target: number | null,
  isElastic: boolean = false,
): TargetStatus {
  if (isElastic) {
    return 'elastic';
  }
  if (target === null) {
    return 'no-target';
  }
  if (assigned > target) {
    return 'overfunded';
  }
  if (assigned === target) {
    return 'funded';
  }
  return assigned > 0 ? 'partial' : 'unfunded';
}

/**
 * Fraction of this month's plan that is assigned, or null when there is no
 * fixed number to measure against. May exceed 1.
 */
export function getPlanProgress(
  assigned: number,
  target: number | null,
  isElastic: boolean = false,
): number | null {
  if (target === null || isElastic || target <= 0) {
    return null;
  }
  return Math.max(0, assigned / target);
}

export type TargetProgress = {
  /**
   * Fraction of the target reached, 0..1+ (may exceed 1 when overfunded), or
   * null when there is nothing to measure against.
   *
   * For a dated target this is overall progress toward the full amount as it
   * will stand at month end; for a monthly target it is this month's funding.
   */
  progress: number | null;
  /**
   * Where `progress` should be by the end of this month to stay on schedule,
   * 0..1. Only meaningful for dated targets; null otherwise.
   *
   * Derived from the engine's own monthly slice rather than a guessed start
   * date, so it is exact: reach the tick and the deadline is still on track.
   */
  pace: number | null;
};

export function getTargetProgress(input: TargetStatusInput): TargetProgress {
  if (input.target === null || input.isElastic) {
    return { progress: null, pace: null };
  }

  const dated = datedTarget(input);
  if (dated) {
    const total = dated.totalTargetAmount;
    return {
      progress: Math.max(0, (input.savedTowardTarget + input.budgeted) / total),
      pace: Math.min(
        1,
        Math.max(0, (input.savedTowardTarget + input.target) / total),
      ),
    };
  }

  if (input.target <= 0) {
    return { progress: null, pace: null };
  }

  return {
    progress: Math.max(0, fundedAmount(input) / input.target),
    pace: null,
  };
}

/**
 * Text colour for the balance figure. Returns null for statuses that carry no
 * target information, so the caller falls back to the pre-existing styling and
 * untargeted categories look exactly as they always have.
 */
export function makeTargetAmountStyle(
  status: TargetStatus,
): CSSProperties | null {
  switch (status) {
    case 'overspent':
      return { color: theme.budgetNumberNegative };
    case 'funded':
    case 'overfunded':
    case 'on-track':
      return { color: theme.templateNumberFunded };
    case 'partial':
    case 'behind':
    case 'unfunded':
      return { color: theme.templateNumberUnderFunded };
    case 'no-target':
    case 'elastic':
    default:
      return null;
  }
}

/**
 * Fill colour for the progress bar. Deliberately reuses the same two hues as
 * the numbers — the funded/partial distinction is carried by the bar's length
 * and by the status label, never by colour alone.
 */
export function getTargetProgressColor(status: TargetStatus): string {
  switch (status) {
    case 'overspent':
      return theme.budgetProgressOverspent;
    case 'funded':
    case 'overfunded':
    case 'on-track':
      return theme.budgetProgressFilled;
    default:
      return theme.budgetProgressPartial;
  }
}
