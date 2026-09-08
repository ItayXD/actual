import { useFeatureFlag } from '#hooks/useFeatureFlag';

export function useSpendingPaceEnabled(): boolean {
  return useFeatureFlag('spendingPace');
}
