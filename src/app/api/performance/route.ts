import { NextRequest, NextResponse } from 'next/server';
import { probe } from '@/lib/probe';

export const dynamic = 'force-dynamic';

interface SiteResult {
  url: string;
  strategy: 'mobile' | 'desktop';
  performance_score: number | null;
  accessibility_score: number | null;
  best_practices_score: number | null;
  seo_score: number | null;
  core_web_vitals: {
    lcp: { value: number | null; rating: string | null };
    cls: { value: number | null; rating: string | null };
    fcp: { value: number | null; rating: string | null };
    tbt: { value: number | null; rating: string | null };
    ttfb: { value: number | null; rating: string | null };
  };
  fetchedAt: string;
  error: string | null;
}

async function psi(url: string, strategy: 'mobile' | 'desktop', key: string): Promise<SiteResult> {
  const fullUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(
    url
  )}&strategy=${strategy}&category=PERFORMANCE&category=ACCESSIBILITY&category=BEST_PRACTICES&category=SEO&key=${key}`;
  const p = await probe({ endpoint: `psi.${url}.${strategy}`, url: fullUrl, timeoutMs: 30000 });
  const body = p.response?.parsedBody;
  if (!body?.lighthouseResult) {
    return {
      url, strategy,
      performance_score: null, accessibility_score: null, best_practices_score: null, seo_score: null,
      core_web_vitals: {
        lcp: { value: null, rating: null }, cls: { value: null, rating: null },
        fcp: { value: null, rating: null }, tbt: { value: null, rating: null },
        ttfb: { value: null, rating: null },
      },
      fetchedAt: new Date().toISOString(),
      error: p.error || body?.error?.message || 'No lighthouseResult in PSI response',
    };
  }
  const lhr = body.lighthouseResult;
  const audit = (id: string) => lhr.audits?.[id];
  const rating = (id: string) => {
    const a = audit(id);
    if (!a) return null;
    if (a.score == null) return null;
    return a.score >= 0.9 ? 'good' : a.score >= 0.5 ? 'needs-improvement' : 'poor';
  };
  const value = (id: string) => audit(id)?.numericValue ?? null;

  return {
    url, strategy,
    performance_score: Math.round((lhr.categories?.performance?.score ?? 0) * 100),
    accessibility_score: Math.round((lhr.categories?.accessibility?.score ?? 0) * 100),
    best_practices_score: Math.round((lhr.categories?.['best-practices']?.score ?? 0) * 100),
    seo_score: Math.round((lhr.categories?.seo?.score ?? 0) * 100),
    core_web_vitals: {
      lcp: { value: value('largest-contentful-paint'), rating: rating('largest-contentful-paint') },
      cls: { value: value('cumulative-layout-shift'), rating: rating('cumulative-layout-shift') },
      fcp: { value: value('first-contentful-paint'), rating: rating('first-contentful-paint') },
      tbt: { value: value('total-blocking-time'), rating: rating('total-blocking-time') },
      ttfb: { value: value('server-response-time'), rating: rating('server-response-time') },
    },
    fetchedAt: new Date().toISOString(),
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const googleKey = process.env.GOOGLE_API_KEY;
  if (!googleKey) {
    return NextResponse.json({
      success: false,
      error: 'GOOGLE_API_KEY not configured',
      hint: 'Set GOOGLE_API_KEY in Amplify env vars to enable live PageSpeed Insights results',
    }, { status: 503 });
  }

  const sites = [
    { key: 'dk', url: 'https://discreetketamine.com' },
    { key: 'dbs', url: 'https://drbensoffer.com' },
    { key: 'tovani', url: 'https://tovanihealth.com' },
  ];

  const results = await Promise.all(
    sites.flatMap((s) => [
      psi(s.url, 'mobile', googleKey).then((r) => ({ site: s.key, ...r })),
      psi(s.url, 'desktop', googleKey).then((r) => ({ site: s.key, ...r })),
    ])
  );

  // Shape by site so the old UI shape still works
  const data: Record<string, any> = {};
  for (const r of results) {
    data[r.site] = data[r.site] ?? { url: r.url };
    data[r.site][r.strategy] = r;
    if (r.strategy === 'mobile') {
      // Attach top-level aggregates for backward compat
      data[r.site].performance_score = r.performance_score;
      data[r.site].accessibility_score = r.accessibility_score;
      data[r.site].best_practices_score = r.best_practices_score;
      data[r.site].seo_score = r.seo_score;
      data[r.site].core_web_vitals = r.core_web_vitals;
    }
  }

  const summary = {
    sites_fetched: sites.length,
    avg_performance: Math.round(
      results.reduce((s, r) => s + (r.performance_score ?? 0), 0) / Math.max(1, results.filter((r) => r.performance_score != null).length)
    ),
    last_audit: new Date().toISOString(),
  };

  return NextResponse.json({ success: true, data: { ...data, summary }, timestamp: new Date().toISOString() });
}
