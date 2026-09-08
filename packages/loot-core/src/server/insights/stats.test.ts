import { describe, expect, it } from 'vitest';

import {
  clamp01,
  mad,
  MAD_TO_SIGMA,
  mean,
  median,
  percentChange,
  robustCvPct,
  robustSigma,
  robustZScore,
  roundToNice,
  sumAbs,
  terminalRun,
} from './stats';

describe('median', () => {
  const cases: [string, number[], number][] = [
    ['empty', [], 0],
    ['single', [42], 42],
    ['odd length', [3, 1, 2], 2],
    ['even length averages the middle pair', [1, 2, 3, 4], 2.5],
    ['unsorted input', [10, 1, 5, 3], 4],
    ['negatives', [-5, -1, -3], -3],
  ];

  it.each(cases)('%s', (_name, values, expected) => {
    expect(median(values)).toBe(expected);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('mean', () => {
  it('returns 0 for an empty sample rather than NaN', () => {
    expect(mean([])).toBe(0);
  });

  it('averages', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('mad', () => {
  it('is 0 for a constant sample', () => {
    expect(mad([7, 7, 7, 7])).toBe(0);
  });

  it('is 0 for an empty sample', () => {
    expect(mad([])).toBe(0);
  });

  it('ignores a single extreme value, unlike a standard deviation', () => {
    // Median is 3; deviations are 2,1,0,1,997 -> median deviation 1.
    expect(mad([1, 2, 3, 4, 1000])).toBe(1);
  });
});

describe('robustSigma', () => {
  it('is 0 for a constant sample with no floor', () => {
    expect(robustSigma([5, 5, 5])).toBe(0);
  });

  it('applies the floor ratio so a constant sample still has scale', () => {
    // median 1000, floor ratio 0.05 -> 50.
    expect(robustSigma([1000, 1000, 1000], 0.05)).toBe(50);
  });

  it('prefers the MAD estimate when it exceeds the floor', () => {
    expect(robustSigma([10, 20, 30], 0.001)).toBeCloseTo(MAD_TO_SIGMA * 10, 6);
  });
});

describe('robustZScore', () => {
  it('returns 0 when the sample has no usable scale', () => {
    expect(robustZScore(500, [5, 5, 5])).toBe(0);
  });

  it('scores an outlier against a baseline that excludes it', () => {
    // Baseline median 10, MAD 0 -> floored sigma 0.05*10 = 0.5.
    expect(robustZScore(20, [10, 10, 10, 10], 0.05)).toBe(20);
  });

  it('is near zero for a value at the median', () => {
    expect(robustZScore(10, [8, 10, 12], 0.05)).toBe(0);
  });
});

describe('robustCvPct', () => {
  it('is 0 for perfectly steady income', () => {
    expect(robustCvPct([1000, 1000, 1000, 1000, 1000, 1000])).toBe(0);
  });

  it('returns null when the median is not positive', () => {
    expect(robustCvPct([0, 0, 0])).toBeNull();
    expect(robustCvPct([-10, -20])).toBeNull();
  });

  it('ignores one bonus month, which a stddev CV would not', () => {
    // A steady salary plus a single large bonus. A stddev-based CV lands near
    // 60% here and would manufacture a volatility warning.
    const steadyPlusBonus = [3000, 3000, 3000, 3000, 3000, 9000];
    expect(robustCvPct(steadyPlusBonus)).toBe(0);
  });

  it('reports genuine variability', () => {
    // median 3000, deviations 1000,1000,0,0,1000,1000 -> MAD 1000.
    const volatile = [2000, 2000, 3000, 3000, 4000, 4000];
    expect(robustCvPct(volatile)).toBe(
      Math.round(((1.4826 * 1000) / 3000) * 100),
    );
  });
});

describe('clamp01', () => {
  const cases: [number, number][] = [
    [-1, 0],
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [2, 1],
    [Number.NaN, 0],
  ];

  it.each(cases)('clamp01(%s) === %s', (input, expected) => {
    expect(clamp01(input)).toBe(expected);
  });
});

describe('percentChange', () => {
  it('returns null when the baseline is zero, rather than Infinity', () => {
    expect(percentChange(0, 100)).toBeNull();
  });

  it('rounds to an integer percent', () => {
    expect(percentChange(999, 1299)).toBe(30);
    expect(percentChange(1000, 1180)).toBe(18);
  });

  it('is negative for a decrease', () => {
    expect(percentChange(1000, 800)).toBe(-20);
  });
});

describe('roundToNice', () => {
  const cases: [number, number][] = [
    [0, 0],
    [-5, 0],
    [7, 5],
    [12, 10],
    [28, 20],
    [64, 50],
    [123, 100],
    [31_250, 20_000],
  ];

  it.each(cases)('roundToNice(%s) === %s', (input, expected) => {
    expect(roundToNice(input)).toBe(expected);
  });
});

describe('sumAbs', () => {
  it('sums magnitudes regardless of sign', () => {
    expect(sumAbs([-100, 250, -50])).toBe(400);
  });
});

describe('terminalRun', () => {
  it('counts consecutive increases ending at the last month', () => {
    expect(terminalRun([100, 110, 121, 133, 146], 'up', 0.05)).toBe(4);
  });

  it('stops at the first month that breaks the direction', () => {
    expect(terminalRun([100, 500, 110, 121, 133], 'up', 0.05)).toBe(2);
  });

  it('ignores jitter below the dead band', () => {
    // Each step is only +2%, under the 5% dead band, so nothing is a trend.
    expect(terminalRun([100, 102, 104, 106], 'up', 0.05)).toBe(0);
  });

  it('counts decreases in the other direction', () => {
    expect(terminalRun([200, 180, 160, 140], 'down', 0.05)).toBe(3);
  });

  it('is 0 for a flat or single-element series', () => {
    expect(terminalRun([100, 100, 100], 'up', 0.05)).toBe(0);
    expect(terminalRun([100], 'up', 0.05)).toBe(0);
    expect(terminalRun([], 'up', 0.05)).toBe(0);
  });
});
