'use client';

import { useEffect, useState } from 'react';

interface AuditItem {
  actor: string;
  ts: string;
  action: string;
  resource: string;
  metadata?: any;
  ip?: string | null;
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

function actionTone(action: string) {
  if (action.includes('refund.success')) return 'bg-green-100 text-green-800';
  if (action.includes('refund.fail')) return 'bg-red-100 text-red-800';
  if (action.includes('refund')) return 'bg-amber-100 text-amber-800';
  if (action.includes('access') || action.includes('view')) return 'bg-blue-100 text-blue-800';
  return 'bg-gray-100 text-gray-700';
}

export function AuditPanel() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actor, setActor] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = actor ? `/api/audit?actor=${encodeURIComponent(actor)}` : '/api/audit';
      const r = await fetch(url, { headers: { 'x-monitor-key': apiKey() }, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setItems(j.items || []);
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
  }, [actor]);

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">📋 Audit Log</h2>
          <p className="text-sm text-gray-500">
            HIPAA-grade actor/action/resource trail. 7-year retention. Refunds, PHI access, admin actions.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="filter by actor"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-40"
          />
          <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? '…' : '↻'}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-700 mb-3">Error: {error}</div>}

      {items.length === 0 && !loading && (
        <div className="text-sm text-gray-500 text-center py-8">No audit events yet.</div>
      )}

      <div className="space-y-1 text-xs">
        {items.map((item, i) => (
          <div key={`${item.actor}-${item.ts}-${i}`} className="flex items-center gap-3 px-3 py-2 border-l-4 border-gray-300 bg-gray-50 rounded">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${actionTone(item.action)}`}>
              {item.action}
            </span>
            <span className="font-mono text-gray-700 w-20 truncate">{item.actor}</span>
            <span className="font-mono text-gray-600 truncate flex-1">{item.resource}</span>
            {item.metadata && (
              <details className="text-[10px] text-gray-500">
                <summary className="cursor-pointer">meta</summary>
                <pre className="mt-1 bg-white p-2 rounded text-[10px] max-w-xs overflow-x-auto">{JSON.stringify(item.metadata, null, 2)}</pre>
              </details>
            )}
            <span className="text-gray-400 text-[10px] shrink-0">{new Date(item.ts).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
