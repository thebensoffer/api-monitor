import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const SITE_CONFIG: Record<string, { base: string; apiKey: string; label: string }> = {
  tovani: {
    base: process.env.TOVANI_BASE_URL || 'https://tovanihealth.com',
    apiKey: process.env.TOVANI_KHAI_API_KEY || '',
    label: 'Tovani Health',
  },
  dk: {
    base: 'https://discreetketamine.com',
    apiKey: process.env.DK_API_KEY || '',
    label: 'Discreet Ketamine',
  },
  dbs: {
    base: 'https://drbensoffer.com',
    apiKey: process.env.DBS_API_KEY || '',
    label: 'Dr Ben Soffer',
  },
};

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { site, paymentIntentId, amount, reason, actor, state } = body;
  if (!site || !paymentIntentId) {
    return NextResponse.json(
      { error: 'site and paymentIntentId required' },
      { status: 400 }
    );
  }

  const cfg = SITE_CONFIG[site];
  if (!cfg) return NextResponse.json({ error: `Unknown site: ${site}` }, { status: 400 });
  if (!cfg.apiKey)
    return NextResponse.json(
      { error: `No API key configured for ${site}` },
      { status: 503 }
    );

  // Audit BEFORE the action — if it fails the audit still shows attempt
  await recordAudit({
    actor: actor || 'unknown',
    action: 'refund.attempt',
    resource: `${site}:${paymentIntentId}`,
    metadata: { amount, reason, state },
  }).catch(() => {});

  try {
    const r = await fetch(`${cfg.base}/api/khai/refund`, {
      method: 'POST',
      headers: {
        'x-khai-api-key': cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentIntentId, amount, reason, state, actor: actor || 'openheart' }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    if (!r.ok || !j.success) {
      await recordAudit({
        actor: actor || 'unknown',
        action: 'refund.failed',
        resource: `${site}:${paymentIntentId}`,
        metadata: { amount, error: j.error, detail: j.detail },
      }).catch(() => {});
      return NextResponse.json({ error: j.error || `HTTP ${r.status}`, detail: j.detail }, { status: r.status || 500 });
    }
    await recordAudit({
      actor: actor || 'unknown',
      action: 'refund.success',
      resource: `${site}:${paymentIntentId}`,
      metadata: { refundId: j.refund?.id, amount: j.refund?.amount },
    }).catch(() => {});
    return NextResponse.json(j);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 500 }
    );
  }
}
