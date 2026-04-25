/**
 * AI interpretation of SEO Attribution data.
 *
 * Reads the same data as /api/seo-attribution, then asks Claude (via Bedrock)
 * to produce 4-7 prioritized insights specifically for a SEO/content-only
 * acquisition strategy (Google Ads is OFF — see CLAUDE.md memory).
 *
 * Cached for 30 min in cron-history DDB to avoid burning tokens on every
 * dashboard refresh.
 *
 * Auth: x-monitor-key header (same as the rest of /api/* in OpenHeart).
 */

import { NextRequest, NextResponse } from 'next/server';
import { askClaudeJSON, CLAUDE_MODELS } from '@/lib/bedrock';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PageRow {
  site: string;
  siteLabel: string;
  landingPage: string;
  eligibilityCount: number;
  orderCount: number;
  revenueCents: number;
  eligToOrderPct: number;
}

interface SourceRow { key: string; label: string; count: number; samplePages: string[] }

interface SeoData {
  summary: { totalEligibility: number; totalOrders: number; totalRevenueDollars: number; eligibilityToOrderPct: number };
  pagesCombined: PageRow[];
  sourcesAggregated: SourceRow[];
  days: number;
}

interface Insight {
  priority: 'high' | 'medium' | 'low';
  title: string;
  recommendation: string;
  reasoning: string;
  category: 'content' | 'cro' | 'channel' | 'distribution' | 'measurement';
}

const SYSTEM_PROMPT = `You are a SEO + content strategy analyst reviewing real attribution data from Discreet Ketamine and Tovani Health, both telehealth ketamine clinics.

CRITICAL CONTEXT:
- Google Ads was TURNED OFF on 2026-04-24. They run organic SEO + content only.
- Acquisition channels actually observed: organic search (Google, Bing, DDG, Yahoo, Brave), AI search (ChatGPT, Perplexity, Claude, Gemini), direct/typed (brand strength), internal navigation, social referrals.
- AI search referrals are the EARLY WAVE — call those out specifically when seen.
- Local SEO pages (/fl/{city}, /nj/{county}/{city}) and medical-specific blog posts (e.g. /blog/r-ketamine-vs-s-ketamine, /blog/odt-rdt-vs-troche) have proven to convert.
- A "good" page in this domain is one where eligibility-to-order conversion is >= 25%.
- Schema reminder: \`landingPage\` is the URL path of the FIRST page the user landed on before submitting eligibility (or completing an order).

Return STRICT JSON. No prose outside the JSON object. Format:
{
  "insights": [
    {
      "priority": "high" | "medium" | "low",
      "title": "Short imperative phrase, <= 60 chars",
      "recommendation": "1-2 sentences of specific action. Reference exact landingPage paths or source labels when relevant.",
      "reasoning": "1-2 sentences explaining WHY based on the data. Cite specific numbers from the data.",
      "category": "content" | "cro" | "channel" | "distribution" | "measurement"
    },
    ... (4 to 7 total)
  ]
}

Categories:
- content: write more / less of certain post types based on what converts
- cro: improve a page that's getting traffic but not converting
- channel: a channel-mix observation (e.g. "ChatGPT referrals are growing — write LLM-friendly FAQ content")
- distribution: how to amplify the winners (e.g. "feature top-converting blog post in homepage hero")
- measurement: data quality / attribution gap that should be fixed before drawing conclusions

Heuristics for finding insights:
- Pages with high eligibility but 0 orders → CRO bug (recommendation: investigate the page or its checkout link)
- Pages with high orders + high revenue → "winner" — recommend writing more of that pattern
- Pages with high conv% but tiny traffic → SEO opportunity (recommend more keyword targeting / link building)
- Channels growing fast → suggest content-strategy adaptation (e.g. AI search → FAQ schema + long-form Q&A)
- "Direct/typed" being dominant → brand strength is healthy, but can mask SEO weakness; suggest cross-checking against GSC clicks
- If data is sparse (<10 eligibility submissions in window), prioritize a "measurement" insight about driving more traffic / fixing capture before drawing conclusions

If the data is essentially empty (0 eligibility), return ONE insight in category=measurement explaining the data gap.`;

function summarize(data: SeoData): string {
  const top10 = data.pagesCombined.slice(0, 10);
  const topPagesLines = top10.map(p =>
    `  ${p.site} ${p.landingPage}: ${p.eligibilityCount} elig, ${p.orderCount} orders, $${(p.revenueCents/100).toFixed(0)}, ${p.eligToOrderPct}% conv`
  ).join('\n');

  const sourcesLines = data.sourcesAggregated.map(s => `  ${s.label} (${s.key}): ${s.count}`).join('\n');

  // High-traffic-no-orders signal (CRO opportunity)
  const failing = data.pagesCombined
    .filter(p => p.eligibilityCount >= 3 && p.orderCount === 0)
    .slice(0, 5)
    .map(p => `  ${p.landingPage}: ${p.eligibilityCount} elig but 0 orders`)
    .join('\n');

  // Hidden gem signal
  const gems = data.pagesCombined
    .filter(p => p.eligibilityCount >= 1 && p.eligToOrderPct >= 25)
    .slice(0, 5)
    .map(p => `  ${p.landingPage}: ${p.eligToOrderPct}% conv (${p.eligibilityCount} elig, ${p.orderCount} orders)`)
    .join('\n');

  return [
    `Time window: last ${data.days} days`,
    `Totals: ${data.summary.totalEligibility} eligibility submissions, ${data.summary.totalOrders} paid orders, $${data.summary.totalRevenueDollars} revenue, ${data.summary.eligibilityToOrderPct}% elig→order rate`,
    '',
    'Top landing pages by revenue:',
    topPagesLines || '  (none)',
    '',
    'Channel mix (referrer source → eligibility submissions):',
    sourcesLines || '  (no referrer data)',
    '',
    'Pages flagged: high traffic, ZERO orders (CRO opportunity):',
    failing || '  (none flagged)',
    '',
    'Pages flagged: high conversion rate, low traffic (SEO opportunity):',
    gems || '  (none flagged)',
  ].join('\n');
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get('days') || '90', 10), 365);

  // Fetch the underlying SEO data via the existing aggregator. Reuses the
  // same Basic Auth path our SSR Lambda already speaks.
  const baseUrl = process.env.OPENHEART_SELF_URL || 'https://main.dl7zrj8lm47be.amplifyapp.com';
  const headers: Record<string, string> = { 'x-monitor-key': process.env.MONITOR_API_KEY || '' };
  if (process.env.OPENHEART_BASIC_AUTH) headers['Authorization'] = `Basic ${process.env.OPENHEART_BASIC_AUTH}`;

  const dataResp = await fetch(`${baseUrl}/api/seo-attribution?days=${days}`, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  }).catch((e) => null);

  if (!dataResp || !dataResp.ok) {
    return NextResponse.json(
      { error: 'Failed to fetch SEO data', detail: dataResp ? `HTTP ${dataResp.status}` : 'fetch failed' },
      { status: 502 }
    );
  }
  const data = await dataResp.json() as SeoData;

  // Empty-data short-circuit so we don't burn tokens on nothing.
  if (data.summary.totalEligibility === 0) {
    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      cached: false,
      insights: [{
        priority: 'high' as const,
        title: 'No eligibility data yet — verify capture',
        recommendation: 'Confirm AttributionCapture is mounted on each site\'s root layout and that page-view tracking is firing. Check the EligibilitySubmission table directly to see if any rows exist with landingPage populated.',
        reasoning: 'The dashboard returned 0 eligibility submissions in the last ' + days + ' days. Either the time window is too narrow, or the attribution-capture pipeline isn\'t writing.',
        category: 'measurement' as const,
      }],
    });
  }

  try {
    const prompt = `Here is the SEO attribution data. Produce 4-7 prioritized, actionable insights.\n\n` + summarize(data);
    const raw = await askClaudeJSON<{ insights: Insight[] }>(prompt, {
      model: CLAUDE_MODELS.HAIKU_35,
      system: SYSTEM_PROMPT,
      maxTokens: 1500,
      temperature: 0.4,
    });

    const allowedPrios: Insight['priority'][] = ['high', 'medium', 'low'];
    const allowedCats: Insight['category'][] = ['content', 'cro', 'channel', 'distribution', 'measurement'];
    const insights = (raw.insights || [])
      .filter((i: any) => i && i.title && i.recommendation && i.reasoning)
      .map((i: any) => ({
        priority: allowedPrios.includes(i.priority) ? i.priority : 'medium',
        title: String(i.title).slice(0, 100),
        recommendation: String(i.recommendation).slice(0, 600),
        reasoning: String(i.reasoning).slice(0, 600),
        category: allowedCats.includes(i.category) ? i.category : 'content',
      }))
      .slice(0, 7);

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      days,
      cached: false,
      insights,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'AI interpretation failed', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 }
    );
  }
}
