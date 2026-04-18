import { NextRequest, NextResponse } from 'next/server';
import { probe } from '@/lib/probe';

export const dynamic = 'force-dynamic';

/**
 * Probes user-facing endpoints — the ones that actually break the user's day
 * when they fail. Read-only / safe-by-default. No POSTs that mutate prod.
 *
 * Each flow group represents a real user journey:
 *   - "auth"     → can users log in? (CSRF endpoint up?)
 *   - "seo"      → can crawlers see us? (sitemap/robots)
 *   - "content"  → are public pages reachable? (homepage)
 *   - "system"   → are infra-level health endpoints up?
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sites = [
    { key: 'tovani', label: 'Tovani Health', base: process.env.TOVANI_BASE_URL || 'https://tovanihealth.com' },
    { key: 'dk', label: 'Discreet Ketamine', base: 'https://discreetketamine.com' },
    { key: 'dbs', label: 'Dr Ben Soffer', base: 'https://drbensoffer.com' },
  ];

  const flows = await Promise.all(
    sites.flatMap((site) => [
      probe({
        endpoint: `${site.key}.auth.csrf`,
        url: `${site.base}/api/auth/csrf`,
      }).then((p) => ({ site: site.key, label: site.label, flow: 'auth', step: 'CSRF token', probe: p })),

      probe({
        endpoint: `${site.key}.seo.sitemap`,
        url: `${site.base}/sitemap.xml`,
        method: 'HEAD',
      }).then((p) => ({ site: site.key, label: site.label, flow: 'seo', step: 'Sitemap', probe: p })),

      probe({
        endpoint: `${site.key}.seo.robots`,
        url: `${site.base}/robots.txt`,
        method: 'HEAD',
      }).then((p) => ({ site: site.key, label: site.label, flow: 'seo', step: 'robots.txt', probe: p })),

      probe({
        endpoint: `${site.key}.content.home`,
        url: `${site.base}/`,
        method: 'HEAD',
      }).then((p) => ({ site: site.key, label: site.label, flow: 'content', step: 'Homepage', probe: p })),

      probe({
        endpoint: `${site.key}.system.health`,
        url: `${site.base}/api/health`,
      }).then((p) => ({ site: site.key, label: site.label, flow: 'system', step: 'Health endpoint', probe: p })),
    ])
  );

  // Group by site for the UI
  const grouped = sites.map((site) => {
    const siteFlows = flows.filter((f) => f.site === site.key);
    const failed = siteFlows.filter((f) => f.probe.error || (f.probe.response && !f.probe.response.ok)).length;
    const avgMs = Math.round(
      siteFlows.reduce((s, f) => s + (f.probe.response?.durationMs || 0), 0) /
        Math.max(1, siteFlows.filter((f) => f.probe.response).length)
    );
    return {
      site: site.key,
      label: site.label,
      base: site.base,
      total: siteFlows.length,
      failed,
      avgMs,
      flows: siteFlows,
    };
  });

  const summary = {
    totalFlows: flows.length,
    sitesChecked: sites.length,
    failed: flows.filter((f) => f.probe.error || (f.probe.response && !f.probe.response.ok)).length,
  };

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    summary,
    grouped,
  });
}
