'use client';

/**
 * InboundSmsPanel — live patient text feed for the main dashboard.
 *
 * Shows recent inbound SMS to the Pinpoint TFN (+18772394885) paired with the
 * outbound reply (AI / away-mode auto-reply / human admin relay). Most recent
 * conversation appears at the TOP. The list is independently scrollable so the
 * panel doesn't push other dashboard cards off-screen.
 *
 * Auto-refreshes every 20s. Manual refresh button + a "live" pulse indicator.
 */

import { useEffect, useRef, useState } from 'react';

interface ConversationItem {
  id: string;
  phoneNumber: string;
  patientName: string | null;
  tenant: 'dk' | 'tovani' | 'unknown';
  inbound: { body: string; createdAt: string; twilioSid: string | null };
  reply: {
    body: string;
    createdAt: string;
    kind: 'ai' | 'auto-reply' | 'admin-relay' | 'unknown';
    intent: string | null;
    twilioStatus: string | null;
  } | null;
  site: string;
  siteLabel: string;
}

interface ApiResponse {
  success: boolean;
  generatedAt: string;
  hours: number;
  summary: {
    total: number;
    bySite: { site: string; label: string; count: number; error: string | null }[];
  };
  items: ConversationItem[];
}

const RANGES = [
  { value: 24, label: '24h' },
  { value: 72, label: '72h' },
  { value: 168, label: '7d' },
  { value: 720, label: '30d' },
];

function formatPhone(p: string): string {
  const digits = p.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return p;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.round((now - d) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

type ReplyKind = NonNullable<ConversationItem['reply']>['kind'];

function replyBadge(kind: ReplyKind | undefined): { label: string; tone: string } {
  if (!kind || kind === 'unknown') return { label: 'Reply', tone: 'bg-gray-100 text-gray-700' };
  if (kind === 'ai') return { label: '🤖 AI reply', tone: 'bg-emerald-100 text-emerald-800' };
  if (kind === 'auto-reply') return { label: '💤 Away auto-reply', tone: 'bg-amber-100 text-amber-800' };
  if (kind === 'admin-relay') return { label: '👤 Human reply', tone: 'bg-indigo-100 text-indigo-800' };
  return { label: 'Reply', tone: 'bg-gray-100 text-gray-700' };
}

function tenantBadge(tenant: ConversationItem['tenant']) {
  if (tenant === 'dk') return { label: 'DK', tone: 'bg-blue-100 text-blue-700' };
  if (tenant === 'tovani') return { label: 'TOVANI', tone: 'bg-indigo-100 text-indigo-700' };
  return { label: '—', tone: 'bg-gray-100 text-gray-600' };
}

export function InboundSmsPanel() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState<number>(72);
  const [order, setOrder] = useState<'newest-top' | 'newest-bottom'>('newest-top');
  const lastFetchRef = useRef<number>(0);
  const lastIdsRef = useRef<Set<string>>(new Set());
  const [pulseId, setPulseId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const r = await fetch(`/api/inbound-sms?hours=${hours}&limit=200`, {
        headers: { 'x-monitor-key': process.env.NEXT_PUBLIC_MONITOR_API_KEY || '' },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: ApiResponse = await r.json();

      // Highlight the newest item if it's new this poll
      const newIds = new Set(j.items.map((i) => i.id));
      const prevIds = lastIdsRef.current;
      if (prevIds.size > 0 && j.items.length > 0) {
        const fresh = j.items.find((i) => !prevIds.has(i.id));
        if (fresh) {
          setPulseId(fresh.id);
          setTimeout(() => setPulseId(null), 2500);
        }
      }
      lastIdsRef.current = newIds;

      setData(j);
      setError(null);
      lastFetchRef.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  const items = data?.items || [];
  const ordered = order === 'newest-top' ? items : [...items].reverse();
  const errored = (data?.summary.bySite || []).filter((s) => s.error);

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">📱 Live Patient Texts</h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            live · auto-refresh 20s
          </span>
          {data && (
            <span className="text-xs text-gray-400">
              {data.summary.total} in last {hours}h
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border border-gray-300 rounded overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setHours(r.value)}
                className={`px-2 py-1 text-xs ${
                  hours === r.value ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setOrder((o) => (o === 'newest-top' ? 'newest-bottom' : 'newest-top'))}
            className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            title="Toggle order"
          >
            {order === 'newest-top' ? '↓ newest top' : '↑ newest bottom'}
          </button>
          <button
            onClick={fetchData}
            className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            title="Refresh now"
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
          Failed to load: {error}
        </div>
      )}
      {errored.length > 0 && (
        <div className="mb-3 p-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded">
          Site errors: {errored.map((s) => `${s.label}: ${s.error}`).join(' · ')}
        </div>
      )}

      {loading && !data && (
        <div className="text-gray-500 text-sm py-6 text-center">Loading patient texts…</div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-gray-500 text-sm py-6 text-center">
          No inbound texts in the last {hours}h.
        </div>
      )}

      {ordered.length > 0 && (
        <div
          className="max-h-[480px] overflow-y-auto pr-2 space-y-3"
          style={{ scrollbarGutter: 'stable' }}
        >
          {ordered.map((item) => {
            const tb = tenantBadge(item.tenant);
            const rb = item.reply ? replyBadge(item.reply.kind) : null;
            const isPulse = pulseId === item.id;
            return (
              <div
                key={item.id}
                className={`border rounded-lg p-3 transition-shadow ${
                  isPulse
                    ? 'border-emerald-400 bg-emerald-50 shadow-md'
                    : 'border-gray-200 bg-gray-50 hover:bg-white'
                }`}
              >
                {/* Header: name, phone, time, badges */}
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-gray-900 truncate">
                      {item.patientName || <span className="italic text-gray-500">Unknown</span>}
                    </span>
                    <span className="text-sm text-gray-500 tabular-nums whitespace-nowrap">
                      {formatPhone(item.phoneNumber)}
                    </span>
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${tb.tone}`}>
                      {tb.label}
                    </span>
                  </div>
                  <span
                    className="text-xs text-gray-500 whitespace-nowrap"
                    title={new Date(item.inbound.createdAt).toLocaleString()}
                  >
                    {relTime(item.inbound.createdAt)}
                  </span>
                </div>

                {/* Inbound message */}
                <div className="flex gap-2 mb-2">
                  <div className="flex-shrink-0 w-12 text-[10px] uppercase tracking-wide text-gray-500 pt-1">
                    Patient
                  </div>
                  <div className="flex-1 bg-white rounded px-3 py-2 border border-gray-200 text-sm text-gray-900 whitespace-pre-wrap break-words">
                    {item.inbound.body}
                  </div>
                </div>

                {/* Reply (or "no reply yet") */}
                {item.reply ? (
                  <div className="flex gap-2">
                    <div className="flex-shrink-0 w-12 text-[10px] uppercase tracking-wide text-gray-500 pt-1">
                      Reply
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${rb!.tone}`}>
                          {rb!.label}
                        </span>
                        {item.reply.intent && (
                          <span className="text-[10px] text-gray-500">intent: {item.reply.intent}</span>
                        )}
                        <span
                          className="text-[10px] text-gray-400"
                          title={new Date(item.reply.createdAt).toLocaleString()}
                        >
                          {relTime(item.reply.createdAt)}
                        </span>
                      </div>
                      <div className="bg-emerald-50/40 rounded px-3 py-2 border border-emerald-200 text-sm text-gray-900 whitespace-pre-wrap break-words">
                        {item.reply.body}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-shrink-0 w-12 text-[10px] uppercase tracking-wide text-gray-500 pt-1">
                      Reply
                    </div>
                    <div className="flex-1 text-xs text-gray-500 italic px-3 py-2">
                      no reply within window
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
