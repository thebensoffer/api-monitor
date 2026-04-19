'use client';

import { useEffect, useState } from 'react';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  service: string;
  message: string;
  metadata?: { logGroup?: string; logStream?: string; eventId?: string };
}

interface LogsData {
  source: string;
  logs: LogEntry[];
  total: number;
  groupsScanned?: number;
  filters: any;
  timestamp: string;
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

function LogRow({ log }: { log: LogEntry }) {
  const [open, setOpen] = useState(false);
  const tone =
    log.level === 'error' ? 'border-red-400 bg-red-50' :
    log.level === 'warning' ? 'border-yellow-400 bg-yellow-50' :
    'border-blue-400 bg-blue-50';
  const badge =
    log.level === 'error' ? 'bg-red-100 text-red-800' :
    log.level === 'warning' ? 'bg-yellow-100 text-yellow-800' :
    'bg-blue-100 text-blue-800';

  return (
    <div className={`border-l-4 ${tone}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2 text-left hover:bg-white/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-gray-400 text-xs font-mono w-3">{open ? '▼' : '▶'}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge}`}>
                {log.level.toUpperCase()}
              </span>
              <span className="text-xs font-mono text-gray-700">{log.service}</span>
              <span className="text-[10px] text-gray-400 ml-auto">{new Date(log.timestamp).toLocaleString()}</span>
            </div>
            <div className="text-sm text-gray-800 truncate">{log.message}</div>
          </div>
        </div>
      </button>
      {open && (
        <div className="px-6 pb-3 space-y-2 text-xs">
          <div>
            <div className="text-gray-500 uppercase font-medium mb-1">Full message</div>
            <pre className="bg-gray-900 text-green-200 px-3 py-2 rounded overflow-x-auto whitespace-pre-wrap text-[11px] max-h-72">
              {log.message}
            </pre>
          </div>
          {log.metadata && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <div className="text-gray-500 uppercase font-medium">Log group</div>
                <code className="text-[11px] break-all">{log.metadata.logGroup || '—'}</code>
              </div>
              <div>
                <div className="text-gray-500 uppercase font-medium">Log stream</div>
                <code className="text-[11px] break-all">{log.metadata.logStream || '—'}</code>
              </div>
              <div>
                <div className="text-gray-500 uppercase font-medium">Event ID</div>
                <code className="text-[11px] break-all">{log.metadata.eventId || '—'}</code>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LogsPanel() {
  const [data, setData] = useState<LogsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<string>('');
  const [hours, setHours] = useState(1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (level) params.set('level', level);
      params.set('limit', '100');
      params.set('since', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString());
      const r = await fetch(`/api/logs?${params}`, {
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
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, [level, hours]);

  const counts = {
    error: data?.logs.filter((l) => l.level === 'error').length ?? 0,
    warning: data?.logs.filter((l) => l.level === 'warning').length ?? 0,
    info: data?.logs.filter((l) => l.level === 'info').length ?? 0,
  };

  return (
    <div className="space-y-4">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">📝 Live System Logs</h2>
            <p className="text-sm text-gray-500">
              Real CloudWatch events from Amplify SSR + openheart-cron Lambdas.
              Click any row for full message + log stream.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={hours} onChange={(e) => setHours(parseInt(e.target.value, 10))} className="text-xs border border-gray-300 rounded px-2 py-1">
              <option value={1}>last 1h</option>
              <option value={6}>last 6h</option>
              <option value={24}>last 24h</option>
            </select>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1">
              <option value="">all levels</option>
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="error">error</option>
            </select>
            <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="border-l-4 border-blue-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Total</div>
            <div className="text-2xl font-bold">{data?.total ?? 0}</div>
          </div>
          <div className="border-l-4 border-blue-400 pl-3">
            <div className="text-xs text-gray-500 uppercase">Info</div>
            <div className="text-2xl font-bold text-blue-700">{counts.info}</div>
          </div>
          <div className="border-l-4 border-yellow-400 pl-3">
            <div className="text-xs text-gray-500 uppercase">Warnings</div>
            <div className="text-2xl font-bold text-yellow-700">{counts.warning}</div>
          </div>
          <div className="border-l-4 border-red-400 pl-3">
            <div className="text-xs text-gray-500 uppercase">Errors</div>
            <div className="text-2xl font-bold text-red-700">{counts.error}</div>
          </div>
        </div>

        {error && <div className="text-sm text-red-700 mb-3">Error: {error}</div>}

        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
          {data?.logs.map((log, i) => <LogRow key={`${log.timestamp}-${i}`} log={log} />)}
          {!loading && data && data.logs.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-8">No logs in this window.</div>
          )}
          {loading && !data && <div className="text-sm text-gray-500 p-4">Loading…</div>}
        </div>
        {data && (
          <div className="text-xs text-gray-400 mt-2">
            source: {data.source} · scanned {data.groupsScanned ?? 0} log groups · refreshed {new Date(data.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
