import type {
  Insight,
  InsightSeverity,
} from '@actual-app/core/types/models/insights';
import { describe, expect, it } from 'vitest';

import type { DismissalEntry } from './dismissals';
import {
  addDismissal,
  expiryFor,
  indexDismissals,
  isSuppressed,
  MAX_ENTRIES,
  parseDismissals,
  pruneDismissals,
  removeDismissal,
  serializeDismissals,
} from './dismissals';

const NOW = 1_789_000_000;
const DAY = 86_400;

function insight({
  id = 'low-balance:a1',
  fingerprint = 'low-balance:a1:2026-09-18:20',
  severity = 'warning',
  expiresAt = null,
}: {
  id?: string;
  fingerprint?: string;
  severity?: InsightSeverity;
  expiresAt?: string | null;
} = {}): Insight {
  return {
    kind: 'low-balance',
    id,
    fingerprint,
    severity,
    score: 0.5,
    subjects: [],
    date: null,
    amount: null,
    expiresAt,
    data: {},
  } as unknown as Insight;
}

describe('parseDismissals', () => {
  it('reads a well-formed store', () => {
    const raw = serializeDismissals([{ i: 'a', f: 'f1', u: NOW + DAY }]);
    expect(parseDismissals(raw)).toEqual([{ i: 'a', f: 'f1', u: NOW + DAY }]);
  });

  it('treats absent, empty and malformed values as no snoozes', () => {
    expect(parseDismissals(undefined)).toEqual([]);
    expect(parseDismissals(null)).toEqual([]);
    expect(parseDismissals('')).toEqual([]);
    expect(parseDismissals('not json')).toEqual([]);
    expect(parseDismissals('{"v":1}')).toEqual([]);
    expect(parseDismissals('[]')).toEqual([]);
  });

  it('drops entries with the wrong shape rather than failing the card', () => {
    const raw = JSON.stringify({
      v: 1,
      d: [
        { i: 'good', f: 'f', u: 1 },
        { i: 'missing-u', f: 'f' },
        { f: 'no-id', u: 1 },
        null,
      ],
    });
    expect(parseDismissals(raw)).toEqual([{ i: 'good', f: 'f', u: 1 }]);
  });

  it('round-trips', () => {
    const entries: DismissalEntry[] = [{ i: 'a', f: 'f1', u: 10 }];
    expect(parseDismissals(serializeDismissals(entries))).toEqual(entries);
  });
});

describe('expiryFor', () => {
  const cases: [InsightSeverity, number][] = [
    ['critical', 3],
    ['warning', 14],
    ['info', 30],
  ];

  it.each(cases)('snoozes a %s insight for %s days', (severity, days) => {
    expect(expiryFor(insight({ severity }), NOW)).toBe(NOW + days * DAY);
  });

  it('never lasts less than a day', () => {
    // A server expiry already in the past would otherwise make the click a
    // no-op, and the row would reappear immediately.
    const expiry = expiryFor(
      insight({ severity: 'info', expiresAt: '1999-01-01' }),
      NOW,
    );
    expect(expiry).toBe(NOW + DAY);
  });

  it('respects an earlier server expiry', () => {
    // No point holding a snooze past the point the fact stops being true.
    const soon = new Date((NOW + 2 * DAY) * 1000).toISOString().slice(0, 10);
    const expiry = expiryFor(
      insight({ severity: 'info', expiresAt: soon }),
      NOW,
    );
    expect(expiry).toBeLessThan(NOW + 30 * DAY);
  });
});

describe('isSuppressed', () => {
  it('hides an insight whose facts have not changed', () => {
    const entries = addDismissal([], insight(), NOW);
    expect(isSuppressed(insight(), indexDismissals(entries), NOW)).toBe(true);
  });

  it('brings an insight straight back when its facts change', () => {
    // The whole point of the fingerprint: a worse shortfall is new information.
    const entries = addDismissal([], insight(), NOW);
    const worse = insight({ fingerprint: 'low-balance:a1:2026-09-18:80' });

    expect(isSuppressed(worse, indexDismissals(entries), NOW)).toBe(false);
  });

  it('brings an insight back once the snooze lapses', () => {
    const entries = addDismissal([], insight({ severity: 'critical' }), NOW);
    const index = indexDismissals(entries);

    expect(
      isSuppressed(insight({ severity: 'critical' }), index, NOW + DAY),
    ).toBe(true);
    expect(
      isSuppressed(insight({ severity: 'critical' }), index, NOW + 4 * DAY),
    ).toBe(false);
  });

  it('does not hide an unrelated insight', () => {
    const entries = addDismissal([], insight(), NOW);
    const other = insight({ id: 'low-balance:a2' });
    expect(isSuppressed(other, indexDismissals(entries), NOW)).toBe(false);
  });
});

describe('addDismissal', () => {
  it('replaces a stale entry for the same insight rather than accumulating', () => {
    const first = addDismissal([], insight(), NOW);
    const second = addDismissal(
      first,
      insight({ fingerprint: 'changed' }),
      NOW + DAY,
    );

    expect(second).toHaveLength(1);
    expect(second[0].f).toBe('changed');
  });

  it('keeps entries for other insights', () => {
    const entries = addDismissal(
      addDismissal([], insight({ id: 'a' }), NOW),
      insight({ id: 'b' }),
      NOW,
    );
    expect(entries.map(e => e.i).sort()).toEqual(['a', 'b']);
  });
});

describe('removeDismissal', () => {
  it('un-snoozes one insight', () => {
    const entries = addDismissal([], insight({ id: 'a' }), NOW);
    expect(removeDismissal(entries, 'a')).toEqual([]);
  });
});

describe('pruneDismissals', () => {
  it('drops lapsed entries', () => {
    const entries: DismissalEntry[] = [
      { i: 'live', f: 'f', u: NOW + DAY },
      { i: 'lapsed', f: 'f', u: NOW - DAY },
    ];
    expect(pruneDismissals(entries, NOW).map(e => e.i)).toEqual(['live']);
  });

  it('caps the set so the synced string stays bounded', () => {
    const entries: DismissalEntry[] = Array.from(
      { length: MAX_ENTRIES + 50 },
      (_, i) => ({ i: `x${i}`, f: 'f', u: NOW + DAY + i }),
    );

    const pruned = pruneDismissals(entries, NOW);
    expect(pruned).toHaveLength(MAX_ENTRIES);
    // Keeps the newest.
    expect(pruned[0].i).toBe(`x${MAX_ENTRIES + 49}`);
  });

  it('stays small in bytes at the cap', () => {
    const entries: DismissalEntry[] = Array.from(
      { length: MAX_ENTRIES },
      (_, i) => ({
        i: `possible-duplicate:0123456789abcdef~0123456789abcdef${i}`,
        f: 'a4d1c0e2',
        u: NOW + DAY,
      }),
    );

    // Well under any reasonable limit for a single synced preference value.
    expect(serializeDismissals(entries).length).toBeLessThan(20_000);
  });
});
