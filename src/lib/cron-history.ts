/**
 * In-memory per-cron run history.
 * Move to DynamoDB (table `api-monitor-metrics` already provisioned) when needed.
 */

export interface CronRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  message: string;
  source: 'eventbridge' | 'manual' | 'dispatcher';
  data?: any;
  error?: string;
}

const HISTORY_LIMIT_PER_JOB = 25;

declare global {
  // eslint-disable-next-line no-var
  var __cronHistory: Map<string, CronRun[]> | undefined;
}

if (!globalThis.__cronHistory) globalThis.__cronHistory = new Map();

export function recordRun(run: CronRun) {
  const map = globalThis.__cronHistory!;
  const arr = map.get(run.id) ?? [];
  arr.unshift(run);
  if (arr.length > HISTORY_LIMIT_PER_JOB) arr.length = HISTORY_LIMIT_PER_JOB;
  map.set(run.id, arr);
}

export function getRuns(id: string): CronRun[] {
  return globalThis.__cronHistory?.get(id) ?? [];
}

export function getAllLatest(): Record<string, CronRun | null> {
  const result: Record<string, CronRun | null> = {};
  for (const [id, runs] of globalThis.__cronHistory!.entries()) {
    result[id] = runs[0] ?? null;
  }
  return result;
}
