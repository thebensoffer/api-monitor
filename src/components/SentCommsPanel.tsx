'use client';

import { useEffect, useState, useMemo } from 'react';

interface SentItem {
  site: string;
  type: 'email' | 'sms';
  id: string;
  recipient: string;
  recipientName?: string | null;
  subject?: string;
  body: string | null;
  htmlBody?: string | null;
  templateKey?: string | null;
  status?: string;
  resendId?: string | null;
  twilioSid?: string | null;
  twilioStatus?: string | null;
  sentBy?: string | null;
  sentByUser?: { name?: string; email?: string } | null;
  channel?: string;
  errorMessage?: string | null;
  createdAt: string;
  isAutomatic?: boolean;
}

interface SentData {
  generatedAt: string;
  since: string;
  summary: {
    totalEmails: number;
    totalSms: number;
    bySite: { site: string; label: string; emails: number; sms: number; error: string | null }[];
  };
  items: SentItem[];
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';
const siteAccents: Record<string, string> = {
  dk: 'border-emerald-500 bg-emerald-50 text-emerald-800',
  dbs: 'border-amber-500 bg-amber-50 text-amber-800',
  tovani: 'border-indigo-500 bg-indigo-50 text-indigo-800',
};
const siteLabel: Record<string, string> = { dk: 'DK', dbs: 'DBS', tovani: 'TH' };

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const tone =
    s.includes('deliver') || s === 'sent' || s === 'success'
      ? 'bg-green-100 text-green-800'
      : s.includes('fail') || s.includes('bounce') || s.includes('error') || s.includes('undeliv')
      ? 'bg-red-100 text-red-800'
      : s.includes('queue') || s.includes('pend')
      ? 'bg-yellow-100 text-yellow-800'
      : 'bg-gray-100 text-gray-800';
  return <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full uppercase ${tone}`}>{status}</span>;
}

function ItemRow({ item }: { item: SentItem }) {
  const [open, setOpen] = useState(false);
  const isEmail = item.type === 'email';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-gray-400 text-xs font-mono w-3">{open ? '▼' : '▶'}</span>
          <span
            className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border-l-4 ${siteAccents[item.site] || 'bg-gray-50 border-gray-300'}`}
          >
            {siteLabel[item.site] || item.site}
          </span>
          <span className="text-xs font-mono text-gray-500 uppercase w-10">{isEmail ? '✉ MAIL' : '📱 SMS'}</span>
          <span className="text-sm text-gray-900 truncate min-w-0 flex-1">
            {isEmail ? (
              <>
                <span className="font-medium">{item.recipient}</span>
                <span className="text-gray-500"> · {item.subject}</span>
              </>
            ) : (
              <>
                <span className="font-medium">{item.recipient}</span>
                <span className="text-gray-500"> · {(item.body || '').slice(0, 60)}{(item.body || '').length > 60 ? '…' : ''}</span>
              </>
            )}
          </span>
          <StatusBadge status={item.status || item.twilioStatus || undefined} />
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
          {item.isAutomatic === false && <span className="text-blue-700 font-medium">manual</span>}
          {item.templateKey && <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">{item.templateKey}</span>}
          <span>{new Date(item.createdAt).toLocaleString()}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 py-3 bg-white text-xs space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-gray-500 uppercase font-medium mb-1">Recipient</div>
              <div className="font-mono">{item.recipient}{item.recipientName ? ` (${item.recipientName})` : ''}</div>
            </div>
            <div>
              <div className="text-gray-500 uppercase font-medium mb-1">Sent by</div>
              <div>
                {item.sentByUser?.name || item.sentByUser?.email || item.sentBy || (item.isAutomatic === false ? 'staff' : 'automation')}
              </div>
            </div>
            {item.resendId && (
              <div>
                <div className="text-gray-500 uppercase font-medium mb-1">Resend ID</div>
                <code className="text-[11px]">{item.resendId}</code>
              </div>
            )}
            {item.twilioSid && (
              <div>
                <div className="text-gray-500 uppercase font-medium mb-1">Twilio SID</div>
                <code className="text-[11px]">{item.twilioSid}</code>
              </div>
            )}
          </div>
          {isEmail && (
            <div>
              <div className="text-gray-500 uppercase font-medium mb-1">Subject</div>
              <div className="font-medium">{item.subject}</div>
            </div>
          )}
          <div>
            <div className="text-gray-500 uppercase font-medium mb-1">{isEmail ? 'Email body' : 'SMS body'}</div>
            <pre className="bg-gray-900 text-green-200 px-3 py-2 rounded overflow-x-auto text-[11px] whitespace-pre-wrap max-h-96">
              {item.body || (isEmail && item.htmlBody ? '(html-only — see source)' : '(empty)')}
            </pre>
          </div>
          {item.htmlBody && isEmail && (
            <details>
              <summary className="cursor-pointer text-blue-600 hover:underline">Show HTML source</summary>
              <pre className="bg-gray-50 px-3 py-2 rounded overflow-x-auto text-[11px] max-h-72 mt-1">{item.htmlBody}</pre>
            </details>
          )}
          {item.errorMessage && (
            <div className="text-red-700 bg-red-50 px-2 py-1 rounded">Error: {item.errorMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function SentCommsPanel() {
  const [data, setData] = useState<SentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSite, setFilterSite] = useState<'all' | string>('all');
  const [filterType, setFilterType] = useState<'all' | 'email' | 'sms'>('all');
  const [hours, setHours] = useState(24);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/sent-comms?hours=${hours}&limit=200`, {
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
  }, [hours]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.items.filter(
      (it) =>
        (filterSite === 'all' || it.site === filterSite) &&
        (filterType === 'all' || it.type === filterType)
    );
  }, [data, filterSite, filterType]);

  return (
    <div className="space-y-4">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">📤 Sent Communications</h2>
            <p className="text-sm text-gray-500">
              Every outbound email and SMS sent to patients across DK, DBS, Tovani — including Claude-sent and automation.
              Click any row to see the full text.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={hours}
              onChange={(e) => setHours(parseInt(e.target.value, 10))}
              className="text-xs border border-gray-300 rounded px-2 py-1"
            >
              <option value={1}>last 1h</option>
              <option value={6}>last 6h</option>
              <option value={24}>last 24h</option>
              <option value={72}>last 3d</option>
              <option value={168}>last 7d</option>
            </select>
            <button
              onClick={load}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="border-l-4 border-blue-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Emails</div>
              <div className="text-2xl font-bold">{data.summary.totalEmails}</div>
            </div>
            <div className="border-l-4 border-purple-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">SMS</div>
              <div className="text-2xl font-bold">{data.summary.totalSms}</div>
            </div>
            {data.summary.bySite.map((s) => (
              <div key={s.site} className={`border-l-4 pl-3 ${siteAccents[s.site]?.split(' ')[0] || ''}`}>
                <div className="text-xs text-gray-500 uppercase">{s.label}</div>
                <div className="text-lg font-semibold">
                  {s.emails + s.sms}{' '}
                  <span className="text-xs font-normal text-gray-500">
                    ({s.emails}✉ {s.sms}📱)
                  </span>
                </div>
                {s.error && <div className="text-[10px] text-red-700">{s.error}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-gray-500">Filter:</span>
          <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)} className="border border-gray-300 rounded px-2 py-1">
            <option value="all">all sites</option>
            <option value="dk">DK only</option>
            <option value="dbs">DBS only</option>
            <option value="tovani">Tovani only</option>
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)} className="border border-gray-300 rounded px-2 py-1">
            <option value="all">all types</option>
            <option value="email">emails only</option>
            <option value="sms">SMS only</option>
          </select>
          <span className="text-gray-400 ml-auto">
            showing {filtered.length} of {data?.items.length ?? 0}
          </span>
        </div>

        {error && <div className="text-sm text-red-700 mb-3">Error: {error}</div>}

        <div className="space-y-1.5">
          {filtered.map((it) => (
            <ItemRow key={`${it.site}-${it.type}-${it.id}`} item={it} />
          ))}
          {!loading && filtered.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-8">No outbound communications in the selected window.</div>
          )}
          {loading && !data && <div className="text-sm text-gray-500">Loading…</div>}
        </div>
      </div>
    </div>
  );
}
