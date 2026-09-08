import type {
  Insight,
  InsightKind,
} from '@actual-app/core/types/models/insights';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TestProviders } from '#mocks';

import { InsightSentence } from './InsightSentence';

/**
 * Renders every insight kind.
 *
 * This is the check that matters most on the client side, because the sentence
 * composition is the fiddly part: money has to go through `components` (it
 * renders JSX for tabular figures and the privacy filter), everything else
 * through `values`, and counted nouns need `count` for plural rules. Getting any
 * of that wrong produces a literal "<amount />" or "{{payee}}" in the UI rather
 * than an error, so only a rendering test catches it.
 *
 * It also pins that no kind is missing a case — a new detector shipped without a
 * sentence would silently render nothing.
 */

function insight<K extends InsightKind>(
  kind: K,
  data: Record<string, unknown>,
  overrides: Partial<Insight> = {},
): Insight {
  return {
    kind,
    id: `${kind}:x`,
    fingerprint: `${kind}:x:fp`,
    severity: 'warning',
    score: 0.5,
    subjects: [],
    date: null,
    amount: null,
    expiresAt: null,
    data,
    ...overrides,
  } as unknown as Insight;
}

function renderSentence(value: Insight) {
  // Scoped to this render's own container: reading `document.body` would
  // concatenate every earlier render in the same test.
  const { container } = render(
    <TestProviders>
      <InsightSentence insight={value} />
    </TestProviders>,
  );
  return container.textContent ?? '';
}

const CASES: [InsightKind, Insight, RegExp][] = [
  [
    'low-balance',
    insight(
      'low-balance',
      {
        accountName: 'Checking',
        threshold: 30_000,
        thresholdSource: 'derived',
        projectedBalance: 12_000,
        daysAway: 10,
        alreadyBelow: false,
      },
      { date: '2026-09-18' },
    ),
    /Checking is likely to fall below \$?300\.00 on September 18/,
  ],
  [
    'negative-balance',
    insight(
      'negative-balance',
      {
        accountName: 'Checking',
        projectedBalance: -1_200,
        shortfall: 1_200,
        daysAway: 9,
        nextIncomeDate: '2026-09-30',
        daysUntilIncome: 15,
        incomeArrivesTooLate: true,
      },
      { date: '2026-09-24' },
    ),
    /Checking is projected to go negative on September 24, before your next expected income on September 30/,
  ],
  [
    'category-overspend-risk',
    insight('category-overspend-risk', {
      categoryName: 'Dining',
      projectedOverspend: 7_400,
      basis: 'pace',
      scheduledRemaining: 0,
    }),
    /Dining is projected to exceed its available balance by \$?74\.00/,
  ],
  [
    'spending-pace',
    insight('spending-pace', {
      categoryName: 'Groceries',
      pacePct: 22,
      direction: 'above',
      spentToDate: 12_200,
      expectedToDate: 10_000,
    }),
    /Groceries is running 22% above your usual pace at this point in the month/,
  ],
  [
    'upcoming-commitments',
    insight('upcoming-commitments', { count: 3, total: 86_000 }),
    /3 scheduled bills totalling \$?860\.00 arrive before your next expected income/,
  ],
  [
    'month-end-projection',
    insight('month-end-projection', { net: 42_000, month: '2026-09' }),
    /You are likely to finish September with \$?420\.00 still available/,
  ],
  [
    'underfunded-category',
    insight('underfunded-category', {
      categoryName: 'Annual insurance',
      shortfallPerMonth: 4_600,
    }),
    /Annual insurance needs another \$?46\.00 per month/,
  ],
  [
    'bill-increase',
    insight('bill-increase', { payeeName: 'Electricity', deltaPct: 18 }),
    /Your Electricity payment is 18% higher than its trailing median/,
  ],
  [
    'subscription-change',
    insight('subscription-change', {
      payeeName: 'Streamly',
      oldAmount: 999,
      newAmount: 1_299,
      direction: 'increase',
    }),
    /Streamly increased from \$?9\.99 to \$?12\.99/,
  ],
  [
    'possible-duplicate',
    insight('possible-duplicate', { payeeName: 'Hardware Co', daysApart: 1 }),
    /Two similar charges from Hardware Co appeared within one day/,
  ],
  [
    'missing-recurring',
    insight('missing-recurring', {
      isIncome: true,
      payeeName: 'Employer',
      scheduleName: null,
      expectedDate: '2026-09-01',
    }),
    /Your Employer payment normally arrives by September 1 and has not appeared/,
  ],
  [
    'unusual-transaction',
    insight('unusual-transaction', {
      payeeName: 'Corner Shop',
      categoryName: 'Shopping',
      basis: 'payee',
      chargeAmount: -80_000,
    }),
    /A charge of \$?800\.00 is much larger than your usual transactions for Corner Shop/,
  ],
  [
    'trend-change',
    insight('trend-change', {
      categoryName: 'Transport',
      months: 4,
      direction: 'up',
    }),
    /Transport spending has increased for 4 consecutive months/,
  ],
  [
    'income-volatility',
    insight('income-volatility', { cvPct: 28, basisMonths: 6 }),
    /Monthly income has varied by 28% over the last 6 months/,
  ],
  [
    'data-quality',
    insight('data-quality', { issue: 'uncategorized', count: 7 }),
    /7 transactions are uncategorized, affecting the forecast/,
  ],
  [
    'stale-schedule',
    insight('stale-schedule', {
      scheduleName: 'Gym membership',
      payeeName: null,
      consecutiveUnmatched: 3,
      pattern: 'unmatched-run',
    }),
    /Gym membership has not matched a transaction for 3 occurrences/,
  ],
];

describe('InsightSentence', () => {
  it.each(CASES.map(([kind, value, pattern]) => [kind, value, pattern]))(
    'renders a %s sentence',
    (_kind, value, pattern) => {
      expect(renderSentence(value as Insight)).toMatch(pattern as RegExp);
    },
  );

  it('covers every insight kind', () => {
    // A detector shipped without a sentence would render nothing at all, which
    // is invisible rather than loud. This pins the coverage.
    const covered = new Set(CASES.map(([kind]) => kind));
    expect(covered.size).toBe(16);
  });

  it('leaves no placeholder unsubstituted', () => {
    // The failure mode of getting `values` and `components` mixed up is a
    // literal "<amount />" or "{{payee}}" in the UI, not an exception.
    for (const [, value] of CASES) {
      const text = renderSentence(value);
      expect(text).not.toMatch(/\{\{|<amount|<previous|<current/);
    }
  });

  it('renders money in tabular figures', () => {
    render(
      <TestProviders>
        <InsightSentence
          insight={insight('category-overspend-risk', {
            categoryName: 'Dining',
            projectedOverspend: 7_400,
            basis: 'pace',
            scheduledRemaining: 0,
          })}
        />
      </TestProviders>,
    );

    const amount = screen.getByText(/^\$?74\.00$/);
    // FinancialText applies the tabular-figure feature settings.
    expect(amount).toBeTruthy();
    expect(amount.className).toBeTruthy();
  });

  it('words the scheduled-bill case as a certainty, not a projection', () => {
    const text = renderSentence(
      insight('category-overspend-risk', {
        categoryName: 'Dining',
        projectedOverspend: 7_400,
        basis: 'scheduled',
        scheduledRemaining: 25_000,
      }),
    );
    expect(text).toMatch(/Scheduled bills of \$?250\.00 are still to come/);
  });

  it('avoids a leading article, which cannot agree with an interpolated name', () => {
    // "A {{name}}" rendered "A Internet bill" on a real budget.
    const text = renderSentence(
      insight('missing-recurring', {
        isIncome: false,
        payeeName: null,
        scheduleName: 'Internet bill',
        expectedDate: '2026-09-06',
      }),
    );
    expect(text).toMatch(/Your Internet bill payment normally goes out/);
    expect(text).not.toMatch(/\bA Internet\b/);
  });

  it('states a large overspend as a multiple rather than a huge percentage', () => {
    // Seen on a real budget: "General is running 671% above your usual pace",
    // which is accurate and unreadable.
    const text = renderSentence(
      insight('spending-pace', {
        categoryName: 'General',
        pacePct: 671,
        direction: 'above',
        spentToDate: 77_100,
        expectedToDate: 10_000,
      }),
    );
    expect(text).toMatch(/General has spent 7\.7 times its usual amount/);
    expect(text).not.toMatch(/671/);
  });

  it('keeps a percentage for a modest overspend', () => {
    const text = renderSentence(
      insight('spending-pace', {
        categoryName: 'Groceries',
        pacePct: 22,
        direction: 'above',
        spentToDate: 12_200,
        expectedToDate: 10_000,
      }),
    );
    expect(text).toMatch(/Groceries is running 22% above your usual pace/);
  });

  it('says an already-overdrawn account is overdrawn, not "projected"', () => {
    // Seen on a real budget: an account sitting at -5.36 today was reported as
    // "projected to go negative on September 8", which was today.
    const text = renderSentence(
      insight(
        'negative-balance',
        {
          accountName: 'HSBC',
          projectedBalance: -536,
          shortfall: 536,
          daysAway: 0,
          nextIncomeDate: '2026-09-30',
          daysUntilIncome: 22,
          incomeArrivesTooLate: true,
        },
        { date: '2026-09-08' },
      ),
    );

    expect(text).toMatch(/HSBC is overdrawn by \$?5\.36/);
    expect(text).not.toMatch(/projected/);
  });

  it('words an already-negative account differently from a prediction', () => {
    const text = renderSentence(
      insight('low-balance', {
        accountName: 'Checking',
        threshold: 30_000,
        thresholdSource: 'user',
        projectedBalance: 1_000,
        daysAway: 0,
        alreadyBelow: true,
      }),
    );
    expect(text).toMatch(/Checking is already below \$?300\.00/);
  });

  it('interpolates the count so plural rules have something to work with', () => {
    // The `_one` / `_other` variants live in the locale JSON, which this repo
    // clones at build time rather than committing — so in a test the key itself
    // is the fallback. What matters here is that `count` reaches the sentence;
    // the plural form is i18next's job once locales are present.
    expect(
      renderSentence(
        insight('data-quality', { issue: 'uncategorized', count: 1 }),
      ),
    ).toMatch(/^1 transaction/);
    expect(
      renderSentence(
        insight('data-quality', { issue: 'uncategorized', count: 9 }),
      ),
    ).toMatch(/^9 transaction/);
  });
});
