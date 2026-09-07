import type { Template } from './templates';

import type { CategoryEntity } from './index';

/**
 * What a category's budget automations are aiming at for one month, computed
 * without applying anything. Read-only: producing this never writes a budget,
 * a goal, or a sync message.
 */
export type CategoryTargetProjection = {
  categoryId: CategoryEntity['id'];
  /**
   * Amount the automations would assign this month, in minor units. This is the
   * templates' demand, not what applying them would actually assign once To
   * Budget runs dry.
   */
  budgeted: number;
  /**
   * The target to measure funding against, in minor units — the full demand, or
   * the `#goal` amount when one is set. null when the templates express no
   * fixed number (see `isElastic`). This mirrors what `setGoals` persists into
   * the `goal` column when a template is applied.
   */
  goal: number | null;
  /**
   * True when a `#goal` directive drives the target, which means progress is
   * measured against the category balance rather than the amount budgeted.
   */
  longGoal: boolean;
  /** Per-template share of `goal`, in the order the templates were given. */
  perTemplate: number[];
  templateTypes: Template['type'][];
  /** Nearest `by`/`spend` deadline, or null when nothing is dated. */
  targetMonth: string | null;
  /** Months until `targetMonth`. 0 means due this month. */
  monthsRemaining: number | null;
  /** Full amount being saved toward, not this month's slice. */
  totalTargetAmount: number | null;
  savedTowardTarget: number;
  limit: { amount: number; hold: boolean } | null;
  /**
   * True for `remainder` and `percentage of available funds` templates, whose
   * demand is "whatever is left" rather than a fixed number. These have nothing
   * to be under- or over-funded against, so the UI shows no bar.
   */
  isElastic: boolean;
  /** Message from a template that failed to parse or validate. */
  error: string | null;
};

export type MonthTargetProjection = {
  month: string;
  categories: CategoryTargetProjection[];
};
