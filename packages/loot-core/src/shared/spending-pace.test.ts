import { describe, expect, it } from 'vitest';

import type { MonthlySpendHistory } from './spending-pace';
import {
  buildDevelopmentProfile,
  combineProfiles,
  cumulativeCurve,
  forecastSpendingPace,
  normalizeMonthProfile,
} from './spending-pace';

/** A month that spends `amount` on `day` and nothing else. */
function spendOn(day: number, amount: number, days = 30): MonthlySpendHistory {
  const byDay = new Array(days).fill(0);
  byDay[day - 1] = amount;
  return { daysInMonth: days, byDay };
}

/** A month that spends `perDay` on every day. */
function spendEvenly(perDay: number, days = 30): MonthlySpendHistory {
  return { daysInMonth: days, byDay: new Array(days).fill(perDay) };
}

describe('normalizeMonthProfile', () => {
  it('normalises a curve to end at exactly one', () => {
    const profile = normalizeMonthProfile(cumulativeCurve(spendEvenly(10)), 30);

    expect(profile).not.toBeNull();
    expect(profile![29]).toBe(1);
    expect(profile![14]).toBeCloseTo(0.5, 1);
  });

  it('puts a front-loaded month at full development on day one', () => {
    const profile = normalizeMonthProfile(cumulativeCurve(spendOn(1, 500)), 30);

    expect(profile![0]).toBe(1);
    expect(profile![29]).toBe(1);
  });

  it('returns null for a month with no shape to give', () => {
    expect(
      normalizeMonthProfile(cumulativeCurve(spendEvenly(0)), 30),
    ).toBeNull();
    expect(
      normalizeMonthProfile(cumulativeCurve(spendOn(5, -50)), 30),
    ).toBeNull();
    expect(normalizeMonthProfile([], 30)).toBeNull();
  });

  it('stretches a 28-day month onto a 31-day one', () => {
    const profile = normalizeMonthProfile(
      cumulativeCurve(spendEvenly(10, 28)),
      31,
    );

    expect(profile).toHaveLength(31);
    expect(profile![30]).toBe(1);
    expect(profile![15]).toBeCloseTo(16 / 31, 1);
  });
});

describe('combineProfiles', () => {
  it('takes the median day by day, so one odd month cannot bend the shape', () => {
    // Four months done by the 2nd, one that waited until the 30th.
    const usual = normalizeMonthProfile(cumulativeCurve(spendOn(2, 100)), 30)!;
    const odd = normalizeMonthProfile(cumulativeCurve(spendOn(30, 100)), 30)!;

    const combined = combineProfiles([usual, usual, usual, usual, odd]);

    // A mean would put the 2nd at 0.8; the median ignores the outlier entirely.
    expect(combined[1]).toBe(1);
    expect(combined[29]).toBe(1);
  });

  it('returns an empty curve for no profiles', () => {
    expect(combineProfiles([])).toEqual([]);
  });
});

describe('buildDevelopmentProfile', () => {
  it('falls back to a flat month with no history at all', () => {
    const { profile, profileMonths } = buildDevelopmentProfile({
      daysInMonth: 30,
      categoryHistory: [],
      budgetHistory: [],
    });

    expect(profileMonths).toBe(0);
    expect(profile[0]).toBeCloseTo(1 / 30);
    expect(profile[14]).toBeCloseTo(0.5);
    expect(profile[29]).toBe(1);
  });

  it('always ends the month fully developed', () => {
    const { profile } = buildDevelopmentProfile({
      daysInMonth: 31,
      categoryHistory: [spendOn(1, 500), spendOn(2, 300)],
      budgetHistory: [spendOn(1, 500)],
    });

    expect(profile[30]).toBe(1);
  });

  it('never decreases, even when a month ends in refunds', () => {
    const byDay = new Array(30).fill(0);
    byDay[4] = 1000;
    byDay[20] = -400;
    const { profile } = buildDevelopmentProfile({
      daysInMonth: 30,
      categoryHistory: [{ daysInMonth: 30, byDay }],
      budgetHistory: [],
    });

    for (let i = 1; i < profile.length; i++) {
      expect(profile[i]).toBeGreaterThanOrEqual(profile[i - 1]);
    }
  });

  it('learns a front-loaded rhythm from the category itself', () => {
    const frontLoaded = Array.from({ length: 12 }, () => spendOn(2, 400));
    const { profile, profileMonths } = buildDevelopmentProfile({
      daysInMonth: 30,
      categoryHistory: frontLoaded,
      budgetHistory: frontLoaded,
    });

    expect(profileMonths).toBe(12);
    // A flat month would be at 2/30 by the 2nd; a category that always spends
    // on the 2nd should be almost fully developed.
    expect(profile[1]).toBeGreaterThan(0.8);
  });

  it('weights each month equally regardless of its size', () => {
    const cheapEarly = Array.from({ length: 6 }, () => spendOn(3, 10));
    const oneHugeLateMonth = spendOn(28, 100000);
    const { profile } = buildDevelopmentProfile({
      daysInMonth: 30,
      categoryHistory: [...cheapEarly, oneHugeLateMonth],
      budgetHistory: [],
    });

    // Six of seven months were done by the 3rd, so the shape says so even
    // though the seventh month dwarfs them in money terms.
    expect(profile[2]).toBeGreaterThan(0.6);
  });

  it('ignores months that spent nothing or netted out negative', () => {
    const refundOnly: MonthlySpendHistory = {
      daysInMonth: 30,
      byDay: new Array(30).fill(0).map((_, i) => (i === 5 ? -50 : 0)),
    };
    const { profileMonths } = buildDevelopmentProfile({
      daysInMonth: 30,
      categoryHistory: [refundOnly, spendEvenly(0), spendOn(10, 100)],
      budgetHistory: [],
    });

    expect(profileMonths).toBe(1);
  });

  it('borrows the budget-wide rhythm for a category with no history', () => {
    const budgetHistory = Array.from({ length: 12 }, () => spendOn(1, 2000));
    const { profile, profileMonths } = buildDevelopmentProfile({
      daysInMonth: 30,
      categoryHistory: [],
      budgetHistory,
    });

    expect(profileMonths).toBe(0);
    // Flat would be 1/30 on the 1st; the household pattern pulls it far up.
    expect(profile[0]).toBeGreaterThan(0.5);
  });

  it('stretches a short month onto a long one', () => {
    const february = Array.from({ length: 6 }, () => spendEvenly(10, 28));
    const { profile } = buildDevelopmentProfile({
      daysInMonth: 31,
      categoryHistory: february,
      budgetHistory: [],
    });

    expect(profile[15]).toBeCloseTo(16 / 31, 1);
    expect(profile[30]).toBe(1);
  });
});

describe('forecastSpendingPace', () => {
  const flat = (daysInMonth: number) =>
    Array.from({ length: daysInMonth }, (_, i) => (i + 1) / daysInMonth);

  /** Forecast inputs for a flat 30-day month, with everything overridable. */
  function inputs(overrides: {
    available: number;
    spentToDate: number;
    dayOfMonth: number;
    priorMonthlyTotal?: number | null;
    historyMonths?: number;
    committedLater?: number;
    development?: number;
    daysInMonth?: number;
  }) {
    const daysInMonth = overrides.daysInMonth ?? 30;
    const profile = flat(daysInMonth);
    return {
      available: overrides.available,
      spentToDate: overrides.spentToDate,
      committedLater: overrides.committedLater ?? 0,
      development: overrides.development ?? profile[overrides.dayOfMonth - 1],
      remainingDevelopment: profile.slice(overrides.dayOfMonth),
      priorMonthlyTotal:
        overrides.priorMonthlyTotal === undefined
          ? null
          : overrides.priorMonthlyTotal,
      // A year of history unless a test says otherwise, so the default case is
      // the one where the prior is worth deferring to.
      historyMonths: overrides.historyMonths ?? 12,
      daysInMonth,
      dayOfMonth: overrides.dayOfMonth,
    };
  }

  it('projects a month spent exactly on pace to land exactly on budget', () => {
    const forecast = forecastSpendingPace(
      inputs({
        available: 30000,
        spentToDate: 10000,
        dayOfMonth: 10,
        priorMonthlyTotal: 30000,
      }),
    );

    expect(forecast.projectedTotal).toBeCloseTo(30000, 0);
    expect(forecast.projectedLeftover).toBeCloseTo(0, 0);
    expect(forecast.usedFraction).toBeCloseTo(1 / 3);
    expect(forecast.paceFraction).toBeCloseTo(1 / 3);
    // Landing exactly on budget means running out exactly at month end, which
    // is the boundary between the two answers. Either reading is true; what
    // matters is that it is not reported as running out early.
    expect(forecast.runOutDay ?? 30).toBeCloseTo(30, 0);
  });

  it('lasts the month when spending is comfortably under pace', () => {
    const forecast = forecastSpendingPace(
      inputs({
        available: 30000,
        spentToDate: 8000,
        dayOfMonth: 10,
        priorMonthlyTotal: 24000,
      }),
    );

    expect(forecast.lastsPastMonthEnd).toBe(true);
    expect(forecast.runOutDay).toBeNull();
    expect(forecast.projectedLeftover).toBeGreaterThan(0);
  });

  it('is not fooled by a whole budget spent on the first day', () => {
    const withHistory = forecastSpendingPace(
      inputs({
        available: 30000,
        spentToDate: 30000,
        dayOfMonth: 1,
        priorMonthlyTotal: 30000,
      }),
    );
    const naiveProjection = 30000 * 30;

    // A divide-by-days reading would project a month 30x over budget. Anchored
    // to what the category normally costs, the projection stays in the same
    // order of magnitude as the budget.
    expect(withHistory.projectedTotal).toBeLessThan(naiveProjection / 10);
    expect(withHistory.projectedTotal).toBeGreaterThan(30000);
  });

  it('barely moves the projection for a big shop on the first day', () => {
    // The case the feature exists for: $300 budget, history says $300 a month,
    // and a $100 shop lands on the 1st. A divide-by-days reading projects
    // $3000; anchoring to history projects $303.
    const forecast = forecastSpendingPace(
      inputs({
        available: 30000,
        spentToDate: 10000,
        dayOfMonth: 1,
        priorMonthlyTotal: 30000,
      }),
    );

    expect(forecast.projectedTotal).toBeGreaterThan(30000);
    expect(forecast.projectedTotal).toBeLessThan(31000);
  });

  it('reads a lump as on-track when the rhythm expects it', () => {
    const daysInMonth = 30;
    // Groceries on the 2nd, the 16th and the 25th, every month.
    const payday = Array.from({ length: 12 }, () => {
      const byDay = new Array(daysInMonth).fill(0);
      byDay[1] = 12000;
      byDay[15] = 12000;
      byDay[24] = 6000;
      return { daysInMonth, byDay };
    });
    const { profile } = buildDevelopmentProfile({
      daysInMonth,
      categoryHistory: payday,
      budgetHistory: payday,
    });

    const asUsual = forecastSpendingPace({
      available: 30000,
      spentToDate: 12000,
      committedLater: 0,
      development: profile[1],
      remainingDevelopment: profile.slice(2),
      priorMonthlyTotal: 30000,
      historyMonths: 12,
      daysInMonth,
      dayOfMonth: 2,
    });
    // 40% of the budget spent on the 2nd is 40% of the month's rhythm, so the
    // projection lands on budget rather than crying overspend.
    expect(asUsual.projectedTotal).toBeGreaterThan(29000);
    expect(asUsual.projectedTotal).toBeLessThan(31000);
    expect(asUsual.usedFraction).toBeCloseTo(0.4);
    expect(asUsual.paceFraction).toBeCloseTo(0.39, 1);
  });

  it('flags a lump that is double the usual rhythm', () => {
    const daysInMonth = 30;
    const payday = Array.from({ length: 12 }, () => {
      const byDay = new Array(daysInMonth).fill(0);
      byDay[1] = 12000;
      byDay[15] = 12000;
      byDay[24] = 6000;
      return { daysInMonth, byDay };
    });
    const { profile } = buildDevelopmentProfile({
      daysInMonth,
      categoryHistory: payday,
      budgetHistory: payday,
    });

    const forecast = forecastSpendingPace({
      available: 30000,
      spentToDate: 24000,
      committedLater: 0,
      development: profile[1],
      remainingDevelopment: profile.slice(2),
      priorMonthlyTotal: 30000,
      historyMonths: 12,
      daysInMonth,
      dayOfMonth: 2,
    });

    expect(forecast.projectedLeftover).toBeLessThan(0);
    expect(forecast.runOutDay).not.toBeNull();
    expect(forecast.runOutDay!).toBeLessThan(20);
  });

  it('still leans on history when a lumpy month is a category habit', () => {
    const daysInMonth = 30;
    const frontLoaded = Array.from({ length: 12 }, () => spendOn(1, 30000));
    const { profile } = buildDevelopmentProfile({
      daysInMonth,
      categoryHistory: frontLoaded,
      budgetHistory: frontLoaded,
    });

    const forecast = forecastSpendingPace({
      available: 30000,
      spentToDate: 30000,
      committedLater: 0,
      development: profile[0],
      remainingDevelopment: profile.slice(1),
      priorMonthlyTotal: 30000,
      historyMonths: 12,
      daysInMonth,
      dayOfMonth: 1,
    });

    // This category always spends its whole month on the 1st, so spending the
    // whole budget on the 1st is the plan working, not an overspend.
    expect(forecast.projectedTotal).toBeLessThan(31000);
  });

  it('converges on the actual by the last day of the month', () => {
    const forecast = forecastSpendingPace(
      inputs({
        available: 50000,
        spentToDate: 41234,
        dayOfMonth: 30,
        priorMonthlyTotal: 30000,
      }),
    );

    expect(forecast.projectedTotal).toBe(41234);
    expect(forecast.projectedLeftover).toBe(8766);
  });

  it('gives a run-out day inside the month when spending runs hot', () => {
    const forecast = forecastSpendingPace(
      inputs({
        available: 30000,
        spentToDate: 24000,
        dayOfMonth: 20,
        priorMonthlyTotal: 36000,
      }),
    );

    expect(forecast.lastsPastMonthEnd).toBe(false);
    expect(forecast.runOutDay).not.toBeNull();
    expect(forecast.runOutDay!).toBeGreaterThan(20);
    expect(forecast.runOutDay!).toBeLessThan(30);
    expect(forecast.daysRemaining!).toBeCloseTo(forecast.runOutDay! - 20);
    expect(forecast.projectedLeftover).toBeLessThan(0);
  });

  it('reports nothing left when the budget is already gone', () => {
    const forecast = forecastSpendingPace(
      inputs({
        available: 20000,
        spentToDate: 25000,
        dayOfMonth: 12,
        priorMonthlyTotal: 20000,
      }),
    );

    expect(forecast.isExhausted).toBe(true);
    expect(forecast.daysRemaining).toBe(0);
    expect(forecast.runOutDay).toBeNull();
    expect(forecast.usedFraction).toBeCloseTo(1.25);
  });

  it('counts spending scheduled later this month as already committed', () => {
    const withCommitment = forecastSpendingPace(
      inputs({
        available: 30000,
        spentToDate: 2000,
        committedLater: 25000,
        dayOfMonth: 5,
        priorMonthlyTotal: 6000,
      }),
    );

    // History says $60 a month, but $250 is already on the books for later.
    expect(withCommitment.projectedTotal).toBeGreaterThanOrEqual(27000);
    expect(withCommitment.usedFraction).toBeCloseTo(0.9);
  });

  it('carries the rate past month end when the money outlasts the month', () => {
    const forecast = forecastSpendingPace(
      inputs({
        available: 60000,
        spentToDate: 5000,
        dayOfMonth: 10,
        priorMonthlyTotal: 15000,
      }),
    );

    expect(forecast.lastsPastMonthEnd).toBe(true);
    expect(forecast.runOutDay).toBeNull();
    // Twenty days left in the month plus whatever the surplus buys after it.
    expect(forecast.daysRemaining!).toBeGreaterThan(20);
  });

  it('reports no run-out date when nothing is being spent', () => {
    const forecast = forecastSpendingPace(
      inputs({
        available: 10000,
        spentToDate: 0,
        dayOfMonth: 15,
        priorMonthlyTotal: 0,
      }),
    );

    expect(forecast.projectedTotal).toBe(0);
    expect(forecast.daysRemaining).toBeNull();
    expect(forecast.lastsPastMonthEnd).toBe(true);
  });

  it('survives the first day of the month with no history to lean on', () => {
    const forecast = forecastSpendingPace(
      inputs({ available: 30000, spentToDate: 15000, dayOfMonth: 1 }),
    );

    expect(Number.isFinite(forecast.projectedTotal)).toBe(true);
    expect(forecast.isExhausted).toBe(false);
    expect(forecast.daysRemaining!).toBeGreaterThanOrEqual(0);
  });

  it('projects exactly the prior when spending is exactly to pattern', () => {
    // The identity that makes the blend trustworthy: spending `F * prior` by
    // development `F` projects to `prior` for any development and any depth of
    // history. Without it the bar would drift off plan for arithmetic reasons.
    for (const dayOfMonth of [1, 5, 17, 29]) {
      for (const historyMonths of [1, 4, 12]) {
        const development = dayOfMonth / 30;
        const forecast = forecastSpendingPace(
          inputs({
            available: 50000,
            spentToDate: Math.round(30000 * development),
            dayOfMonth,
            priorMonthlyTotal: 30000,
            historyMonths,
          }),
        );

        expect(forecast.projectedTotal).toBeCloseTo(30000, -1);
      }
    }
  });

  it('lets the month speak sooner when the prior rests on little history', () => {
    const runningHot = {
      available: 30000,
      spentToDate: 20000,
      dayOfMonth: 10,
      priorMonthlyTotal: 30000,
    };

    const established = forecastSpendingPace(
      inputs({ ...runningHot, historyMonths: 12 }),
    );
    const thin = forecastSpendingPace(
      inputs({ ...runningHot, historyMonths: 1 }),
    );

    // Two months of history is barely more reliable than the month in
    // progress, so the overspend signal comes through more strongly.
    expect(thin.projectedTotal).toBeGreaterThan(established.projectedTotal);
    // Both still land far below the divide-by-days reading of $600.
    expect(thin.projectedTotal).toBeLessThan(50000);
  });

  it('reports money as whole minor units', () => {
    // The formatter rejects a fractional cent, so the estimator's floats must
    // not reach it. These inputs make the blend land off a whole number.
    const forecast = forecastSpendingPace(
      inputs({
        available: 100000,
        spentToDate: 7331,
        dayOfMonth: 9,
        priorMonthlyTotal: 26669,
        daysInMonth: 31,
      }),
    );

    expect(Number.isInteger(forecast.projectedTotal)).toBe(true);
    expect(Number.isInteger(forecast.projectedLeftover)).toBe(true);
    expect(Number.isInteger(forecast.projectedDailyRate)).toBe(true);
  });

  it('never projects less than what has already been spent', () => {
    const forecast = forecastSpendingPace(
      inputs({
        available: 30000,
        spentToDate: 28000,
        dayOfMonth: 25,
        priorMonthlyTotal: 5000,
      }),
    );

    expect(forecast.projectedTotal).toBeGreaterThanOrEqual(28000);
  });
});
