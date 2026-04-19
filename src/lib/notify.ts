/**
 * Notification dispatcher — gets alerts OUT of the dashboard.
 *
 * dispatch() takes an Alert and sends via:
 *   - Resend (email to NOTIFY_EMAIL_TO)
 *   - Twilio (SMS to NOTIFY_SMS_TO) if both Twilio creds + phone set
 *   - Slack incoming webhook (NOTIFY_SLACK_WEBHOOK) if set
 *
 * Dedup: each (alertId, channel) pair recorded in DynamoDB
 * `openheart-cron-runs` (reused) so we don't spam on every poll.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

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

async function sendEmail(alert: NotifyAlert): Promise<NotifyResult> {
  const apiKey = process.env.RESEND_API_KEY || process.env.NOTIFY_RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL_TO;
  if (!apiKey) return { channel: 'email', ok: false, detail: 'No RESEND_API_KEY' };
  if (!to) return { channel: 'email', ok: false, detail: 'No NOTIFY_EMAIL_TO' };

  const subject = `[OpenHeart ${alert.severity.toUpperCase()}] ${alert.title}`;
  const html = `
    <div style="font-family:system-ui;padding:16px">
      <h2 style="color:${alert.type === 'error' ? '#b91c1c' : alert.type === 'warning' ? '#a16207' : '#1e40af'}">${alert.title}</h2>
      <p>${alert.message}</p>
      <table style="margin-top:16px;font-size:13px">
        <tr><td><b>Source</b></td><td>${alert.source}</td></tr>
        <tr><td><b>Severity</b></td><td>${alert.severity}</td></tr>
        ${alert.action ? `<tr><td><b>Action</b></td><td>${alert.action}</td></tr>` : ''}
      </table>
      <p style="font-size:12px;color:#666;margin-top:24px">
        OpenHeart · <a href="https://main.dl7zrj8lm47be.amplifyapp.com/dashboard">Open dashboard</a>
      </p>
    </div>
  `.trim();

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.NOTIFY_EMAIL_FROM || 'OpenHeart <noreply@drbensoffer.com>',
        to: [to],
        subject,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { channel: 'email', ok: false, detail: `${r.status} ${j.error?.message || j.message || ''}`.trim() };
    return { channel: 'email', ok: true, detail: `id=${j.id}` };
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
  // Only route severity=high for now; medium = email only; low = no notify
  const channels: ('email' | 'sms' | 'slack')[] =
    alert.severity === 'high' ? ['email', 'sms', 'slack'] :
    alert.severity === 'medium' ? ['email', 'slack'] :
    [];

  if (channels.length === 0) return [];

  const results: NotifyResult[] = [];
  for (const ch of channels) {
    if (await alreadyNotified(alert.id, ch)) {
      results.push({ channel: ch, ok: true, detail: 'deduped (already sent within window)' });
      continue;
    }
    const res = ch === 'email' ? await sendEmail(alert)
              : ch === 'sms'   ? await sendSms(alert)
              :                  await sendSlack(alert);
    results.push(res);
    if (res.ok && !res.detail.startsWith('deduped')) {
      await recordNotified(alert.id, ch, res.detail).catch(() => {});
    }
  }
  return results;
}
