import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SITES = [
  { key: 'tovani', label: 'Tovani Health', base: process.env.TOVANI_BASE_URL || 'https://tovanihealth.com', apiKey: process.env.TOVANI_KHAI_API_KEY || '' },
  { key: 'dk', label: 'Discreet Ketamine', base: 'https://discreetketamine.com', apiKey: process.env.DK_API_KEY || '' },
  { key: 'dbs', label: 'Dr Ben Soffer', base: 'https://drbensoffer.com', apiKey: process.env.DBS_API_KEY || '' },
];

async function fetchSite(site: typeof SITES[0], since: string, limit: number) {
  if (!site.apiKey) {
    return { site: site.key, label: site.label, error: `No API key`, orders: [], charges: [], refunds: [] };
  }
  try {
    const url = `${site.base}/api/khai/payments?since=${encodeURIComponent(since)}&limit=${limit}`;
    const r = await fetch(url, {
      headers: { 'x-khai-api-key': site.apiKey },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!r.ok) {
      return { site: site.key, label: site.label, error: `HTTP ${r.status}`, orders: [], charges: [], refunds: [] };
    }
    const j = await r.json();
    const orders = (j.orders ?? []).map((o: any) => ({ ...o, _site: site.key, _siteLabel: site.label }));
    const charges = (j.charges ?? []).map((c: any) => ({ ...c, _site: site.key, _siteLabel: site.label }));
    const refunds = (j.refunds ?? []).map((r: any) => ({ ...r, _site: site.key, _siteLabel: site.label }));
    return { site: site.key, label: site.label, error: null, orders, charges, refunds };
  } catch (err) {
    return { site: site.key, label: site.label, error: err instanceof Error ? err.message : 'fetch failed', orders: [], charges: [], refunds: [] };
  }
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const hours = Math.max(1, parseInt(searchParams.get('hours') || '168', 10));
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const results = await Promise.all(SITES.map((s) => fetchSite(s, since, limit)));

  const allOrders = results.flatMap((r) => r.orders);

  // DK + Tovani share the same Stripe account → both endpoints return the
  // SAME charges, just labeled differently. Build paymentIntentId → site
  // attribution from the Order tables (each Order knows its true owner)
  // and dedupe by charge id.
  const piToSite: Record<string, { site: string; label: string }> = {};
  for (const o of allOrders) {
    if (o.stripePaymentIntentId) {
      piToSite[o.stripePaymentIntentId] = { site: o._site, label: o._siteLabel };
    }
  }

  const dedupCharges: Record<string, any> = {};
  for (const r of results) {
    for (const c of r.charges) {
      if (!c.id) continue;
      // Use existing entry's attribution if we've already seen this charge id
      const existing = dedupCharges[c.id];
      const truthAttr = c.paymentIntentId ? piToSite[c.paymentIntentId] : null;
      const finalAttr = truthAttr || existing || { site: c._site, label: c._siteLabel };
      dedupCharges[c.id] = { ...c, _site: finalAttr.site, _siteLabel: finalAttr.label };
    }
  }
  const allCharges = Object.values(dedupCharges);

  // Same dedup for refunds (they reference paymentIntentId too)
  const dedupRefunds: Record<string, any> = {};
  for (const r of results) {
    for (const refund of r.refunds) {
      if (!refund.id) continue;
      const existing = dedupRefunds[refund.id];
      const truthAttr = refund.paymentIntentId ? piToSite[refund.paymentIntentId] : null;
      const finalAttr = truthAttr || existing || { site: refund._site, label: refund._siteLabel };
      dedupRefunds[refund.id] = { ...refund, _site: finalAttr.site, _siteLabel: finalAttr.label };
    }
  }
  const allRefunds = Object.values(dedupRefunds);

  // Highlight failures: charges with status=failed or outcome=blocked, plus disputed
  const failures = allCharges.filter((c: any) =>
    c.status === 'failed' ||
    c.outcome === 'issuer_declined' ||
    c.outcome === 'blocked' ||
    c.disputed === true
  );

  // Total revenue (succeeded charges - refunds)
  const totalRevenueCents = allCharges
    .filter((c: any) => c.status === 'succeeded')
    .reduce((s: number, c: any) => s + (c.amount - (c.amountRefunded || 0)), 0);

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    since,
    summary: {
      orders: allOrders.length,
      charges: allCharges.length,
      refunds: allRefunds.length,
      failures: failures.length,
      revenueCents: totalRevenueCents,
      bySite: results.map((r) => ({
        site: r.site,
        label: r.label,
        orders: r.orders.length, // orders are still per-site (DB-sourced)
        charges: allCharges.filter((c: any) => c._site === r.site).length, // attributed by paymentIntentId match
        refunds: allRefunds.filter((rf: any) => rf._site === r.site).length,
        chargesUnattributed: allCharges.filter((c: any) => c._site === r.site && !c.paymentIntentId).length,
        error: r.error,
      })),
    },
    orders: allOrders,
    charges: allCharges,
    refunds: allRefunds,
    failures,
  });
}
