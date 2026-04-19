import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const SITES = [
  { key: 'tovani', label: 'Tovani Health', base: process.env.TOVANI_BASE_URL || 'https://tovanihealth.com', apiKey: process.env.TOVANI_KHAI_API_KEY || '' },
  { key: 'dk', label: 'Discreet Ketamine', base: 'https://discreetketamine.com', apiKey: process.env.DK_API_KEY || '' },
  { key: 'dbs', label: 'Dr Ben Soffer', base: 'https://drbensoffer.com', apiKey: process.env.DBS_API_KEY || '' },
];

interface TimelineEvent {
  site: string;
  type: 'email' | 'sms' | 'order' | 'charge' | 'refund';
  ts: string;
  summary: string;
  detail?: any;
}

async function searchSite(site: typeof SITES[0], query: string): Promise<TimelineEvent[]> {
  if (!site.apiKey) return [];
  const events: TimelineEvent[] = [];

  // Pull last 90 days of sent comms + payments and filter client-side for the query
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const headers = { 'x-khai-api-key': site.apiKey };
  const opts = { headers, signal: AbortSignal.timeout(15000), cache: 'no-store' as const };

  try {
    const [comms, payments] = await Promise.all([
      fetch(`${site.base}/api/khai/sent-communications?type=all&since=${encodeURIComponent(since)}&limit=200`, opts).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`${site.base}/api/khai/payments?since=${encodeURIComponent(since)}&limit=200`, opts).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);

    const q = query.toLowerCase();
    const matches = (s?: string | null) => !!s && s.toLowerCase().includes(q);

    if (comms?.sent?.emails) {
      for (const e of comms.sent.emails) {
        if (matches(e.recipientEmail) || matches(e.recipientName) || matches(e.subject)) {
          events.push({
            site: site.key,
            type: 'email',
            ts: e.createdAt,
            summary: `→ ${e.recipientEmail}: ${e.subject}`,
            detail: { id: e.id, status: e.status, templateKey: e.templateKey, body: e.textBody },
          });
        }
      }
    }
    if (comms?.sent?.sms) {
      for (const s of comms.sent.sms) {
        if (matches(s.phoneNumber) || matches(s.body)) {
          events.push({
            site: site.key,
            type: 'sms',
            ts: s.createdAt,
            summary: `→ ${s.phoneNumber}: ${(s.body || '').slice(0, 80)}`,
            detail: { id: s.id, twilioStatus: s.twilioStatus, twilioSid: s.twilioSid },
          });
        }
      }
    }
    if (payments?.orders) {
      for (const o of payments.orders) {
        // Order matches the patient's user ID; we don't have email here, but the orderNumber is searchable
        if (matches(o.orderNumber) || matches(o.userId)) {
          events.push({
            site: site.key,
            type: 'order',
            ts: o.createdAt,
            summary: `Order ${o.orderNumber} · ${o.status} · $${(o.amount / 100).toFixed(2)}`,
            detail: o,
          });
        }
      }
    }
    if (payments?.charges) {
      for (const c of payments.charges) {
        if (matches(c.billingEmail) || matches(c.billingName)) {
          events.push({
            site: site.key,
            type: 'charge',
            ts: c.createdAt,
            summary: `Charge ${c.status} · $${(c.amount / 100).toFixed(2)} · ${c.cardBrand || ''} ${c.last4 || ''}`.trim(),
            detail: c,
          });
        }
      }
    }
    if (payments?.refunds) {
      for (const r of payments.refunds) {
        // Refund rows don't have email; include all refunds for context if any patient charge matched
        events.push({
          site: site.key,
          type: 'refund',
          ts: r.createdAt,
          summary: `Refund $${(r.amount / 100).toFixed(2)} · ${r.reason || r.status}`,
          detail: r,
        });
      }
    }
  } catch (err) {
    // ignore site failures
  }

  return events;
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();
  const actor = searchParams.get('actor') || 'unknown';
  if (!query || query.length < 3) {
    return NextResponse.json({ error: 'q must be at least 3 characters' }, { status: 400 });
  }

  // HIPAA — every patient lookup is logged
  await recordAudit({
    actor,
    action: 'patient.timeline.search',
    resource: query,
  }).catch(() => {});

  const allEvents = (await Promise.all(SITES.map((s) => searchSite(s, query)))).flat();
  // Dedup refunds that were matched only as context — only keep refunds whose chargeId matches a charge in events
  const chargeIds = new Set(allEvents.filter((e) => e.type === 'charge').map((e: any) => e.detail?.id));
  const filtered = allEvents.filter((e) => {
    if (e.type !== 'refund') return true;
    return chargeIds.has((e as any).detail?.chargeId);
  });
  filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  return NextResponse.json({
    success: true,
    query,
    count: filtered.length,
    events: filtered,
  });
}
