import { useTranslation } from 'react-i18next';

import { SvgMoneyBag } from '@actual-app/components/icons/v1';
import { spacing } from '@actual-app/components/tokens';
import { View } from '@actual-app/components/view';

import { getSidebarMenuItemPath } from '#components/sidebar/sidebarMenu';
import { useSidebarMenuItemDetails } from '#components/sidebar/useSidebarMenuItemDetails';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useSidebarMenu } from '#hooks/useSidebarMenu';

import { NavRow } from './NavRow';

export function PrimaryNav() {
  const { sidebarItems } = useSidebarMenu();
  const itemDetails = useSidebarMenuItemDetails();
  const { t } = useTranslation();
  const isPlanPageEnabled = useFeatureFlag('planPage');

  return (
    <View
      data-testid="sidebar-primary-buttons"
      style={{
        flexShrink: 0,
        padding: `${spacing.xs}px ${spacing.sm}px 0`,
      }}
    >
      {sidebarItems.map(item => (
        <NavRow
          key={item.id}
          title={itemDetails[item.id].title}
          Icon={itemDetails[item.id].Icon}
          to={getSidebarMenuItemPath(item.id, true)}
        />
      ))}
      {isPlanPageEnabled && (
        <NavRow title={t('Plan')} Icon={SvgMoneyBag} to="/plan" />
      )}
    </View>
  );
}
