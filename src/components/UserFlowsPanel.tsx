'use client';

import { useEffect, useState } from 'react';
import { ProbeRow, ProbeLike } from './ProbeRow';

interface FlowItem {
  site: string;
  label: string;
  flow: string;
  step: string;
  probe: ProbeLike;
}

interface SiteGroup {
  site: string;
  label: string;
  base: string;
  total: number;
  failed: number;
  avgMs: number;
  flows: FlowItem[];
}

interface UserFlowData {
  generatedAt: string;
  summary: { totalFlows: number; sitesChecked: number; failed: number };
  grouped: SiteGroup[];
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

const flowIcons: Record<string, string> = {
  auth: '🔑',
  seo: '🔍',
  content: '📄',
  system: '⚙️',
};

export function UserFlowsPanel() {
  const [data, setData] = useState<UserFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/user-flows', {
        headers: { 'x-monitor-key': apiKey() },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 60000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">🧭 User-Flow Probes</h2>
            <p className="text-sm text-gray-500">
              Probes the actual paths users (and crawlers) hit — auth, SEO, content, system.
            </p>
          </div>
          <button
            onClick={load}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? 'Probing…' : '↻ Refresh'}
          </button>
        </div>

        {data && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="border-l-4 border-blue-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Total flows</div>
              <div className="text-2xl font-semibold">{data.summary.totalFlows}</div>
            </div>
            <div className="border-l-4 border-purple-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Sites</div>
              <div className="text-2xl font-semibold">{data.summary.sitesChecked}</div>
            </div>
            <div className="border-l-4 border-red-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Failed</div>
              <div className="text-2xl font-semibold text-red-700">{data.summary.failed}</div>
            </div>
          </div>
        )}
        {error && <div className="text-sm text-red-700">Error: {error}</div>}

        {data && data.grouped.map((g) => (
          <div key={g.site} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">
                {g.label}{' '}
                <span className="text-xs font-normal text-gray-500">{g.base}</span>
              </h3>
              <div className="text-xs text-gray-500">
                {g.total - g.failed}/{g.total} OK · avg {g.avgMs}ms
              </div>
            </div>
            <div className="space-y-2">
              {g.flows.map((f) => (
                <ProbeRow
                  key={f.probe.endpoint}
                  probe={f.probe}
                  label={`${flowIcons[f.flow] || '•'} ${f.flow}: ${f.step}`}
                />
              ))}
            </div>
          </div>
        ))}
        {loading && !data && <div className="text-gray-500 text-sm">Loading flows…</div>}
      </div>
    </div>
  );
}
