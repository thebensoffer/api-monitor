/**
 * Triage-item store (DynamoDB `api-monitor-triage-items`).
 *
 * One row per classified inbound email. The dashboard reads this table
 * directly to render the triage feed. We also keep the classifier's
 * shadow-action plan here so Phase 2 auto-fix can be enabled per-handler
 * without reprocessing old rows.
 *
 * Schema:
 *   PK  id         (S)   — random cuid/uuid
 *   SK  createdAt  (S)   — ISO timestamp (for range queries)
 *   attrs: inboundEmailId, platform, fromEmail, subject, bucket, alertType,
 *          severity, confidence, reasoning, proposedAction, actionParams,
 *          actionStatus, actionResult, receivedAt
 *   GSI  by-bucket-created-index — PK=bucket, SK=createdAt
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Classification } from './classify';

const TABLE = process.env.DYNAMODB_TRIAGE_ITEMS_TABLE || 'api-monitor-triage-items';

let _doc: DynamoDBDocumentClient | null = null;
function doc(): DynamoDBDocumentClient {
  if (_doc) return _doc;
  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Alert-triage items: missing AWS credentials');
  }
  const ddb = new DynamoDBClient({
    region: process.env.OPENHEART_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });
  _doc = DynamoDBDocumentClient.from(ddb);
  return _doc;
}

function cuid(): string {
  // Cheap non-crypto id — fine for dashboard rows, not for auth tokens.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export interface TriageItemInput {
  inboundEmailId: string;
  platform: string;
  fromEmail: string;
  subject: string;
  receivedAt: string;
  bodySnippet: string;
  classification: Classification;
  actionStatus: 'shadow' | 'skipped' | 'executed' | 'failed';
  actionResult: Record<string, unknown> | null;
}

export async function putTriageItem(input: TriageItemInput): Promise<string> {
  const id = cuid();
  const createdAt = new Date().toISOString();
  const item: Record<string, unknown> = {
    id,
    createdAt,
    inboundEmailId: input.inboundEmailId,
    platform: input.platform,
    fromEmail: input.fromEmail,
    subject: input.subject.slice(0, 500),
    receivedAt: input.receivedAt,
    bodySnippet: input.bodySnippet.slice(0, 2000),
    bucket: input.classification.bucket,
    alertType: input.classification.alertType,
    severity: input.classification.severity,
    confidence: input.classification.confidence,
    reasoning: input.classification.reasoning,
    proposedAction: input.classification.proposedAction,
    actionParams: input.classification.actionParams ?? undefined,
    actionStatus: input.actionStatus,
    actionResult: input.actionResult ?? undefined,
  };
  // Strip undefined (DDB rejects them)
  for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
  await doc().send(new PutCommand({ TableName: TABLE, Item: item }));
  return id;
}
