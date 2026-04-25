import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SITES = [
  { key: 'dk',     label: 'Discreet Ketamine', base: 'https://discreetketamine.com',                       apiKey: process.env.DK_API_KEY || '' },
  { key: 'tovani', label: 'Tovani Health',     base: process.env.TOVANI_BASE_URL || 'https://tovanihealth.com', apiKey: process.env.TOVANI_KHAI_API_KEY || '' },
  // DBS not included — no organic SEO attribution there yet (phone-attributed flow)
];

interface SitePage {
  landingPage: string;
  eligibilityCount: number;
  orderCount: number;
  revenueCents: number;
  eligToOrderPct: number;
}
interface SiteSource {
  key: string;
  label: string;
  count: number;
  samplePages: string[];
}

async function fetchSite(site: typeof SITES[0], days: number) {
  if (!site.apiKey) return { site: site.key, label: site.label, error: 'no API key' };
  try {
    const r = await fetch(`${site.base}/api/khai/seo-attribution?days=${days}`, {
      headers: { 'x-khai-api-key': site.apiKey },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    if (!r.ok) return { site: site.key, label: site.label, error: `HTTP ${r.status}` };
    const j = await r.json();
    return { site: site.key, label: site.label, ...j };
  } catch (err) {
    return { site: site.key, label: site.label, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = Math.min(parseInt(new URL(request.url).searchParams.get('days') || '90', 10), 365);
  const results = await Promise.all(SITES.map((s) => fetchSite(s, days)));

  // Combined view: union of pages across sites; tagged with site of origin.
  // Aggregate referrer-source counts across both sites for the channel mix view.
  const allPages: Array<SitePage & { site: string; siteLabel: string }> = [];
  const sourcesAgg: Record<string, SiteSource> = {};

  for (const r of results) {
    if ((r as any).error) continue;
    const pages = (r as any).pages as SitePage[] | undefined;
    if (pages) {
      for (const p of pages) {
        allPages.push({ ...p, site: r.site, siteLabel: r.label });
      }
    }
    const sources = (r as any).sources as SiteSource[] | undefined;
    if (sources) {
      for (const s of sources) {
        if (!sourcesAgg[s.key]) sourcesAgg[s.key] = { key: s.key, label: s.label, count: 0, samplePages: [] };
        sourcesAgg[s.key].count += s.count;
        sourcesAgg[s.key].samplePages.push(...s.samplePages);
      }
    }
  }

  allPages.sort((a, b) => (b.revenueCents - a.revenueCents) || (b.eligibilityCount - a.eligibilityCount));

  const totalRevenueCents = allPages.reduce((s, p) => s + p.revenueCents, 0);
  const totalOrders = allPages.reduce((s, p) => s + p.orderCount, 0);
  const totalEligibility = allPages.reduce((s, p) => s + p.eligibilityCount, 0);

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    days,
    summary: {
      sitesQueried: SITES.length,
      sitesOk: results.filter((r) => !(r as any).error).length,
      totalEligibility,
      totalOrders,
      totalRevenueDollars: Math.round(totalRevenueCents / 100),
      eligibilityToOrderPct: totalEligibility > 0
        ? Number(((totalOrders / totalEligibility) * 100).toFixed(1))
        : 0,
    },
    sites: results,
    pagesCombined: allPages.slice(0, 100),
    sourcesAggregated: Object.values(sourcesAgg)
      .map((s) => ({ ...s, samplePages: Array.from(new Set(s.samplePages)).slice(0, 5) }))
      .sort((a, b) => b.count - a.count),
  });
}
