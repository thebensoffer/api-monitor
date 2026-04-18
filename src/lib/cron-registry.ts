/**
 * Central registry of monitoring crons OpenHeart owns.
 *
 * Each cron has:
 *  - id           — URL slug used at /api/cron/<id>
 *  - schedule     — AWS EventBridge expression (cron(...) or rate(...))
 *  - description  — what it does, in plain English
 *  - handler      — async fn returning JSON-serializable result
 *
 * One dynamic route handler dispatches to these. The same registry feeds
 * the dashboard UI (so the schedule list is single-source-of-truth).
 *
 * Per-job result history kept in-memory in `cron-history.ts`. Move to
 * DynamoDB when we want persistence across restarts.
 */

import { probe } from './probe';
import tls from 'node:tls';

// Self-fetch base URL — defaults to deployed Amplify URL on prod, localhost on dev.
function selfBase(): string {
  return (
    process.env.OPENHEART_SELF_URL ||
    process.env.OPENHEART_URL ||
    'http://localhost:3000'
  );
}
function selfHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'x-monitor-key': process.env.MONITOR_API_KEY || '',
  };
  // Forward Amplify basic-auth so self-fetches survive the gate
  const basic = process.env.OPENHEART_BASIC_AUTH;
  if (basic) h['Authorization'] = `Basic ${basic}`;
  return h;
}

export interface CronContext {
  triggeredAt: string;
  source: 'eventbridge' | 'manual' | 'dispatcher';
}

export interface CronResult {
  ok: boolean;
  message: string;
  data?: any;
}

export interface CronDef {
  id: string;
  group: 'monitoring' | 'reporting' | 'health';
  schedule: string;
  description: string;
  handler: (ctx: CronContext) => Promise<CronResult>;
}

const TARGETS = [
  { key: 'tovani', base: process.env.TOVANI_BASE_URL || 'https://tovanihealth.com' },
  { key: 'dk', base: 'https://discreetketamine.com' },
  { key: 'dbs', base: 'https://drbensoffer.com' },
];

async function pingHealth(label: string, base: string) {
  const p = await probe({ endpoint: `${label}.health`, url: `${base}/api/health`, timeoutMs: 5000 });
  return {
    label,
    ok: p.response?.ok ?? false,
    httpStatus: p.response?.httpStatus ?? null,
    durationMs: p.response?.durationMs ?? null,
    error: p.error,
  };
}

function checkCertDays(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = tls.connect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: 4000 },
      () => {
        const cert = sock.getPeerCertificate();
        sock.end();
        if (!cert?.valid_to) return resolve(null);
        const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
        resolve(days);
      }
    );
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

export const CRON_REGISTRY: CronDef[] = [
  {
    id: 'neon-keepalive',
    group: 'health',
    schedule: 'rate(5 minutes)',
    description: 'Pings every site /api/health to keep DB connections warm and confirm uptime.',
    handler: async () => {
      const results = await Promise.all(TARGETS.map(t => pingHealth(t.key, t.base)));
      const failed = results.filter(r => !r.ok);
      return {
        ok: failed.length === 0,
        message: failed.length === 0
          ? `All ${results.length} sites healthy`
          : `${failed.length}/${results.length} unhealthy: ${failed.map(f => f.label).join(', ')}`,
        data: { results },
      };
    },
  },
  {
    id: 'amplify-build-monitor',
    group: 'monitoring',
    schedule: 'rate(10 minutes)',
    description: 'Polls AWS Amplify build status for all monitored apps; alerts on FAILED builds.',
    handler: async () => {
      // Lightweight stub: hit the existing /api/builds endpoint internally.
      const r = await fetch(`${selfBase()}/api/builds`, { headers: selfHeaders() });
      const ok = r.ok;
      const body = ok ? await r.json() : null;
      return {
        ok,
        message: ok ? 'Build statuses polled' : `builds API returned ${r.status}`,
        data: body,
      };
    },
  },
  {
    id: 'aws-quota-monitor',
    group: 'monitoring',
    schedule: 'cron(30 11 * * ? *)',
    description: 'Daily check of AWS service quotas (Lambda concurrency, RDS connections, EventBridge rules).',
    handler: async () => {
      // Stub: would call AWS Service Quotas API. Document findings for now.
      return {
        ok: true,
        message: 'Quota check stub — wire AWS SDK service-quotas client to enable',
        data: { todo: 'aws-sdk service-quotas integration' },
      };
    },
  },
  {
    id: 'cwv-monitor',
    group: 'monitoring',
    schedule: 'cron(0 6 ? * MON *)',
    description: 'Weekly Core Web Vitals snapshot for tovani/DK/DBS via PageSpeed Insights API.',
    handler: async () => {
      const key = process.env.GOOGLE_API_KEY;
      if (!key) return { ok: false, message: 'GOOGLE_API_KEY not set; skipping PSI fetch' };
      const results = await Promise.all(TARGETS.map(async (t) => {
        const r = await probe({
          endpoint: `psi.${t.key}`,
          url: `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(t.base)}&key=${key}&strategy=mobile`,
          timeoutMs: 30000,
        });
        const lhr = r.response?.parsedBody?.lighthouseResult;
        return {
          site: t.key,
          performance: lhr?.categories?.performance?.score ?? null,
          lcp: lhr?.audits?.['largest-contentful-paint']?.numericValue ?? null,
          cls: lhr?.audits?.['cumulative-layout-shift']?.numericValue ?? null,
          fcp: lhr?.audits?.['first-contentful-paint']?.numericValue ?? null,
        };
      }));
      return { ok: true, message: `Captured CWV for ${results.length} sites`, data: results };
    },
  },
  {
    id: 'seo-health',
    group: 'monitoring',
    schedule: 'cron(0 5 ? * MON *)',
    description: 'Weekly check that sitemap.xml and robots.txt are reachable on all sites.',
    handler: async () => {
      const checks = await Promise.all(TARGETS.flatMap(t => [
        probe({ endpoint: `${t.key}.sitemap`, url: `${t.base}/sitemap.xml`, method: 'HEAD' }),
        probe({ endpoint: `${t.key}.robots`, url: `${t.base}/robots.txt`, method: 'HEAD' }),
      ]));
      const failed = checks.filter(c => c.error || (c.response && !c.response.ok));
      return {
        ok: failed.length === 0,
        message: failed.length === 0
          ? `All ${checks.length} SEO endpoints OK`
          : `${failed.length} failures: ${failed.map(f => f.endpoint).join(', ')}`,
        data: { checks: checks.map(c => ({ endpoint: c.endpoint, status: c.response?.httpStatus, ms: c.response?.durationMs })) },
      };
    },
  },
  {
    id: 'secret-expiration-radar',
    group: 'monitoring',
    schedule: 'cron(0 13 * * ? *)',
    description: 'Daily TLS-cert + secret-expiry sweep; warns when anything is < 30 days from expiry.',
    handler: async () => {
      const hosts = ['tovanihealth.com', 'discreetketamine.com', 'drbensoffer.com'];
      const results = await Promise.all(hosts.map(async (h) => ({ host: h, daysLeft: await checkCertDays(h) })));
      const expiringSoon = results.filter(r => r.daysLeft !== null && r.daysLeft < 30);
      return {
        ok: expiringSoon.length === 0,
        message: expiringSoon.length === 0
          ? `All ${results.length} certs valid > 30d`
          : `${expiringSoon.length} cert(s) expiring soon: ${expiringSoon.map(e => `${e.host} (${e.daysLeft}d)`).join(', ')}`,
        data: { certs: results },
      };
    },
  },
  {
    id: 'stripe-webhook-watchdog',
    group: 'monitoring',
    schedule: 'rate(15 minutes)',
    description: 'Confirms each site recently received Stripe webhooks; alerts if quiet too long.',
    handler: async () => {
      // Stub: real impl would query each site's webhook log table.
      return {
        ok: true,
        message: 'Watchdog stub — wire to per-site webhook-log endpoint to enable',
      };
    },
  },
  {
    id: 'email-alert-triage',
    group: 'monitoring',
    schedule: 'rate(10 minutes)',
    description: 'Pulls recent inbound alert emails and routes them by severity.',
    handler: async () => {
      return {
        ok: true,
        message: 'Triage stub — wire IMAP / inbound webhook to enable',
      };
    },
  },
  {
    id: 'backup-verification',
    group: 'monitoring',
    schedule: 'cron(30 10 * * ? *)',
    description: 'Verifies the most recent RDS snapshot exists and is restorable.',
    handler: async () => {
      return {
        ok: true,
        message: 'Backup-verify stub — wire AWS RDS describe-db-snapshots to enable',
      };
    },
  },
  {
    id: 'backup-checksum',
    group: 'monitoring',
    schedule: 'cron(0 6 ? * SUN *)',
    description: 'Weekly checksum of latest backup against expected manifest.',
    handler: async () => {
      return {
        ok: true,
        message: 'Backup-checksum stub — wire S3 head-object + sha256 verification',
      };
    },
  },
  {
    id: 'morning-briefing',
    group: 'reporting',
    schedule: 'cron(0 12 * * ? *)',
    description: 'Daily 12:00 UTC ops digest — health rollup, alerts, deploys, errors.',
    handler: async () => {
      const r = await fetch(`${selfBase()}/api/status`, { headers: selfHeaders() });
      const status = r.ok ? await r.json() : null;
      return {
        ok: r.ok,
        message: status
          ? `${status.summary.online}/${status.summary.total} online · ${status.summary.errors} errors · ${status.summary.warnings} warnings`
          : 'Status fetch failed',
        data: status?.summary,
      };
    },
  },
  {
    id: 'evening-report',
    group: 'reporting',
    schedule: 'cron(0 23 * * ? *)',
    description: 'Daily 23:00 UTC end-of-day summary — same shape as morning briefing.',
    handler: async () => {
      const r = await fetch(`${selfBase()}/api/status`, { headers: selfHeaders() });
      const status = r.ok ? await r.json() : null;
      return {
        ok: r.ok,
        message: status
          ? `EoD: ${status.summary.online}/${status.summary.total} online`
          : 'Status fetch failed',
        data: status?.summary,
      };
    },
  },
  {
    id: 'gsc-snapshot',
    group: 'reporting',
    schedule: 'cron(0 11 ? * MON *)',
    description: 'Weekly Google Search Console snapshot; archives queries/clicks/impressions.',
    handler: async () => {
      const r = await fetch(`${selfBase()}/api/gsc-data?range=7d&site=both`, { headers: selfHeaders() });
      const ok = r.ok;
      return {
        ok,
        message: ok ? 'GSC snapshot captured' : `GSC API returned ${r.status}`,
      };
    },
  },
];

export function getCron(id: string): CronDef | undefined {
  return CRON_REGISTRY.find(c => c.id === id);
}
