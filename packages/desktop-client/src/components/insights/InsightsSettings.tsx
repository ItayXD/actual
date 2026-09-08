import { Dialog, DialogTrigger } from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgSettingsSliderAlternate } from '@actual-app/components/icons/v2';
import { Menu } from '@actual-app/components/menu';
import type { MenuItem } from '@actual-app/components/menu';
import { Popover } from '@actual-app/components/popover';
import { theme } from '@actual-app/components/theme';
import type { InsightsWidget } from '@actual-app/core/types/models';
import type {
  InsightKind,
  InsightSeverity,
} from '@actual-app/core/types/models/insights';

import { NON_DRAGGABLE_AREA_CLASS_NAME } from '#components/reports/constants';

import { KIND_GROUPS } from './insightsMeta';

/**
 * Per-kind mutes and the snooze reset, in a popover on the card header.
 *
 * A modal would mean editing `modalsSlice.ts` and the `Modals.tsx` switch — two
 * more hunks in high-churn upstream files, against `FORK.md`'s "fewest,
 * smallest" rule. This is all new files and touches nothing.
 *
 * It also does not fight react-grid-layout. `dragConfig.cancel` is matched
 * against the event target's ancestors, and react-aria portals the popover to
 * `document.body` — outside the grid item — so only the *trigger* needs the
 * non-draggable class. The contents need nothing.
 */

const KIND_LABELS: Record<InsightKind, string> = {
  'negative-balance': 'Projected overdraft',
  'low-balance': 'Low balance',
  'upcoming-commitments': 'Bills before payday',
  'month-end-projection': 'Month-end projection',
  'category-overspend-risk': 'Category overspend risk',
  'spending-pace': 'Spending pace',
  'underfunded-category': 'Underfunded category',
  'bill-increase': 'Bill increase',
  'subscription-change': 'Subscription price change',
  'missing-recurring': 'Missing recurring item',
  'stale-schedule': 'Stale schedule',
  'unusual-transaction': 'Unusual transaction',
  'possible-duplicate': 'Possible duplicate',
  'trend-change': 'Spending trend',
  'income-volatility': 'Income volatility',
  'data-quality': 'Data quality',
};

const GROUP_LABELS: Record<string, string> = {
  'cash-flow': 'Cash flow',
  budget: 'Budget',
  bills: 'Bills and subscriptions',
  transactions: 'Transactions',
  trends: 'Trends and data',
};

type InsightsSettingsProps = {
  meta: NonNullable<InsightsWidget['meta']>;
  snoozedTotal: number;
  onMetaChange: (meta: InsightsWidget['meta']) => void;
  onRestoreAll: () => void;
};

export function InsightsSettings({
  meta,
  snoozedTotal,
  onMetaChange,
  onRestoreAll,
}: InsightsSettingsProps) {
  const { t } = useTranslation();
  const muted = new Set(meta.mutedKinds ?? []);

  const toggleKind = (kind: InsightKind) => {
    const next = new Set(muted);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    onMetaChange({ ...meta, mutedKinds: [...next] });
  };

  const severityItems: { name: InsightSeverity; text: string }[] = [
    { name: 'info', text: t('Everything') },
    { name: 'warning', text: t('Warnings and above') },
    { name: 'critical', text: t('Only urgent') },
  ];

  // Built up rather than declared as one literal: `Menu.line` and `Menu.label`
  // are `unique symbol`s, and an array literal widens them to `symbol`, which no
  // longer satisfies `MenuItem`.
  const items: MenuItem<string>[] = [
    { type: Menu.label, name: 'severity-label', text: t('Show') },
  ];

  for (const item of severityItems) {
    items.push({
      name: `severity-${item.name}`,
      text: item.text,
      toggle: (meta.minSeverity ?? 'info') === item.name,
    });
  }

  items.push(Menu.line);

  for (const group of KIND_GROUPS) {
    items.push({
      type: Menu.label,
      name: `group-${group.id}`,
      text: t(GROUP_LABELS[group.id]),
    });
    for (const kind of group.kinds) {
      items.push({
        name: `kind-${kind}`,
        text: t(KIND_LABELS[kind]),
        // A tick means "watching this", so the stored list is the inverse.
        toggle: !muted.has(kind),
      });
    }
  }

  if (snoozedTotal > 0) {
    items.push(Menu.line, {
      name: 'restore-all',
      text: t('Restore snoozed insights'),
    });
  }

  return (
    <DialogTrigger>
      <Button
        variant="bare"
        className={NON_DRAGGABLE_AREA_CLASS_NAME}
        aria-label={t('Insight settings')}
        style={{ color: theme.tableHeaderText, padding: 4 }}
      >
        <SvgSettingsSliderAlternate width={13} height={13} />
      </Button>

      <Popover style={{ width: 260, maxHeight: 420, overflowY: 'auto' }}>
        <Dialog aria-label={t('Insight settings')}>
          <Menu<string>
            items={items}
            onMenuSelect={name => {
              if (name === 'restore-all') {
                onRestoreAll();
                return;
              }
              if (name.startsWith('severity-')) {
                onMetaChange({
                  ...meta,
                  minSeverity: name.slice(
                    'severity-'.length,
                  ) as InsightSeverity,
                });
                return;
              }
              if (name.startsWith('kind-')) {
                toggleKind(name.slice('kind-'.length) as InsightKind);
              }
            }}
          />
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
