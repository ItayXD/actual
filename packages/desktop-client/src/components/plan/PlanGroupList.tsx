import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgAdd } from '@actual-app/components/icons/v1';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CategoryEntity } from '@actual-app/core/types/models';

import { useCreateCategoryMutation } from '#budget';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import { PLAN_COLUMN_WIDTH, PlanCategoryRow } from './PlanCategoryRow';
import type { PlanGroup } from './planData';

const columnHeaderStyle = {
  width: PLAN_COLUMN_WIDTH,
  flexShrink: 0,
  textAlign: 'right',
  color: theme.pageTextSubdued,
} as const;

function ColumnHeaders() {
  return (
    <View
      style={{
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingBottom: 6,
        borderBottomWidth: 1,
        borderColor: theme.tableBorder,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
          <Trans>Category</Trans>
        </Text>
      </View>
      <View style={{ width: 150, flexShrink: 0 }} />
      <Text style={{ ...styles.smallText, ...columnHeaderStyle }}>
        <Trans>Planned</Trans>
      </Text>
      <Text style={{ ...styles.smallText, ...columnHeaderStyle }}>
        <Trans>Past budgeted</Trans>
      </Text>
      <Text style={{ ...styles.smallText, ...columnHeaderStyle }}>
        <Trans>Past expenses</Trans>
      </Text>
    </View>
  );
}

function GroupHeader({ item }: { item: PlanGroup }) {
  const format = useFormat();

  return (
    <View
      style={{
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0 6px',
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: 600 }}>{item.group.name}</Text>
      </View>
      <View style={{ width: 150, flexShrink: 0 }} />
      <PrivacyFilter>
        <FinancialText
          style={{
            ...columnHeaderStyle,
            fontWeight: 600,
            color: theme.pageText,
          }}
        >
          {format(item.target, 'financial')}
        </FinancialText>
      </PrivacyFilter>
      <PrivacyFilter>
        <FinancialText style={{ ...columnHeaderStyle, fontWeight: 600 }}>
          {format(item.pastBudgeted, 'financial')}
        </FinancialText>
      </PrivacyFilter>
      <PrivacyFilter>
        <FinancialText
          style={{
            ...columnHeaderStyle,
            fontWeight: 600,
            color: theme.pageText,
          }}
        >
          {format(item.pastSpending, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}

/**
 * Adds a category to this group without leaving the plan. New categories start
 * with no plan, so they show up immediately as something to plan for.
 */
function AddCategoryRow({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const createCategory = useCreateCategoryMutation();

  if (!adding) {
    return (
      <Button
        variant="bare"
        onPress={() => setAdding(true)}
        style={{
          alignSelf: 'flex-start',
          gap: 4,
          marginTop: 2,
          color: theme.pageTextSubdued,
        }}
      >
        <SvgAdd width={8} height={8} />
        <Text style={styles.smallText}>
          <Trans>Add category</Trans>
        </Text>
      </Button>
    );
  }

  return (
    <View style={{ flexShrink: 0, padding: '4px 0', maxWidth: 260 }}>
      <Input
        autoFocus
        placeholder={t('Category name')}
        aria-label={t('New category name')}
        onEnter={value => {
          const name = value.trim();
          if (name) {
            createCategory.mutate({
              name,
              groupId,
              isIncome: false,
              isHidden: false,
            });
          }
          setAdding(false);
        }}
        onEscape={() => setAdding(false)}
        onBlur={() => setAdding(false)}
      />
    </View>
  );
}

export function PlanGroupList({
  groups,
  onEditAutomations,
}: {
  groups: PlanGroup[];
  onEditAutomations: (categoryId: CategoryEntity['id']) => void;
}) {
  return (
    <View>
      <ColumnHeaders />
      {groups.map(group => (
        <View key={group.group.id} style={{ flexShrink: 0 }}>
          <GroupHeader item={group} />
          {group.categories.map(item => (
            <PlanCategoryRow
              key={item.category.id}
              item={item}
              onEditAutomations={() => onEditAutomations(item.category.id)}
            />
          ))}
          <AddCategoryRow groupId={group.group.id} />
        </View>
      ))}
    </View>
  );
}
