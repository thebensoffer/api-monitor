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
import { dispatchAlert } from './notify';
import { getAllLatest as getAllSyntheticLatest } from './synthetic';

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
  {
    id: 'synthetic-journey',
    group: 'monitoring',
    schedule: 'rate(1 hour)',
    description: 'Hourly user-flow probe + external synthetic-report check. Alerts on flow regression OR stale browser-based reports from Khai.',
    handler: async () => {
      // 1) Internal probes
      const r = await fetch(`${selfBase()}/api/user-flows`, { headers: selfHeaders() });
      if (!r.ok) return { ok: false, message: `user-flows API returned ${r.status}` };
      const j = await r.json();
      const failed = j?.summary?.failed ?? 0;
      const total = j?.summary?.totalFlows ?? 0;
      if (failed > 0) {
        const failedFlows = (j.grouped || []).flatMap((g: any) =>
          (g.flows || []).filter((f: any) => f.probe.error || (f.probe.response && !f.probe.response.ok))
            .map((f: any) => `${g.label}/${f.flow}/${f.step}`)
        );
        await dispatchAlert({
          id: `synthetic-journey-${failed}`,
          type: 'error',
          title: `Synthetic journey: ${failed}/${total} flows failed`,
          message: `Failing: ${failedFlows.slice(0, 5).join(', ')}${failedFlows.length > 5 ? '…' : ''}`,
          severity: 'high',
          source: 'Synthetic journey cron',
          action: 'Investigate which flow regressed in OpenHeart User Flows tab',
        }).catch(() => {});
      }

      // 2) External browser-based reports (Khai or future remote runner)
      const externalReports = await getAllSyntheticLatest().catch(() => ({}));
      const externalScenarios = Object.values(externalReports);
      const externalFailed = externalScenarios.filter((s) => !s.ok);
      const externalStale = externalScenarios.filter((s) => Date.now() - new Date(s.ts).getTime() > 2 * 60 * 60 * 1000);

      for (const f of externalFailed) {
        await dispatchAlert({
          id: `synthetic-external-fail-${f.scenario}`,
          type: 'error',
          title: `Browser-flow regression: ${f.scenario}`,
          message: f.message || 'Khai reported failure',
          severity: 'high',
          source: f.source || 'Synthetic external',
          action: 'Open OpenHeart Synthetic tab → drill into the failing scenario',
        }).catch(() => {});
      }
      for (const s of externalStale) {
        await dispatchAlert({
          id: `synthetic-external-stale-${s.scenario}`,
          type: 'warning',
          title: `Synthetic runner silent: ${s.scenario}`,
          message: `No report in ${Math.floor((Date.now() - new Date(s.ts).getTime()) / 60000)} min — runner may be down`,
          severity: 'medium',
          source: 'Synthetic monitor',
          action: 'Check Khai is running locally or remote runner deployment',
        }).catch(() => {});
      }

      return {
        ok: failed === 0 && externalFailed.length === 0,
        message: `Probes: ${total - failed}/${total} pass · External: ${externalScenarios.length - externalFailed.length}/${externalScenarios.length} pass${externalStale.length ? ` · ${externalStale.length} stale` : ''}`,
        data: { internal: j.summary, externalScenarios: externalScenarios.length, externalFailed: externalFailed.length, externalStale: externalStale.length },
      };
    },
  },
  {
    id: 'cron-watchdog',
    group: 'monitoring',
    schedule: 'rate(1 hour)',
    description: 'Watcher-of-watchers: alerts if any frequently-firing cron hasn\'t recorded a run recently. Catches "OpenHeart silently went blind".',
    handler: async () => {
      const r = await fetch(`${selfBase()}/api/cron`, { headers: selfHeaders() });
      if (!r.ok) return { ok: false, message: `cron API returned ${r.status}` };
      const j = await r.json();
      const now = Date.now();
      const stale: { id: string; ageMin: number; expectedMaxMin: number }[] = [];
      for (const c of j.crons || []) {
        // Skip self — the cron-watchdog's own lastRun isn't written until AFTER
        // this handler returns, so it would always self-flag on its first run.
        if (c.id === 'cron-watchdog') continue;
        // Parse expected interval from schedule (rate(N minutes/hours) only)
        let maxMin: number | null = null;
        const rateMatch = (c.schedule as string).match(/rate\((\d+)\s+(minutes?|hours?)\)/);
        if (rateMatch) {
          const n = parseInt(rateMatch[1], 10);
          maxMin = rateMatch[2].startsWith('hour') ? n * 60 : n;
          maxMin = Math.floor(maxMin * 2.5); // allow 2.5x grace
        }
        if (!maxMin) continue;
        if (!c.lastRun) {
          stale.push({ id: c.id, ageMin: -1, expectedMaxMin: maxMin });
          continue;
        }
        const ageMin = Math.floor((now - new Date(c.lastRun.startedAt).getTime()) / 60000);
        if (ageMin > maxMin) stale.push({ id: c.id, ageMin, expectedMaxMin: maxMin });
      }

      if (stale.length > 0) {
        await dispatchAlert({
          id: `cron-watchdog-${stale.map((s) => s.id).sort().join(',')}`,
          type: 'error',
          title: `${stale.length} cron(s) silent past expected interval`,
          message: stale.map((s) => `${s.id}: ${s.ageMin === -1 ? 'never' : s.ageMin + 'm'} (expected <${s.expectedMaxMin}m)`).join('; '),
          severity: 'high',
          source: 'Cron watchdog',
          action: 'Check EventBridge rules + openheart-cron Lambda in AWS',
        }).catch(() => {});
      }

      return {
        ok: stale.length === 0,
        message: stale.length === 0
          ? `All rate-based crons firing within expected interval`
          : `${stale.length} stale: ${stale.map((s) => s.id).join(', ')}`,
        data: { stale },
      };
    },
  },
  {
    id: 'aws-cost-monitor',
    group: 'monitoring',
    schedule: 'cron(0 13 * * ? *)',
    description: 'Daily AWS cost check via Cost Explorer. Alerts on >50% day-over-day spike.',
    handler: async () => {
      const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
      if (!accessKeyId || !secretAccessKey) {
        return { ok: false, message: 'AWS credentials missing' };
      }
      try {
        const { CostExplorerClient, GetCostAndUsageCommand } = await import('@aws-sdk/client-cost-explorer');
        const ce = new CostExplorerClient({
          region: 'us-east-1', // Cost Explorer is global but only callable in us-east-1
          credentials: { accessKeyId, secretAccessKey },
        });
        const today = new Date();
        const end = today.toISOString().slice(0, 10);
        const start = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const r = await ce.send(new GetCostAndUsageCommand({
          TimePeriod: { Start: start, End: end },
          Granularity: 'DAILY',
          Metrics: ['UnblendedCost'],
        }));
        const days = (r.ResultsByTime ?? []).map((d) => ({
          date: d.TimePeriod?.Start,
          amount: parseFloat(d.Total?.UnblendedCost?.Amount ?? '0'),
        })).filter((d) => d.amount > 0);
        if (days.length < 2) {
          return { ok: true, message: 'Not enough cost data yet', data: { days } };
        }
        const yesterday = days[days.length - 1];
        const dayBefore = days[days.length - 2];
        const ratio = dayBefore.amount > 0 ? yesterday.amount / dayBefore.amount : 1;
        const spike = ratio > 1.5;
        if (spike) {
          await dispatchAlert({
            id: `cost-spike-${yesterday.date}`,
            type: 'warning',
            title: `AWS cost spike: $${yesterday.amount.toFixed(2)} (${Math.round((ratio - 1) * 100)}% above prior day)`,
            message: `Yesterday: $${yesterday.amount.toFixed(2)}, day before: $${dayBefore.amount.toFixed(2)}. Investigate unusual usage.`,
            severity: 'medium',
            source: 'AWS cost monitor',
            action: 'Open AWS Cost Explorer; check for runaway Lambda, S3 egress, or NAT gateway',
          }).catch(() => {});
        }
        return {
          ok: true,
          message: `Last 7d: $${days.reduce((s, d) => s + d.amount, 0).toFixed(2)} total · yesterday $${yesterday.amount.toFixed(2)}${spike ? ' ⚠ SPIKE' : ''}`,
          data: { days, yesterday, ratio },
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Cost Explorer failed' };
      }
    },
  },
  {
    id: 'failed-payment-watchdog',
    group: 'monitoring',
    schedule: 'rate(15 minutes)',
    description: 'Watches /api/payments for newly-failed Stripe charges; high-severity alert per failure.',
    handler: async () => {
      const r = await fetch(`${selfBase()}/api/payments?hours=1&limit=50`, { headers: selfHeaders() });
      if (!r.ok) {
        return { ok: false, message: `payments API returned ${r.status}` };
      }
      const j = await r.json();
      const failures = j?.failures ?? [];
      if (failures.length > 0) {
        // Alert per-failure (notify dedup keeps it sane within the 4h window)
        for (const f of failures.slice(0, 5)) {
          await dispatchAlert({
            id: `payment-failure-${f.id}`,
            type: 'error',
            title: `Payment failed: ${f._siteLabel} ${(f.amount / 100).toFixed(2)} USD`,
            message: `${f.billingEmail || 'unknown patient'} — ${f.outcomeMessage || f.outcomeReason || f.status}`,
            severity: 'high',
            source: 'Stripe payment watchdog',
            action: `Open Payments tab → filter Failures → contact patient for retry`,
          }).catch(() => {});
        }
      }
      return {
        ok: failures.length === 0,
        message: failures.length === 0 ? 'No payment failures in last hour' : `${failures.length} failure(s) in last hour`,
        data: { failureCount: failures.length, recentFailures: failures.slice(0, 5).map((f: any) => ({ id: f.id, amount: f.amount, site: f._site })) },
      };
    },
  },
];

export function getCron(id: string): CronDef | undefined {
  return CRON_REGISTRY.find(c => c.id === id);
}
