import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { InsightsWidget } from '@actual-app/core/types/models';

import { InsightsList } from '#components/insights/InsightsList';
import { resolveInsightsMeta } from '#components/insights/insightsMeta';
import { InsightsSettings } from '#components/insights/InsightsSettings';
import { useInsights } from '#components/insights/useInsights';
import { ReportCard } from '#components/reports/ReportCard';
import { ReportCardName } from '#components/reports/ReportCardName';

type InsightsCardProps = {
  widgetId: string;
  isEditing?: boolean;
  meta?: InsightsWidget['meta'];
  onMetaChange: (newMeta: InsightsWidget['meta']) => void;
};

/**
 * A ranked, snoozeable list of things worth looking at.
 *
 * Note there is **no `to` prop**. That is structural, not an omission:
 * `ReportCard` wraps the whole card in a `<Button>` when `to` is set, and a
 * scrollable list with a link and a snooze button per row cannot live inside a
 * button — it would be invalid HTML and would swallow every row interaction.
 * The card is the whole feature; there is no full page behind it.
 *
 * Everything else follows `PlanCard`.
 */
export function InsightsCard({
  widgetId,
  isEditing,
  meta = {},
  onMetaChange,
}: InsightsCardProps) {
  const { t } = useTranslation();
  const [nameMenuOpen, setNameMenuOpen] = useState(false);
  const resolved = resolveInsightsMeta(meta);

  const {
    visible,
    snoozed,
    isPending,
    isError,
    refetch,
    asOf,
    hasInsufficientHistory,
    snooze,
    restore,
    restoreAll,
    snoozedTotal,
    // Enabled while editing too: the query is cached with `staleTime:
    // Infinity` so this cannot refetch mid-drag, and gating it left the card
    // showing a skeleton exactly when the user is trying to judge its size.
  } = useInsights(meta, true);

  return (
    <ReportCard
      widgetId={widgetId}
      isEditing={isEditing}
      disableClick={nameMenuOpen}
      onRename={() => setNameMenuOpen(true)}
    >
      <View style={{ flex: 1, padding: 14, gap: 8, minHeight: 0 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <ReportCardName
            name={meta?.name || t('Insights')}
            isEditing={nameMenuOpen}
            onChange={newName => {
              onMetaChange({ ...meta, name: newName });
              setNameMenuOpen(false);
            }}
            onClose={() => setNameMenuOpen(false)}
          />

          {/*
            The honest disclosure that the scroll region holds more, at no
            vertical cost. Deliberately not a live region — a live count would
            announce on every background recompute.

            Never rendered anywhere outside this card: no sidebar badge, no
            title-bar dot. PRODUCT.md rules out attention-grabbing.
          */}
          {!isPending && visible.length > 0 && (
            <Text
              style={{
                ...styles.verySmallText,
                color: theme.tableHeaderText,
                ...styles.tnum,
              }}
            >
              {visible.length}
            </Text>
          )}

          <View style={{ flex: 1 }} />

          <InsightsSettings
            meta={meta ?? {}}
            snoozedTotal={snoozedTotal}
            onMetaChange={onMetaChange}
            onRestoreAll={restoreAll}
          />
        </View>

        <InsightsList
          insights={visible}
          snoozed={snoozed}
          showSnoozed={resolved.showSnoozed}
          isPending={isPending}
          isError={isError}
          asOf={asOf}
          hasInsufficientHistory={hasInsufficientHistory}
          onSnooze={snooze}
          onRestore={restore}
          onRetry={refetch}
          onToggleSnoozed={() =>
            onMetaChange({ ...meta, showSnoozed: !resolved.showSnoozed })
          }
        />
      </View>
    </ReportCard>
  );
}
