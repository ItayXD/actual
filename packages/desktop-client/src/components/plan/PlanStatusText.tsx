import { Trans } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import type { TransObjectLiteral } from '@actual-app/core/types/util';

import { formatMonthLabel } from '#components/budget/goals/formatMonthLabel';
import type { TargetStatus } from '#components/budget/targets/targetStatus';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import type { PlanCategory } from './planData';

/**
 * Status wording for a Plan row. Mirrors the budget table's labels so the two
 * surfaces describe the same category the same way, and keeps the colours from
 * being the only signal.
 */
export function PlanStatusText({
  item,
  status,
}: {
  item: PlanCategory;
  status: TargetStatus;
}) {
  const format = useFormat();
  const locale = useLocale();

  if (item.error) {
    return (
      <span style={{ color: theme.errorText }}>
        <Trans>Automation error</Trans>
      </span>
    );
  }

  // A long-term goal's figure is a lifetime target, not a monthly ask, so it is
  // deliberately absent from Total planned. Say so, or the row looks like an
  // arithmetic error.
  if (item.isLongGoal) {
    return (
      <span style={{ color: theme.pageTextSubdued }}>
        <Trans>Long-term goal</Trans>
      </span>
    );
  }

  const funded = item.isLongGoal ? item.balance : item.assigned;
  const shortfall = (item.target ?? 0) - funded;

  switch (status) {
    case 'elastic':
      return (
        <span style={{ color: theme.pageTextSubdued }}>
          <Trans>Whatever is left</Trans>
        </span>
      );

    case 'overspent':
      return (
        <span style={{ color: theme.budgetNumberNegative }}>
          <Trans>Overspent</Trans>
        </span>
      );

    case 'funded':
      return (
        <span style={{ color: theme.templateNumberFunded }}>
          <Trans>Fully funded</Trans>
        </span>
      );

    case 'overfunded':
      return (
        <span style={{ color: theme.templateNumberFunded }}>
          <Trans>Overfunded</Trans>
        </span>
      );

    case 'on-track':
      return (
        <span style={{ color: theme.templateNumberFunded }}>
          {item.targetMonth ? (
            <Trans>
              On track for{' '}
              {
                {
                  month: formatMonthLabel(item.targetMonth, locale),
                } as TransObjectLiteral
              }
            </Trans>
          ) : (
            <Trans>On track</Trans>
          )}
        </span>
      );

    case 'behind':
    case 'partial':
    case 'unfunded':
      return (
        <span style={{ color: theme.templateNumberUnderFunded }}>
          <Trans>
            Needs{' '}
            {{ amount: format(shortfall, 'financial') } as TransObjectLiteral}{' '}
            more
          </Trans>
        </span>
      );

    case 'no-target':
    default:
      return <span style={{ color: theme.pageTextSubdued }}>—</span>;
  }
}
