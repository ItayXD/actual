import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { SvgClose } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { Insight } from '@actual-app/core/types/models/insights';
import { css, cx } from '@emotion/css';

import { NON_DRAGGABLE_AREA_CLASS_NAME } from '#components/reports/constants';

import { InsightSentence } from './InsightSentence';
import { InsightSeverityIcon } from './insightSeverity';
import { InsightSubjectLink } from './InsightSubjectLink';

type InsightRowProps = {
  insight: Insight;
  isSnoozed?: boolean;
  onSnooze: (insight: Insight) => void;
  onRestore: (insightId: string) => void;
};

export function InsightRow({
  insight,
  isSnoozed = false,
  onSnooze,
  onRestore,
}: InsightRowProps) {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();

  return (
    <li
      className={css({
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        paddingTop: isNarrowWidth ? 12 : 8,
        paddingBottom: isNarrowWidth ? 12 : 8,
        // DESIGN.md: mobile touch targets are at least 40px tall.
        minHeight: isNarrowWidth ? 44 : undefined,
        borderBottom: `1px solid ${theme.tableBorder}`,
        opacity: isSnoozed ? 0.55 : 1,
      })}
    >
      <InsightSeverityIcon severity={insight.severity} />

      {/*
        A block-level container rather than a `Text`: `PrivacyFilter` renders a
        `<div>` when privacy mode is on, and a `<div>` inside a `<span>` is
        invalid HTML. Text still flows inline inside it.

        The sentence is never coloured — see `insightSeverity.tsx` for why.
      */}
      <View
        style={{
          display: 'block',
          flex: 1,
          minWidth: 0,
          lineHeight: 1.35,
          fontSize: 13,
          color: theme.tableText,
        }}
      >
        <InsightSubjectLink subjects={insight.subjects}>
          <InsightSentence insight={insight} />
        </InsightSubjectLink>
      </View>

      {isSnoozed ? (
        <Button
          variant="bare"
          className={NON_DRAGGABLE_AREA_CLASS_NAME}
          style={{ ...styles.verySmallText, color: theme.tableHeaderText }}
          onPress={() => onRestore(insight.id)}
        >
          <Trans>Restore</Trans>
        </Button>
      ) : (
        /*
          Always visible, never `opacity: 0`. `ReportCard`'s hover-reveal pattern
          would make this unreachable on touch and invisible to anyone who does
          not hover. A permanently quiet glyph is both calmer and honest.

          Labelled "Snooze" rather than "Dismiss" because that is what it does:
          the insight returns as soon as its facts change.
        */
        <Button
          variant="bare"
          className={cx(
            NON_DRAGGABLE_AREA_CLASS_NAME,
            css({
              color: theme.pageTextLight,
              flexShrink: 0,
              // DESIGN.md: at least a 40px touch target on mobile.
              padding: isNarrowWidth ? 12 : 4,
              '&:hover': { color: theme.pageText },
            }),
          )}
          aria-label={t('Snooze this insight')}
          // The list moves focus to the next row's button after a snooze.
          data-snooze="true"
          onPress={() => onSnooze(insight)}
        >
          <SvgClose width={11} height={11} />
        </Button>
      )}
    </li>
  );
}
