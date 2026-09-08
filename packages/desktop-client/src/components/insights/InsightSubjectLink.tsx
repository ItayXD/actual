import type { ReactNode } from 'react';

import type { InsightSubject } from '@actual-app/core/types/models/insights';

import { Link } from '#components/common/Link';

/**
 * Turns an insight's primary subject into somewhere to go.
 *
 * Only routes that exist on a wide screen are used. `/transactions/:id` is
 * mobile-only (`WideNotSupported`), so a transaction-scoped insight links to its
 * account instead, which is where the user would go to look at the row anyway.
 *
 * The link inherits its text colour rather than using `Link variant="text"`,
 * whose `pageTextPositive` is Actual Purple. `DESIGN.md`'s One Accent Rule keeps
 * purple for the primary action and the current selection; a list of sixteen
 * purple sentences would be exactly the "decoration" it rules out.
 */

function destinationFor(subjects: InsightSubject[]): string | null {
  for (const subject of subjects) {
    switch (subject.type) {
      case 'account':
        return `/accounts/${subject.id}`;
      case 'category':
        return `/categories/${subject.id}`;
      case 'schedule':
        return `/schedules/${subject.id}`;
      case 'payee':
        return `/payees/${subject.id}`;
      case 'uncategorized':
        return '/categories/uncategorized';
      case 'month':
        return '/budget';
      default:
        break;
    }
  }
  return null;
}

type InsightSubjectLinkProps = {
  subjects: InsightSubject[];
  children: ReactNode;
};

export function InsightSubjectLink({
  subjects,
  children,
}: InsightSubjectLinkProps) {
  const to = destinationFor(subjects);

  if (to === null) {
    // Not focusable, so an unlinked row does not pretend to be clickable.
    return children;
  }

  return (
    <Link
      variant="internal"
      to={to}
      style={{
        color: 'inherit',
        textDecoration: 'none',
        ':hover': { textDecoration: 'underline' },
        ':focus-visible': { textDecoration: 'underline' },
      }}
    >
      {children}
    </Link>
  );
}

export { destinationFor };
