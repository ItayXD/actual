import type {
  CategoryEntity,
  CategoryGroupEntity,
} from '@actual-app/core/types/models';
import type {
  CategoryTargetProjection,
  PastSpending,
} from '@actual-app/core/types/models/targets';

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
    templateTypes: ['periodic'],
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
  return { budgeted: {}, balance: {}, ...overrides };
}

function past(overrides: Partial<PastSpending> = {}): PastSpending {
  return {
    basis: 'last-3-months',
    income: 0,
    byCategory: {},
    ...overrides,
  };
}

describe('buildPlanData', () => {
  it('sums planned amounts per group and overall', () => {
    const data = buildPlanData(
      [projection('a', { goal: 10000 }), projection('b', { goal: 25000 })],
      values(),
      past({ income: 100000 }),
      [group('g1', [cat('a'), cat('b')])],
    );

    expect(data.totalTarget).toBe(35000);
    expect(data.groups[0].target).toBe(35000);
  });

  it('sums past spending per group and overall', () => {
    const data = buildPlanData(
      [projection('a'), projection('b')],
      values(),
      past({ byCategory: { a: 12000, b: 3000 } }),
      [group('g1', [cat('a'), cat('b')])],
    );

    expect(data.totalPastSpending).toBe(15000);
    expect(data.groups[0].pastSpending).toBe(15000);
  });

  it('takes income from the comparison window, not the current month', () => {
    const data = buildPlanData(
      [projection('a', { goal: 30000 })],
      values(),
      past({ income: 100000 }),
      [group('g1', [cat('a')])],
    );

    expect(data.income).toBe(100000);
    expect(data.unplanned).toBe(70000);
  });

  it('reports a negative unplanned figure when the plan overcommits income', () => {
    const data = buildPlanData(
      [projection('a', { goal: 150000 })],
      values(),
      past({ income: 100000 }),
      [group('g1', [cat('a')])],
    );

    expect(data.unplanned).toBe(-50000);
  });

  it('compares each plan against its own history', () => {
    const data = buildPlanData(
      [projection('a', { goal: 10000 }), projection('b', { goal: 10000 })],
      values(),
      past({ byCategory: { a: 4000, b: 18000 } }),
      [group('g1', [cat('a'), cat('b')])],
    );

    const [a, b] = data.groups[0].categories;
    expect(a.vsPastSpending).toBe(6000); // plan leaves room
    expect(b.vsPastSpending).toBe(-8000); // plan is below what it costs
  });

  it('has no comparison for a category with no plan', () => {
    const data = buildPlanData(
      [],
      values(),
      past({ byCategory: { a: 4000 } }),
      [group('g1', [cat('a')])],
    );

    expect(data.groups[0].categories[0].target).toBe(null);
    expect(data.groups[0].categories[0].vsPastSpending).toBe(null);
    expect(data.groups[0].categories[0].pastSpending).toBe(4000);
  });

  it('excludes elastic categories from the planned total', () => {
    const data = buildPlanData(
      [
        projection('a', { goal: 10000 }),
        projection('b', { goal: null, isElastic: true }),
      ],
      values(),
      past({ income: 100000 }),
      [group('g1', [cat('a'), cat('b')])],
    );

    expect(data.totalTarget).toBe(10000);
    expect(data.elastic.map(c => c.category.id)).toEqual(['b']);
  });

  it('skips the income group', () => {
    const data = buildPlanData(
      [projection('salary', { goal: 500000 })],
      values(),
      past(),
      [group('income', [cat('salary')], { is_income: true })],
    );

    expect(data.groups).toEqual([]);
    expect(data.totalTarget).toBe(0);
  });

  it('skips hidden categories', () => {
    const data = buildPlanData(
      [projection('a', { goal: 10000 }), projection('b', { goal: 90000 })],
      values(),
      past(),
      [group('g1', [cat('a'), { ...cat('b'), hidden: true }])],
    );

    expect(data.totalTarget).toBe(10000);
  });

  it('lists every group, so unplanned categories can be planned', () => {
    // Unlike the budget table, an empty group is not noise here — it is where
    // you go to start planning.
    const data = buildPlanData([], values(), past(), [
      group('g1', [cat('a')]),
      group('g2', [cat('b')]),
    ]);

    expect(data.groups.map(g => g.group.id)).toEqual(['g1', 'g2']);
  });

  it('surfaces broken automations rather than hiding them', () => {
    const data = buildPlanData(
      [projection('a', { goal: null, error: 'Only one #goal is allowed' })],
      values(),
      past(),
      [group('g1', [cat('a')])],
    );

    expect(data.errors.map(c => c.category.id)).toEqual(['a']);
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
      past(),
      [group('g1', [cat('a'), cat('b'), cat('c'), cat('d')])],
    );

    // 'c' is due this month, so it is a monthly line, not a long-term goal.
    expect(data.longTerm.map(c => c.category.id)).toEqual(['a', 'b']);
  });
});
