'use client';

import { useEffect, useState } from 'react';

interface SyntheticReport {
  scenario: string;
  ts: string;
  ok: boolean;
  durationMs: number;
  message: string;
  source?: string;
  steps?: { name: string; ok: boolean; durationMs?: number; error?: string }[];
  metadata?: Record<string, any>;
  ageMinutes?: number;
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

function ScenarioRow({ report }: { report: SyntheticReport }) {
  const [open, setOpen] = useState(false);
  const stale = (report.ageMinutes ?? 0) > 120;
  const tone = !report.ok ? 'border-red-400 bg-red-50' : stale ? 'border-yellow-400 bg-yellow-50' : 'border-green-400 bg-green-50';

  return (
    <div className={`border-l-4 ${tone} rounded-r overflow-hidden`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full px-4 py-2 text-left hover:bg-white/50">
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-xs font-mono w-3">{open ? '▼' : '▶'}</span>
          <span className="text-base">{report.ok ? '✅' : '❌'}</span>
          <span className="font-medium text-sm flex-1">{report.scenario}</span>
          {stale && <span className="text-[10px] bg-yellow-200 text-yellow-900 px-1.5 py-0.5 rounded font-medium">STALE {report.ageMinutes}m</span>}
          <span className="text-xs text-gray-500">{report.source || 'unknown'} · {report.durationMs}ms</span>
          <span className="text-xs text-gray-400 shrink-0">{new Date(report.ts).toLocaleString()}</span>
        </div>
        <div className="text-xs text-gray-700 ml-9 mt-0.5">{report.message}</div>
      </button>
      {open && (
        <div className="px-4 py-3 bg-white text-xs space-y-2">
          {report.metadata?.description && (
            <div className="text-gray-600 italic">{report.metadata.description}</div>
          )}
          {report.steps && report.steps.length > 0 && (
            <div>
              <div className="font-semibold text-gray-700 mb-1">Steps ({report.steps.length})</div>
              <div className="space-y-1">
                {report.steps.map((s, i) => (
                  <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded ${s.ok ? 'bg-gray-50' : 'bg-red-50'}`}>
                    <span>{s.ok ? '✓' : '✗'}</span>
                    <span className="font-mono flex-1 truncate">{s.name}</span>
                    {s.durationMs != null && <span className="text-gray-500">{s.durationMs}ms</span>}
                    {s.error && <span className="text-red-700 text-[11px]">{s.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SyntheticPanel() {
  const [data, setData] = useState<{ summary: any; latest: SyntheticReport[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/synthetic', { headers: { 'x-monitor-key': apiKey() }, cache: 'no-store' });
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
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">🤖 Synthetic Patient Journeys</h2>
          <p className="text-sm text-gray-500">
            Browser-based scripted flows reported by external runners (Khai). The hourly synthetic-journey cron alerts on regressions or stale runners.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="border-l-4 border-blue-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Scenarios</div>
            <div className="text-2xl font-bold">{data.summary.scenarios}</div>
          </div>
          <div className="border-l-4 border-green-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Passing</div>
            <div className="text-2xl font-bold text-green-700">{data.summary.ok}</div>
          </div>
          <div className="border-l-4 border-red-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Failed</div>
            <div className="text-2xl font-bold text-red-700">{data.summary.failed}</div>
          </div>
          <div className="border-l-4 border-yellow-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Stale &gt; 2h</div>
            <div className="text-2xl font-bold text-yellow-700">{data.summary.stale}</div>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-700 mb-3">{error}</div>}

      {data && data.latest.length === 0 && (
        <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded">
          <div className="font-medium mb-1">No reports yet.</div>
          <div className="text-xs">
            Set up the Khai runner on your Mac:
            <pre className="mt-2 bg-gray-900 text-green-200 p-3 rounded overflow-x-auto text-[11px]">{`OPENHEART_URL=https://main.dl7zrj8lm47be.amplifyapp.com \\
OPENHEART_BASIC_AUTH=$(echo -n 'ben:PASSWORD' | base64) \\
MONITOR_API_KEY=kai-monitor-2026-super-secret-key \\
node ~/api-monitor/scripts/khai-synthetic-runner.js`}</pre>
            <div className="mt-2">Schedule it via Khai's node-cron or macOS launchd to fire hourly.</div>
          </div>
        </div>
      )}

      {data && data.latest.length > 0 && (
        <div className="space-y-1.5">
          {data.latest.map((r) => <ScenarioRow key={r.scenario} report={r} />)}
        </div>
      )}
    </div>
  );
}
