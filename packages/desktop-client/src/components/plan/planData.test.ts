import type {
  CategoryEntity,
  CategoryGroupEntity,
} from '@actual-app/core/types/models';
import type { CategoryTargetProjection } from '@actual-app/core/types/models/targets';

import type { PlanMonthValues } from './planData';
import { buildPlanData } from './planData';

function cat(id: string, name = id): CategoryEntity {
  return { id, name, group: 'g1', is_income: false };
}

function group(
  id: string,
  categories: CategoryEntity[],
  overrides: Partial<CategoryGroupEntity> = {},
): CategoryGroupEntity {
  return { id, name: id, is_income: false, categories, ...overrides };
}

function projection(
  categoryId: string,
  overrides: Partial<CategoryTargetProjection> = {},
): CategoryTargetProjection {
  return {
    categoryId,
    budgeted: 0,
    goal: 10000,
    longGoal: false,
    perTemplate: [],
    templateTypes: ['simple'],
    targetMonth: null,
    monthsRemaining: null,
    totalTargetAmount: null,
    savedTowardTarget: 0,
    limit: null,
    isElastic: false,
    error: null,
    ...overrides,
  };
}

function values(overrides: Partial<PlanMonthValues> = {}): PlanMonthValues {
  return { income: 0, budgeted: {}, balance: {}, ...overrides };
}

describe('buildPlanData', () => {
  it('sums targets per group and overall', () => {
    const data = buildPlanData(
      [projection('a', { goal: 10000 }), projection('b', { goal: 25000 })],
      values({ income: 100000, budgeted: { a: 10000, b: 5000 } }),
      [group('g1', [cat('a'), cat('b')])],
    );

    expect(data.totalTarget).toBe(35000);
    expect(data.totalAssigned).toBe(15000);
    expect(data.groups[0].target).toBe(35000);
    expect(data.groups[0].assigned).toBe(15000);
  });

  it('computes unplanned income as income minus the plan', () => {
    const data = buildPlanData(
      [projection('a', { goal: 30000 })],
      values({ income: 100000 }),
      [group('g1', [cat('a')])],
    );

    expect(data.unplanned).toBe(70000);
  });

  it('reports a negative unplanned figure when the plan overcommits income', () => {
    const data = buildPlanData(
      [projection('a', { goal: 150000 })],
      values({ income: 100000 }),
      [group('g1', [cat('a')])],
    );

    expect(data.unplanned).toBe(-50000);
  });

  it('excludes elastic categories from the monthly total', () => {
    // "Whatever is left" would otherwise make the plan total depend on how
    // much happened to be available.
    const data = buildPlanData(
      [
        projection('a', { goal: 10000 }),
        projection('b', { goal: null, isElastic: true }),
      ],
      values({ income: 100000, budgeted: { b: 42000 } }),
      [group('g1', [cat('a'), cat('b')])],
    );

    expect(data.totalTarget).toBe(10000);
    expect(data.elastic.map(c => c.category.id)).toEqual(['b']);
  });

  it('skips the income group', () => {
    const data = buildPlanData(
      [projection('salary', { goal: 500000 })],
      values({ income: 500000 }),
      [group('income', [cat('salary')], { is_income: true })],
    );

    expect(data.groups).toEqual([]);
    expect(data.totalTarget).toBe(0);
  });

  it('skips hidden categories', () => {
    const data = buildPlanData(
      [projection('a', { goal: 10000 }), projection('b', { goal: 90000 })],
      values(),
      [group('g1', [cat('a'), { ...cat('b'), hidden: true }])],
    );

    expect(data.totalTarget).toBe(10000);
  });

  it('omits groups with nothing planned and nothing assigned', () => {
    const data = buildPlanData([], values(), [
      group('g1', [cat('a')]),
      group('g2', [cat('b')]),
    ]);

    expect(data.groups).toEqual([]);
  });

  it('keeps a group that has assignments but no targets', () => {
    const data = buildPlanData([], values({ budgeted: { a: 5000 } }), [
      group('g1', [cat('a')]),
    ]);

    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].target).toBe(0);
    expect(data.groups[0].assigned).toBe(5000);
  });

  it('partitions long-term goals by #goal or a future deadline', () => {
    const data = buildPlanData(
      [
        projection('a', { longGoal: true }),
        projection('b', { monthsRemaining: 5, totalTargetAmount: 120000 }),
        projection('c', { monthsRemaining: 0, totalTargetAmount: 120000 }),
        projection('d'),
      ],
      values(),
      [group('g1', [cat('a'), cat('b'), cat('c'), cat('d')])],
    );

    // 'c' is due this month, so it is a monthly line, not a long-term goal.
    expect(data.longTerm.map(c => c.category.id)).toEqual(['a', 'b']);
  });

  it('surfaces broken automations rather than hiding them', () => {
    const data = buildPlanData(
      [projection('a', { goal: null, error: 'Only one #goal is allowed' })],
      values({ budgeted: { a: 100 } }),
      [group('g1', [cat('a')])],
    );

    expect(data.errors.map(c => c.category.id)).toEqual(['a']);
    expect(data.errors[0].error).toMatch(/Only one #goal/);
  });
});
