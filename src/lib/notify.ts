/**
 * Notification dispatcher — gets alerts OUT of the dashboard.
 *
 * dispatch() takes an Alert and sends via:
 *   - SES email (NOTIFY_EMAIL_TO)
 *   - Twilio (SMS to NOTIFY_SMS_TO) if both Twilio creds + phone set
 *   - Slack incoming webhook (NOTIFY_SLACK_WEBHOOK) if set
 *
 * Each alert is auto-diagnosed by Claude (triage agent) and the email
 * embeds the diagnosis + magic-link buttons for one-tap fixes.
 *
 * Dedup: each (alertId, channel) pair recorded in DynamoDB
 * `openheart-notifications` so we don't spam on every poll.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { triageAlert, type TriageResult } from './triage';
import { signFixToken } from './fix-tokens';

const TABLE = 'openheart-notifications';
const DEDUP_WINDOW_HOURS = 4;

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

export interface NotifyAlert {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  source: string;
  action?: string;
}

interface NotifyResult {
  channel: 'email' | 'sms' | 'slack';
  ok: boolean;
  detail: string;
}

async function alreadyNotified(alertId: string, channel: string): Promise<boolean> {
  const c = client();
  if (!c) return false;
  try {
    const r = await c.send(
      new GetCommand({
        TableName: TABLE,
        Key: { alertKey: `${alertId}:${channel}` },
      })
    );
    if (!r.Item) return false;
    const sentAt = new Date(r.Item.sentAt);
    return Date.now() - sentAt.getTime() < DEDUP_WINDOW_HOURS * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

async function recordNotified(alertId: string, channel: string, detail: string) {
  const c = client();
  if (!c) return;
  await c.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        alertKey: `${alertId}:${channel}`,
        sentAt: new Date().toISOString(),
        detail,
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      },
    })
  );
}

async function sendEmail(alert: NotifyAlert, triage?: TriageResult | null): Promise<NotifyResult> {
  const to = process.env.NOTIFY_EMAIL_TO;
  if (!to) return { channel: 'email', ok: false, detail: 'No NOTIFY_EMAIL_TO' };

  // Action-needed badge for the subject line — instantly readable
  const actionBadge =
    triage?.actionNeeded === 'none' ? ' [no action]' :
    triage?.actionNeeded === 'auto-fixable' ? ' [auto-fixable]' :
    triage?.actionNeeded === 'human' ? ' [needs human]' :
    triage?.actionNeeded === 'monitor' ? ' [monitor]' :
    '';
  const subject = `[OpenHeart ${alert.severity.toUpperCase()}]${actionBadge} ${alert.title}`;

  // Build magic-link buttons if triage suggests an auto-fix
  let fixButtons = '';
  if (triage?.fixAction && process.env.FIX_TOKEN_SECRET) {
    try {
      const token = signFixToken({
        actionId: triage.fixAction.id,
        params: triage.fixAction.params,
        alertId: alert.id,
        mode: 'execute',
        expiresAt: Date.now() + 30 * 60 * 1000,
      });
      const baseUrl = process.env.OPENHEART_SELF_URL || 'https://main.dl7zrj8lm47be.amplifyapp.com';
      const link = `${baseUrl}/api/fix-action/execute?t=${encodeURIComponent(token)}`;
      fixButtons = `
        <div style="margin:20px 0;padding:14px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px">
          <div style="font-weight:600;margin-bottom:8px">🔧 Suggested fix: <code>${triage.fixAction.id}</code></div>
          <div style="font-size:12px;color:#666;margin-bottom:10px">Params: <code>${JSON.stringify(triage.fixAction.params)}</code></div>
          <a href="${link}" style="display:inline-block;padding:10px 16px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">▶ Apply fix (preview first)</a>
          <div style="font-size:11px;color:#888;margin-top:8px">Magic link expires in 30 min · token authorizes one specific fix · audit-logged</div>
        </div>`;
    } catch (e) {
      // FIX_TOKEN_SECRET missing or sign failed — fall through without buttons
    }
  }

  const triageBlock = triage ? `
    <div style="margin:16px 0;padding:14px;background:#f3f4f6;border-radius:6px;border-left:4px solid ${triage.severity === 'high' ? '#dc2626' : triage.severity === 'medium' ? '#f59e0b' : '#3b82f6'}">
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;font-weight:600">🤖 Triage diagnosis · confidence: ${triage.confidence}</div>
      <div style="margin:6px 0">${triage.diagnosis}</div>
      <div style="margin-top:8px"><strong>Recommended:</strong> ${triage.recommendedFix}</div>
      <div style="margin-top:6px;font-size:12px"><strong>Action needed:</strong> <code>${triage.actionNeeded}</code></div>
    </div>` : '';

  const html = `
    <div style="font-family:system-ui;max-width:560px;padding:16px">
      <h2 style="color:${alert.type === 'error' ? '#b91c1c' : alert.type === 'warning' ? '#a16207' : '#1e40af'};margin-bottom:8px">${alert.title}</h2>
      <p style="margin:0 0 12px 0">${alert.message}</p>
      ${triageBlock}
      ${fixButtons}
      <table style="margin-top:16px;font-size:13px;color:#444">
        <tr><td style="padding:2px 8px 2px 0"><b>Source</b></td><td>${alert.source}</td></tr>
        <tr><td style="padding:2px 8px 2px 0"><b>Severity</b></td><td>${alert.severity}${triage && triage.severity !== alert.severity ? ` (triage: ${triage.severity})` : ''}</td></tr>
        ${alert.action ? `<tr><td style="padding:2px 8px 2px 0"><b>Probe action</b></td><td>${alert.action}</td></tr>` : ''}
      </table>
      <p style="font-size:12px;color:#666;margin-top:24px;border-top:1px solid #eee;padding-top:12px">
        OpenHeart · <a href="https://main.dl7zrj8lm47be.amplifyapp.com/dashboard">Open dashboard</a>
      </p>
    </div>
  `.trim();

  // Prefer SES (matches the rest of the platform); fall back to Resend if AWS creds unavailable.
  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const fromAddress = process.env.NOTIFY_EMAIL_FROM || 'noreply@drbensoffer.com';

  if (accessKeyId && secretAccessKey) {
    try {
      const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
      const ses = new SESClient({
        region: process.env.OPENHEART_AWS_REGION || 'us-east-1',
        credentials: { accessKeyId, secretAccessKey },
      });
      const r = await ses.send(new SendEmailCommand({
        Source: fromAddress,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
      }));
      return { channel: 'email', ok: true, detail: `ses-msg=${r.MessageId}` };
    } catch (err: any) {
      // If SES fails (e.g. unverified sender), try Resend as fallback before giving up
      const resendKey = process.env.NOTIFY_RESEND_API_KEY || process.env.RESEND_API_KEY;
      if (!resendKey) return { channel: 'email', ok: false, detail: `SES: ${err?.message || 'unknown'}` };
    }
  }

  const resendKey = process.env.NOTIFY_RESEND_API_KEY || process.env.RESEND_API_KEY;
  if (!resendKey) return { channel: 'email', ok: false, detail: 'No SES creds and no Resend key' };

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `OpenHeart <${fromAddress}>`, to: [to], subject, html }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { channel: 'email', ok: false, detail: `resend ${r.status} ${j.error?.message || ''}`.trim() };
    return { channel: 'email', ok: true, detail: `resend-id=${j.id}` };
  } catch (err) {
    return { channel: 'email', ok: false, detail: err instanceof Error ? err.message : 'fetch failed' };
  }
}

async function sendSms(alert: NotifyAlert): Promise<NotifyResult> {
  const sid = process.env.NOTIFY_TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.NOTIFY_TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.NOTIFY_TWILIO_FROM;
  const to = process.env.NOTIFY_SMS_TO;
  if (!sid || !token || !from || !to)
    return { channel: 'sms', ok: false, detail: 'Twilio creds incomplete' };

  const body = `[OpenHeart ${alert.severity.toUpperCase()}] ${alert.title}\n${alert.message.slice(0, 160)}`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { channel: 'sms', ok: false, detail: `${r.status} ${j.message || ''}`.trim() };
    return { channel: 'sms', ok: true, detail: `sid=${j.sid}` };
  } catch (err) {
    return { channel: 'sms', ok: false, detail: err instanceof Error ? err.message : 'fetch failed' };
  }
}

async function sendSlack(alert: NotifyAlert): Promise<NotifyResult> {
  const webhook = process.env.NOTIFY_SLACK_WEBHOOK;
  if (!webhook) return { channel: 'slack', ok: false, detail: 'No NOTIFY_SLACK_WEBHOOK' };
  const emoji = alert.type === 'error' ? ':rotating_light:' : alert.type === 'warning' ? ':warning:' : ':information_source:';
  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${emoji} *[${alert.severity.toUpperCase()}]* ${alert.title}\n${alert.message}\n_${alert.source}${alert.action ? ' · ' + alert.action : ''}_`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { channel: 'slack', ok: false, detail: `HTTP ${r.status}` };
    return { channel: 'slack', ok: true, detail: 'sent' };
  } catch (err) {
    return { channel: 'slack', ok: false, detail: err instanceof Error ? err.message : 'fetch failed' };
  }
}

export async function dispatchAlert(alert: NotifyAlert): Promise<NotifyResult[]> {
  // Triage first (Phase 1). Returns null if ANTHROPIC_API_KEY unset — system still works.
  const triage = await triageAlert({
    id: alert.id,
    type: alert.type,
    title: alert.title,
    message: alert.message,
    severity: alert.severity,
    source: alert.source,
    action: alert.action,
  }).catch(() => null);

  // Triage can downgrade severity to "none" (= don't notify at all)
  const effectiveSeverity = triage?.actionNeeded === 'none' ? 'low' : alert.severity;

  // Routing: high → email+sms+slack, medium → email+slack, low → email only
  const channels: ('email' | 'sms' | 'slack')[] =
    effectiveSeverity === 'high' ? ['email', 'sms', 'slack'] :
    effectiveSeverity === 'medium' ? ['email', 'slack'] :
    effectiveSeverity === 'low' && triage?.actionNeeded !== 'none' ? ['email'] :
    [];

  if (channels.length === 0) return [];

  const results: NotifyResult[] = [];
  for (const ch of channels) {
    if (await alreadyNotified(alert.id, ch)) {
      results.push({ channel: ch, ok: true, detail: 'deduped (already sent within window)' });
      continue;
    }
    const res = ch === 'email' ? await sendEmail(alert, triage)
              : ch === 'sms'   ? await sendSms(alert)
              :                  await sendSlack(alert);
    results.push(res);
    if (res.ok && !res.detail.startsWith('deduped')) {
      await recordNotified(alert.id, ch, res.detail).catch(() => {});
    }
  }
  return results;
}
