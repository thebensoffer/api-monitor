/**
 * Per-cron run history, persisted to DynamoDB.
 *
 * Why DynamoDB and not memory: Amplify SSR runs across multiple Lambda
 * containers; an EventBridge-triggered cron lands on container A while
 * the dashboard reads from container B. In-memory storage = ghost data.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

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

const TABLE = process.env.OPENHEART_CRON_TABLE || 'openheart-cron-runs';
const HISTORY_LIMIT_PER_JOB = 25;

let _doc: DynamoDBDocumentClient | null = null;

function client(): DynamoDBDocumentClient | null {
  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  if (!_doc) {
    const ddb = new DynamoDBClient({
      region: process.env.OPENHEART_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
    });
    _doc = DynamoDBDocumentClient.from(ddb);
  }
  return _doc;
}

export async function recordRun(run: CronRun): Promise<void> {
  const c = client();
  if (!c) return;
  // Truncate run.data so we don't blow past Dynamo's 400KB item limit
  let safeData: any = undefined;
  if (run.data !== undefined) {
    try {
      const s = JSON.stringify(run.data);
      safeData = s.length > 30000 ? `[truncated ${s.length}B]` : run.data;
    } catch {
      safeData = '[unserializable]';
    }
  }
  await c.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        cronId: run.id,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        ok: run.ok,
        message: run.message,
        source: run.source,
        ...(safeData !== undefined ? { data: safeData } : {}),
        ...(run.error ? { error: run.error } : {}),
        // 30-day TTL on each run record (set numeric ttl epoch seconds)
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    })
  );
}

export async function getRuns(id: string): Promise<CronRun[]> {
  const c = client();
  if (!c) return [];
  const res = await c.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'cronId = :id',
      ExpressionAttributeValues: { ':id': id },
      ScanIndexForward: false, // newest first
      Limit: HISTORY_LIMIT_PER_JOB,
    })
  );
  return (res.Items ?? []).map((i) => ({
    id: i.cronId,
    startedAt: i.startedAt,
    finishedAt: i.finishedAt,
    durationMs: i.durationMs,
    ok: i.ok,
    message: i.message,
    source: i.source,
    data: i.data,
    error: i.error,
  }));
}

export async function getAllLatest(): Promise<Record<string, CronRun | null>> {
  const c = client();
  if (!c) return {};
  // Scan with pagination — DynamoDB returns max 1MB/page, our table grows
  // past that quickly. Without pagination, recently-added crons get omitted.
  const latest: Record<string, CronRun> = {};
  let lastKey: any = undefined;
  let pageCount = 0;
  do {
    const res = await c.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey: lastKey,
    }));
    for (const i of res.Items ?? []) {
      const existing = latest[i.cronId];
      if (!existing || existing.startedAt < i.startedAt) {
        latest[i.cronId] = {
          id: i.cronId,
          startedAt: i.startedAt,
          finishedAt: i.finishedAt,
          durationMs: i.durationMs,
          ok: i.ok,
          message: i.message,
          source: i.source,
          data: i.data,
          error: i.error,
        };
      }
    }
    lastKey = res.LastEvaluatedKey;
    pageCount++;
    // Hard cap so a runaway table doesn't burn the Lambda's time
    if (pageCount > 20) break;
  } while (lastKey);
  return latest;
}
