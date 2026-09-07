import type { ByTemplate, SpendTemplate } from '#types/models/templates';

import {
  effectiveRepeatMonths,
  effectiveSpendWindow,
  effectiveTargetMonth,
  monthsUntilTarget,
} from './target-meta';

function by(overrides: Partial<ByTemplate> = {}): ByTemplate {
  return {
    type: 'by',
    directive: 'template',
    priority: 1,
    amount: 1200,
    month: '2026-12',
    ...overrides,
  };
}

function spend(overrides: Partial<SpendTemplate> = {}): SpendTemplate {
  return {
    type: 'spend',
    directive: 'template',
    priority: 1,
    amount: 1200,
    month: '2026-12',
    from: '2026-01',
    ...overrides,
  };
}

describe('effectiveRepeatMonths', () => {
  it('returns null when the template does not repeat', () => {
    expect(effectiveRepeatMonths(by())).toBe(null);
    expect(effectiveRepeatMonths(by({ repeat: 0 }))).toBe(null);
  });

  it('returns the repeat interval in months', () => {
    expect(effectiveRepeatMonths(by({ repeat: 3 }))).toBe(3);
  });

  it('multiplies by 12 for annual templates, defaulting repeat to 1', () => {
    expect(effectiveRepeatMonths(by({ annual: true }))).toBe(12);
    expect(effectiveRepeatMonths(by({ annual: true, repeat: 2 }))).toBe(24);
  });
});

describe('effectiveTargetMonth', () => {
  it('keeps a future target month as-is', () => {
    expect(effectiveTargetMonth(by({ month: '2026-12' }), '2026-09')).toBe(
      '2026-12',
    );
  });

  it('keeps the current month as-is', () => {
    expect(effectiveTargetMonth(by({ month: '2026-09' }), '2026-09')).toBe(
      '2026-09',
    );
  });

  it('keeps a lapsed non-repeating target in the past', () => {
    expect(effectiveTargetMonth(by({ month: '2026-03' }), '2026-09')).toBe(
      '2026-03',
    );
  });

  it('rolls a lapsed repeating target forward by whole periods', () => {
    expect(
      effectiveTargetMonth(by({ month: '2026-02', repeat: 3 }), '2026-09'),
    ).toBe('2026-11');
  });

  it('stops on the current month rather than skipping past it', () => {
    expect(
      effectiveTargetMonth(by({ month: '2026-03', repeat: 3 }), '2026-09'),
    ).toBe('2026-09');
  });

  it('rolls an annual target forward across the year boundary', () => {
    expect(
      effectiveTargetMonth(by({ month: '2024-05', annual: true }), '2026-09'),
    ).toBe('2027-05');
  });
});

describe('monthsUntilTarget', () => {
  it('is 0 when the target is due this month', () => {
    expect(monthsUntilTarget(by({ month: '2026-09' }), '2026-09')).toBe(0);
  });

  it('counts months remaining for a future target', () => {
    expect(monthsUntilTarget(by({ month: '2026-12' }), '2026-09')).toBe(3);
  });

  it('is negative for a lapsed non-repeating target', () => {
    expect(monthsUntilTarget(by({ month: '2026-03' }), '2026-09')).toBe(-6);
  });

  it('is never negative for a repeating target', () => {
    expect(
      monthsUntilTarget(by({ month: '2026-02', repeat: 3 }), '2026-09'),
    ).toBe(2);
    expect(
      monthsUntilTarget(by({ month: '2026-03', repeat: 3 }), '2026-09'),
    ).toBe(0);
  });
});

describe('effectiveSpendWindow', () => {
  it('leaves a future window untouched', () => {
    expect(effectiveSpendWindow(spend(), '2026-09')).toEqual({
      fromMonth: '2026-01',
      toMonth: '2026-12',
      monthsRemaining: 3,
    });
  });

  it('shifts both ends in lockstep by the same number of periods', () => {
    expect(
      effectiveSpendWindow(
        spend({ from: '2025-01', month: '2025-12', annual: true }),
        '2026-09',
      ),
    ).toEqual({
      fromMonth: '2026-01',
      toMonth: '2026-12',
      monthsRemaining: 3,
    });
  });

  it('shifts by more than one period when several have lapsed', () => {
    expect(
      effectiveSpendWindow(
        spend({ from: '2026-01', month: '2026-03', repeat: 3 }),
        '2026-09',
      ),
    ).toEqual({
      fromMonth: '2026-07',
      toMonth: '2026-09',
      monthsRemaining: 0,
    });
  });

  it('leaves a lapsed non-repeating window in the past', () => {
    expect(
      effectiveSpendWindow(
        spend({ from: '2025-01', month: '2025-12' }),
        '2026-09',
      ),
    ).toEqual({
      fromMonth: '2025-01',
      toMonth: '2025-12',
      monthsRemaining: -9,
    });
  });
});
