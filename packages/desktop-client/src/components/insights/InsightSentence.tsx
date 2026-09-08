import type { ReactNode } from 'react';
import { Trans } from 'react-i18next';

import * as monthUtils from '@actual-app/core/shared/months';
import type { Insight } from '@actual-app/core/types/models/insights';

import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import { InsightAmount } from './InsightAmount';

/**
 * The only file in the feature that contains English.
 *
 * loot-core has no i18n, so an insight arrives as a `kind` discriminant plus
 * numbers, ids and ISO dates, and this switch turns it into a sentence. That is
 * the same boundary `translateBudgetTemplateNotification` draws for budget
 * template messages.
 *
 * Three rules, and the first is the one that is easy to get wrong:
 *
 *  1. **Money goes in `components`, never `values`.** A money figure has to
 *     render JSX — tabular figures plus the privacy filter — so it cannot be a
 *     string interpolation. A `values`-interpolated "$74" would come out in
 *     proportional figures, which breaks the Tabular Number Rule.
 *  2. Names, dates and percentages go in `values`, pre-formatted here so they
 *     follow the user's own number and date preferences.
 *  3. Anything countable uses `count`, with `{{count}}` in the key, so
 *     languages with different plural rules work.
 *
 * `i18next-parser` is configured with `keySeparator: false` and
 * `defaultValue: value || key`, so the key *is* the English sentence and
 * punctuation in it is safe. Component placeholders are named rather than
 * positional so a translator reordering a clause knows which figure is which.
 */

type InsightSentenceProps = {
  insight: Insight;
};

export function InsightSentence({ insight }: InsightSentenceProps): ReactNode {
  const locale = useLocale();
  const format = useFormat();

  /** A date in prose form: "September 18" reads better mid-sentence. */
  const day = (date: string) => monthUtils.format(date, 'MMMM d', locale);
  const monthName = (month: string) =>
    monthUtils.format(`${month}-01`, 'MMMM', locale);
  const pct = (value: number) => format(Math.abs(value), 'percentage');

  switch (insight.kind) {
    case 'low-balance': {
      const { accountName, threshold, alreadyBelow } = insight.data;
      if (alreadyBelow) {
        return (
          <Trans
            i18nKey="{{account}} is already below <amount />"
            values={{ account: accountName }}
            components={{ amount: <InsightAmount value={threshold} /> }}
          />
        );
      }
      return (
        <Trans
          i18nKey="{{account}} is likely to fall below <amount /> on {{date}}"
          values={{ account: accountName, date: day(insight.date ?? '') }}
          components={{ amount: <InsightAmount value={threshold} /> }}
        />
      );
    }

    case 'negative-balance': {
      const { accountName, nextIncomeDate, daysAway, shortfall } = insight.data;
      // An account that is negative *today* is not a projection. Saying
      // "projected to go negative on <today>" about money already gone reads as
      // a bug and undermines trust in the rest of the card.
      if (daysAway <= 0) {
        return (
          <Trans
            i18nKey="{{account}} is overdrawn by <amount />"
            values={{ account: accountName }}
            components={{ amount: <InsightAmount value={shortfall} /> }}
          />
        );
      }
      if (nextIncomeDate === null) {
        return (
          <Trans
            i18nKey="{{account}} is projected to go negative on {{date}}"
            values={{ account: accountName, date: day(insight.date ?? '') }}
          />
        );
      }
      return (
        <Trans
          i18nKey="{{account}} is projected to go negative on {{date}}, before your next expected income on {{incomeDate}}"
          values={{
            account: accountName,
            date: day(insight.date ?? ''),
            incomeDate: day(nextIncomeDate),
          }}
        />
      );
    }

    case 'category-overspend-risk': {
      const { categoryName, projectedOverspend, basis, scheduledRemaining } =
        insight.data;
      if (basis === 'scheduled') {
        // Arithmetic rather than a forecast, so it is worded as a certainty.
        return (
          <Trans
            i18nKey="Scheduled bills of <amount /> are still to come out of {{category}}, which is more than it has left"
            values={{ category: categoryName }}
            components={{
              amount: <InsightAmount value={scheduledRemaining} />,
            }}
          />
        );
      }
      return (
        <Trans
          i18nKey="{{category}} is projected to exceed its available balance by <amount />"
          values={{ category: categoryName }}
          components={{ amount: <InsightAmount value={projectedOverspend} /> }}
        />
      );
    }

    case 'spending-pace': {
      const { categoryName, pacePct, direction, spentToDate, expectedToDate } =
        insight.data;

      // Past a doubling, a percentage stops being legible — "671% above your
      // usual pace" is accurate and useless. A multiple reads better and is
      // easier to judge at a glance.
      if (direction === 'above' && pacePct >= 100 && expectedToDate > 0) {
        const multiple = (spentToDate / expectedToDate).toFixed(1);
        return (
          <Trans
            i18nKey="{{category}} has spent {{multiple}} times its usual amount by this point in the month"
            values={{ category: categoryName, multiple }}
          />
        );
      }

      if (direction === 'below') {
        return (
          <Trans
            i18nKey="{{category}} is running {{percent}} below your usual pace at this point in the month"
            values={{ category: categoryName, percent: pct(pacePct) }}
          />
        );
      }
      return (
        <Trans
          i18nKey="{{category}} is running {{percent}} above your usual pace at this point in the month"
          values={{ category: categoryName, percent: pct(pacePct) }}
        />
      );
    }

    case 'upcoming-commitments':
      return (
        <Trans
          i18nKey="{{count}} scheduled bills totalling <amount /> arrive before your next expected income"
          count={insight.data.count}
          values={{ count: insight.data.count }}
          components={{ amount: <InsightAmount value={insight.data.total} /> }}
        />
      );

    case 'month-end-projection': {
      const { net, month } = insight.data;
      if (net < 0) {
        return (
          <Trans
            i18nKey="You are likely to finish {{month}} over budget by <amount /> across your categories"
            values={{ month: monthName(month) }}
            components={{ amount: <InsightAmount value={net} absolute /> }}
          />
        );
      }
      return (
        <Trans
          i18nKey="You are likely to finish {{month}} with <amount /> still available across your categories"
          values={{ month: monthName(month) }}
          components={{ amount: <InsightAmount value={net} /> }}
        />
      );
    }

    case 'underfunded-category':
      return (
        <Trans
          i18nKey="{{category}} needs another <amount /> per month to cover its next payment"
          values={{ category: insight.data.categoryName }}
          components={{
            amount: <InsightAmount value={insight.data.shortfallPerMonth} />,
          }}
        />
      );

    case 'bill-increase':
      return (
        <Trans
          i18nKey="Your {{payee}} payment is {{percent}} higher than its trailing median"
          values={{
            payee: insight.data.payeeName,
            percent: pct(insight.data.deltaPct),
          }}
        />
      );

    case 'subscription-change': {
      const { payeeName, oldAmount, newAmount, direction } = insight.data;
      const components = {
        previous: <InsightAmount value={oldAmount} />,
        current: <InsightAmount value={newAmount} />,
      };
      if (direction === 'decrease') {
        return (
          <Trans
            i18nKey="{{payee}} decreased from <previous /> to <current />"
            values={{ payee: payeeName }}
            components={components}
          />
        );
      }
      return (
        <Trans
          i18nKey="{{payee}} increased from <previous /> to <current />"
          values={{ payee: payeeName }}
          components={components}
        />
      );
    }

    case 'possible-duplicate': {
      const { payeeName, daysApart } = insight.data;
      if (daysApart === 0) {
        return (
          <Trans
            i18nKey="Two similar charges from {{payee}} appeared on the same day"
            values={{ payee: payeeName }}
          />
        );
      }
      return (
        <Trans
          i18nKey="Two similar charges from {{payee}} appeared within one day"
          values={{ payee: payeeName }}
        />
      );
    }

    case 'missing-recurring': {
      const { isIncome, payeeName, scheduleName, expectedDate } = insight.data;
      const name = scheduleName || payeeName || '';
      // Phrased to avoid a leading article: "A {{name}}" produces "A Internet
      // bill", and English article agreement depends on the interpolated word,
      // so no amount of templating fixes it.
      if (isIncome) {
        return (
          <Trans
            i18nKey="Your {{name}} payment normally arrives by {{date}} and has not appeared"
            values={{ name, date: day(expectedDate) }}
          />
        );
      }
      return (
        <Trans
          i18nKey="Your {{name}} payment normally goes out by {{date}} and has not appeared"
          values={{ name, date: day(expectedDate) }}
        />
      );
    }

    case 'unusual-transaction': {
      const { payeeName, categoryName, basis, chargeAmount } = insight.data;
      if (basis === 'category') {
        return (
          <Trans
            i18nKey="A charge of <amount /> is much larger than your usual {{category}} transactions"
            values={{ category: categoryName ?? '' }}
            components={{
              amount: <InsightAmount value={chargeAmount} absolute />,
            }}
          />
        );
      }
      return (
        <Trans
          i18nKey="A charge of <amount /> is much larger than your usual transactions for {{payee}}"
          values={{ payee: payeeName ?? '' }}
          components={{
            amount: <InsightAmount value={chargeAmount} absolute />,
          }}
        />
      );
    }

    case 'trend-change': {
      const { categoryName, months, direction } = insight.data;
      if (direction === 'down') {
        return (
          <Trans
            i18nKey="{{category}} spending has decreased for {{count}} consecutive months"
            count={months}
            values={{ category: categoryName, count: months }}
          />
        );
      }
      return (
        <Trans
          i18nKey="{{category}} spending has increased for {{count}} consecutive months"
          count={months}
          values={{ category: categoryName, count: months }}
        />
      );
    }

    case 'income-volatility':
      return (
        <Trans
          i18nKey="Monthly income has varied by {{percent}} over the last {{count}} months"
          count={insight.data.basisMonths}
          values={{
            percent: pct(insight.data.cvPct),
            count: insight.data.basisMonths,
          }}
        />
      );

    case 'data-quality': {
      const { issue, count } = insight.data;
      if (issue === 'uncleared-stale') {
        return (
          <Trans
            i18nKey="{{count}} transactions have been uncleared for over a month"
            count={count}
            values={{ count }}
          />
        );
      }
      if (issue === 'future-dated') {
        return (
          <Trans
            i18nKey="{{count}} transactions are dated in the future, which shifts your balances"
            count={count}
            values={{ count }}
          />
        );
      }
      return (
        <Trans
          i18nKey="{{count}} transactions are uncategorized, affecting the forecast"
          count={count}
          values={{ count }}
        />
      );
    }

    case 'stale-schedule': {
      const { scheduleName, payeeName, consecutiveUnmatched, pattern } =
        insight.data;
      const name = scheduleName || payeeName || '';
      if (pattern === 'overdue-one-time') {
        return (
          <Trans
            i18nKey="The one-off schedule {{name}} is long overdue and has never matched a transaction"
            values={{ name }}
          />
        );
      }
      return (
        <Trans
          i18nKey="{{name}} has not matched a transaction for {{count}} occurrences"
          count={consecutiveUnmatched}
          values={{ name, count: consecutiveUnmatched }}
        />
      );
    }

    default:
      return null;
  }
}
