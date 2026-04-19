/**
 * HIPAA-grade audit logger.
 *
 * Every PHI-touching action (refund, sent-comms drill-down with body content,
 * patient record access) should be logged here. Records go to DynamoDB
 * `openheart-audit-log` with actor as hash key + ts as range key so we can
 * query "what did Brooke do today" or "everything that touched patient X".
 *
 * Append-only. 7-year retention via DynamoDB TTL.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.OPENHEART_AUDIT_TABLE || 'openheart-audit-log';
const SEVEN_YEARS_SECONDS = 7 * 365 * 24 * 60 * 60;

let _doc: DynamoDBDocumentClient | null = null;
function client(): DynamoDBDocumentClient | null {
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

export interface AuditEvent {
  actor: string;
  action: string;
  resource: string;
  metadata?: Record<string, any>;
  ip?: string | null;
}

export async function recordAudit(event: AuditEvent): Promise<void> {
  const c = client();
  if (!c) return;
  const ts = new Date().toISOString();
  await c.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        actor: event.actor,
        ts,
        action: event.action,
        resource: event.resource,
        metadata: event.metadata ?? null,
        ip: event.ip ?? null,
        ttl: Math.floor(Date.now() / 1000) + SEVEN_YEARS_SECONDS,
      },
    })
  );
}

export async function listByActor(actor: string, limit = 50) {
  const c = client();
  if (!c) return [];
  const r = await c.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'actor = :a',
      ExpressionAttributeValues: { ':a': actor },
      ScanIndexForward: false,
      Limit: limit,
    })
  );
  return r.Items ?? [];
}

export async function listAllRecent(limit = 200) {
  const c = client();
  if (!c) return [];
  const r = await c.send(new ScanCommand({ TableName: TABLE, Limit: limit }));
  const items = r.Items ?? [];
  return items.sort((a: any, b: any) => (b.ts || '').localeCompare(a.ts || ''));
}
