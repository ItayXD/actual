import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import { getSpendingPaceColor } from './paceStatus';
import { getPaceSummary } from './paceSummary';
import type { CategorySpendingPaceResult } from './useCategorySpendingPace';

type PaceRowProps = {
  label: string;
  value: string;
  valueStyle?: ComponentProps<typeof Text>['style'];
};

function PaceRow({ label, value, valueStyle }: PaceRowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <Text style={{ color: theme.pageTextSubdued }}>{label}</Text>
      <Text style={{ ...styles.tnum, ...valueStyle }}>{value}</Text>
    </View>
  );
}

type SpendingPaceTooltipProps = {
  pace: CategorySpendingPaceResult;
};

/**
 * What the usage bar means, in figures and in words.
 *
 * The headline answers the question the bar raises — how long will this last —
 * and the rows below it show the arithmetic behind that answer, so a surprising
 * forecast can be checked rather than just believed.
 */
export function SpendingPaceTooltip({ pace }: SpendingPaceTooltipProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();

  const { headline, detail } = getPaceSummary({ pace, t, format, locale });
  const { forecast } = pace;
  const isCurrent = pace.phase === 'current';

  return (
    <View style={{ padding: 10, gap: 4, minWidth: 220 }}>
      <Text
        style={{ fontWeight: 'bold', color: getSpendingPaceColor(pace.status) }}
      >
        {headline}
      </Text>
      {detail !== '' && (
        <Text style={{ color: theme.pageTextSubdued }}>{detail}</Text>
      )}

      <View
        style={{
          borderTop: '1px solid ' + theme.tableBorderSeparator,
          margin: '4px 0',
        }}
      />

      <PaceRow label={t('Spent')} value={format(pace.spent, 'financial')} />
      <PaceRow
        // Carryover makes "budgeted" the wrong word for the denominator: the
        // bar measures against everything the category has to spend.
        label={pace.hasCarryover ? t('Available') : t('Budgeted')}
        value={format(pace.available, 'financial')}
      />
      {isCurrent && (
        <PaceRow
          label={t('Usually spent by today')}
          value={format(
            Math.round(pace.available * forecast.paceFraction),
            'financial',
          )}
        />
      )}

      {pace.hasForecast && (
        <>
          <View
            style={{
              borderTop: '1px solid ' + theme.tableBorderSeparator,
              margin: '4px 0',
            }}
          />
          <PaceRow
            label={t('Projected for the month')}
            value={format(forecast.projectedTotal, 'financial')}
          />
          <PaceRow
            label={t('Projected left over')}
            value={format(forecast.projectedLeftover, 'financial')}
            valueStyle={{
              color:
                forecast.projectedLeftover < 0
                  ? theme.budgetNumberNegative
                  : theme.templateNumberFunded,
            }}
          />
        </>
      )}

      <Text
        style={{
          ...styles.smallText,
          color: theme.pageTextSubdued,
          marginTop: 4,
        }}
      >
        {pace.historyMonths === 0
          ? t(
              'No history for this category yet, so this uses your overall spending rhythm',
            )
          : pace.historyMonths === 1
            ? t('Based on 1 month of history')
            : t('Based on {{months}} months of history', {
                months: pace.historyMonths,
              })}
      </Text>
    </View>
  );
}
