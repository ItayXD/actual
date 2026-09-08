import type { TargetStatus, TargetStatusInput } from './targetStatus';
import {
  getPlanProgress,
  getPlanStatus,
  getTargetProgress,
  getTargetStatus,
  makeTargetAmountStyle,
} from './targetStatus';

function input(overrides: Partial<TargetStatusInput> = {}): TargetStatusInput {
  return {
    balance: 0,
    budgeted: 0,
    target: 10000,
    isLongGoal: false,
    isElastic: false,
    monthsRemaining: null,
    savedTowardTarget: 0,
    totalTargetAmount: null,
    ...overrides,
  };
}

describe('getTargetStatus', () => {
  const cases: Array<[string, Partial<TargetStatusInput>, TargetStatus]> = [
    // Overspending outranks everything, target or not.
    [
      'negative balance with a target',
      { balance: -500, budgeted: 10000 },
      'overspent',
    ],
    [
      'negative balance without a target',
      { balance: -500, target: null },
      'overspent',
    ],

    // No fixed number to measure against.
    ['remainder template', { isElastic: true }, 'elastic'],
    ['no target at all', { target: null }, 'no-target'],
    [
      'elastic wins over a null target',
      { isElastic: true, target: null },
      'elastic',
    ],

    // Monthly targets.
    ['nothing assigned', { budgeted: 0 }, 'unfunded'],
    ['partly assigned', { budgeted: 4000 }, 'partial'],
    ['exactly assigned', { budgeted: 10000 }, 'funded'],
    ['over assigned', { budgeted: 12000 }, 'overfunded'],

    // A zero target is met by definition, and beaten by any assignment.
    ['zero target, nothing assigned', { target: 0 }, 'funded'],
    [
      'zero target, something assigned',
      { target: 0, budgeted: 100 },
      'overfunded',
    ],

    // Long goals accumulate, so they are judged on balance, not budgeted.
    [
      'long goal short on balance despite a full assignment',
      { isLongGoal: true, balance: 4000, budgeted: 10000, target: 10000 },
      'partial',
    ],
    [
      'long goal met by balance with nothing assigned',
      { isLongGoal: true, balance: 10000, budgeted: 0, target: 10000 },
      'funded',
    ],

    // Dated targets: judged on this month's slice, with the total as an escape.
    [
      'dated target with this month covered',
      { budgeted: 10000, monthsRemaining: 3, totalTargetAmount: 120000 },
      'on-track',
    ],
    [
      'dated target underfunded this month',
      { budgeted: 2000, monthsRemaining: 3, totalTargetAmount: 120000 },
      'behind',
    ],
    [
      'dated target with nothing assigned',
      { budgeted: 0, monthsRemaining: 3, totalTargetAmount: 120000 },
      'unfunded',
    ],
    [
      'dated target already saved in full',
      {
        budgeted: 0,
        monthsRemaining: 3,
        totalTargetAmount: 120000,
        savedTowardTarget: 120000,
      },
      'overfunded',
    ],

    // monthsRemaining 0 means "due this month" — back to monthly rules, so an
    // exact assignment reads as `funded` rather than `on-track`.
    [
      'dated target due this month',
      { budgeted: 10000, monthsRemaining: 0, totalTargetAmount: 120000 },
      'funded',
    ],
    // A lapsed non-repeating deadline must not be treated as still pacing.
    [
      'lapsed deadline',
      { budgeted: 10000, monthsRemaining: -2, totalTargetAmount: 120000 },
      'funded',
    ],
    // Without a known total there is nothing to pace against.
    [
      'months remaining but no total',
      { budgeted: 2000, monthsRemaining: 3, totalTargetAmount: null },
      'partial',
    ],
  ];

  it.each(cases)('%s → %s', (_name, overrides, expected) => {
    expect(getTargetStatus(input(overrides))).toBe(expected);
  });
});

describe('getTargetProgress', () => {
  it('has no progress without a target', () => {
    expect(getTargetProgress(input({ target: null }))).toEqual({
      progress: null,
      pace: null,
    });
  });

  it('has no progress for an elastic target', () => {
    expect(getTargetProgress(input({ isElastic: true }))).toEqual({
      progress: null,
      pace: null,
    });
  });

  it('measures a monthly target against what was assigned', () => {
    expect(getTargetProgress(input({ budgeted: 2500 }))).toEqual({
      progress: 0.25,
      pace: null,
    });
  });

  it('measures a long goal against the balance', () => {
    expect(
      getTargetProgress(input({ isLongGoal: true, balance: 5000 })),
    ).toEqual({ progress: 0.5, pace: null });
  });

  it('can exceed 1 when overfunded', () => {
    expect(getTargetProgress(input({ budgeted: 15000 })).progress).toBe(1.5);
  });

  it('never reports negative progress', () => {
    expect(getTargetProgress(input({ budgeted: -5000 })).progress).toBe(0);
  });

  it('avoids dividing by a zero target', () => {
    expect(getTargetProgress(input({ target: 0, budgeted: 100 }))).toEqual({
      progress: null,
      pace: null,
    });
  });

  describe('dated targets', () => {
    const dated = {
      monthsRemaining: 3,
      totalTargetAmount: 120000,
      savedTowardTarget: 60000,
      target: 15000,
    };

    it('reports overall progress and the month-end pace tick', () => {
      // Saved 60000 of 120000, assigning 15000 this month → 62.5% at month end,
      // and 62.5% is exactly where an on-schedule saver should be.
      expect(getTargetProgress(input({ ...dated, budgeted: 15000 }))).toEqual({
        progress: 0.625,
        pace: 0.625,
      });
    });

    it('puts progress behind the pace tick when underfunded', () => {
      const { progress, pace } = getTargetProgress(
        input({ ...dated, budgeted: 3000 }),
      );
      expect(progress).toBeLessThan(pace ?? 0);
    });

    it('puts progress ahead of the pace tick when overfunded', () => {
      const { progress, pace } = getTargetProgress(
        input({ ...dated, budgeted: 40000 }),
      );
      expect(progress).toBeGreaterThan(pace ?? 0);
    });

    it('clamps the pace tick to the end of the bar', () => {
      expect(
        getTargetProgress(
          input({ ...dated, savedTowardTarget: 119000, target: 15000 }),
        ).pace,
      ).toBe(1);
    });
  });
});

describe('makeTargetAmountStyle', () => {
  it('defers to the legacy styling when there is no target', () => {
    expect(makeTargetAmountStyle('no-target')).toBe(null);
    expect(makeTargetAmountStyle('elastic')).toBe(null);
  });

  it('colours every target-bearing status', () => {
    const statuses: TargetStatus[] = [
      'overspent',
      'unfunded',
      'partial',
      'funded',
      'overfunded',
      'on-track',
      'behind',
    ];
    for (const status of statuses) {
      expect(makeTargetAmountStyle(status)).toHaveProperty('color');
    }
  });
});

describe('getPlanStatus', () => {
  it("reports how this month's assignment compares to the plan", () => {
    expect(getPlanStatus(0, 10000)).toBe('unfunded');
    expect(getPlanStatus(4000, 10000)).toBe('partial');
    expect(getPlanStatus(10000, 10000)).toBe('funded');
    expect(getPlanStatus(12000, 10000)).toBe('overfunded');
  });

  it('has no opinion without a fixed plan', () => {
    expect(getPlanStatus(5000, null)).toBe('no-target');
    expect(getPlanStatus(5000, 10000, true)).toBe('elastic');
  });

  it('treats a zero plan as met', () => {
    expect(getPlanStatus(0, 0)).toBe('funded');
    expect(getPlanStatus(100, 0)).toBe('overfunded');
  });

  it('ignores the balance, which the Balance column owns', () => {
    // Same assignment and plan, whatever the balance is doing.
    expect(getPlanStatus(10000, 10000)).toBe('funded');
  });
});

describe('getPlanProgress', () => {
  it('is the assigned fraction of the plan', () => {
    expect(getPlanProgress(2500, 10000)).toBe(0.25);
    expect(getPlanProgress(10000, 10000)).toBe(1);
  });

  it('can exceed 1 when over-assigned', () => {
    expect(getPlanProgress(15000, 10000)).toBe(1.5);
  });

  it('never goes negative', () => {
    expect(getPlanProgress(-5000, 10000)).toBe(0);
  });

  it('is null when there is nothing to measure against', () => {
    expect(getPlanProgress(5000, null)).toBe(null);
    expect(getPlanProgress(5000, 0)).toBe(null);
    expect(getPlanProgress(5000, 10000, true)).toBe(null);
  });
});
