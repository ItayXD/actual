import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { TargetProgressBar } from '#components/budget/targets/TargetProgressBar';
import {
  getPlanProgress,
  getPlanStatus,
} from '#components/budget/targets/targetStatus';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import type { PlanCategory } from './planData';

export const PLAN_COLUMN_WIDTH = 120;

const columnStyle = {
  width: PLAN_COLUMN_WIDTH,
  flexShrink: 0,
  textAlign: 'right',
} as const;

/**
 * The planned amount, which opens the budget automations editor — the same UI
 * the budget screen uses, so a plan is defined in exactly one place whichever
 * screen you start from. Categories with no plan yet show "Set" and open the
 * editor's empty state.
 */
function PlannedCell({
  item,
  onEditAutomations,
}: {
  item: PlanCategory;
  onEditAutomations: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();

  return (
    <Button
      variant="bare"
      aria-label={t('Edit plan for {{name}}', { name: item.category.name })}
      onPress={onEditAutomations}
      style={{ ...columnStyle, justifyContent: 'flex-end', padding: '2px 4px' }}
    >
      <PrivacyFilter>
        <FinancialText
          style={{
            color:
              item.target === null ? theme.pageTextSubdued : theme.pageText,
          }}
        >
          {item.target === null ? t('Set') : format(item.target, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </Button>
  );
}

/**
 * One category: what it costs historically, what you plan for it, and whether
 * the plan is realistic against that history.
 */
export function PlanCategoryRow({
  item,
  onEditAutomations,
}: {
  item: PlanCategory;
  onEditAutomations: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();

  const status = getPlanStatus(item.assigned, item.target, item.isElastic);
  const progress = getPlanProgress(item.assigned, item.target, item.isElastic);

  // Positive means the plan allows more than history; negative means the plan
  // is under what this category usually costs.
  const delta = item.vsPastSpending;
  const isUnderHistory = delta !== null && delta < 0;

  return (
    <View
      style={{
        // Never compress: a squeezed row overlaps its neighbours' text.
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: '4px 0',
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
            status={status}
            aria-label={t('{{name}} assigned against plan', {
              name: item.category.name,
            })}
            valueText={t('{{assigned}} of {{planned}} planned', {
              assigned: format(item.assigned, 'financial'),
              planned: format(item.target ?? 0, 'financial'),
            })}
            style={{ maxWidth: 240 }}
          />
        )}
      </View>

      {item.error ? (
        <Text
          style={{
            ...styles.smallText,
            color: theme.errorText,
            width: 150,
            textAlign: 'right',
          }}
        >
          <Trans>Automation error</Trans>
        </Text>
      ) : (
        <View style={{ width: 150, flexShrink: 0 }}>
          <PrivacyFilter>
            <FinancialText
              style={{
                ...styles.smallText,
                textAlign: 'right',
                color: isUnderHistory
                  ? theme.templateNumberUnderFunded
                  : theme.pageTextSubdued,
              }}
            >
              {delta === null
                ? ''
                : delta < 0
                  ? t('{{amount}} under history', {
                      amount: format(-delta, 'financial'),
                    })
                  : t('{{amount}} spare', {
                      amount: format(delta, 'financial'),
                    })}
            </FinancialText>
          </PrivacyFilter>
        </View>
      )}

      <PlannedCell item={item} onEditAutomations={onEditAutomations} />

      <PrivacyFilter>
        <FinancialText style={{ ...columnStyle, color: theme.pageTextSubdued }}>
          {format(item.pastBudgeted, 'financial')}
        </FinancialText>
      </PrivacyFilter>

      <PrivacyFilter>
        <FinancialText style={columnStyle}>
          {format(item.pastSpending, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}
