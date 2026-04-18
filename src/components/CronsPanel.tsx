'use client';

import { useEffect, useState } from 'react';

interface CronRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  message: string;
  source: string;
  data?: any;
  error?: string;
}

interface CronEntry {
  id: string;
  group: 'monitoring' | 'reporting' | 'health';
  schedule: string;
  description: string;
  lastRun: CronRun | null;
  history: CronRun[];
}

interface CronsData {
  generatedAt: string;
  summary: { total: number; everRun: number; lastRunOk: number; lastRunFail: number };
  crons: CronEntry[];
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

const groupColors: Record<string, string> = {
  monitoring: 'bg-blue-100 text-blue-800',
  reporting: 'bg-purple-100 text-purple-800',
  health: 'bg-green-100 text-green-800',
};

function CronRunRow({ run }: { run: CronRun }) {
  return (
    <div className={`flex items-center gap-3 text-xs px-3 py-2 border-l-4 ${run.ok ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}>
      <span className={`font-mono ${run.ok ? 'text-green-700' : 'text-red-700'}`}>
        {run.ok ? '✓' : '✗'}
      </span>
      <span className="font-mono text-gray-500">{new Date(run.startedAt).toLocaleString()}</span>
      <span className="font-mono text-gray-500">{run.durationMs}ms</span>
      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono uppercase">{run.source}</span>
      <span className="text-gray-800 truncate">{run.message}</span>
    </div>
  );
}

function CronCard({ entry, onRun }: { entry: CronEntry; onRun: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRun(entry.id);
    } finally {
      setRunning(false);
    }
  };

  const last = entry.lastRun;
  const statusBadge = !last
    ? <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">never run</span>
    : last.ok
    ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">OK · {last.durationMs}ms</span>
    : <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">FAIL</span>;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-3 text-left flex-1 min-w-0"
        >
          <span className="text-gray-400 text-xs font-mono w-3">{open ? '▼' : '▶'}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${groupColors[entry.group]}`}>{entry.group}</span>
          <span className="font-medium text-sm">{entry.id}</span>
          <code className="text-xs text-gray-500 font-mono">{entry.schedule}</code>
          {statusBadge}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {last && (
            <span className="text-xs text-gray-500">
              {new Date(last.startedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? 'Running…' : '▶ Run now'}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 py-3 bg-white text-sm space-y-3">
          <div className="text-gray-700">{entry.description}</div>
          {last && (
            <div>
              <div className="font-semibold text-gray-700 mb-1 text-xs">Last result message</div>
              <div className="text-gray-900">{last.message}</div>
              {last.data && (
                <pre className="bg-gray-900 text-green-200 px-3 py-2 rounded overflow-x-auto text-[11px] mt-2 max-h-60">
                  {JSON.stringify(last.data, null, 2)}
                </pre>
              )}
              {last.error && <div className="text-red-700 mt-2 text-xs">Error: {last.error}</div>}
            </div>
          )}
          {entry.history.length > 1 && (
            <div>
              <div className="font-semibold text-gray-700 mb-1 text-xs">Recent runs ({entry.history.length})</div>
              <div className="space-y-1">
                {entry.history.map((r) => (
                  <CronRunRow key={r.startedAt} run={r} />
                ))}
              </div>
            </div>
          )}
          {entry.history.length === 0 && (
            <div className="text-gray-500 text-xs">No runs yet. Click ▶ Run now to test.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function CronsPanel() {
  const [data, setData] = useState<CronsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/cron', {
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

  const runOne = async (id: string) => {
    await fetch(`/api/cron/${id}`, { headers: { 'x-monitor-key': apiKey() } });
    await load();
  };

  const runAll = async () => {
    if (!data) return;
    setLoading(true);
    await Promise.all(
      data.crons.map((c) => fetch(`/api/cron/${c.id}`, { headers: { 'x-monitor-key': apiKey() } }))
    );
    await load();
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
            <h2 className="text-xl font-semibold text-gray-900">⏰ OpenHeart Crons</h2>
            <p className="text-sm text-gray-500">
              Monitoring jobs OpenHeart owns. Manual runs supported · history per job · live status.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runAll}
              className="px-3 py-1.5 text-sm rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              disabled={loading || !data}
            >
              ▶ Run all
            </button>
            <button
              onClick={load}
              className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? '…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="border-l-4 border-blue-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Total crons</div>
              <div className="text-2xl font-semibold">{data.summary.total}</div>
            </div>
            <div className="border-l-4 border-purple-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Ever run</div>
              <div className="text-2xl font-semibold">{data.summary.everRun}</div>
            </div>
            <div className="border-l-4 border-green-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Last OK</div>
              <div className="text-2xl font-semibold text-green-700">{data.summary.lastRunOk}</div>
            </div>
            <div className="border-l-4 border-red-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Last failed</div>
              <div className="text-2xl font-semibold text-red-700">{data.summary.lastRunFail}</div>
            </div>
          </div>
        )}

        {error && <div className="text-sm text-red-700 mb-3">Error: {error}</div>}

        {data && (
          <div className="space-y-2">
            {data.crons.map((c) => (
              <CronCard key={c.id} entry={c} onRun={runOne} />
            ))}
          </div>
        )}
        {loading && !data && <div className="text-gray-500 text-sm">Loading crons…</div>}
      </div>
    </div>
  );
}
