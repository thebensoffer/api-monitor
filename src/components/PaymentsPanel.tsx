'use client';

import { useEffect, useState, useMemo } from 'react';

interface Charge {
  type: 'charge';
  id: string;
  paymentIntentId: string | null;
  amount: number;
  amountRefunded: number;
  currency: string;
  status: string;
  outcome?: string | null;
  outcomeReason?: string | null;
  outcomeMessage?: string | null;
  billingEmail?: string | null;
  billingName?: string | null;
  last4?: string | null;
  cardBrand?: string | null;
  receiptUrl?: string | null;
  refunded: boolean;
  disputed: boolean;
  livemode: boolean;
  state?: string | null;
  createdAt: string;
  _site: string;
  _siteLabel: string;
}

interface Refund {
  type: 'refund';
  id: string;
  chargeId: string | null;
  paymentIntentId: string | null;
  amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  state?: string | null;
  createdAt: string;
  _site: string;
  _siteLabel: string;
}

interface PaymentsData {
  generatedAt: string;
  since: string;
  summary: {
    orders: number;
    charges: number;
    refunds: number;
    failures: number;
    revenueCents: number;
    bySite: { site: string; label: string; orders: number; charges: number; refunds: number; error: string | null }[];
  };
  orders: any[];
  charges: Charge[];
  refunds: Refund[];
  failures: Charge[];
}

const apiKey = () => process.env.NEXT_PUBLIC_MONITOR_API_KEY || '';

const siteAccents: Record<string, string> = {
  dk: 'border-emerald-500 bg-emerald-50 text-emerald-800',
  dbs: 'border-amber-500 bg-amber-50 text-amber-800',
  tovani: 'border-indigo-500 bg-indigo-50 text-indigo-800',
};

function dollars(cents: number, currency = 'usd') {
  return `${currency === 'usd' ? '$' : currency.toUpperCase() + ' '}${(cents / 100).toFixed(2)}`;
}

function StatusBadge({ status, outcome, refunded, disputed }: { status: string; outcome?: string | null; refunded?: boolean; disputed?: boolean }) {
  let tone = 'bg-gray-100 text-gray-700';
  let label = status;
  if (disputed) { tone = 'bg-red-100 text-red-800'; label = 'DISPUTED'; }
  else if (refunded) { tone = 'bg-purple-100 text-purple-800'; label = 'REFUNDED'; }
  else if (status === 'succeeded') { tone = 'bg-green-100 text-green-800'; label = 'paid'; }
  else if (status === 'failed') { tone = 'bg-red-100 text-red-800'; label = 'FAILED'; }
  else if (status === 'pending') { tone = 'bg-yellow-100 text-yellow-800'; label = 'pending'; }
  return <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full uppercase ${tone}`}>{label}</span>;
}

function RefundDialog({
  charge,
  actor,
  onClose,
  onSuccess,
}: {
  charge: Charge;
  actor: string;
  onClose: () => void;
  onSuccess: (refund: any) => void;
}) {
  const refundable = charge.amount - charge.amountRefunded;
  const [amountStr, setAmountStr] = useState(String(refundable / 100));
  const [reason, setReason] = useState('requested_by_customer');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setRunning(true);
    setError(null);
    try {
      const cents = Math.round(parseFloat(amountStr) * 100);
      if (!cents || cents <= 0 || cents > refundable) {
        throw new Error(`Amount must be 0–${dollars(refundable)}`);
      }
      const r = await fetch('/api/payments/refund', {
        method: 'POST',
        headers: { 'x-monitor-key': apiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site: charge._site,
          paymentIntentId: charge.paymentIntentId,
          amount: cents,
          reason,
          state: charge.state,
          actor,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || j.detail || `HTTP ${r.status}`);
      onSuccess(j.refund);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-1">Refund charge</h3>
        <p className="text-sm text-gray-500 mb-4">
          {charge._siteLabel} · {charge.billingEmail || charge.billingName || charge.id}
        </p>
        <div className="space-y-3 text-sm">
          <div className="bg-gray-50 p-3 rounded">
            <div className="flex justify-between"><span>Original</span><strong>{dollars(charge.amount)}</strong></div>
            <div className="flex justify-between"><span>Already refunded</span><strong>{dollars(charge.amountRefunded)}</strong></div>
            <div className="flex justify-between text-red-700"><span>Available to refund</span><strong>{dollars(refundable)}</strong></div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Refund amount (USD)</label>
            <input
              type="number"
              step="0.01"
              max={refundable / 100}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="requested_by_customer">requested by customer</option>
              <option value="duplicate">duplicate charge</option>
              <option value="fraudulent">fraudulent</option>
            </select>
          </div>
          {error && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={running}
              className="flex-1 px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {running ? 'Refunding…' : `Refund ${dollars(Math.round((parseFloat(amountStr) || 0) * 100))}`}
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Logged to audit trail as actor=<code>{actor}</code>. This is irreversible.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChargeRow({ charge, onRefund }: { charge: Charge; onRefund: (c: Charge) => void }) {
  const [open, setOpen] = useState(false);
  const refundable = charge.amount - charge.amountRefunded;
  const isFailure = charge.status === 'failed' || charge.outcome === 'issuer_declined' || charge.outcome === 'blocked';

  return (
    <div className={`border ${isFailure ? 'border-red-300' : 'border-gray-200'} rounded-lg overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-gray-400 text-xs font-mono w-3">{open ? '▼' : '▶'}</span>
          <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border-l-4 ${siteAccents[charge._site] || 'bg-gray-50 border-gray-300'}`}>
            {charge._site.toUpperCase()}{charge.state ? `:${charge.state}` : ''}
          </span>
          <span className="font-mono text-sm font-semibold w-20">{dollars(charge.amount, charge.currency)}</span>
          <span className="text-sm text-gray-700 truncate min-w-0 flex-1">
            {charge.billingEmail || charge.billingName || charge.id}
            {charge.cardBrand && <span className="text-gray-400 ml-2">· {charge.cardBrand} ····{charge.last4}</span>}
          </span>
          <StatusBadge status={charge.status} outcome={charge.outcome} refunded={charge.refunded} disputed={charge.disputed} />
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
          {!charge.livemode && <span className="text-orange-600 font-medium">TEST</span>}
          <span>{new Date(charge.createdAt).toLocaleString()}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 py-3 bg-white text-xs space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><div className="text-gray-500 uppercase font-medium">Charge ID</div><code className="text-[11px]">{charge.id}</code></div>
            <div><div className="text-gray-500 uppercase font-medium">Payment Intent</div><code className="text-[11px]">{charge.paymentIntentId || '—'}</code></div>
            <div><div className="text-gray-500 uppercase font-medium">Status</div>{charge.status}</div>
            <div><div className="text-gray-500 uppercase font-medium">Outcome</div>{charge.outcome || '—'}</div>
            <div><div className="text-gray-500 uppercase font-medium">Reason</div>{charge.outcomeReason || '—'}</div>
            <div><div className="text-gray-500 uppercase font-medium">Already refunded</div>{dollars(charge.amountRefunded)}</div>
          </div>
          {charge.outcomeMessage && (
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500 uppercase font-medium mb-1">Stripe message</div>
              <div>{charge.outcomeMessage}</div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            {charge.receiptUrl && (
              <a href={charge.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">📄 Receipt</a>
            )}
            {charge.paymentIntentId && refundable > 0 && (
              <button
                type="button"
                onClick={() => onRefund(charge)}
                className="ml-auto px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
              >
                ↩ Refund {dollars(refundable)}
              </button>
            )}
            {refundable === 0 && charge.amount > 0 && (
              <span className="ml-auto text-xs text-gray-400">fully refunded</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PaymentsPanel() {
  const [data, setData] = useState<PaymentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundCharge, setRefundCharge] = useState<Charge | null>(null);
  const [filterSite, setFilterSite] = useState<'all' | string>('all');
  const [filterView, setFilterView] = useState<'all' | 'failures' | 'refunds'>('all');
  const [hours, setHours] = useState(168);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/payments?hours=${hours}&limit=100`, {
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

  const items: Charge[] = useMemo(() => {
    if (!data) return [];
    let list: Charge[] = filterView === 'failures' ? data.failures : data.charges;
    if (filterSite !== 'all') list = list.filter((c) => c._site === filterSite);
    if (filterView === 'refunds') {
      // Show only charges that have been refunded (including partial)
      list = data.charges.filter((c) => c.amountRefunded > 0);
    }
    return list;
  }, [data, filterSite, filterView]);

  return (
    <div className="space-y-4">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">💳 Payments</h2>
            <p className="text-sm text-gray-500">
              Live Stripe + DB orders across all 3 sites. Drill any charge for details · click refund to act.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <select value={hours} onChange={(e) => setHours(parseInt(e.target.value, 10))} className="text-xs border border-gray-300 rounded px-2 py-1">
              <option value={24}>last 24h</option>
              <option value={72}>last 3d</option>
              <option value={168}>last 7d</option>
              <option value={720}>last 30d</option>
            </select>
            <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="border-l-4 border-green-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Net Revenue</div>
              <div className="text-2xl font-bold text-green-700">{dollars(data.summary.revenueCents)}</div>
            </div>
            <div className="border-l-4 border-blue-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Charges</div>
              <div className="text-2xl font-bold">{data.summary.charges}</div>
            </div>
            <div className="border-l-4 border-purple-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Orders</div>
              <div className="text-2xl font-bold">{data.summary.orders}</div>
            </div>
            <div className="border-l-4 border-amber-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Refunds</div>
              <div className="text-2xl font-bold text-amber-700">{data.summary.refunds}</div>
            </div>
            <div className="border-l-4 border-red-500 pl-3">
              <div className="text-xs text-gray-500 uppercase">Failures</div>
              <div className="text-2xl font-bold text-red-700">{data.summary.failures}</div>
            </div>
          </div>
        )}

        {data && (
          <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
            {data.summary.bySite.map((s) => (
              <div key={s.site} className={`border-l-4 pl-2 py-1 ${siteAccents[s.site]?.split(' ')[0] || ''}`}>
                <div className="text-gray-500 uppercase">{s.label}</div>
                <div className="font-semibold">{s.charges} charges · {s.refunds} refunds</div>
                {s.error && <div className="text-red-700 text-[10px]">{s.error}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-gray-500">View:</span>
          <select value={filterView} onChange={(e) => setFilterView(e.target.value as any)} className="border border-gray-300 rounded px-2 py-1">
            <option value="all">all charges</option>
            <option value="failures">failures only</option>
            <option value="refunds">refunded only</option>
          </select>
          <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)} className="border border-gray-300 rounded px-2 py-1">
            <option value="all">all sites</option>
            <option value="dk">DK only</option>
            <option value="dbs">DBS only</option>
            <option value="tovani">Tovani only</option>
          </select>
          <span className="text-gray-400 ml-auto">
            showing {items.length} {filterView}
          </span>
        </div>

        {error && <div className="text-sm text-red-700 mb-3">Error: {error}</div>}

        <div className="space-y-1.5">
          {items.map((c) => (
            <ChargeRow key={`${c._site}-${c.id}`} charge={c} onRefund={(ch) => setRefundCharge(ch)} />
          ))}
          {!loading && items.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-8">No charges in this window.</div>
          )}
        </div>
      </div>

      {refundCharge && (
        <RefundDialog
          charge={refundCharge}
          actor="ben"
          onClose={() => setRefundCharge(null)}
          onSuccess={() => {
            setRefundCharge(null);
            load();
          }}
        />
      )}
    </div>
  );
}
