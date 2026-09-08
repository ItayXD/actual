import { createApp } from '#server/app';
import * as monthUtils from '#shared/months';
import type {
  InsightKind,
  InsightsParams,
  InsightsResult,
} from '#types/models/insights';

import { buildInsightContext } from './context';
import { rankInsights } from './rank';
import { CAPS, runDetectors } from './registry';
import { DEFAULTS } from './thresholds';
import type { ResolvedInsightsConfig } from './types';

/**
 * Read-only insight generation.
 *
 * **This handler must never write.** `FORK.md` rule 8 forbids a view mutating
 * the budget file as a side effect of being looked at, and this one reads a lot:
 * budget sheets, schedules, transactions, and the automation engine.
 *
 * Note that registering it without `mutator` documents that intent but does not
 * enforce it — `runHandler` only routes mutator-tagged handlers through
 * `runMutator`, so a handler that wrote would still write and would merely log
 * "mutator not running". The actual guarantees are structural:
 *
 *   1. `context.ts` is the only file here that touches the database, and it only
 *      reads. Every reused primitive (`generateForecast`, `projectTargets`,
 *      `getSheetValue`) is itself read-only.
 *   2. Detectors receive plain data — no db handle, no `send`, no sheet
 *      reference — so they *cannot* write.
 *   3. `read-only.test.ts` fails the build if anything under this directory
 *      imports a mutating helper.
 */

function resolveConfig(params: InsightsParams): ResolvedInsightsConfig & {
  today: string;
  month: string;
} {
  const today = params.today ?? monthUtils.currentDay();

  return {
    today,
    month: params.month ?? monthUtils.getMonth(today),
    horizonDays: params.horizonDays ?? DEFAULTS.HORIZON_DAYS,
    historyMonths: params.historyMonths ?? DEFAULTS.HISTORY_MONTHS,
    maxInsights: params.maxInsights ?? DEFAULTS.MAX_INSIGHTS,
    kinds: new Set<InsightKind>(params.kinds ?? []),
    lowBalanceThresholds: params.lowBalanceThresholds ?? {},
  };
}

export async function generateInsights(
  params: InsightsParams = {},
): Promise<InsightsResult> {
  const cfg = resolveConfig(params);
  const ctx = await buildInsightContext(cfg);
  const { insights, unavailable } = runDetectors(ctx, cfg);
  const { visible, suppressedByKind } = rankInsights({
    insights,
    caps: CAPS,
    maxInsights: cfg.maxInsights,
    today: cfg.today,
  });

  return {
    asOf: cfg.today,
    month: cfg.month,
    insights: visible,
    suppressedByKind,
    unavailable,
    truncated: ctx.truncated,
  };
}

export type InsightsHandlers = {
  'insights/generate': typeof generateInsights;
};

export const app = createApp<InsightsHandlers>();

// Deliberately bare: no `mutator`, no `undoable`. See the note above — this is
// documentation of intent, and the guarantee lives in the import discipline plus
// `read-only.test.ts`.
app.method('insights/generate', generateInsights);
