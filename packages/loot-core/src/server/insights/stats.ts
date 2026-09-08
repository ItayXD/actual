/**
 * Small, robust statistics. Pure, synchronous, no imports.
 *
 * "Robust" throughout means median/MAD rather than mean/stddev. That is not
 * fussiness: these run over samples of four to thirteen points, where a single
 * annual bonus or one house purchase moves a mean enough to manufacture a
 * warning that is not there.
 */

/** Normal-consistency constant: 1.4826 * MAD estimates sigma for normal data. */
export const MAD_TO_SIGMA = 1.4826;

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Median absolute deviation from the median. */
export function mad(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const m = median(values);
  return median(values.map(v => Math.abs(v - m)));
}

/**
 * Robust scale estimate, floored so a perfectly constant sample cannot produce
 * an infinite z-score. `floorRatio` is applied to the median.
 */
export function robustSigma(values: number[], floorRatio = 0): number {
  const scale = MAD_TO_SIGMA * mad(values);
  const floor = Math.abs(median(values)) * floorRatio;
  return Math.max(scale, floor);
}

/**
 * Robust z of `value` against `values`. `values` should exclude `value` itself,
 * so an outlier cannot inflate its own denominator — the classic failure of a
 * plain z-score on a small sample. Returns 0 when there is no usable scale.
 */
export function robustZScore(
  value: number,
  values: number[],
  floorRatio = 0,
): number {
  const sigma = robustSigma(values, floorRatio);
  if (sigma === 0) {
    return 0;
  }
  return (value - median(values)) / sigma;
}

/**
 * Robust coefficient of variation, as an integer percent. Returns null when the
 * median is non-positive, since a ratio to zero says nothing.
 */
export function robustCvPct(values: number[]): number | null {
  const m = median(values);
  if (m <= 0) {
    return null;
  }
  return Math.round(((MAD_TO_SIGMA * mad(values)) / m) * 100);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** Integer percent change from `from` to `to`, or null when `from` is zero. */
export function percentChange(from: number, to: number): number | null {
  if (from === 0) {
    return null;
  }
  return Math.round((to / from - 1) * 100);
}

/**
 * Rounds to a 1/2/5 × power-of-ten step at or below `value`, so a *derived*
 * threshold reads like a number a person would have chosen. Only ever applied to
 * values we invent, never to values we report back from the file.
 */
export function roundToNice(value: number): number {
  if (value <= 0) {
    return 0;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return step * magnitude;
}

/** Sum of the absolute values. */
export function sumAbs(values: number[]): number {
  return values.reduce((sum, v) => sum + Math.abs(v), 0);
}

/**
 * Number of consecutive moves in one direction, counting back from the last
 * element. `deadBand` is a fractional tolerance, so jitter does not count as a
 * trend: with 0.05, a month must exceed the previous one by 5% to extend an
 * upward run.
 *
 * Returns the count of *moves*, not of months spanned, because that is what the
 * sentence says — "increased for four consecutive months" is four increases.
 */
export function terminalRun(
  values: number[],
  direction: 'up' | 'down',
  deadBand: number,
): number {
  let run = 0;
  for (let i = values.length - 1; i > 0; i--) {
    const prev = values[i - 1];
    const curr = values[i];
    const extended =
      direction === 'up'
        ? curr > prev * (1 + deadBand)
        : curr < prev * (1 - deadBand);
    if (!extended) {
      break;
    }
    run++;
  }
  return run;
}
