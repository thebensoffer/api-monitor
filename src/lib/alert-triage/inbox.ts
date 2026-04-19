/**
 * Inbound-email store backed by DynamoDB.
 *
 * The `openheart-inbound-email-processor` Lambda (SES → S3 → SNS target)
 * writes one row here per inbound alert email with triaged=false. The
 * triage cron reads unprocessed rows, classifies them, records a
 * TriageItem, and flips triaged=true so the same row isn't picked up twice.
 *
 * Schema (DynamoDB table `api-monitor-inbound-emails`):
 *   PK  id         (S)   — random cuid/uuid assigned at ingest
 *   SK  receivedAt (S)   — ISO timestamp from SES message metadata
 *   attrs: fromEmail, subject, textBody, s3Bucket, s3Key, recipientDomain,
 *          platform, messageId, triaged (boolean), triagedAt
 *   GSI  untriaged-index — PK=triaged("false" when not yet triaged, absent when triaged)
 *                          SK=receivedAt
 *
 * The sparse GSI lets us cheaply list untriaged rows. Once triaged, we
 * delete the `triaged` attribute so the row falls out of the GSI.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

export interface InboundEmailRow {
  id: string;
  receivedAt: string;             // ISO string (DDB sort key format)
  fromEmail: string;
  subject: string;
  textBody: string;
  snippet: string;
  recipientDomain: string;
  platform: string;               // "tovani" | "dk" | "dbs" | "unknown"
  messageId: string | null;
  s3Bucket?: string;
  s3Key?: string;
  triaged: boolean;
}

const TABLE = process.env.DYNAMODB_INBOUND_EMAILS_TABLE || 'api-monitor-inbound-emails';

let _doc: DynamoDBDocumentClient | null = null;
function doc(): DynamoDBDocumentClient {
  if (_doc) return _doc;
  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Alert-triage inbox: missing AWS credentials');
  }
  const ddb = new DynamoDBClient({
    region: process.env.OPENHEART_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });
  _doc = DynamoDBDocumentClient.from(ddb);
  return _doc;
}

/**
 * Senders we treat as system alerts. The inbound Lambda populates the DDB
 * table from all mail landing at alerts@{tovanihealth|discreetketamine|drbensoffer}.com,
 * so this is a defense-in-depth filter — the table should already only
 * contain alert-senders. Conservative; widen as new vendors surface.
 */
const SYSTEM_SENDER_PATTERNS: RegExp[] = [
  /@amazonaws\.com$/i,
  /@notifications\.amazonaws\.com$/i,
  /@email\.aws\.com$/i,
  /no-?reply@stripe\.com$/i,
  /notifications@stripe\.com$/i,
  /noreply@github\.com$/i,
  /@(sentry|vercel|cloudflare|neon\.tech|upstash|logrocket|posthog|datadoghq|pagerduty|betterstack|sumologic)\.com$/i,
  /@sentry\.io$/i,
  /@drchrono\.com$/i,
  /@twilio\.com$/i,
  /@e\.twilio\.com$/i,
  /@google\.com$/i,
  /noreply@accounts\.google\.com$/i,
  /^alerts?@/i,
  /^ops@/i,
  /^postmaster@/i,
  /^mailer-daemon@/i,
];

export function isSystemAlertSender(email: string): boolean {
  const e = (email || '').trim();
  if (!e) return false;
  return SYSTEM_SENDER_PATTERNS.some((re) => re.test(e));
}

export function platformForDomain(domain: string): 'tovani' | 'dk' | 'dbs' | 'unknown' {
  const d = (domain || '').toLowerCase();
  if (d === 'tovanihealth.com') return 'tovani';
  if (d === 'discreetketamine.com') return 'dk';
  if (d === 'drbensoffer.com') return 'dbs';
  return 'unknown';
}

/**
 * List untriaged inbound-email rows, newest first, via the sparse GSI.
 */
export async function listUntriaged(limit = 50): Promise<InboundEmailRow[]> {
  const c = doc();
  try {
    const r = await c.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'untriaged-index',
        KeyConditionExpression: 'triaged = :t',
        ExpressionAttributeValues: { ':t': 'false' },
        ScanIndexForward: false, // newest first
        Limit: limit,
      })
    );
    return (r.Items || []) as unknown as InboundEmailRow[];
  } catch (err: any) {
    // If the GSI isn't ready yet or the table is empty, fall back to scan.
    console.warn('[alert-triage] untriaged-index query failed, scanning:', err?.message);
    const r = await c.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'triaged = :t',
        ExpressionAttributeValues: { ':t': 'false' },
        Limit: Math.max(limit * 4, 100),
      })
    );
    return ((r.Items || []) as unknown as InboundEmailRow[])
      .sort((a, b) => (b.receivedAt > a.receivedAt ? 1 : -1))
      .slice(0, limit);
  }
}

/**
 * Mark a row as triaged: remove the sparse-GSI key and stamp triagedAt.
 * Safe to call twice (idempotent).
 */
export async function markTriaged(id: string, receivedAt: string): Promise<void> {
  await doc().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { id, receivedAt },
      UpdateExpression: 'REMOVE triaged SET triagedAt = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    })
  );
}
