/**
 * Synthetic-test report storage.
 *
 * External runners (Khai locally, future remote runners) POST results to
 * /api/synthetic/report. Each report is keyed by scenario + timestamp.
 * The synthetic-journey cron reads the latest per scenario and alerts if:
 *   - any latest report is failing
 *   - any scenario's latest report is older than its expected interval
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'openheart-synthetic-reports';

export interface SyntheticReport {
  scenario: string;
  ts: string;
  ok: boolean;
  durationMs: number;
  message: string;
  steps?: { name: string; ok: boolean; durationMs?: number; error?: string }[];
  source?: string; // 'khai' | 'manual' | 'cron'
  metadata?: Record<string, any>;
}

let _doc: DynamoDBDocumentClient | null = null;
function client() {
  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  if (!_doc) {
    const ddb = new DynamoDBClient({
      region: process.env.OPENHEART_AWS_REGION || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
    });
    _doc = DynamoDBDocumentClient.from(ddb);
  }
  return _doc;
}

export async function saveReport(report: SyntheticReport): Promise<void> {
  const c = client();
  if (!c) return;
  await c.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        ...report,
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    })
  );
}

export async function getRecent(scenario: string, limit = 25): Promise<SyntheticReport[]> {
  const c = client();
  if (!c) return [];
  const r = await c.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'scenario = :s',
      ExpressionAttributeValues: { ':s': scenario },
      ScanIndexForward: false,
      Limit: limit,
    })
  );
  return (r.Items ?? []) as SyntheticReport[];
}

export async function getAllLatest(): Promise<Record<string, SyntheticReport>> {
  const c = client();
  if (!c) return {};
  const r = await c.send(new ScanCommand({ TableName: TABLE }));
  const latest: Record<string, SyntheticReport> = {};
  for (const item of (r.Items ?? []) as SyntheticReport[]) {
    const cur = latest[item.scenario];
    if (!cur || cur.ts < item.ts) latest[item.scenario] = item;
  }
  return latest;
}
