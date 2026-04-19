import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SENTRY_ORG = 'bensoffer';
const PROJECTS = ['discreetketamine', 'drbensoffer', 'beyondthederech'];

const TOKEN = process.env.SENTRY_AUTH_TOKEN || '';

async function sentryFetch(path: string) {
  const r = await fetch(`https://sentry.io/api/0${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Sentry ${path} → HTTP ${r.status}`);
  return r.json();
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!TOKEN) return NextResponse.json({ error: 'SENTRY_AUTH_TOKEN not set' }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || '24h';

  try {
    // 1) Per-project: unresolved issues + recent issues with stack trace
    const projects = await Promise.all(PROJECTS.map(async (slug) => {
      try {
        const issues = await sentryFetch(`/projects/${SENTRY_ORG}/${slug}/issues/?statsPeriod=${range}&query=is:unresolved&limit=15`);
        const all = await sentryFetch(`/projects/${SENTRY_ORG}/${slug}/issues/?statsPeriod=${range}&limit=50`);
        return {
          slug,
          unresolvedCount: Array.isArray(issues) ? issues.length : 0,
          totalCount: Array.isArray(all) ? all.length : 0,
          topIssues: (Array.isArray(issues) ? issues : []).slice(0, 10).map((i: any) => ({
            id: i.id,
            shortId: i.shortId,
            title: i.title,
            culprit: i.culprit,
            level: i.level,
            isUnhandled: i.isUnhandled,
            count: parseInt(i.count || '0', 10),
            userCount: i.userCount || 0,
            firstSeen: i.firstSeen,
            lastSeen: i.lastSeen,
            permalink: i.permalink,
            assignedTo: i.assignedTo?.name || null,
          })),
        };
      } catch (err) {
        return { slug, error: err instanceof Error ? err.message : 'fetch failed', unresolvedCount: 0, totalCount: 0, topIssues: [] };
      }
    }));

    // 2) Org-level event-rate trend (24h hourly)
    let trend: { ts: string; count: number }[] = [];
    try {
      const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24;
      const since = Math.floor(Date.now() / 1000) - hours * 3600;
      const stats = await sentryFetch(`/organizations/${SENTRY_ORG}/stats/?stat=received&since=${since}&resolution=1h`);
      // Sentry returns [[unix, count], ...]
      if (Array.isArray(stats)) {
        trend = stats.map((point: any) => ({
          ts: new Date(point[0] * 1000).toISOString(),
          count: point[1] || 0,
        }));
      }
    } catch {
      // non-fatal
    }

    const summary = {
      totalUnresolved: projects.reduce((s, p) => s + (p.unresolvedCount || 0), 0),
      totalEvents24h: trend.reduce((s, p) => s + p.count, 0),
      peakHourCount: trend.reduce((m, p) => Math.max(m, p.count), 0),
      projectsWithErrors: projects.filter((p) => (p.unresolvedCount || 0) > 0).length,
    };

    return NextResponse.json({
      success: true,
      range,
      summary,
      projects,
      trend,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 }
    );
  }
}
