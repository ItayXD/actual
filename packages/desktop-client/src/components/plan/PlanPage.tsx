import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import {
  SvgArrowThinLeft,
  SvgArrowThinRight,
} from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type { SpendingBasis } from '@actual-app/core/types/models/targets';

import { formatMonthLabel } from '#components/budget/goals/formatMonthLabel';
import { useBudgetTargetInvalidation } from '#components/budget/targets/useBudgetTargetInvalidation';
import { Page } from '#components/Page';
import { useLocale } from '#hooks/useLocale';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { PlanGroupList } from './PlanGroupList';
import { PlanLongTermGoals } from './PlanLongTermGoals';
import { PlanSummary } from './PlanSummary';
import { usePlanData } from './usePlanData';

function MonthSelector({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Button
        variant="bare"
        aria-label={t('Previous month')}
        onPress={() => onChange(monthUtils.subMonths(month, 1))}
      >
        <SvgArrowThinLeft width={10} height={10} />
      </Button>
      <Text style={{ fontWeight: 500, minWidth: 90, textAlign: 'center' }}>
        {formatMonthLabel(month, locale)}
      </Text>
      <Button
        variant="bare"
        aria-label={t('Next month')}
        onPress={() => onChange(monthUtils.addMonths(month, 1))}
      >
        <SvgArrowThinRight width={10} height={10} />
      </Button>
    </View>
  );
}

/**
 * The whole plan for one month in one place: what income is coming in, what
 * the automations add up to, and how far each category has got.
 */
export function PlanPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [month, setMonth] = useState(() => monthUtils.currentMonth());
  const [basis, setBasis] = useSyncedPref('plan.comparisonBasis');
  const comparisonBasis = (basis as SpendingBasis) || 'last-3-months';
  const { data, isLoading } = usePlanData(month, comparisonBasis);

  useBudgetTargetInvalidation();

  const onEditAutomations = (categoryId: string) =>
    dispatch(
      pushModal({
        modal: {
          name: 'category-automations-edit',
          options: { categoryId, month },
        },
      }),
    );

  return (
    <Page header={t('Plan')}>
      <View style={{ maxWidth: 1000, width: '100%' }}>
        <MonthSelector month={month} onChange={setMonth} />

        {data ? (
          <>
            <PlanSummary
              data={data}
              basis={comparisonBasis}
              onBasisChange={setBasis}
            />

            {data.errors.length > 0 && (
              <View
                style={{
                  marginTop: 12,
                  padding: 10,
                  backgroundColor: theme.errorBackground,
                  borderRadius: 4,
                }}
              >
                <Text style={{ color: theme.errorText }}>
                  <Trans>
                    Some automations could not be read, so those categories show
                    no target:
                  </Trans>{' '}
                  {data.errors.map(e => e.category.name).join(', ')}
                </Text>
              </View>
            )}

            <PlanGroupList
              groups={data.groups}
              onEditAutomations={onEditAutomations}
            />
            <PlanLongTermGoals goals={data.longTerm} />
          </>
        ) : (
          <View style={{ padding: '24px 0' }}>
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              {isLoading ? (
                <Trans>Loading plan…</Trans>
              ) : (
                <Trans>No plan data.</Trans>
              )}
            </Text>
          </View>
        )}
      </View>
    </Page>
  );
}
