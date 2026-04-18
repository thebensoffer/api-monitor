'use client';

import { useEffect, useState } from 'react';

interface CertInfo {
  host: string;
  ok: boolean;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysUntilExpiry: number | null;
  protocol: string | null;
  error: string | null;
}

interface DnsInfo {
  host: string;
  a: string[];
  aaaa: string[];
  cname: string[];
  mx: { exchange: string; priority: number }[];
  ns: string[];
  txt: string[];
  resolveMs: number;
  error: string | null;
}

interface NetworkData {
  generatedAt: string;
  summary: { hostsChecked: number; expired: number; expiringSoon: number; dnsIssues: number };
  results: { host: string; cert: CertInfo; dns: DnsInfo }[];
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

function CertBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">unknown</span>;
  if (days < 0) return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800">EXPIRED</span>;
  if (days < 14) return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800">{days}d</span>;
  if (days < 30) return <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-800">{days}d</span>;
  return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800">{days}d</span>;
}

export function NetworkChecksPanel() {
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/network-checks', {
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
    const i = setInterval(load, 5 * 60 * 1000); // every 5 min — certs don't move fast
    return () => clearInterval(i);
  }, []);

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">🔐 TLS Certificates &amp; DNS</h2>
          <p className="text-sm text-gray-500">
            Live certificate expiry and authoritative DNS lookups for all monitored domains.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Checking…' : '↻ Recheck'}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="border-l-4 border-blue-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Hosts</div>
            <div className="text-2xl font-semibold">{data.summary.hostsChecked}</div>
          </div>
          <div className="border-l-4 border-red-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Expired</div>
            <div className="text-2xl font-semibold text-red-700">{data.summary.expired}</div>
          </div>
          <div className="border-l-4 border-yellow-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">Expiring &lt; 30d</div>
            <div className="text-2xl font-semibold text-yellow-700">{data.summary.expiringSoon}</div>
          </div>
          <div className="border-l-4 border-purple-500 pl-3">
            <div className="text-xs text-gray-500 uppercase">DNS Issues</div>
            <div className="text-2xl font-semibold">{data.summary.dnsIssues}</div>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-700 mb-3">Error: {error}</div>}

      {data && (
        <div className="space-y-2">
          {data.results.map((r) => {
            const isOpen = expanded === r.host;
            return (
              <div key={r.host} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : r.host)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-gray-400 text-xs font-mono">{isOpen ? '▼' : '▶'}</span>
                    <span className="font-medium text-sm">{r.host}</span>
                    <CertBadge days={r.cert.daysUntilExpiry} />
                    <span className="text-xs font-mono text-gray-500">{r.cert.protocol || '—'}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-xs text-gray-600">
                    <span className="font-mono">{r.dns.a.length} A · {r.dns.aaaa.length} AAAA</span>
                    <span className="font-mono">DNS {r.dns.resolveMs}ms</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 py-3 bg-white text-xs space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="font-semibold text-gray-700 mb-1">Certificate</div>
                        <table className="w-full text-[11px]">
                          <tbody>
                            <tr><td className="text-gray-500 pr-3">Subject</td><td className="font-mono">{r.cert.subject || '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3">Issuer</td><td className="font-mono">{r.cert.issuer || '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3">Valid from</td><td className="font-mono">{r.cert.validFrom ? new Date(r.cert.validFrom).toLocaleString() : '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3">Valid to</td><td className="font-mono">{r.cert.validTo ? new Date(r.cert.validTo).toLocaleString() : '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3">Days left</td><td className="font-mono">{r.cert.daysUntilExpiry ?? '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3">TLS</td><td className="font-mono">{r.cert.protocol || '—'}</td></tr>
                          </tbody>
                        </table>
                        {r.cert.error && <div className="text-red-700 mt-1">Cert error: {r.cert.error}</div>}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-700 mb-1">DNS records</div>
                        <table className="w-full text-[11px]">
                          <tbody>
                            <tr><td className="text-gray-500 pr-3 align-top">A</td><td className="font-mono">{r.dns.a.join(', ') || '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3 align-top">AAAA</td><td className="font-mono">{r.dns.aaaa.join(', ') || '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3 align-top">CNAME</td><td className="font-mono">{r.dns.cname.join(', ') || '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3 align-top">MX</td><td className="font-mono">{r.dns.mx.map(m => `${m.priority} ${m.exchange}`).join(', ') || '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3 align-top">NS</td><td className="font-mono">{r.dns.ns.join(', ') || '—'}</td></tr>
                            <tr><td className="text-gray-500 pr-3 align-top">TXT</td><td className="font-mono break-all">{r.dns.txt.slice(0, 4).join(' | ') || '—'}</td></tr>
                          </tbody>
                        </table>
                        {r.dns.error && <div className="text-red-700 mt-1">DNS error: {r.dns.error}</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {loading && !data && <div className="text-gray-500 text-sm">Loading network checks…</div>}
    </div>
  );
}
