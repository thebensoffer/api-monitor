'use client';

import { useEffect, useState } from 'react';

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  level: string;
  isUnhandled: boolean;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  assignedTo: string | null;
}

interface ProjectData {
  slug: string;
  unresolvedCount: number;
  totalCount: number;
  topIssues: SentryIssue[];
  error?: string;
}

interface SentryData {
  range: string;
  summary: { totalUnresolved: number; totalEvents24h: number; peakHourCount: number; projectsWithErrors: number };
  projects: ProjectData[];
  trend: { ts: string; count: number }[];
  generatedAt: string;
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

const projectAccents: Record<string, { label: string; tone: string }> = {
  discreetketamine: { label: 'DK', tone: 'border-emerald-500 bg-emerald-50' },
  drbensoffer: { label: 'DBS', tone: 'border-amber-500 bg-amber-50' },
  beyondthederech: { label: 'BTD', tone: 'border-violet-500 bg-violet-50' },
};

function levelTone(level: string) {
  if (level === 'fatal' || level === 'error') return 'bg-red-100 text-red-800';
  if (level === 'warning') return 'bg-yellow-100 text-yellow-800';
  if (level === 'info') return 'bg-blue-100 text-blue-800';
  return 'bg-gray-100 text-gray-700';
}

function IssueRow({ issue }: { issue: SentryIssue }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left px-3 py-2 hover:bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-xs font-mono w-3">{open ? '▼' : '▶'}</span>
          <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${levelTone(issue.level)}`}>
            {issue.level}
          </span>
          {issue.isUnhandled && <span className="text-[10px] bg-red-200 text-red-900 px-1 rounded font-medium">UNHANDLED</span>}
          <span className="text-sm text-gray-900 flex-1 truncate">{issue.title}</span>
          <span className="text-xs text-gray-600">×{issue.count}</span>
          <span className="text-xs text-gray-600">{issue.userCount}u</span>
          <span className="text-xs text-gray-400">{new Date(issue.lastSeen).toLocaleString()}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 py-2 bg-gray-50 text-xs space-y-1">
          <div><span className="text-gray-500">Short ID</span> · <code>{issue.shortId}</code></div>
          {issue.culprit && <div><span className="text-gray-500">Culprit</span> · <code>{issue.culprit}</code></div>}
          <div><span className="text-gray-500">First seen</span> · {new Date(issue.firstSeen).toLocaleString()}</div>
          <div><span className="text-gray-500">Last seen</span> · {new Date(issue.lastSeen).toLocaleString()}</div>
          {issue.assignedTo && <div><span className="text-gray-500">Assigned</span> · {issue.assignedTo}</div>}
          <a href={issue.permalink} target="_blank" rel="noopener noreferrer" className="inline-block text-blue-600 hover:underline mt-1">
            Open in Sentry ↗
          </a>
        </div>
      )}
    </div>
  );
}

function TrendChart({ trend }: { trend: { ts: string; count: number }[] }) {
  if (trend.length === 0) return <div className="text-xs text-gray-500">No trend data</div>;
  const max = Math.max(1, ...trend.map((p) => p.count));
  return (
    <div className="flex items-end gap-0.5 h-20">
      {trend.map((p, i) => {
        const h = Math.max(2, (p.count / max) * 80);
        return (
          <div
            key={i}
            className="flex-1 bg-blue-500 hover:bg-blue-700 transition-colors rounded-t"
            style={{ height: `${h}px` }}
            title={`${new Date(p.ts).toLocaleString()}: ${p.count} events`}
          />
        );
      })}
    </div>
  );
}

export function SentryPanel() {
  const [data, setData] = useState<SentryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/sentry-deep?range=24h', { headers: { 'x-monitor-key': apiKey() }, cache: 'no-store' });
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
    <div className="space-y-4">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">🐛 Sentry Live</h2>
            <p className="text-sm text-gray-500">
              Real per-project unresolved issues + 24h event trend across DK / DBS / BTD.
              Click any issue to open in Sentry.
            </p>
          </div>
          <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? '…' : '↻'}
          </button>
        </div>

        {data && (
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="border-l-4 border-red-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Unresolved</div>
              <div className="text-2xl font-bold text-red-700">{data.summary.totalUnresolved}</div>
            </div>
            <div className="border-l-4 border-blue-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Events 24h</div>
              <div className="text-2xl font-bold">{data.summary.totalEvents24h.toLocaleString()}</div>
            </div>
            <div className="border-l-4 border-orange-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Peak hour</div>
              <div className="text-2xl font-bold">{data.summary.peakHourCount}</div>
            </div>
            <div className="border-l-4 border-purple-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Projects affected</div>
              <div className="text-2xl font-bold">{data.summary.projectsWithErrors}/{data.projects.length}</div>
            </div>
          </div>
        )}

        {data && data.trend.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-gray-500 uppercase mb-1">Event rate, last 24h</div>
            <TrendChart trend={data.trend} />
          </div>
        )}

        {error && <div className="text-sm text-red-700 mb-3">{error}</div>}

        {data && data.projects.map((p) => {
          const accent = projectAccents[p.slug] || { label: p.slug, tone: 'border-gray-400 bg-gray-50' };
          return (
            <div key={p.slug} className={`border-l-4 ${accent.tone} rounded-r p-4 mb-3`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">
                  <span className="text-xs uppercase font-mono mr-2">{accent.label}</span>
                  {p.slug}
                </h3>
                <div className="text-xs text-gray-600">
                  {p.unresolvedCount} unresolved · {p.totalCount} total
                </div>
              </div>
              {p.error && <div className="text-xs text-red-700">{p.error}</div>}
              <div className="space-y-1">
                {p.topIssues.length === 0 && !p.error && (
                  <div className="text-xs text-gray-500 italic">No unresolved issues 🎉</div>
                )}
                {p.topIssues.map((iss) => <IssueRow key={iss.id} issue={iss} />)}
              </div>
            </div>
          );
        })}
        {loading && !data && <div className="text-sm text-gray-500">Loading Sentry data…</div>}
      </div>
    </div>
  );
}
