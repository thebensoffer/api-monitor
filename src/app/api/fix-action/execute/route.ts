import { NextRequest, NextResponse } from 'next/server';
import { verifyFixToken } from '@/lib/fix-tokens';
import { executeFixAction, dryRunFixAction, autopilotEnabled } from '@/lib/fix-actions';

export const dynamic = 'force-dynamic';

/**
 * Magic-link handler. Email contains:
 *   /api/fix-action/execute?t=<signed token>
 *
 * Returns an HTML page (so a one-tap from a phone email app works) that
 * shows the dry-run result and a confirm button (which POSTs back here),
 * OR runs immediately if the token's mode === 'execute'.
 *
 * Auth model: HMAC-signed token contains the action + params + expiry.
 * No additional auth needed — possession of the link IS the authorization,
 * which is fine because the link goes only to NOTIFY_EMAIL_TO.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('t');
  if (!token) return htmlError(400, 'Missing token');

  const payload = verifyFixToken(token);
  if (!payload) return htmlError(403, 'Invalid or expired token');

  // Step 1: GET always shows the dry-run preview + confirm button
  const dry = await dryRunFixAction(payload.actionId, payload.params);
  return htmlPreview(payload, dry, request.url);
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('t');
  if (!token) return htmlError(400, 'Missing token');
  const payload = verifyFixToken(token);
  if (!payload) return htmlError(403, 'Invalid or expired token');

  if (!autopilotEnabled()) {
    return htmlError(503, 'Autopilot is disabled (OPENHEART_AUTOPILOT=off)');
  }

  const result = await executeFixAction(payload.actionId, payload.params, 'magic-link');
  return htmlResult(payload, result);
}

function htmlPage(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui;max-width:560px;margin:32px auto;padding:0 16px;color:#111}h1{font-size:20px}pre{background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px}.btn{display:inline-block;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;margin-right:8px}.go{background:#dc2626;color:#fff}.cancel{background:#e5e7eb;color:#111}.ok{color:#166534}.bad{color:#991b1b}</style>
</head><body>${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function htmlError(status: number, msg: string) {
  return htmlPage('OpenHeart fix-action', `<h1>❌ ${msg}</h1><p>This link is invalid or has expired (30-min window).</p>`, status);
}

function htmlPreview(payload: any, dry: any, currentUrl: string) {
  const safe = (s: any) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));
  const action = safe(payload.actionId);
  const params = safe(JSON.stringify(payload.params, null, 2));
  return htmlPage(
    `OpenHeart: ${action}`,
    `<h1>🔧 ${action}</h1>
     <p><strong>Alert:</strong> ${safe(payload.alertId)}</p>
     <p><strong>Params:</strong></p><pre>${params}</pre>
     <p><strong>Dry-run preview:</strong></p>
     <pre class="${dry.ok ? 'ok' : 'bad'}">${safe(dry.message)}${dry.before !== undefined ? '\n\nbefore: ' + safe(JSON.stringify(dry.before)) : ''}${dry.after !== undefined ? '\nafter: ' + safe(JSON.stringify(dry.after)) : ''}</pre>
     ${dry.ok
       ? `<form method="POST" action="${safe(currentUrl)}" style="margin-top:24px"><button type="submit" class="btn go">▶ Apply this fix</button><a href="https://main.dl7zrj8lm47be.amplifyapp.com/dashboard" class="btn cancel">Cancel</a></form>`
       : `<p class="bad">Dry-run failed — won't execute. Investigate manually.</p>`
     }
     <p style="margin-top:32px;font-size:11px;color:#666">Token expires ${new Date(payload.expiresAt).toLocaleString()}.</p>`
  );
}

function htmlResult(payload: any, result: any) {
  const safe = (s: any) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));
  return htmlPage(
    `OpenHeart: ${result.ok ? '✅' : '❌'}`,
    `<h1>${result.ok ? '✅' : '❌'} ${safe(payload.actionId)}</h1>
     <p>${safe(result.message)}</p>
     ${result.before !== undefined ? `<pre>before: ${safe(JSON.stringify(result.before))}\nafter: ${safe(JSON.stringify(result.after))}</pre>` : ''}
     <p><a href="https://main.dl7zrj8lm47be.amplifyapp.com/dashboard?tab=audit" class="btn go">View audit log</a></p>
     <p style="font-size:11px;color:#666">Recorded with actor=magic-link · timestamp=${new Date().toISOString()}</p>`
  );
}
