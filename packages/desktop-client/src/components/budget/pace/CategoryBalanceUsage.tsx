import { useTranslation } from 'react-i18next';

import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Tooltip } from '@actual-app/components/tooltip';
import { View } from '@actual-app/components/view';
import type { CategoryEntity } from '@actual-app/core/types/models';

import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import { BalanceUsageBar } from './BalanceUsageBar';
import { getPaceLabel } from './paceSummary';
import { SpendingPaceTooltip } from './SpendingPaceTooltip';
import { useCategorySpendingPace } from './useCategorySpendingPace';

type CategoryBalanceUsageProps = {
  category: CategoryEntity;
  month: string;
  /** Suppresses the tooltip while a menu owns the cell. */
  tooltipDisabled?: boolean;
};

/**
 * The usage bar under a category's balance, with the forecast on hover.
 *
 * Absolutely positioned against the balance cell rather than placed in the
 * flow, so the row height is untouched and the balance figure keeps its own
 * layout. The transparent strip above the bar is there to make a 3px target
 * hoverable; it is kept thin so it does not swallow clicks meant for the
 * balance menu.
 *
 * Renders nothing when the category has nothing to measure — no flag, no money
 * available, or a month that has not started.
 */
export function CategoryBalanceUsage({
  category,
  month,
  tooltipDisabled,
}: CategoryBalanceUsageProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const { isNarrowWidth } = useResponsive();
  const pace = useCategorySpendingPace(category, month);

  if (!pace) {
    return null;
  }

  return (
    <View
      style={{
        position: 'absolute',
        left: 5,
        right: 5,
        bottom: 0,
      }}
    >
      <Tooltip
        content={<SpendingPaceTooltip pace={pace} />}
        placement="bottom end"
        triggerProps={{
          delay: 400,
          isDisabled: isNarrowWidth || tooltipDisabled,
        }}
      >
        <View style={{ paddingTop: 5, paddingBottom: 2 }}>
          <BalanceUsageBar
            used={pace.forecast.usedFraction}
            // "Where you would usually be by now" only means something while
            // the month is still running.
            pace={pace.phase === 'current' ? pace.forecast.paceFraction : null}
            status={pace.status}
            aria-label={t('Spending pace')}
            valueText={getPaceLabel({ pace, t, format, locale })}
          />
        </View>
      </Tooltip>
    </View>
  );
}
