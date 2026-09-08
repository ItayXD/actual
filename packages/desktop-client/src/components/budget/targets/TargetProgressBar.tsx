import type { CSSProperties } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import type { TargetStatus } from './targetStatus';
import { getTargetProgressColor } from './targetStatus';

type TargetProgressBarProps = {
  /** Fraction of the target reached. Values above 1 render as a full bar. */
  progress: number;
  /** Where the bar should reach by month end; omit for undated targets. */
  pace?: number | null;
  status: TargetStatus;
  height?: number;
  style?: CSSProperties;
  'aria-label': string;
  /** Spoken value, e.g. "$40 of $100 assigned". */
  valueText: string;
  /** Native hover tooltip, so the status is also available as words. */
  title?: string;
};

function clampFraction(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * A thin bar showing how far a category is toward its target.
 *
 * Two plain views rather than an SVG: a linear bar needs no viewBox, and this
 * renders once per visible category cell, so the cheapest possible markup
 * matters. All props are primitives, which is what lets the React Compiler
 * memoize it usefully.
 */
export function TargetProgressBar({
  progress,
  pace,
  status,
  height = 3,
  style,
  'aria-label': ariaLabel,
  valueText,
  title,
}: TargetProgressBarProps) {
  const filled = clampFraction(progress);

  return (
    <View
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(filled * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText}
      title={title}
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
          backgroundColor: getTargetProgressColor(status),
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
