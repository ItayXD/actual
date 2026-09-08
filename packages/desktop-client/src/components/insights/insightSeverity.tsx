import type { ReactNode } from 'react';
import { VisuallyHidden } from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import {
  SvgExclamationSolid,
  SvgInformationOutline,
} from '@actual-app/components/icons/v1';
import { SvgAlertTriangle } from '@actual-app/components/icons/v2';
import { theme } from '@actual-app/components/theme';
import type { InsightSeverity } from '@actual-app/core/types/models/insights';

/**
 * The single place severity becomes a colour, and the reason severity is never
 * *only* a colour.
 *
 * `DESIGN.md`'s Never-Color-Alone Rule aside, the palette forces the issue.
 * Measured against `tableBackground` in the light theme:
 *
 *   errorText       #e12d39   4.53:1  — passes AA for text, barely
 *   warningText     #b88115   3.39:1  — fails AA for text, fine for a glyph
 *   pageTextSubdued #9fb3c8   2.15:1  — fails even the 3:1 graphics threshold
 *   pageTextLight   #627d98   4.28:1  — fine for a glyph
 *   tableHeaderText #486581   6.08:1  — passes
 *
 * So severity colour is confined to the 14px icon, where 3:1 is the bar, and
 * the sentence itself always renders in `tableText` (14.93:1). That satisfies
 * contrast, Never-Color-Alone and the One Accent Rule at once, by construction:
 * there is no coloured text that could be alone.
 *
 * Note `pageTextSubdued` is deliberately *not* used anywhere in this feature,
 * despite `PlanCard` using it for labels — at 2.15:1 it is not a legible
 * foreground. Secondary text here uses `tableHeaderText` instead.
 *
 * Each severity also gets a distinct *shape* — filled disc, triangle, outline
 * disc — so the meaning survives greyscale. `ReportCard` applies
 * `filter: grayscale(1)` while the dashboard is being edited, which makes that
 * a requirement rather than a nicety.
 */

const ICONS = {
  critical: SvgExclamationSolid,
  warning: SvgAlertTriangle,
  info: SvgInformationOutline,
} as const;

const COLORS: Record<InsightSeverity, string> = {
  critical: theme.errorText,
  warning: theme.warningText,
  info: theme.pageTextLight,
};

export function InsightSeverityIcon({
  severity,
}: {
  severity: InsightSeverity;
}): ReactNode {
  const { t } = useTranslation();
  const Icon = ICONS[severity];

  const label =
    severity === 'critical'
      ? t('Needs attention')
      : severity === 'warning'
        ? t('Worth a look')
        : t('For information');

  return (
    <>
      <Icon
        width={14}
        height={14}
        style={{ color: COLORS[severity], flexShrink: 0, marginTop: 2 }}
        aria-hidden
      />
      <VisuallyHidden>{label}</VisuallyHidden>
    </>
  );
}
