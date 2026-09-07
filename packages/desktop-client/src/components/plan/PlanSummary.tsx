import type { ReactNode } from 'react';
import { Trans } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import type { PlanData } from './planData';

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
    <View style={{ flex: 1, minWidth: 140, gap: 4 }}>
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
 * The four numbers that answer "does my income cover my plan this month?".
 */
export function PlanSummary({ data }: { data: PlanData }) {
  const overcommitted = data.unplanned < 0;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 24,
        padding: '16px 0',
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
        label={<Trans>Assigned</Trans>}
        amount={data.totalAssigned}
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
  );
}
