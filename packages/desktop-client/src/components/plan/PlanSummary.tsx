import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { SpendingBasis } from '@actual-app/core/types/models/targets';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import type { PlanData } from './planData';

export function useBasisOptions(): Array<readonly [SpendingBasis, string]> {
  const { t } = useTranslation();
  return [
    ['last-month', t('Last month')],
    ['last-3-months', t('Last 3 months average')],
    ['year-to-date', t('Year to date average')],
    ['all-time', t('All time average')],
  ];
}

function SummaryFigure({
  label,
  amount,
  color,
  emphasis,
}: {
  label: ReactNode;
  amount: number;
  color?: string;
  emphasis?: boolean;
}) {
  const format = useFormat();

  return (
    <View style={{ flex: 1, minWidth: 150, gap: 4 }}>
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>
      <PrivacyFilter>
        <FinancialText
          style={{
            fontSize: 20,
            fontWeight: emphasis ? 600 : 400,
            color: color ?? theme.pageText,
          }}
        >
          {format(amount, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}

/**
 * Does income cover the plan? Income is an average over the chosen window
 * rather than this month's receipts, so a single unusual month does not make
 * an otherwise sound plan look unaffordable.
 */
export function PlanSummary({
  data,
  basis,
  onBasisChange,
}: {
  data: PlanData;
  basis: SpendingBasis;
  onBasisChange: (basis: SpendingBasis) => void;
}) {
  const { t } = useTranslation();
  const basisOptions = useBasisOptions();
  const overcommitted = data.unplanned < 0;

  return (
    <View style={{ gap: 12, padding: '12px 0' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
          <Trans>Compared with</Trans>
        </Text>
        <Select
          options={basisOptions}
          value={basis}
          onChange={onBasisChange}
          aria-label={t('Comparison period')}
        />
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 24,
          paddingBottom: 16,
          borderBottomWidth: 1,
          borderColor: theme.tableBorder,
        }}
      >
        <SummaryFigure
          label={<Trans>Monthly income</Trans>}
          amount={data.income}
        />
        <SummaryFigure
          label={<Trans>Total planned</Trans>}
          amount={data.totalTarget}
        />
        <SummaryFigure
          label={
            overcommitted ? (
              <Trans>Over income by</Trans>
            ) : (
              <Trans>Left after plan</Trans>
            )
          }
          amount={overcommitted ? -data.unplanned : data.unplanned}
          color={overcommitted ? theme.errorText : theme.noticeTextLight}
          emphasis
        />
      </View>
    </View>
  );
}
