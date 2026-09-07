import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { TargetProgressBar } from '#components/budget/targets/TargetProgressBar';
import {
  getTargetProgress,
  getTargetStatus,
} from '#components/budget/targets/targetStatus';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import type { PlanCategory } from './planData';
import { PlanStatusText } from './PlanStatusText';

export const PLAN_COLUMN_WIDTH = 110;

/**
 * One category line: what it wants, what it has, and how far along it is.
 */
export function PlanCategoryRow({ item }: { item: PlanCategory }) {
  const format = useFormat();

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

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: '6px 0',
        borderBottomWidth: 1,
        borderColor: theme.tableBorderSeparator,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.category.name}
        </Text>
        {progress !== null && (
          <TargetProgressBar
            progress={progress}
            pace={pace}
            status={status}
            aria-label={`${item.category.name} target progress`}
            valueText={`${format(item.assigned, 'financial')} of ${format(
              item.target ?? 0,
              'financial',
            )}`}
            style={{ maxWidth: 260 }}
          />
        )}
      </View>

      <View style={{ width: 190, flexShrink: 0 }}>
        <Text style={{ ...styles.smallText, textAlign: 'right' }}>
          <PlanStatusText item={item} status={status} />
        </Text>
      </View>

      <PrivacyFilter>
        <FinancialText style={{ width: PLAN_COLUMN_WIDTH, textAlign: 'right' }}>
          {item.target === null ? '—' : format(item.target, 'financial')}
        </FinancialText>
      </PrivacyFilter>

      <PrivacyFilter>
        <FinancialText style={{ width: PLAN_COLUMN_WIDTH, textAlign: 'right' }}>
          {format(item.assigned, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}
