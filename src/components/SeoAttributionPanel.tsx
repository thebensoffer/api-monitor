'use client';

/**
 * SEO Attribution panel.
 *
 * Answers "which blog post / landing page actually drove a paying patient?"
 * Pulls from DK + Tovani's /api/khai/seo-attribution endpoints (which join
 * EligibilitySubmission + Order rows by landingPage).
 *
 * Three views in one panel:
 *   1. KPI strip       — total visits, eligibility, orders, revenue, conv%
 *   2. Top pages table — ranked by revenue, with funnel rates per page
 *   3. Source breakdown — bucketed referrers (Google / ChatGPT / Direct / etc.)
 *
 * Per-site filter (DK / Tovani / All) and time-range selector.
 */

import { useEffect, useState } from 'react';

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
interface Summary {
  totalEligibility: number;
  totalOrders: number;
  totalRevenueDollars: number;
  eligibilityToOrderPct: number;
  sitesQueried: number;
  sitesOk: number;
}

const RANGES = [
  { value: '7',   label: '7d'  },
  { value: '30',  label: '30d' },
  { value: '90',  label: '90d' },
  { value: '180', label: '6mo' },
  { value: '365', label: '1y'  },
];

const SITE_FILTERS = [
  { value: 'all',    label: 'All sites'  },
  { value: 'dk',     label: 'DK only'    },
  { value: 'tovani', label: 'Tovani only' },
];

function fmtMoney(cents: number) {
  if (cents === 0) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtCount(n: number) {
  return n === 0 ? '—' : n.toLocaleString();
}
function siteBadge(site: string) {
  const tone = site === 'dk' ? 'bg-blue-100 text-blue-700' :
               site === 'tovani' ? 'bg-indigo-100 text-indigo-700' :
               'bg-gray-100 text-gray-700';
  return <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${tone}`}>{site.toUpperCase()}</span>;
}
function pctTone(pct: number) {
  if (pct >= 20) return 'text-green-700 font-semibold';
  if (pct >= 5)  return 'text-yellow-700';
  if (pct > 0)   return 'text-gray-600';
  return 'text-gray-400';
}

interface Insight {
  priority: 'high' | 'medium' | 'low';
  title: string;
  recommendation: string;
  reasoning: string;
  category: 'content' | 'cro' | 'channel' | 'distribution' | 'measurement';
}

export function SeoAttributionPanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState('90');
  const [siteFilter, setSiteFilter] = useState('all');

  // AI insights state — independent fetch (slower, can fail without breaking the data view)
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsGeneratedAt, setInsightsGeneratedAt] = useState<string | null>(null);

  const fetchInsights = (range: string) => {
    setInsightsLoading(true);
    setInsightsError(null);
    fetch(`/api/seo-attribution/insights?days=${range}`, {
      headers: { 'x-monitor-key': process.env.NEXT_PUBLIC_MONITOR_API_KEY || '' },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((j) => { setInsights(j.insights || []); setInsightsGeneratedAt(j.generatedAt || null); })
      .catch((e) => setInsightsError(String(e)))
      .finally(() => setInsightsLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/seo-attribution?days=${days}`, {
      headers: { 'x-monitor-key': process.env.NEXT_PUBLIC_MONITOR_API_KEY || '' },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((j) => { setData(j); fetchInsights(days); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading && !data) return <div className="text-gray-500 p-6">Loading SEO attribution…</div>;
  if (error) return <div className="text-red-700 p-6">Error: {error}</div>;
  if (!data) return null;

  const summary: Summary = data.summary;
  const allPages: PageRow[] = data.pagesCombined || [];
  const sources: SourceRow[] = data.sourcesAggregated || [];
  const pages = siteFilter === 'all' ? allPages : allPages.filter((p) => p.site === siteFilter);

  // Hidden gems = high eligToOrderPct, low traffic
  const hiddenGems = [...pages]
    .filter((p) => p.eligibilityCount >= 1 && p.eligToOrderPct >= 25)
    .sort((a, b) => b.eligToOrderPct - a.eligToOrderPct)
    .slice(0, 5);

  // Trafficked but failing = high traffic, 0 conversion
  const failing = [...pages]
    .filter((p) => p.eligibilityCount >= 3 && p.orderCount === 0)
    .sort((a, b) => b.eligibilityCount - a.eligibilityCount)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold">📈 SEO Attribution</h2>
            <p className="text-sm text-gray-500">
              Which page drove the paying patient? Joins EligibilitySubmission + Order by landingPage.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="text-sm border-gray-300 rounded px-2 py-1"
            >
              {SITE_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div className="flex border border-gray-300 rounded overflow-hidden">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setDays(r.value)}
                  className={`px-3 py-1 text-sm ${days === r.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KpiCard label="Sites queried" value={`${summary.sitesOk}/${summary.sitesQueried}`} tone="gray" />
          <KpiCard label="Eligibility submissions" value={fmtCount(summary.totalEligibility)} tone="blue" />
          <KpiCard label="Paid orders" value={fmtCount(summary.totalOrders)} tone="green" />
          <KpiCard label="Revenue" value={`$${(summary.totalRevenueDollars).toLocaleString()}`} tone="emerald" />
          <KpiCard label="Elig → order" value={`${summary.eligibilityToOrderPct}%`} tone={summary.eligibilityToOrderPct >= 10 ? 'green' : 'yellow'} />
        </div>
      </div>

      {/* AI Interpretation — Bedrock Haiku reads the same data + suggests actions */}
      <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              🤖 AI Interpretation
              <span className="text-xs font-normal text-gray-500">
                (Claude Haiku reads the data, returns prioritized actions)
              </span>
            </h3>
            {insightsGeneratedAt && (
              <p className="text-xs text-gray-500 mt-0.5">
                Generated {new Date(insightsGeneratedAt).toLocaleString()}
              </p>
            )}
          </div>
          <button
            onClick={() => fetchInsights(days)}
            disabled={insightsLoading}
            className="text-xs px-3 py-1 bg-white border border-purple-300 rounded hover:bg-purple-100 disabled:opacity-50"
          >
            {insightsLoading ? '⏳ Thinking…' : '🔄 Refresh'}
          </button>
        </div>

        {insightsLoading && !insights && (
          <div className="text-sm text-gray-500 italic">
            Asking Claude to interpret the {data.pagesCombined?.length || 0} attributed pages and {data.sourcesAggregated?.length || 0} sources… (~5–10s)
          </div>
        )}
        {insightsError && (
          <div className="text-sm text-red-700">
            Insights failed: {insightsError}. Data view below is unaffected.
          </div>
        )}
        {insights && insights.length > 0 && (
          <div className="space-y-3">
            {insights.map((ins, i) => {
              const prioStyles = {
                high:   'border-red-300 bg-red-50 text-red-700',
                medium: 'border-amber-300 bg-amber-50 text-amber-700',
                low:    'border-gray-300 bg-gray-50 text-gray-700',
              };
              const catEmoji = {
                content:      '✍️',
                cro:          '🛠️',
                channel:      '📡',
                distribution: '📣',
                measurement:  '📏',
              };
              return (
                <div key={i} className="bg-white rounded-md border border-gray-200 p-4">
                  <div className="flex items-start gap-3">
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded border ${prioStyles[ins.priority]}`}>
                      {ins.priority}
                    </span>
                    <span className="text-lg leading-none mt-0.5">{catEmoji[ins.category]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900">{ins.title}</div>
                      <div className="text-sm text-gray-700 mt-1">{ins.recommendation}</div>
                      <div className="text-xs text-gray-500 mt-1.5 italic">
                        Why: {ins.reasoning}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {insights && insights.length === 0 && !insightsLoading && (
          <div className="text-sm text-gray-500 italic">No insights returned.</div>
        )}
      </div>

      {/* Top pages by revenue */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-3">Top pages by revenue</h3>
        {pages.length === 0 ? (
          <div className="text-sm text-gray-500">No attributed pages in this window. May indicate AttributionCapture isn't writing yet, or no organic traffic.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Site</th>
                  <th className="px-3 py-2 text-left">Landing page</th>
                  <th className="px-3 py-2 text-right">Eligibility</th>
                  <th className="px-3 py-2 text-right">Orders</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Conv %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pages.slice(0, 30).map((p, i) => (
                  <tr key={`${p.site}|${p.landingPage}|${i}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{siteBadge(p.site)}</td>
                    <td className="px-3 py-2 font-mono text-xs break-all">{p.landingPage}</td>
                    <td className="px-3 py-2 text-right">{fmtCount(p.eligibilityCount)}</td>
                    <td className="px-3 py-2 text-right">{fmtCount(p.orderCount)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtMoney(p.revenueCents)}</td>
                    <td className={`px-3 py-2 text-right ${pctTone(p.eligToOrderPct)}`}>
                      {p.eligToOrderPct > 0 ? `${p.eligToOrderPct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hidden gems + failing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-1">💎 Hidden gems</h3>
          <p className="text-xs text-gray-500 mb-3">High elig→order rate, low traffic — write more like these</p>
          {hiddenGems.length === 0 ? (
            <div className="text-sm text-gray-500">No clear gems yet (need ≥1 elig + ≥25% order rate)</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {hiddenGems.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs truncate">{p.landingPage}</span>
                  <span className="text-green-700 font-semibold whitespace-nowrap">{p.eligToOrderPct}% · {fmtMoney(p.revenueCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-1">🚧 Trafficked but failing</h3>
          <p className="text-xs text-gray-500 mb-3">Drives ≥3 elig but 0 orders — fix CRO on these first</p>
          {failing.length === 0 ? (
            <div className="text-sm text-gray-500">No failing-funnel pages flagged</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {failing.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs truncate">{p.landingPage}</span>
                  <span className="text-red-700 whitespace-nowrap">{p.eligibilityCount} elig · 0 orders</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Source breakdown */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-3">Channel mix (where eligibility traffic comes from)</h3>
        {sources.length === 0 ? (
          <div className="text-sm text-gray-500">No referrer data captured yet.</div>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => {
              const total = sources.reduce((sum, x) => sum + x.count, 0);
              const pct = total > 0 ? (s.count / total) * 100 : 0;
              const isAi = s.key.startsWith('ai-');
              const isOrganic = s.key.startsWith('organic-');
              const tone = isAi ? 'bg-purple-500' : isOrganic ? 'bg-emerald-500' : s.key === 'direct' ? 'bg-gray-400' : 'bg-blue-400';
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <span className="w-44 text-sm flex items-center gap-1">
                    {isAi && '🤖'}
                    {s.label}
                  </span>
                  <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden relative">
                    <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                    <span className="absolute inset-0 flex items-center px-2 text-xs text-gray-700">
                      {s.count} · {pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone: 'gray' | 'blue' | 'green' | 'emerald' | 'yellow' }) {
  const colors: Record<typeof tone, string> = {
    gray: 'border-gray-300', blue: 'border-blue-500', green: 'border-green-500',
    emerald: 'border-emerald-500', yellow: 'border-yellow-500',
  };
  return (
    <div className={`border-l-4 ${colors[tone]} pl-3`}>
      <div className="text-xs text-gray-500 uppercase">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
