import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * The only automated guard for `FORK.md` rule 8: viewing a budget must never
 * write to it.
 *
 * Registering `insights/generate` without `mutator` documents the intent but
 * enforces nothing — `runHandler` (`server/mutators.ts`) only routes
 * mutator-tagged handlers through `runMutator`, so a handler that wrote would
 * still write and would merely log "mutator not running". A regression here
 * would silently mutate a budget file that syncs to other clients, so it is
 * worth a test rather than a convention.
 *
 * `context.ts` is exempt because it is the designated I/O boundary; it is
 * allowed to read. `app.ts` is exempt because it wires the handler up.
 */

const INSIGHTS_DIR = path.join(__dirname);
const EXEMPT = new Set(['context.ts', 'app.ts']);

/** Anything that writes to the database, the sheet, or the sync log. */
const FORBIDDEN = [
  'db.update',
  'db.insert',
  'db.delete',
  'db.run',
  'batchMessages',
  'sendMessages',
  'setBudget',
  'setGoals',
  'setNextDate',
  '#server/sync',
  '#server/undo',
  'mutator',
  'undoable',
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      return [];
    }
    if (EXEMPT.has(path.relative(INSIGHTS_DIR, full))) {
      return [];
    }
    return [full];
  });
}

describe('the insights engine is read-only', () => {
  const files = sourceFiles(INSIGHTS_DIR);

  it('finds the detector sources to check', () => {
    // Guards against the glob silently matching nothing and the suite passing
    // for the wrong reason.
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map(f => [path.relative(INSIGHTS_DIR, f), f]))(
    '%s contains no mutating call',
    (_name, file) => {
      const source = fs.readFileSync(file, 'utf8');
      const found = FORBIDDEN.filter(token => source.includes(token));
      expect(found).toEqual([]);
    },
  );

  it('keeps the database confined to the context boundary', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toContain("from '#server/db'");
      expect(source).not.toContain("from '#server/aql'");
    }
  });
});
