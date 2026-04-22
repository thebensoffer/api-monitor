/**
 * Alert classifier — Bedrock Haiku via OpenHeart's Bedrock client.
 *
 * Sorts each inbound system-alert email into one of four buckets:
 *   routine      — expected ongoing signal, no action needed
 *   auto_fix     — known failure with a safe scoped remediation handler
 *   investigate  — unfamiliar or fuzzy; agent gathers context, drafts a note
 *   escalate     — security/PHI/payment-dispute; never auto-act
 */

import { askClaudeJSON, CLAUDE_MODELS } from '@/lib/bedrock';
import { FIX_ACTIONS, type FixActionId } from '@/lib/fix-actions';

export type Bucket = 'routine' | 'auto_fix' | 'investigate' | 'escalate';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface InboundMessage {
  id: string;
  fromEmail: string;
  subject: string;
  body: string;
  snippet: string;
  receivedAt: Date;
  platform: string;          // 'tovani' | 'dk' | 'dbs' | recipient-domain
}

export interface Classification {
  bucket: Bucket;
  alertType: string | null;
  severity: Severity;
  confidence: number;
  reasoning: string;
  proposedAction: string | null;
  actionParams: Record<string, unknown> | null;
}

const SYSTEM_PROMPT = `You triage system-alert emails for the OpenHeart monitoring dashboard, which watches three medical platforms: Tovani Health (ketamine telehealth on AWS Amplify + Aurora + Stripe + DrChrono), Discreet Ketamine (DK, sister clinic same stack), and drbensoffer.com (DBS, Dr. Ben Soffer's practice site). Classify each email into exactly one bucket and return strict JSON.

Buckets:
- routine: expected ongoing signal; nothing is wrong (successful backup, cert auto-renewed, "everything green" reports)
- auto_fix: a failure with a known, scoped remediation we can run safely
- investigate: something looks off but no pre-defined fix; human should see a diagnosis
- escalate: HIPAA/PHI concern, payment dispute, security incident, legal — never auto-act

Severity: info | low | medium | high | critical. Smallest severity that still conveys urgency. Routine success is "info". Production outage is "critical".

alertType is a short snake_case tag (e.g. stripe_webhook_failure, iam_key_expiring, amplify_build_failed, ssl_cert_expiring, ses_bounce_spike, sentry_error_spike, drchrono_auth_error, cloudwatch_alarm, aurora_cpu_high, backup_verification_failed, or null if nothing fits).

proposedAction is the name of a known fix-action handler (see shared allowlist in src/lib/fix-actions.ts), or null if none applies. Only use handler ids from this allowlist with their param shapes:
{{HANDLERS}}
If bucket is "escalate" or "routine", proposedAction MUST be null. For "investigate", proposedAction may be null.

actionParams is a JSON object matching the handler's paramSchema (shown inline above). Omit or null if no action.

confidence is 0..1. Below 0.6, prefer "investigate" over "auto_fix".

reasoning: one or two sentences, specific to this email's content — not boilerplate. Mention which platform (tovani/dk/dbs) it concerns if identifiable.

Return ONLY a JSON object with keys: bucket, alertType, severity, confidence, reasoning, proposedAction, actionParams. No prose, no code fences.`;

function buildPrompt(msg: InboundMessage): string {
  return [
    `Platform: ${msg.platform}`,
    `From: ${msg.fromEmail}`,
    `Subject: ${msg.subject}`,
    `Received: ${msg.receivedAt.toISOString()}`,
    '',
    'Body:',
    msg.body || msg.snippet || '(empty body)',
  ].join('\n');
}

export async function classifyAlert(msg: InboundMessage): Promise<Classification> {
  // Pre-classify check: if this is a CloudWatch alarm email AND the alarm
  // has since recovered to OK, short-circuit to a "routine — already
  // recovered" classification. Saves a Bedrock call AND prevents the
  // common false-positive where the agent suggests restart-amplify-app
  // for an alarm that healed itself before the email even landed.
  const recovered = await maybeShortCircuitRecoveredAlarm(msg);
  if (recovered) return recovered;

  const handlerList =
    FIX_ACTIONS.map((a) => `  - ${a.id} (${a.riskLevel} risk): ${a.description}\n      params: ${a.paramSchema}`).join('\n') ||
    '  (no handlers registered)';
  const system = SYSTEM_PROMPT.replace('{{HANDLERS}}', handlerList);
  const raw = await askClaudeJSON<Partial<Classification> & { severity?: string; bucket?: string }>(
    buildPrompt(msg),
    { model: CLAUDE_MODELS.HAIKU_35, system, maxTokens: 600, temperature: 0.2 }
  );
  return normalize(raw);
}

/**
 * If the inbound email is a CloudWatch SNS notification AND the alarm has
 * since recovered to OK, return a routine classification instead of paying
 * for the full Bedrock classify pass. Returns null if the email isn't a
 * CW alarm, the alarm name can't be parsed, or the alarm is still ALARM /
 * INSUFFICIENT_DATA / unreachable.
 */
async function maybeShortCircuitRecoveredAlarm(msg: InboundMessage): Promise<Classification | null> {
  const text = `${msg.subject}\n${msg.body || msg.snippet}`;
  // Heuristic: CloudWatch SNS emails always include both these tokens.
  // Cheap to check and avoids querying for non-CW alerts.
  if (!/CloudWatch|cloudwatch:alarm/i.test(text)) return null;

  // Pull alarm name. Multiple possible patterns — AWS uses different
  // templates depending on whether you're getting the SNS default or a
  // composite alarm. Try them in order.
  const nameMatch =
    text.match(/Alarm\s*"([^"]+)"/) ||
    text.match(/^- Name:\s+(.+)$/m) ||
    text.match(/alarm:([\w.-]+)/);
  if (!nameMatch) return null;
  const alarmName = nameMatch[1].trim();

  // Region — defaults to us-east-1 if we can't extract it
  const regionMatch = text.match(/in (?:the\s+)?([a-z]{2}-[a-z]+-\d)|cloudwatch:([a-z]{2}-[a-z]+-\d):/i);
  const region =
    (regionMatch?.[1] || regionMatch?.[2] || 'us-east-1').toLowerCase();

  // Need AWS creds to call CloudWatch. If missing, skip the short-circuit
  // (full classifier still runs, behavior is unchanged from before).
  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  try {
    const { CloudWatchClient, DescribeAlarmsCommand } = await import('@aws-sdk/client-cloudwatch');
    const cw = new CloudWatchClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    const r = await cw.send(new DescribeAlarmsCommand({ AlarmNames: [alarmName] }));
    const alarm = r.MetricAlarms?.[0] || r.CompositeAlarms?.[0];
    if (!alarm) return null; // alarm doesn't exist (deleted?) — let normal classifier handle

    if (alarm.StateValue !== 'OK') return null; // still firing — let classifier propose action

    // Alarm has self-recovered. Check how long ago.
    const updated = alarm.StateUpdatedTimestamp;
    const ageMin = updated
      ? Math.floor((Date.now() - new Date(updated).getTime()) / 60000)
      : null;

    return {
      bucket: 'routine',
      alertType: 'cloudwatch_alarm_recovered',
      severity: 'info',
      confidence: 0.95,
      reasoning: `CloudWatch alarm "${alarmName}" (${region}) is currently OK${ageMin !== null ? `, recovered ${ageMin}m ago` : ''}. Email is stale — no action needed. Skipped Bedrock classifier to prevent false-positive fix suggestions.`,
      proposedAction: null,
      actionParams: null,
    };
  } catch (err: any) {
    // If we can't reach CloudWatch, fall through to the regular classifier
    console.warn('[classify] alarm short-circuit failed:', err?.message);
    return null;
  }
}

function normalize(raw: any): Classification {
  const allowedBuckets: Bucket[] = ['routine', 'auto_fix', 'investigate', 'escalate'];
  const allowedSev: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

  const bucket = allowedBuckets.includes(raw.bucket) ? (raw.bucket as Bucket) : 'investigate';
  const severity = allowedSev.includes(raw.severity) ? (raw.severity as Severity) : 'medium';
  const confidence = clamp01(typeof raw.confidence === 'number' ? raw.confidence : 0.5);

  const knownIds = FIX_ACTIONS.map((a) => a.id as string);
  let proposedAction: string | null = raw.proposedAction ?? null;
  if (proposedAction && !knownIds.includes(proposedAction)) proposedAction = null;
  if (bucket === 'routine' || bucket === 'escalate') proposedAction = null;

  const finalBucket: Bucket = bucket === 'auto_fix' && confidence < 0.6 ? 'investigate' : bucket;

  return {
    bucket: finalBucket,
    alertType: raw.alertType ?? null,
    severity,
    confidence,
    reasoning: (raw.reasoning || '').slice(0, 1000) || '(no reasoning provided)',
    proposedAction: finalBucket === 'auto_fix' || finalBucket === 'investigate' ? proposedAction : null,
    actionParams: raw.actionParams ?? null,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
