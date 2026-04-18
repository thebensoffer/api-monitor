import { NextRequest, NextResponse } from 'next/server';
import tls from 'node:tls';
import dns from 'node:dns/promises';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CertInfo {
  host: string;
  ok: boolean;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysUntilExpiry: number | null;
  signatureAlgorithm: string | null;
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

function checkCert(host: string, port = 443, timeoutMs = 5000): Promise<CertInfo> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate(true);
        const protocol = socket.getProtocol();
        socket.end();
        if (!cert || Object.keys(cert).length === 0) {
          resolve({
            host,
            ok: false,
            subject: null,
            issuer: null,
            validFrom: null,
            validTo: null,
            daysUntilExpiry: null,
            signatureAlgorithm: null,
            protocol,
            error: 'No certificate presented',
          });
          return;
        }
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const days = validTo
          ? Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null;
        resolve({
          host,
          ok: true,
          subject: cert.subject?.CN || JSON.stringify(cert.subject ?? null),
          issuer: cert.issuer?.CN || JSON.stringify(cert.issuer ?? null),
          validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
          validTo: validTo ? validTo.toISOString() : null,
          daysUntilExpiry: days,
          signatureAlgorithm: (cert as any).asn1Curve || (cert as any).pubkey?.toString('hex')?.slice(0, 12) || null,
          protocol,
          error: null,
        });
      }
    );
    socket.on('error', (err) => {
      resolve({
        host, ok: false, subject: null, issuer: null, validFrom: null, validTo: null,
        daysUntilExpiry: null, signatureAlgorithm: null, protocol: null,
        error: err.message,
      });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        host, ok: false, subject: null, issuer: null, validFrom: null, validTo: null,
        daysUntilExpiry: null, signatureAlgorithm: null, protocol: null,
        error: 'TLS handshake timeout',
      });
    });
  });
}

async function checkDns(host: string): Promise<DnsInfo> {
  const t0 = Date.now();
  const result: DnsInfo = {
    host,
    a: [], aaaa: [], cname: [], mx: [], ns: [], txt: [],
    resolveMs: 0,
    error: null,
  };
  try {
    const [a, aaaa, cname, mx, ns, txt] = await Promise.allSettled([
      dns.resolve4(host),
      dns.resolve6(host),
      dns.resolveCname(host),
      dns.resolveMx(host),
      dns.resolveNs(host),
      dns.resolveTxt(host),
    ]);
    if (a.status === 'fulfilled') result.a = a.value;
    if (aaaa.status === 'fulfilled') result.aaaa = aaaa.value;
    if (cname.status === 'fulfilled') result.cname = cname.value;
    if (mx.status === 'fulfilled') result.mx = mx.value;
    if (ns.status === 'fulfilled') result.ns = ns.value;
    if (txt.status === 'fulfilled') result.txt = txt.value.flat();
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'DNS error';
  }
  result.resolveMs = Date.now() - t0;
  return result;
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hosts = ['tovanihealth.com', 'discreetketamine.com', 'drbensoffer.com'];

  const results = await Promise.all(
    hosts.map(async (h) => {
      const [cert, ddns] = await Promise.all([checkCert(h), checkDns(h)]);
      return { host: h, cert, dns: ddns };
    })
  );

  const expiring = results.filter((r) => (r.cert.daysUntilExpiry ?? Infinity) < 30);
  const expired = results.filter((r) => (r.cert.daysUntilExpiry ?? Infinity) < 0);
  const dnsFailed = results.filter((r) => r.dns.error || r.dns.a.length === 0);

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    summary: {
      hostsChecked: results.length,
      expired: expired.length,
      expiringSoon: expiring.length,
      dnsIssues: dnsFailed.length,
    },
    results,
  });
}
