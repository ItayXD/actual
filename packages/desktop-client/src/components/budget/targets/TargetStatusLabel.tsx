import { Trans } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import type { TransObjectLiteral } from '@actual-app/core/types/util';

import { formatMonthLabel } from '#components/budget/goals/formatMonthLabel';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import type { CategoryTarget } from './useCategoryTarget';

/**
 * Plain-language statement of a category's target status.
 *
 * The wording is what makes the colours accessible: status is never conveyed by
 * hue alone, so this label ships everywhere the colours do.
 */
export function TargetStatusLabel({ target }: { target: CategoryTarget }) {
  const format = useFormat();
  const locale = useLocale();

  const shortfall = target.target === null ? 0 : target.target - target.funded;
  const funded = { color: theme.templateNumberFunded };
  const underFunded = { color: theme.templateNumberUnderFunded };

  switch (target.status) {
    case 'overspent':
      return (
        <span style={{ color: theme.budgetNumberNegative }}>
          <Trans>Overspent</Trans>
        </span>
      );

    case 'funded':
      return (
        <span style={funded}>
          <Trans>Fully funded</Trans>
        </span>
      );

    case 'overfunded':
      return (
        <span style={funded}>
          <Trans>
            Overfunded (
            {
              {
                amount: format(-shortfall, 'financial'),
              } as TransObjectLiteral
            }
            )
          </Trans>
        </span>
      );

    case 'on-track':
      return (
        <span style={funded}>
          {target.targetMonth ? (
            <Trans>
              On track for{' '}
              {
                {
                  month: formatMonthLabel(target.targetMonth, locale),
                } as TransObjectLiteral
              }
            </Trans>
          ) : (
            <Trans>On track</Trans>
          )}
        </span>
      );

    case 'behind':
      return (
        <span style={underFunded}>
          <Trans>
            Behind by{' '}
            {{ amount: format(shortfall, 'financial') } as TransObjectLiteral}
          </Trans>
        </span>
      );

    case 'partial':
    case 'unfunded':
      return (
        <span style={underFunded}>
          <Trans>
            Needs{' '}
            {{ amount: format(shortfall, 'financial') } as TransObjectLiteral}{' '}
            more
          </Trans>
        </span>
      );

    case 'elastic':
      return (
        <span>
          <Trans>No fixed target</Trans>
        </span>
      );

    case 'no-target':
    default:
      return null;
  }
}
