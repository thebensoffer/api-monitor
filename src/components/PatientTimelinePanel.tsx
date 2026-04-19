'use client';

import { useState } from 'react';

interface TimelineEvent {
  site: string;
  type: 'email' | 'sms' | 'order' | 'charge' | 'refund';
  ts: string;
  summary: string;
  detail?: any;
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

const siteAccents: Record<string, string> = {
  dk: 'border-emerald-500 bg-emerald-50',
  dbs: 'border-amber-500 bg-amber-50',
  tovani: 'border-indigo-500 bg-indigo-50',
};

const typeIcon: Record<string, string> = {
  email: '✉',
  sms: '📱',
  order: '🛒',
  charge: '💳',
  refund: '↩',
};

function EventRow({ event }: { event: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border-l-4 ${siteAccents[event.site] || 'border-gray-300 bg-gray-50'} rounded-r p-3`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left">
        <div className="flex items-center gap-3">
          <span className="text-lg">{typeIcon[event.type]}</span>
          <span className="text-[10px] font-mono uppercase text-gray-500 w-12">{event.site}</span>
          <span className="text-[10px] font-mono uppercase text-gray-500 w-12">{event.type}</span>
          <span className="text-sm text-gray-900 flex-1 truncate">{event.summary}</span>
          <span className="text-xs text-gray-500 shrink-0">{new Date(event.ts).toLocaleString()}</span>
        </div>
      </button>
      {open && event.detail && (
        <pre className="mt-2 bg-gray-900 text-green-200 p-2 rounded text-[11px] overflow-x-auto max-h-72 whitespace-pre-wrap">
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function PatientTimelinePanel() {
  const [query, setQuery] = useState('');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (query.trim().length < 3) {
      setError('Enter at least 3 characters (email, phone, name, or order #)');
      return;
    }
    setLoading(true);
    setError(null);
    setEvents([]);
    try {
      const r = await fetch(`/api/patient-timeline?q=${encodeURIComponent(query)}&actor=ben`, {
        headers: { 'x-monitor-key': apiKey() },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setEvents(j.events || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-900">🔎 Patient Timeline</h2>
        <p className="text-sm text-gray-500">
          Cross-site lookup for support calls. Search by email, phone, name, or order #.
          Returns every email, SMS, order, charge, refund touching that patient across DK / DBS / Tovani in the last 90 days.
          Each search is logged to audit.
        </p>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="patient@email.com  /  +15551234567  /  ord_xxx"
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
        />
        <button
          onClick={search}
          disabled={loading || query.length < 3}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && <div className="text-sm text-red-700 mb-3">{error}</div>}

      {events.length > 0 && (
        <>
          <div className="text-xs text-gray-500 mb-3">
            {events.length} events for "{query}" — newest first
          </div>
          <div className="space-y-1.5">
            {events.map((e, i) => (
              <EventRow key={`${e.site}-${e.type}-${i}`} event={e} />
            ))}
          </div>
        </>
      )}

      {!loading && events.length === 0 && query && !error && (
        <div className="text-sm text-gray-500 text-center py-8">
          No events found for "{query}" in the last 90 days.
        </div>
      )}
    </div>
  );
}
