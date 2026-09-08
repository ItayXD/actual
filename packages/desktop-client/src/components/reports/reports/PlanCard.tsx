import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type { PlanWidget } from '@actual-app/core/types/models';

import { FinancialText } from '#components/FinancialText';
import { usePlanData } from '#components/plan/usePlanData';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { ReportCard } from '#components/reports/ReportCard';
import { ReportCardName } from '#components/reports/ReportCardName';
import { useFormat } from '#hooks/useFormat';

type PlanCardProps = {
  widgetId: string;
  isEditing?: boolean;
  meta?: PlanWidget['meta'];
  onMetaChange: (newMeta: PlanWidget['meta']) => void;
};

function Figure({
  label,
  amount,
  color,
}: {
  label: ReactNode;
  amount: number;
  color?: string;
}) {
  const format = useFormat();

  return (
    <View style={{ gap: 2 }}>
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>
      <PrivacyFilter>
        <FinancialText style={{ fontSize: 16, color: color ?? theme.pageText }}>
          {format(amount, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}

/**
 * Compact view of the monthly plan against income. Deliberately just the
 * headline numbers plus one bar — a grid cell this size cannot hold a grouped
 * category list, which is what the full Plan page is for.
 */
export function PlanCard({
  widgetId,
  isEditing,
  meta = {},
  onMetaChange,
}: PlanCardProps) {
  const { t } = useTranslation();
  const [nameMenuOpen, setNameMenuOpen] = useState(false);
  const month = meta?.month || monthUtils.currentMonth();
  // The card always compares against a 3-month average; the Plan page owns the
  // window selector.
  const { data } = usePlanData(month, 'last-3-months');

  const income = data?.income ?? 0;
  const planned = data?.totalTarget ?? 0;
  const unplanned = data?.unplanned ?? 0;
  const overcommitted = unplanned < 0;
  // How much of this month's income the plan claims.
  const coverage = income > 0 ? Math.min(1, planned / income) : 0;

  return (
    <ReportCard
      widgetId={widgetId}
      isEditing={isEditing}
      disableClick={nameMenuOpen}
      to="/plan"
      onRename={() => setNameMenuOpen(true)}
    >
      <View style={{ flex: 1, padding: 20, gap: 12 }}>
        <ReportCardName
          name={meta?.name || t('Plan')}
          isEditing={nameMenuOpen}
          onChange={newName => {
            onMetaChange({ ...meta, name: newName });
            setNameMenuOpen(false);
          }}
          onClose={() => setNameMenuOpen(false)}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
          <Figure label={<Trans>Income</Trans>} amount={income} />
          <Figure label={<Trans>Planned</Trans>} amount={planned} />
          <Figure
            label={
              overcommitted ? (
                <Trans>Over income by</Trans>
              ) : (
                <Trans>Left after plan</Trans>
              )
            }
            amount={overcommitted ? -unplanned : unplanned}
            color={overcommitted ? theme.errorText : theme.noticeTextLight}
          />
        </View>

        <View
          role="progressbar"
          aria-label={t('Share of income claimed by the plan')}
          aria-valuenow={Math.round(coverage * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.budgetProgressTrack,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${coverage * 100}%`,
              backgroundColor: overcommitted
                ? theme.budgetProgressOverspent
                : theme.budgetProgressFilled,
            }}
          />
        </View>
      </View>
    </ReportCard>
  );
}
