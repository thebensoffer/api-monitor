'use client';

import { useEffect, useState } from 'react';

interface SiteIntegrity {
  site: string;
  label: string;
  schema?: {
    lastMigration: string | null;
    lastAppliedAt: string | null;
    appliedCount: number;
    failedCount: number;
    error: string | null;
  };
  orphans?: Record<string, number>;
  orphansTotal?: number;
  error?: string;
}

interface IntegrityData {
  generatedAt: string;
  summary: { sitesChecked: number; sitesWithErrors: number; totalOrphans: number; failedMigrations: number };
  sites: SiteIntegrity[];
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';
const siteAccents: Record<string, string> = {
  dk: 'border-emerald-500 bg-emerald-50',
  dbs: 'border-amber-500 bg-amber-50',
  tovani: 'border-indigo-500 bg-indigo-50',
};

export function IntegrityPanel() {
  const [data, setData] = useState<IntegrityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/integrity', { headers: { 'x-monitor-key': apiKey() }, cache: 'no-store' });
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
    const i = setInterval(load, 5 * 60 * 1000); // every 5 min
    return () => clearInterval(i);
  }, []);

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">🧬 Data Integrity</h2>
          <p className="text-sm text-gray-500">
            Per-app schema state + orphan-record audits. Daily cron alerts on failed migrations or unexpected orphans.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? '…' : '↻'}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="border-l-4 border-blue-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Sites checked</div>
            <div className="text-2xl font-bold">{data.summary.sitesChecked}</div>
          </div>
          <div className="border-l-4 border-red-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">API errors</div>
            <div className="text-2xl font-bold text-red-700">{data.summary.sitesWithErrors}</div>
          </div>
          <div className="border-l-4 border-yellow-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Failed migrations</div>
            <div className="text-2xl font-bold text-yellow-700">{data.summary.failedMigrations}</div>
          </div>
          <div className="border-l-4 border-amber-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Orphan records</div>
            <div className="text-2xl font-bold text-amber-700">{data.summary.totalOrphans}</div>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-700 mb-3">{error}</div>}

      {data && data.sites.map((s) => (
        <div key={s.site} className={`border-l-4 ${siteAccents[s.site] || 'border-gray-400 bg-gray-50'} rounded-r p-4 mb-3`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-900">{s.label}</h3>
            {s.error && <span className="text-xs text-red-700">{s.error}</span>}
            {!s.error && (
              <div className="text-xs text-gray-600 flex gap-3">
                <span>last migration: <code className="font-mono text-[11px]">{s.schema?.lastMigration?.slice(0, 30) || '?'}</code></span>
                {s.schema?.failedCount! > 0 && <span className="text-red-700">{s.schema!.failedCount} failed</span>}
                <span>orphans: <strong>{s.orphansTotal || 0}</strong></span>
              </div>
            )}
          </div>
          {s.orphans && Object.keys(s.orphans).length > 0 && (
            <table className="w-full text-xs mt-2">
              <tbody>
                {Object.entries(s.orphans).map(([k, n]) => (
                  <tr key={k} className={n > 0 ? 'text-amber-800 font-medium' : 'text-gray-600'}>
                    <td className="py-1 pr-3 font-mono">{k}</td>
                    <td className="py-1 text-right">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.schema?.lastAppliedAt && (
            <div className="text-[11px] text-gray-500 mt-2">
              Last migration applied: {new Date(s.schema.lastAppliedAt).toLocaleString()} ({s.schema.appliedCount} total recent)
            </div>
          )}
        </div>
      ))}
      {loading && !data && <div className="text-sm text-gray-500">Loading…</div>}
    </div>
  );
}
