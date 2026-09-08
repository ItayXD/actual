import * as monthUtils from '@actual-app/core/shared/months';
import type { Locale } from 'date-fns';
import type { TFunction } from 'i18next';

import type { UseFormatResult } from '#hooks/useFormat';

import type { CategorySpendingPaceResult } from './useCategorySpendingPace';

/**
 * Beyond this many days the count stops being informative — nobody plans a
 * grocery budget four months out — so the wording switches to how much is
 * expected to be left over instead.
 */
const MAX_USEFUL_DAYS = 75;

function daysPhrase(t: TFunction, days: number): string {
  if (days < 1) {
    return t('less than a day left at this rate');
  }
  const rounded = Math.round(days);
  if (rounded === 1) {
    return t('about a day left at this rate');
  }
  return t('about {{days}} days left at this rate', { days: rounded });
}

export type PaceSummary = {
  /** The one line worth reading first. */
  headline: string;
  /** How long it lasts, or why that cannot be said. Empty when there is none. */
  detail: string;
};

/**
 * The plain-words version of the forecast.
 *
 * Kept out of the tooltip's markup so the same wording can serve the bar's
 * accessible label, where there is no room for a table of figures.
 */
export function getPaceSummary({
  pace,
  t,
  format,
  locale,
}: {
  pace: CategorySpendingPaceResult;
  t: TFunction;
  format: UseFormatResult;
  locale?: Locale;
}): PaceSummary {
  const percentUsed = Math.round(pace.forecast.usedFraction * 100);

  if (pace.status === 'exhausted') {
    return {
      headline: t('Nothing left to spend'),
      detail: t('{{spent}} spent of {{available}}', {
        spent: format(pace.spent, 'financial'),
        available: format(pace.available, 'financial'),
      }),
    };
  }

  if (pace.phase !== 'current') {
    return {
      headline: t('{{percent}}% used', { percent: percentUsed }),
      detail: '',
    };
  }

  if (!pace.hasForecast) {
    return {
      headline: t('{{percent}}% used', { percent: percentUsed }),
      detail: t('Too early to project — no spending history for this category'),
    };
  }

  const { daysRemaining, projectedLeftover } = pace.forecast;

  if (pace.runOutDate !== null) {
    return {
      headline: t('Runs out {{date}}', {
        date: monthUtils.format(pace.runOutDate, 'MMMM d', locale),
      }),
      detail: daysRemaining === null ? '' : daysPhrase(t, daysRemaining),
    };
  }

  if (daysRemaining === null) {
    return {
      headline: t('Nothing spent yet'),
      detail: t('Nothing is projected for the rest of the month either'),
    };
  }

  if (daysRemaining > MAX_USEFUL_DAYS) {
    return {
      headline: t('Lasts well past the end of the month'),
      detail: t('On pace to finish the month with {{leftover}} left', {
        leftover: format(projectedLeftover, 'financial'),
      }),
    };
  }

  return {
    headline: t('Lasts past the end of the month'),
    detail: daysPhrase(t, daysRemaining),
  };
}

/** The whole forecast squeezed into one line, for a screen reader. */
export function getPaceLabel({
  pace,
  t,
  format,
  locale,
}: {
  pace: CategorySpendingPaceResult;
  t: TFunction;
  format: UseFormatResult;
  locale?: Locale;
}): string {
  const { headline, detail } = getPaceSummary({ pace, t, format, locale });
  const amounts = t('{{spent}} of {{available}} spent', {
    spent: format(pace.spent, 'financial'),
    available: format(pace.available, 'financial'),
  });
  // Dashes rather than full stops: `detail` is a sentence fragment that starts
  // lowercase ("about 13 days left…"), so a full stop before it reads wrong.
  const parts =
    detail === '' ? [amounts, headline] : [amounts, headline, detail];
  return `${parts.join(' — ')}.`;
}
