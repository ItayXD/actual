import type { CSSProperties } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { getSpendingPaceColor } from './paceStatus';
import type { SpendingPaceStatus } from './useCategorySpendingPace';

type BalanceUsageBarProps = {
  /** Fraction of what is available that is spent. Above 1 renders as full. */
  used: number;
  /**
   * Where usage would stand today if the whole month were spent to the
   * category's usual rhythm. Omit outside the current month, where "today"
   * means nothing.
   */
  pace?: number | null;
  status: SpendingPaceStatus;
  height?: number;
  style?: CSSProperties;
  'aria-label': string;
  /** Spoken value, e.g. "$40 of $100 spent". */
  valueText: string;
};

function clampFraction(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * A thin bar showing how much of a category's month is spent.
 *
 * Two plain views rather than an SVG: a linear bar needs no viewBox, and this
 * renders once per visible category cell, so the cheapest possible markup
 * matters. All props are primitives, which is what lets the React Compiler
 * memoize it usefully.
 */
export function BalanceUsageBar({
  used,
  pace,
  status,
  height = 3,
  style,
  'aria-label': ariaLabel,
  valueText,
}: BalanceUsageBarProps) {
  const filled = clampFraction(used);

  return (
    <View
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(filled * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText}
      style={{
        height,
        flexShrink: 0,
        borderRadius: height / 2,
        backgroundColor: theme.budgetProgressTrack,
        overflow: 'hidden',
        ...style,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${filled * 100}%`,
          backgroundColor: getSpendingPaceColor(status),
        }}
      />
      {pace != null && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            // Nudged left by its own width so the tick stays visible at 100%.
            left: `calc(${clampFraction(pace) * 100}% - 1px)`,
            width: 1,
            backgroundColor: theme.budgetProgressPace,
          }}
        />
      )}
    </View>
  );
}
