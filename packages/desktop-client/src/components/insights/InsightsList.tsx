import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type { Insight } from '@actual-app/core/types/models/insights';
import { css, cx } from '@emotion/css';

import { NON_DRAGGABLE_AREA_CLASS_NAME } from '#components/reports/constants';
import { useLocale } from '#hooks/useLocale';

import { InsightRow } from './InsightRow';

type InsightsListProps = {
  insights: Insight[];
  snoozed: Insight[];
  showSnoozed: boolean;
  isPending: boolean;
  isError: boolean;
  asOf: string | null;
  hasInsufficientHistory: boolean;
  onSnooze: (insight: Insight) => void;
  onRestore: (insightId: string) => void;
  onRetry: () => void;
  onToggleSnoozed: () => void;
};

function Centered({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        textAlign: 'center',
      }}
    >
      {children}
    </View>
  );
}

/** Three placeholder rows. Opacity only — layout must not animate. */
function Skeleton() {
  return (
    <View aria-hidden style={{ gap: 14, paddingTop: 4 }}>
      {[0, 1, 2].map(i => (
        <View
          key={i}
          style={{
            height: 12,
            width: `${90 - i * 15}%`,
            borderRadius: 4,
            backgroundColor: theme.tableBorder,
          }}
        />
      ))}
    </View>
  );
}

export function InsightsList({
  insights,
  snoozed,
  showSnoozed,
  isPending,
  isError,
  asOf,
  hasInsufficientHistory,
  onSnooze,
  onRestore,
  onRetry,
  onToggleSnoozed,
}: InsightsListProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const listRef = useRef<HTMLUListElement>(null);
  const [lastSnoozed, setLastSnoozed] = useState<Insight | null>(null);

  /**
   * Snoozing removes the row the user was pointing at, so focus has to go
   * somewhere deliberate. Letting it fall to `<body>` would drop a keyboard or
   * screen-reader user back at the top of the Reports page.
   */
  const handleSnooze = (insight: Insight, index: number) => {
    onSnooze(insight);
    setLastSnoozed(insight);

    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-snooze]',
      );
      const next = buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)];
      if (next) {
        next.focus();
      } else {
        listRef.current?.focus();
      }
    });
  };

  if (isError) {
    // Handled here rather than thrown: letting this reach the dashboard's
    // ErrorBoundary would replace the whole card with "failed to load" for what
    // is usually a transient query failure.
    return (
      <Centered>
        <Text style={{ ...styles.smallText, color: theme.tableHeaderText }}>
          <Trans>Insights could not be calculated.</Trans>
        </Text>
        <Button
          variant="bare"
          className={NON_DRAGGABLE_AREA_CLASS_NAME}
          style={{ ...styles.verySmallText, marginTop: 6 }}
          onPress={onRetry}
        >
          <Trans>Try again</Trans>
        </Button>
      </Centered>
    );
  }

  if (isPending) {
    return <Skeleton />;
  }

  if (insights.length === 0) {
    return (
      <Centered>
        <Text style={{ ...styles.smallText, color: theme.tableText }}>
          {hasInsufficientHistory ? (
            <Trans>Not enough history yet to spot patterns.</Trans>
          ) : snoozed.length > 0 ? (
            <Trans>All caught up.</Trans>
          ) : (
            /*
              A quiet sentence, deliberately. No tick, no celebration:
              PRODUCT.md rules out attention-grabbing, and cheering an empty
              state is the mirror image of manufacturing alarm for a full one.
            */
            <Trans>Nothing needs your attention.</Trans>
          )}
        </Text>
        {asOf !== null && (
          <Text
            style={{
              ...styles.verySmallText,
              color: theme.tableHeaderText,
              marginTop: 4,
            }}
          >
            <Trans>
              Checked through{' '}
              {{ date: monthUtils.format(asOf, 'MMMM d', locale) }}
            </Trans>
          </Text>
        )}
        {snoozed.length > 0 && (
          <Button
            variant="bare"
            className={NON_DRAGGABLE_AREA_CLASS_NAME}
            style={{
              ...styles.verySmallText,
              color: theme.tableHeaderText,
              marginTop: 6,
            }}
            onPress={onToggleSnoozed}
          >
            <Trans count={snoozed.length}>
              Show {{ count: snoozed.length }} snoozed
            </Trans>
          </Button>
        )}
      </Centered>
    );
  }

  const rows = showSnoozed ? [...insights, ...snoozed] : insights;

  return (
    <>
      <ul
        ref={listRef}
        tabIndex={-1}
        aria-label={t('Insights')}
        className={cx(
          NON_DRAGGABLE_AREA_CLASS_NAME,
          css({
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            // Stops a scroll gesture inside the card from chaining into the
            // dashboard page, which is what makes scroll-in-a-card feel broken.
            overscrollBehavior: 'contain',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            // No scroll-shadow fade at the bottom: DESIGN.md reserves shadows
            // for transient surfaces. The dividers and the header count are the
            // overflow cue.
            ...styles.lightScrollbar,
          }),
        )}
      >
        {rows.map((insight, index) => (
          <InsightRow
            key={insight.id}
            insight={insight}
            isSnoozed={showSnoozed && snoozed.includes(insight)}
            onSnooze={() => handleSnooze(insight, index)}
            onRestore={onRestore}
          />
        ))}
      </ul>

      {/*
        The only live region on the card. Making the header count live would
        announce on every background recompute.
      */}
      <View
        aria-live="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: 18,
        }}
      >
        {lastSnoozed !== null && (
          <>
            <Text
              style={{
                ...styles.verySmallText,
                color: theme.tableHeaderText,
              }}
            >
              <Trans>Insight snoozed.</Trans>
            </Text>
            <Button
              variant="bare"
              className={NON_DRAGGABLE_AREA_CLASS_NAME}
              style={{ ...styles.verySmallText }}
              onPress={() => {
                onRestore(lastSnoozed.id);
                setLastSnoozed(null);
              }}
            >
              <Trans>Undo</Trans>
            </Button>
          </>
        )}
        {lastSnoozed === null && snoozed.length > 0 && (
          <Button
            variant="bare"
            className={NON_DRAGGABLE_AREA_CLASS_NAME}
            style={{
              ...styles.verySmallText,
              color: theme.tableHeaderText,
            }}
            onPress={onToggleSnoozed}
          >
            {showSnoozed ? (
              <Trans>Hide snoozed</Trans>
            ) : (
              <Trans count={snoozed.length}>
                {{ count: snoozed.length }} snoozed
              </Trans>
            )}
          </Button>
        )}
      </View>
    </>
  );
}
