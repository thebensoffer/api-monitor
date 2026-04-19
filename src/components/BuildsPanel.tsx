'use client';

import { useEffect, useState } from 'react';

interface BuildJob {
  jobId: string;
  status: string;
  jobType?: string;
  commitId?: string;
  commitMessage?: string;
  commitTime?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationSeconds?: number | null;
}

interface AppSummary {
  appId: string;
  name: string;
  domain: string;
  branch: string;
  updateTime?: string | null;
  latestJob: BuildJob | null;
  recentJobs: { jobId: string; status: string; startTime: string | null }[];
  successRate: number | null;
}

interface BuildsData {
  summary: {
    apps: number;
    latestStatuses: { SUCCEED: number; FAILED: number; RUNNING: number; OTHER: number };
    generatedAt: string;
  };
  apps: AppSummary[];
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-gray-400">—</span>;
  const tone =
    status === 'SUCCEED' ? 'bg-green-100 text-green-800' :
    status === 'FAILED' ? 'bg-red-100 text-red-800' :
    status === 'RUNNING' ? 'bg-blue-100 text-blue-800' :
    status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
    'bg-gray-100 text-gray-800';
  const icon = status === 'SUCCEED' ? '✅' : status === 'FAILED' ? '❌' : status === 'RUNNING' ? '⏳' : '•';
  return <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${tone}`}>{icon} {status}</span>;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function AppCard({ app }: { app: AppSummary }) {
  const [open, setOpen] = useState(false);
  const lj = app.latestJob;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-gray-400 text-xs font-mono w-3">{open ? '▼' : '▶'}</span>
          <div className="min-w-0">
            <div className="font-medium text-sm">{app.name}</div>
            <div className="text-xs text-gray-500 truncate">{app.domain} · {app.branch}</div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0 text-xs text-gray-600">
          {lj?.commitMessage && <span className="truncate max-w-xs hidden md:inline">{lj.commitMessage.split('\n')[0]}</span>}
          {lj?.durationSeconds != null && <span className="font-mono">{Math.floor(lj.durationSeconds / 60)}m {lj.durationSeconds % 60}s</span>}
          <span>{relTime(lj?.startTime)}</span>
          <StatusBadge status={lj?.status} />
        </div>
      </button>
      {open && (
        <div className="px-4 py-3 bg-white text-xs space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-gray-500 uppercase font-medium mb-1">Latest job</div>
              {lj ? (
                <div className="space-y-1 font-mono">
                  <div>jobId: {lj.jobId}</div>
                  <div>type: {lj.jobType || '—'}</div>
                  <div>commit: {lj.commitId?.slice(0, 7)}</div>
                  <div className="break-words whitespace-pre-wrap font-sans bg-gray-50 p-2 rounded">{lj.commitMessage || '—'}</div>
                  <div>started: {lj.startTime ? new Date(lj.startTime).toLocaleString() : '—'}</div>
                  <div>ended: {lj.endTime ? new Date(lj.endTime).toLocaleString() : '—'}</div>
                </div>
              ) : (
                <div className="text-gray-500">No jobs yet</div>
              )}
            </div>
            <div>
              <div className="text-gray-500 uppercase font-medium mb-1">Recent runs ({app.recentJobs.length})</div>
              <div className="space-y-1">
                {app.recentJobs.map((j) => (
                  <div key={j.jobId} className="flex items-center justify-between text-[11px] py-1 border-b border-gray-100">
                    <span className="font-mono">#{j.jobId}</span>
                    <StatusBadge status={j.status} />
                    <span className="text-gray-500">{relTime(j.startTime)}</span>
                  </div>
                ))}
              </div>
              {app.successRate !== null && (
                <div className="mt-2 text-gray-500">Success rate (last {app.recentJobs.length}): <span className="font-mono">{app.successRate}%</span></div>
              )}
            </div>
          </div>
          <div className="text-[11px] text-gray-500">
            App ID: <code>{app.appId}</code> · Last updated: {relTime(app.updateTime)}
          </div>
        </div>
      )}
    </div>
  );
}

export function BuildsPanel() {
  const [data, setData] = useState<BuildsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/builds', {
        headers: { 'x-monitor-key': apiKey() },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed');
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
    <div className="space-y-4">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">🚀 Deployment Pipeline</h2>
            <p className="text-sm text-gray-500">Live AWS Amplify build status. Click any app to see commit, duration, recent runs.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
            <div className="border-l-4 border-blue-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Apps</div>
              <div className="text-2xl font-bold">{data.summary.apps}</div>
            </div>
            <div className="border-l-4 border-green-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">✓ Succeeded</div>
              <div className="text-2xl font-bold text-green-700">{data.summary.latestStatuses.SUCCEED}</div>
            </div>
            <div className="border-l-4 border-red-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">✗ Failed</div>
              <div className="text-2xl font-bold text-red-700">{data.summary.latestStatuses.FAILED}</div>
            </div>
            <div className="border-l-4 border-blue-400 pl-3">
              <div className="text-xs text-gray-500 uppercase">⏳ Running</div>
              <div className="text-2xl font-bold">{data.summary.latestStatuses.RUNNING}</div>
            </div>
            <div className="border-l-4 border-gray-400 pl-3">
              <div className="text-xs text-gray-500 uppercase">Other</div>
              <div className="text-2xl font-bold">{data.summary.latestStatuses.OTHER}</div>
            </div>
          </div>
        )}

        {error && <div className="text-sm text-red-700 mb-3">Error: {error}</div>}

        {data && (
          <div className="space-y-2">
            {data.apps.map((a) => (
              <AppCard key={a.appId} app={a} />
            ))}
          </div>
        )}
        {loading && !data && <div className="text-sm text-gray-500">Loading builds…</div>}
      </div>
    </div>
  );
}
