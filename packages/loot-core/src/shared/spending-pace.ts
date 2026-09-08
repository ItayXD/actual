/**
 * Forecasting how long a category's budget will last.
 *
 * The naive answer — divide what is left by what has been spent per day so far
 * — is unusable early in a month: one big grocery run on the 1st reads as a
 * month's worth of pace and predicts the budget gone by the 3rd. Two ideas fix
 * that, and they are the whole of this module.
 *
 * 1. A **development pattern**. Spending is not spread evenly through a month;
 *    rent lands on the 1st and groceries cluster around paydays. So instead of
 *    asking "what fraction of the month has elapsed", ask "what fraction of a
 *    typical month's spending for this category has usually happened by now".
 *    Against that yardstick, an early shop is expected rather than alarming.
 *
 * 2. A **prior**, blended in by credibility. What this category normally costs
 *    per month is known from history and is worth far more, on the 2nd, than
 *    anything this month's two transactions can say. As the month develops the
 *    weight shifts onto what actually happened, and on the last day the
 *    forecast is just the actual.
 *
 * Both are borrowed from loss reserving, where the same problem — projecting a
 * part-developed period from a stable pattern plus a prior — is the standard
 * one. The estimator below is a credibility blend of the two answers on offer:
 * the pattern-adjusted extrapolation of this month, and what the category
 * normally costs. The weight on this month rises with development, so an early
 * lump barely moves the projection and the last day of the month reports the
 * actual.
 *
 * Everything here is pure. Building profiles needs history, so the server calls
 * it; forecasting needs the live budgeted amount, so the client calls it.
 */

/** One historical month of a category's spending, day by day. */
export type MonthlySpendHistory = {
  daysInMonth: number;
  /**
   * Spend per day of month — index 0 is the 1st — signed positive for
   * spending. Refunds appear as negative entries and are allowed to net out.
   */
  byDay: number[];
};

/**
 * Months of history at which an empirical shape earns half its weight against
 * the fallback it shrinks toward. Small on purpose: even three months of a
 * category's own rhythm beats a flat line, and the blend degrades gracefully
 * rather than switching over at a threshold.
 */
const PROFILE_SHRINKAGE_MONTHS = 2;

/** Cumulative fraction of the month elapsed by each day. The no-history case. */
function uniformProfile(daysInMonth: number): number[] {
  return Array.from({ length: daysInMonth }, (_, i) => (i + 1) / daysInMonth);
}

/**
 * Median. Duplicated from `server/insights/stats.ts` rather than imported:
 * that module documents itself as import-free, and `#shared` must not depend
 * on `#server` in any case.
 */
function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Running total through each day of the month; index 0 is the 1st. */
export function cumulativeCurve(history: MonthlySpendHistory): number[] {
  const cumulative: number[] = [];
  let running = 0;
  for (let day = 1; day <= history.daysInMonth; day++) {
    running += history.byDay[day - 1] ?? 0;
    cumulative.push(running);
  }
  return cumulative;
}

/**
 * One month's cumulative spend curve, normalised to end at 1 and stretched
 * onto a month of `daysInMonth` days.
 *
 * Normalising per month is what keeps an expensive December from dominating the
 * shape: every month contributes its rhythm and none contributes its size.
 * Returns null for a month that spent nothing, or that netted out negative
 * against refunds, since neither has a rhythm to contribute.
 *
 * `cumulative` is indexed from 0 for the 1st, in absolute minor units, signed
 * positive for spending.
 */
export function normalizeMonthProfile(
  cumulative: number[],
  daysInMonth: number,
): number[] | null {
  const sourceDays = cumulative.length;
  if (sourceDays <= 0 || daysInMonth <= 0) {
    return null;
  }

  const total = cumulative[sourceDays - 1];
  if (total <= 0) {
    return null;
  }

  const profile: number[] = [];
  let previous = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    // Same relative position in the month, so a 28-day February maps onto a
    // 31-day March rather than leaving three empty days at the end.
    const sourceDay = Math.min(
      sourceDays,
      Math.max(1, Math.ceil((day * sourceDays) / daysInMonth)),
    );
    // Clamped and forced non-decreasing: a late refund can otherwise push the
    // running total back down, and a curve that dips is not a development
    // pattern.
    const value = Math.min(
      1,
      Math.max(previous, cumulative[sourceDay - 1] / total),
    );
    profile.push(value);
    previous = value;
  }
  // Guard against rounding leaving the last day a hair under a whole month.
  profile[daysInMonth - 1] = 1;
  return profile;
}

/**
 * One curve from many, day by day.
 *
 * Median rather than mean, because these run over three to twelve months: one
 * aberrant month — a holiday stock-up, a month where the shop happened to fall
 * on the 28th — bends a mean enough to invent a rhythm that is not there.
 */
export function combineProfiles(profiles: number[][]): number[] {
  const daysInMonth = profiles[0]?.length ?? 0;
  return Array.from({ length: daysInMonth }, (_, day) =>
    median(profiles.map(profile => profile[day])),
  );
}

/** The combined curve for a set of months, or null when none had a shape. */
function averageProfile(
  history: MonthlySpendHistory[],
  daysInMonth: number,
): { profile: number[]; months: number } | null {
  const profiles = history
    .map(month => normalizeMonthProfile(cumulativeCurve(month), daysInMonth))
    .filter((profile): profile is number[] => profile !== null);

  if (profiles.length === 0) {
    return null;
  }

  return { profile: combineProfiles(profiles), months: profiles.length };
}

function blendProfiles(a: number[], b: number[], weightOnA: number): number[] {
  return a.map((value, i) => weightOnA * value + (1 - weightOnA) * b[i]);
}

function credibility(months: number): number {
  return months / (months + PROFILE_SHRINKAGE_MONTHS);
}

export type DevelopmentProfile = {
  /** Cumulative fraction by each day of the month; index 0 is the 1st. */
  profile: number[];
  /** Months of the category's own history behind the shape. */
  profileMonths: number;
};

/**
 * The development pattern to judge a category's month against.
 *
 * Shrunk twice, because a single category rarely has enough history to pin
 * down its own shape: the category's own curve toward the whole budget's
 * curve, and the budget's toward a flat line. A brand-new category with no
 * history of its own still gets the household's rhythm — paydays, the 1st of
 * the month — which is most of what makes an early purchase look alarming
 * under a flat assumption.
 */
export function buildDevelopmentProfile({
  daysInMonth,
  categoryHistory,
  budgetHistory,
}: {
  daysInMonth: number;
  categoryHistory: MonthlySpendHistory[];
  budgetHistory: MonthlySpendHistory[];
}): DevelopmentProfile {
  const uniform = uniformProfile(daysInMonth);

  const budgetWide = averageProfile(budgetHistory, daysInMonth);
  const base = budgetWide
    ? blendProfiles(budgetWide.profile, uniform, credibility(budgetWide.months))
    : uniform;

  const own = averageProfile(categoryHistory, daysInMonth);
  if (!own) {
    return { profile: base, profileMonths: 0 };
  }

  return {
    profile: blendProfiles(own.profile, base, credibility(own.months)),
    profileMonths: own.months,
  };
}

export type SpendingForecastInput = {
  /**
   * What the category has to spend this month, in minor units: this month's
   * budget plus anything carried in. The balance running out is what the
   * forecast is about, so this is the balance plus what has been spent.
   */
  available: number;
  /** Spent on or before today, positive minor units. */
  spentToDate: number;
  /** Already recorded for later this month, positive minor units. */
  committedLater: number;
  /** Fraction of a typical month usually spent by today, 0..1. */
  development: number;
  /** Cumulative development for tomorrow through the last day of the month. */
  remainingDevelopment: number[];
  /** Average monthly spend from history, positive minor units, or null. */
  priorMonthlyTotal: number | null;
  /** Months of history behind `priorMonthlyTotal`; 0 when there is none. */
  historyMonths: number;
  daysInMonth: number;
  /** Day of the month reached, 1..daysInMonth. */
  dayOfMonth: number;
};

/**
 * Every money field is whole minor units. The estimator works in floats, but a
 * fractional cent is not a number the formatter will accept, so rounding
 * happens here rather than at each of the several call sites that display one.
 */
export type SpendingForecast = {
  /** Spent so far as a fraction of what is available. May exceed 1. */
  usedFraction: number;
  /** Where usage would stand today if the whole budget were spent to pattern. */
  paceFraction: number;
  /** Projected spending for the whole month, positive minor units. */
  projectedTotal: number;
  /** Projected end-of-month balance; negative means projected to overspend. */
  projectedLeftover: number;
  /**
   * Days from today until the balance is projected to reach zero, or null when
   * nothing is being spent. 0 when it is already gone.
   */
  daysRemaining: number | null;
  /** Day of the month the balance runs out, or null if not before month end. */
  runOutDay: number | null;
  /** True when the balance is projected to survive the month. */
  lastsPastMonthEnd: boolean;
  /** Projected spend per day over the rest of the month, minor units. */
  projectedDailyRate: number;
  /** True when what is available has already been spent. */
  isExhausted: boolean;
};

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Months of history at which a prior earns half its credibility. A prior drawn
 * from two months is itself a guess, so it should not be deferred to the way a
 * year's worth is.
 */
const PRIOR_CREDIBILITY_MONTHS = 3;

/**
 * Projected spending for the whole month, in minor units.
 *
 * Two estimates are available at any point in the month. The extrapolation,
 * `spent / F`, scales this month's spending up by how much of the pattern is
 * left to run; it is right when the month is genuinely heavier than usual, and
 * wildly wrong on the 2nd. The prior is what the category normally costs; it is
 * right when the month is ordinary and merely lumpy, and blind to a real change
 * in habits. So take a weighted average:
 *
 *     projected = z * (spent / F) + (1 - z) * prior,  z = F^k
 *
 * Because `z * (spent / F)` is `spent * F^(k-1)`, this evaluates without ever
 * dividing by `F` — which is what makes it safe on the 1st, when `F` is close
 * to zero. Whatever `k` is, spending exactly to pattern projects to exactly the
 * prior, and the last day of the month projects the actual.
 *
 * `k` runs from 1 to 2 with how much history stands behind the prior. At 2 the
 * estimate stays close to the prior through the first half of the month, which
 * is what a year of history earns; nearer 1 the data is allowed to speak
 * sooner, which is right when the "prior" is an average of two months and no
 * more reliable than the month in progress.
 *
 * The result is floored at what has already been spent, since no amount of
 * prior belief can unspend it.
 */
function projectMonthTotal({
  spentToDate,
  development,
  priorMonthlyTotal,
  historyMonths,
  daysInMonth,
}: {
  spentToDate: number;
  development: number;
  priorMonthlyTotal: number | null;
  historyMonths: number;
  daysInMonth: number;
}): number {
  const f = clampFraction(development);

  if (priorMonthlyTotal === null) {
    // No history to anchor to, so the extrapolation is the only estimate
    // there is. Floored at half a day of development so a purchase on the 1st
    // cannot divide by something near zero.
    const floor = Math.max(f, 1 / (2 * Math.max(1, daysInMonth)));
    return Math.max(spentToDate, spentToDate / floor);
  }

  const priorCredibility =
    historyMonths / (historyMonths + PRIOR_CREDIBILITY_MONTHS);
  const exponent = 1 + priorCredibility;
  const dataWeight = f ** exponent;
  const blended =
    spentToDate * f ** (exponent - 1) + (1 - dataWeight) * priorMonthlyTotal;
  return Math.max(spentToDate, blended);
}

/**
 * How long the money lasts, and what the month is heading for.
 *
 * `available` at or below zero has no fraction to report against, so callers
 * are expected to skip those categories rather than rely on a sentinel here.
 */
export function forecastSpendingPace({
  available,
  spentToDate,
  committedLater,
  development,
  remainingDevelopment,
  priorMonthlyTotal,
  historyMonths,
  daysInMonth,
  dayOfMonth,
}: SpendingForecastInput): SpendingForecast {
  const f = clampFraction(development);
  const spentTotal = spentToDate + committedLater;
  const usedFraction = available > 0 ? spentTotal / available : 0;

  const projectedFromPattern = projectMonthTotal({
    spentToDate,
    development: f,
    priorMonthlyTotal,
    historyMonths,
    daysInMonth,
  });
  // What is already on the books for later this month is a floor on what is
  // still to come: the pattern estimate is an average over months that mostly
  // did not have this particular bill sitting in them.
  const remainingEstimate = Math.max(
    projectedFromPattern - spentToDate,
    committedLater,
    0,
  );
  const projectedTotal = spentToDate + remainingEstimate;

  const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
  const projectedDailyRate =
    remainingDays > 0
      ? remainingEstimate / remainingDays
      : projectedTotal / Math.max(1, daysInMonth);

  // Reported money is rounded; the unrounded figures stay in scope below,
  // where they drive the run-out arithmetic and rounding would accumulate.
  const reportedTotal = Math.round(projectedTotal);
  const base = {
    usedFraction,
    paceFraction: f,
    projectedTotal: reportedTotal,
    projectedLeftover: available - reportedTotal,
    projectedDailyRate: Math.round(projectedDailyRate),
  };

  if (spentTotal >= available) {
    return {
      ...base,
      daysRemaining: 0,
      runOutDay: null,
      lastsPastMonthEnd: false,
      isExhausted: true,
    };
  }

  // Spread the projected remainder over the rest of the month by the same
  // pattern, then read off the day the running total crosses what is
  // available. Interpolating inside the crossing day keeps the answer from
  // jumping a whole day at a time.
  const tailShare = 1 - f;
  let previous = spentToDate;
  for (let i = 0; i < remainingDevelopment.length; i++) {
    const developed =
      tailShare > 0
        ? clampFraction((remainingDevelopment[i] - f) / tailShare)
        : 1;
    const cumulative = spentToDate + remainingEstimate * developed;
    if (cumulative >= available) {
      const fraction =
        cumulative > previous
          ? (available - previous) / (cumulative - previous)
          : 0;
      const daysRemaining = i + fraction;
      return {
        ...base,
        daysRemaining,
        runOutDay: dayOfMonth + daysRemaining,
        lastsPastMonthEnd: false,
        isExhausted: false,
      };
    }
    previous = cumulative;
  }

  // Survives the month. Answer the question anyway by carrying the projected
  // daily rate past month end — "if I keep spending at this rate" is exactly
  // what was asked, and a balance that rolls over really does keep going.
  const surplus = available - projectedTotal;
  return {
    ...base,
    daysRemaining:
      projectedDailyRate > 0
        ? remainingDays + surplus / projectedDailyRate
        : null,
    runOutDay: null,
    lastsPastMonthEnd: true,
    isExhausted: false,
  };
}
