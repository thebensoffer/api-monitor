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
