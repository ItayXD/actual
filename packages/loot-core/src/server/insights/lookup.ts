import type { InsightCategory, InsightContext } from './types';

/** Small shared lookups, so no detector rebuilds an index. */

export function categoryNameOf(ctx: InsightContext, id: string): string {
  return ctx.categories.find(category => category.id === id)?.name ?? '';
}

export function payeeNameOf(ctx: InsightContext, id: string | null): string {
  if (id === null) {
    return '';
  }
  return ctx.payeeNames[id] ?? '';
}

/**
 * Categories a spending insight may talk about: visible, and not income.
 *
 * Hidden categories are excluded deliberately. A user who hid a category has
 * said they do not want to think about it, and an insight feed that resurfaces
 * it anyway would be overriding that.
 */
export function spendingCategories(ctx: InsightContext): InsightCategory[] {
  return ctx.categories.filter(
    category => !category.hidden && !category.isIncome,
  );
}

export function scheduleNameOf(ctx: InsightContext, id: string): string | null {
  return ctx.schedules.find(schedule => schedule.id === id)?.name ?? null;
}
