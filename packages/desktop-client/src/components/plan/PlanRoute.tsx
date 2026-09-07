import { ErrorBoundary } from 'react-error-boundary';
import { Navigate, useLocation } from 'react-router';

import { FeatureErrorFallback } from '#components/FeatureErrorFallback';
import { useFeatureFlag } from '#hooks/useFeatureFlag';

import { PlanPage } from './PlanPage';

/**
 * Gates the Plan page behind its feature flag, so a stale bookmark lands on the
 * budget rather than a blank screen when the flag is off.
 */
export function PlanRoute() {
  const location = useLocation();
  const isPlanPageEnabled = useFeatureFlag('planPage');

  if (!isPlanPageEnabled) {
    return <Navigate to="/budget" replace />;
  }

  return (
    <ErrorBoundary
      FallbackComponent={FeatureErrorFallback}
      resetKeys={[location.pathname]}
    >
      <PlanPage />
    </ErrorBoundary>
  );
}
