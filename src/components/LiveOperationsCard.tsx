'use client';

import { useEffect, useState } from 'react';

interface VisitorsData {
  active_now: number;
  active_dk: number;
  active_dbs: number;
  last_24h: { dk: any; dbs: any; total_sessions: number };
  live_activity: any[];
}

interface SentryData {
  totalIssues?: number;
  unresolvedIssues?: number;
  criticalIssues?: number;
  resolvedToday?: number;
  errorFreeRate?: number;
}

interface BuildsData {
  summary: {
    apps: number;
    latestStatuses: { SUCCEED: number; FAILED: number; RUNNING: number; OTHER: number };
  };
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

function MetricBlock({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone: 'blue' | 'green' | 'red' | 'amber' | 'gray';
}) {
  const tones: Record<string, string> = {
    blue: 'border-blue-500 bg-blue-50 text-blue-700',
    green: 'border-green-500 bg-green-50 text-green-700',
    red: 'border-red-500 bg-red-50 text-red-700',
    amber: 'border-amber-500 bg-amber-50 text-amber-700',
    gray: 'border-gray-400 bg-gray-50 text-gray-700',
  };
  return (
    <div className={`border-l-4 pl-3 py-1 ${tones[tone]}`}>
      <div className="text-xs uppercase font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-70">{sub}</div>}
    </div>
  );
}

export function LiveOperationsCard() {
  const [visitors, setVisitors] = useState<{ data: VisitorsData; error?: string } | null>(null);
  const [builds, setBuilds] = useState<{ data: BuildsData; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [vRes, bRes] = await Promise.all([
        fetch('/api/visitors', { headers: { 'x-monitor-key': apiKey() }, cache: 'no-store' }),
        fetch('/api/builds', { headers: { 'x-monitor-key': apiKey() }, cache: 'no-store' }),
      ]);
      const v = await vRes.json();
      const b = await bRes.json();
      setVisitors(v.success ? { data: v.data } : { data: null as any, error: v.error || v.hint || 'unavailable' });
      setBuilds(b.success ? { data: b } : { data: null as any, error: b.error || b.hint || 'unavailable' });
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
        <h4 className="text-lg font-semibold text-gray-900">📡 Live Operations</h4>
        <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          live
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* GA4 Realtime active users */}
        {visitors?.data ? (
          <>
            <MetricBlock
              label="Active right now"
              value={visitors.data.active_now}
              sub={`DK ${visitors.data.active_dk} · DBS ${visitors.data.active_dbs}`}
              tone="green"
            />
            <MetricBlock
              label="Sessions (24h)"
              value={visitors.data.last_24h.total_sessions}
              sub={`DK ${visitors.data.last_24h.dk?.sessions ?? 0} · DBS ${visitors.data.last_24h.dbs?.sessions ?? 0}`}
              tone="blue"
            />
          </>
        ) : (
          <div className="col-span-2 text-xs text-gray-500 border-l-4 border-gray-300 pl-3">
            Visitors: {visitors?.error || (loading ? 'loading…' : 'unavailable')}
          </div>
        )}

        {/* Amplify build statuses */}
        {builds?.data ? (
          <>
            <MetricBlock
              label="Apps (Amplify)"
              value={builds.data.summary.apps}
              sub={`✓ ${builds.data.summary.latestStatuses.SUCCEED} · ✗ ${builds.data.summary.latestStatuses.FAILED}`}
              tone="blue"
            />
            <MetricBlock
              label="Building now"
              value={builds.data.summary.latestStatuses.RUNNING}
              sub={builds.data.summary.latestStatuses.RUNNING > 0 ? 'in flight' : 'idle'}
              tone={builds.data.summary.latestStatuses.RUNNING > 0 ? 'amber' : 'gray'}
            />
          </>
        ) : (
          <div className="col-span-2 text-xs text-gray-500 border-l-4 border-gray-300 pl-3">
            Builds: {builds?.error || (loading ? 'loading…' : 'unavailable')}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-4">
        Visitors via GA4 Realtime · Builds via AWS Amplify · auto-refreshes every 60s
      </p>
    </div>
  );
}
