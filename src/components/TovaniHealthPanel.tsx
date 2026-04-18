'use client';

import { useEffect, useState } from 'react';
import { ProbeRow, ProbeLike } from './ProbeRow';

interface VersionEvent {
  service: string;
  version: string;
  observedAt: string;
  metadata?: Record<string, any>;
}

interface TovaniData {
  success: boolean;
  target: string;
  generatedAt: string;
  summary: { totalProbes: number; ok: number; failed: number; avgResponseMs: number };
  probes: ProbeLike[];
  deployments: VersionEvent[];
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

export function TovaniHealthPanel() {
  const [data, setData] = useState<TovaniData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/tovani-health', {
        headers: { 'x-monitor-key': apiKey() },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">🩺 Tovani Health Live Probes</h2>
            <p className="text-sm text-gray-500">
              Real transmissions to <code>tovanihealth.com</code> — each call is recorded with full request/response detail.
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="border-l-4 border-blue-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Probes</div>
              <div className="text-2xl font-semibold">{data.summary.totalProbes}</div>
            </div>
            <div className="border-l-4 border-green-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">OK</div>
              <div className="text-2xl font-semibold text-green-700">{data.summary.ok}</div>
            </div>
            <div className="border-l-4 border-red-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Failed</div>
              <div className="text-2xl font-semibold text-red-700">{data.summary.failed}</div>
            </div>
            <div className="border-l-4 border-purple-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Avg latency</div>
              <div className="text-2xl font-semibold">{data.summary.avgResponseMs}ms</div>
            </div>
          </div>
        )}
        {error && <div className="text-sm text-red-700 mb-3">Error: {error}</div>}
        {data && (
          <>
            <div className="text-xs text-gray-500 mb-2">
              Generated at {new Date(data.generatedAt).toLocaleString()} · click any probe to drill into its transmitted data
            </div>
            <div className="space-y-2">
              {data.probes.map((p) => (
                <ProbeRow key={p.endpoint} probe={p} />
              ))}
            </div>
          </>
        )}
        {loading && !data && <div className="text-gray-500 text-sm">Loading probes…</div>}
      </div>

      {data && data.deployments && data.deployments.length > 0 && (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">🚀 Deployment Timeline</h3>
          <p className="text-sm text-gray-500 mb-4">
            Build version changes detected by polling. Each row is a deploy moment we observed live.
          </p>
          <div className="space-y-2">
            {data.deployments.map((d, i) => (
              <div key={i} className="flex items-center gap-3 text-sm border-l-4 border-purple-400 bg-purple-50 px-3 py-2 rounded">
                <span className="text-xs uppercase font-mono text-purple-700">{d.service}</span>
                <span className="font-mono">
                  {d.metadata?.previousVersion ? `${d.metadata.previousVersion} → ` : ''}
                  <strong>{d.version}</strong>
                </span>
                <span className="text-gray-500 text-xs ml-auto">{new Date(d.observedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
