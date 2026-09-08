import { Trans } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { formatMonthLabel } from '#components/budget/goals/formatMonthLabel';
import { TargetProgressBar } from '#components/budget/targets/TargetProgressBar';
import {
  getTargetProgress,
  getTargetStatus,
} from '#components/budget/targets/targetStatus';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import type { PlanCategory } from './planData';

function GoalRow({ item }: { item: PlanCategory }) {
  const format = useFormat();
  const locale = useLocale();

  const statusInput = {
    balance: item.balance,
    budgeted: item.assigned,
    target: item.target,
    isLongGoal: item.isLongGoal,
    isElastic: item.isElastic,
    monthsRemaining: item.monthsRemaining,
    savedTowardTarget: item.savedTowardTarget,
    totalTargetAmount: item.totalTargetAmount,
  };
  const status = getTargetStatus(statusInput);
  const { progress, pace } = getTargetProgress(statusInput);

  // A long-term goal is measured on the running balance; a dated target is
  // measured on what has been put aside so far.
  const saved = item.isLongGoal ? item.balance : item.savedTowardTarget;
  const total = item.isLongGoal ? item.target : item.totalTargetAmount;

  return (
    <View
      style={{
        flexShrink: 0,
        gap: 5,
        padding: '10px 0',
        borderBottomWidth: 1,
        borderColor: theme.tableBorderSeparator,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <Text style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
          {item.category.name}
        </Text>
        <PrivacyFilter>
          <FinancialText style={styles.smallText}>
            <Trans>
              {{ saved: format(saved, 'financial') }} of{' '}
              {{ total: format(total ?? 0, 'financial') }}
            </Trans>
          </FinancialText>
        </PrivacyFilter>
      </View>

      {progress !== null && (
        <TargetProgressBar
          progress={progress}
          pace={pace}
          status={status}
          height={5}
          aria-label={`${item.category.name} goal progress`}
          valueText={`${format(saved, 'financial')} of ${format(
            total ?? 0,
            'financial',
          )}`}
        />
      )}

      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {item.monthsRemaining !== null && item.monthsRemaining > 0 ? (
          <Trans>
            {{ months: item.monthsRemaining }} months left · due{' '}
            {{ month: formatMonthLabel(item.targetMonth, locale) }}
          </Trans>
        ) : (
          <Trans>Long-term goal</Trans>
        )}
      </Text>
    </View>
  );
}

/**
 * Goals that span more than this month, where the interesting question is
 * whether the pace will get there in time.
 */
export function PlanLongTermGoals({ goals }: { goals: PlanCategory[] }) {
  if (goals.length === 0) {
    return null;
  }

  return (
    <View style={{ flexShrink: 0, marginTop: 28 }}>
      <Text style={{ fontWeight: 600, marginBottom: 4 }}>
        <Trans>Long-term goals</Trans>
      </Text>
      <Text
        style={{
          ...styles.smallText,
          color: theme.pageTextSubdued,
          marginBottom: 6,
        }}
      >
        <Trans>
          The marker shows where each bar should reach by the end of this month.
        </Trans>
      </Text>
      {goals.map(item => (
        <GoalRow key={item.category.id} item={item} />
      ))}
    </View>
  );
}
