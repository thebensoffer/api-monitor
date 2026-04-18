/**
 * In-memory deploy-version timeline.
 *
 * Each service can register a version string after a probe; we keep the
 * full chronological history so the UI can render a deployment timeline.
 *
 * Resets on dev-server restart — fine for now. Move to DynamoDB later.
 */

export interface VersionEvent {
  service: string;
  version: string;
  observedAt: string;
  metadata?: Record<string, any>;
}

const HISTORY_LIMIT = 100;

declare global {
  // eslint-disable-next-line no-var
  var __versionHistory: VersionEvent[] | undefined;
  // eslint-disable-next-line no-var
  var __versionLatest: Map<string, string> | undefined;
}

if (!globalThis.__versionHistory) globalThis.__versionHistory = [];
if (!globalThis.__versionLatest) globalThis.__versionLatest = new Map();

export function recordVersion(
  service: string,
  version: string | null | undefined,
  metadata?: Record<string, any>
): VersionEvent | null {
  if (!version) return null;
  const latest = globalThis.__versionLatest!;
  const history = globalThis.__versionHistory!;
  const previous = latest.get(service);
  if (previous === version) return null;
  const event: VersionEvent = {
    service,
    version,
    observedAt: new Date().toISOString(),
    metadata: { ...metadata, previousVersion: previous ?? null },
  };
  history.push(event);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  latest.set(service, version);
  return event;
}

export function getVersionHistory(): VersionEvent[] {
  return [...(globalThis.__versionHistory ?? [])].reverse();
}

export function getLatestVersions(): Record<string, string> {
  return Object.fromEntries(globalThis.__versionLatest ?? new Map());
}
