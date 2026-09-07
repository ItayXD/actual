import { useFeatureFlag } from '#hooks/useFeatureFlag';

/**
 * Always-on target progress is a subfeature of goal templates: the whole goal
 * display path is already gated on `goalTemplatesEnabled`, so requiring both
 * keeps a single consistent story rather than two half-enabled states.
 */
export function useBudgetTargetsEnabled(): boolean {
  const goalTemplatesEnabled = useFeatureFlag('goalTemplatesEnabled');
  const budgetTargets = useFeatureFlag('budgetTargets');
  return goalTemplatesEnabled && budgetTargets;
}
