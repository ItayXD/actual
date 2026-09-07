import { Trans } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import { PLAN_COLUMN_WIDTH, PlanCategoryRow } from './PlanCategoryRow';
import type { PlanGroup } from './planData';

function ColumnHeaders() {
  return (
    <View
      style={{
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
      <View style={{ width: 190, flexShrink: 0 }} />
      <Text
        style={{
          ...styles.smallText,
          color: theme.pageTextSubdued,
          width: PLAN_COLUMN_WIDTH,
          textAlign: 'right',
        }}
      >
        <Trans>Planned</Trans>
      </Text>
      <Text
        style={{
          ...styles.smallText,
          color: theme.pageTextSubdued,
          width: PLAN_COLUMN_WIDTH,
          textAlign: 'right',
        }}
      >
        <Trans>Assigned</Trans>
      </Text>
    </View>
  );
}

function GroupHeader({ item }: { item: PlanGroup }) {
  const format = useFormat();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0 6px',
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: 600 }}>{item.group.name}</Text>
      </View>
      <View style={{ width: 190, flexShrink: 0 }} />
      <PrivacyFilter>
        <FinancialText
          style={{
            width: PLAN_COLUMN_WIDTH,
            textAlign: 'right',
            fontWeight: 600,
          }}
        >
          {format(item.target, 'financial')}
        </FinancialText>
      </PrivacyFilter>
      <PrivacyFilter>
        <FinancialText
          style={{
            width: PLAN_COLUMN_WIDTH,
            textAlign: 'right',
            fontWeight: 600,
          }}
        >
          {format(item.assigned, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}

export function PlanGroupList({ groups }: { groups: PlanGroup[] }) {
  if (groups.length === 0) {
    return (
      <View style={{ padding: '24px 0' }}>
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            No budget automations yet. Add one to a category and its target will
            show up here.
          </Trans>
        </Text>
      </View>
    );
  }

  return (
    <View>
      <ColumnHeaders />
      {groups.map(group => (
        <View key={group.group.id}>
          <GroupHeader item={group} />
          {group.categories.map(item => (
            <PlanCategoryRow key={item.category.id} item={item} />
          ))}
        </View>
      ))}
    </View>
  );
}
