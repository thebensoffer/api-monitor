import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SITES = [
  { key: 'tovani', label: 'Tovani Health', base: process.env.TOVANI_BASE_URL || 'https://tovanihealth.com', apiKey: process.env.TOVANI_KHAI_API_KEY || '' },
  { key: 'dk', label: 'Discreet Ketamine', base: 'https://discreetketamine.com', apiKey: process.env.DK_API_KEY || '' },
  { key: 'dbs', label: 'Dr Ben Soffer', base: 'https://drbensoffer.com', apiKey: process.env.DBS_API_KEY || '' },
];

async function fetchSite(site: typeof SITES[0]) {
  if (!site.apiKey) return { site: site.key, label: site.label, error: 'No API key' };
  try {
    const r = await fetch(`${site.base}/api/khai/integrity`, {
      headers: { 'x-khai-api-key': site.apiKey },
      signal: AbortSignal.timeout(15000),
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

  const results = await Promise.all(SITES.map(fetchSite));

  const totalOrphans = results.reduce((s: number, r: any) => s + (r.orphansTotal || 0), 0);
  const failedMigrations = results.reduce((s: number, r: any) => s + (r.schema?.failedCount || 0), 0);

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    summary: {
      sitesChecked: results.length,
      sitesWithErrors: results.filter((r) => r.error).length,
      totalOrphans,
      failedMigrations,
    },
    sites: results,
  });
}
