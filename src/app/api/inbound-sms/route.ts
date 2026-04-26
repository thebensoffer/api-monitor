/**
 * Inbound SMS proxy — fans out to each site's Khai endpoint and merges.
 *
 * Today only DK is wired (the Pinpoint webhook is the centralized inbox for
 * BOTH DK and Tovani patients — Tovani's sMSMessage table doesn't get hit by
 * the inbound flow). When/if Tovani gets its own inbound webhook, add it to
 * SITES.
 *
 * Auth: x-monitor-key header (same as the rest of /api/*).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface ConversationItem {
  id: string;
  phoneNumber: string;
  patientName: string | null;
  tenant: 'dk' | 'tovani' | 'unknown';
  inbound: { body: string; createdAt: string; twilioSid: string | null };
  reply: {
    body: string;
    createdAt: string;
    kind: 'ai' | 'auto-reply' | 'admin-relay' | 'unknown';
    intent: string | null;
    twilioStatus: string | null;
  } | null;
  site: string;
  siteLabel: string;
}

const SITES = [
  {
    key: 'dk',
    label: 'Discreet Ketamine',
    base: 'https://discreetketamine.com',
    apiKey: process.env.DK_API_KEY || '',
  },
  // Tovani inbound flows through the same DK Pinpoint webhook today, so don't
  // double-fetch. If Tovani gets its own inbound webhook later, add it here.
];

async function fetchSite(site: typeof SITES[0], hours: number, limit: number) {
  if (!site.apiKey) {
    return { site: site.key, label: site.label, error: `No API key (set ${site.key.toUpperCase()}_API_KEY)`, items: [] as ConversationItem[] };
  }
  try {
    const url = `${site.base}/api/khai/inbound-sms?hours=${hours}&limit=${limit}`;
    const r = await fetch(url, {
      headers: { 'x-khai-api-key': site.apiKey },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!r.ok) {
      return { site: site.key, label: site.label, error: `HTTP ${r.status}`, items: [] as ConversationItem[] };
    }
    const j = await r.json();
    const items: ConversationItem[] = (j.items ?? []).map((i: any) => ({
      ...i,
      site: site.key,
      siteLabel: site.label,
    }));
    return { site: site.key, label: site.label, error: null as string | null, items };
  } catch (err) {
    return {
      site: site.key,
      label: site.label,
      error: err instanceof Error ? err.message : 'fetch failed',
      items: [] as ConversationItem[],
    };
  }
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const hours = Math.min(Math.max(parseInt(searchParams.get('hours') || '72', 10), 1), 720);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  const results = await Promise.all(SITES.map((s) => fetchSite(s, hours, limit)));

  const items = results
    .flatMap((r) => r.items)
    // Most recent first
    .sort((a, b) => new Date(b.inbound.createdAt).getTime() - new Date(a.inbound.createdAt).getTime());

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    hours,
    summary: {
      total: items.length,
      bySite: results.map((r) => ({ site: r.site, label: r.label, count: r.items.length, error: r.error })),
    },
    items,
  });
}
