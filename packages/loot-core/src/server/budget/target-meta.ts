import * as monthUtils from '#shared/months';
import type { ByTemplate, SpendTemplate } from '#types/models/templates';

/**
 * Number of months between repetitions of a `by`/`spend` template, or null when
 * the template does not repeat.
 *
 * `annual` multiplies `repeat` by 12 (defaulting `repeat` to 1), which is how
 * both `runBy` and `runSpend` have always derived their period.
 */
export function effectiveRepeatMonths(
  template: ByTemplate | SpendTemplate,
): number | null {
  const repeat = template.annual
    ? (template.repeat || 1) * 12
    : (template.repeat ?? null);
  return repeat ? repeat : null;
}

/**
 * Months a repeating template must be shifted forward so its target month stops
 * being in the past relative to `month`. Always 0 for a non-repeating template,
 * which keeps its literal month even once that month has passed.
 */
function monthShift(
  template: ByTemplate | SpendTemplate,
  month: string,
): number {
  const repeat = effectiveRepeatMonths(template);
  if (repeat === null) {
    return 0;
  }

  const templateMonth = `${template.month}`;
  let shift = 0;
  while (
    monthUtils.differenceInCalendarMonths(
      monthUtils.addMonths(templateMonth, shift),
      month,
    ) < 0
  ) {
    shift += repeat;
  }
  return shift;
}

/**
 * The template's target month, rolled forward by whole repeat periods until it
 * is no longer in the past.
 */
export function effectiveTargetMonth(
  template: ByTemplate | SpendTemplate,
  month: string,
): string {
  return monthUtils.addMonths(`${template.month}`, monthShift(template, month));
}

/**
 * Months from `month` until the template's effective target month. 0 means the
 * target is due this month; negative means a non-repeating target has lapsed.
 */
export function monthsUntilTarget(
  template: ByTemplate | SpendTemplate,
  month: string,
): number {
  return monthUtils.differenceInCalendarMonths(
    effectiveTargetMonth(template, month),
    month,
  );
}

/**
 * The `from`/`to` window of a `spend` template, with both ends rolled forward in
 * lockstep by the same number of repeat periods.
 */
export function effectiveSpendWindow(
  template: SpendTemplate,
  month: string,
): { fromMonth: string; toMonth: string; monthsRemaining: number } {
  const shift = monthShift(template, month);
  const toMonth = monthUtils.addMonths(`${template.month}`, shift);

  return {
    fromMonth: monthUtils.addMonths(`${template.from}`, shift),
    toMonth,
    monthsRemaining: monthUtils.differenceInCalendarMonths(toMonth, month),
  };
}
