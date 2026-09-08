import { theme } from '@actual-app/components/theme';

import type { SpendingPaceStatus } from './useCategorySpendingPace';

/**
 * Fill colour for the usage bar.
 *
 * Deliberately the same three hues the budget already uses for money — green
 * for within plan, orange for heading over, red for gone — so the bar reads
 * without a legend. The distinction is never carried by colour alone: the bar's
 * length and its tooltip both say the same thing in another form.
 */
export function getSpendingPaceColor(status: SpendingPaceStatus): string {
  switch (status) {
    case 'exhausted':
      return theme.budgetProgressOverspent;
    case 'ahead':
      return theme.budgetProgressPartial;
    case 'on-pace':
    default:
      return theme.budgetProgressFilled;
  }
}
