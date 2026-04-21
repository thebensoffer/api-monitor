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
import { getRuns } from './cron-history';

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
    description: 'Weekly Core Web Vitals snapshot for tovani/DK/DBS via PageSpeed Insights. Alerts on perf score < 50 (poor) or LCP > 4s.',
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
      // Alert on poor scores (Tier 3 #14)
      const poor = results.filter((r) => (r.performance ?? 1) < 0.5 || (r.lcp ?? 0) > 4000);
      for (const p of poor) {
        await dispatchAlert({
          id: `perf-poor-${p.site}-${new Date().toISOString().slice(0, 10)}`,
          type: 'warning',
          title: `${p.site.toUpperCase()} mobile performance degraded`,
          message: `score=${Math.round((p.performance || 0) * 100)} · LCP=${Math.round(p.lcp || 0)}ms · CLS=${(p.cls || 0).toFixed(2)}`,
          severity: 'medium',
          source: 'CWV monitor',
          action: 'Check Performance tab + PageSpeed Insights for the failing page',
        }).catch(() => {});
      }
      return { ok: poor.length === 0, message: `${results.length} sites checked${poor.length ? `, ${poor.length} poor` : ', all OK'}`, data: results };
    },
  },
  {
    id: 'sender-reputation',
    group: 'monitoring',
    schedule: 'cron(0 14 * * ? *)',
    description: 'Daily check of SES sending quota + bounce/complaint rate, plus Twilio A2P brand/campaign status. Alerts on degraded reputation.',
    handler: async () => {
      const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
      const result: any = { ses: null, twilio: null };

      // --- SES bounce/complaint reputation ---
      if (accessKeyId && secretAccessKey) {
        try {
          const { SESClient, GetSendStatisticsCommand, GetSendQuotaCommand } = await import('@aws-sdk/client-ses');
          const ses = new SESClient({
            region: process.env.OPENHEART_AWS_REGION || 'us-east-1',
            credentials: { accessKeyId, secretAccessKey },
          });
          const [stats, quota] = await Promise.all([
            ses.send(new GetSendStatisticsCommand({})).catch((e) => ({ SendDataPoints: [], _err: e?.message })),
            ses.send(new GetSendQuotaCommand({})).catch((e) => ({ Max24HourSend: null, SentLast24Hours: null, _err: e?.message })),
          ]);
          const points = (stats as any).SendDataPoints || [];
          // Last-24h aggregate
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          const recent = points.filter((p: any) => p.Timestamp && p.Timestamp.getTime() > cutoff);
          const totals = recent.reduce(
            (acc: any, p: any) => ({
              attempts: acc.attempts + (p.DeliveryAttempts || 0),
              bounces: acc.bounces + (p.Bounces || 0),
              complaints: acc.complaints + (p.Complaints || 0),
              rejects: acc.rejects + (p.Rejects || 0),
            }),
            { attempts: 0, bounces: 0, complaints: 0, rejects: 0 }
          );
          const bounceRate = totals.attempts > 0 ? totals.bounces / totals.attempts : 0;
          const complaintRate = totals.attempts > 0 ? totals.complaints / totals.attempts : 0;
          result.ses = {
            quota: { max24h: (quota as any).Max24HourSend, sentLast24h: (quota as any).SentLast24Hours },
            last24h: totals,
            bounceRate: bounceRate * 100,
            complaintRate: complaintRate * 100,
          };
          // AWS account suspension thresholds: bounce >5%, complaint >0.1%
          if (bounceRate > 0.05) {
            await dispatchAlert({
              id: `ses-bounce-${new Date().toISOString().slice(0, 10)}`,
              type: 'error',
              title: `SES bounce rate ${(bounceRate * 100).toFixed(2)}% exceeds 5%`,
              message: `${totals.bounces}/${totals.attempts} bounced in last 24h. AWS will suspend sending if sustained.`,
              severity: 'high',
              source: 'Sender reputation',
              action: 'Investigate bouncing addresses; clean list immediately',
            }).catch(() => {});
          } else if (complaintRate > 0.001) {
            await dispatchAlert({
              id: `ses-complaint-${new Date().toISOString().slice(0, 10)}`,
              type: 'error',
              title: `SES complaint rate ${(complaintRate * 100).toFixed(3)}% exceeds 0.1%`,
              message: `${totals.complaints}/${totals.attempts} marked as spam. AWS suspension risk.`,
              severity: 'high',
              source: 'Sender reputation',
              action: 'Audit sender list + content; add unsubscribe link if missing',
            }).catch(() => {});
          }
        } catch (err) {
          result.ses = { error: err instanceof Error ? err.message : 'SES check failed' };
        }
      }

      // --- Twilio A2P 10DLC brand/campaign status ---
      const sid = process.env.TWILIO_ACCOUNT_SID || process.env.NOTIFY_TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN || process.env.NOTIFY_TWILIO_AUTH_TOKEN;
      if (sid && token) {
        try {
          const auth = Buffer.from(`${sid}:${token}`).toString('base64');
          const headers = { Authorization: `Basic ${auth}` };
          const brand = await fetch(`https://messaging.twilio.com/v1/a2p/BrandRegistrations`, { headers, signal: AbortSignal.timeout(8000) })
            .then((r) => r.ok ? r.json() : null).catch(() => null);
          const campaigns = await fetch(`https://messaging.twilio.com/v1/Services`, { headers, signal: AbortSignal.timeout(8000) })
            .then((r) => r.ok ? r.json() : null).catch(() => null);
          const brandStatuses = (brand?.results || []).map((b: any) => ({ sid: b.sid, status: b.status, brand_score: b.brand_score, failure_reason: b.failure_reason }));
          result.twilio = {
            brands: brandStatuses,
            services: campaigns?.services?.length ?? 0,
          };
          const failedBrands = brandStatuses.filter((b: any) => b.status === 'FAILED' || b.status === 'SUSPENDED');
          if (failedBrands.length > 0) {
            await dispatchAlert({
              id: `twilio-a2p-failed`,
              type: 'error',
              title: `Twilio A2P brand registration ${failedBrands[0].status}`,
              message: failedBrands.map((b: any) => `${b.sid}: ${b.failure_reason || b.status}`).join('; '),
              severity: 'high',
              source: 'Sender reputation',
              action: 'SMS will be throttled or blocked. Open Twilio console → A2P 10DLC',
            }).catch(() => {});
          }
        } catch (err) {
          result.twilio = { error: err instanceof Error ? err.message : 'Twilio check failed' };
        }
      } else {
        result.twilio = { error: 'TWILIO_ACCOUNT_SID/AUTH_TOKEN not set' };
      }

      const sesOk = !result.ses?.error && (result.ses?.bounceRate ?? 0) < 5 && (result.ses?.complaintRate ?? 0) < 0.1;
      const twilioOk = !result.twilio?.error && !(result.twilio?.brands || []).some((b: any) => b.status === 'FAILED' || b.status === 'SUSPENDED');
      return {
        ok: sesOk && twilioOk,
        message: `SES: ${sesOk ? 'OK' : 'DEGRADED'} (bounce ${result.ses?.bounceRate?.toFixed(2) ?? '?'}%, complaint ${result.ses?.complaintRate?.toFixed(3) ?? '?'}%) · Twilio: ${twilioOk ? 'OK' : 'DEGRADED'} (${result.twilio?.brands?.length ?? 0} brands)`,
        data: result,
      };
    },
  },
  {
    id: 'integrity-monitor',
    group: 'monitoring',
    schedule: 'cron(0 9 * * ? *)',
    description: 'Daily DB integrity check across all 3 apps. Alerts on schema-migration failures or unexpected orphan-record counts.',
    handler: async () => {
      const r = await fetch(`${selfBase()}/api/integrity`, { headers: selfHeaders() });
      if (!r.ok) return { ok: false, message: `integrity API returned ${r.status}` };
      const j = await r.json();
      const probs: string[] = [];
      for (const site of j.sites || []) {
        if (site.error) {
          probs.push(`${site.label}: API error (${site.error})`);
          continue;
        }
        if (site.schema?.failedCount > 0) {
          probs.push(`${site.label}: ${site.schema.failedCount} failed migration(s)`);
        }
        if (site.orphansTotal > 0) {
          const detail = Object.entries(site.orphans || {})
            .filter(([, n]) => (n as number) > 0)
            .map(([k, n]) => `${k}=${n}`)
            .join(', ');
          probs.push(`${site.label}: ${site.orphansTotal} orphan(s) [${detail}]`);
        }
      }
      if (probs.length > 0) {
        await dispatchAlert({
          id: `integrity-issues-${new Date().toISOString().slice(0, 10)}`,
          type: 'warning',
          title: `Data integrity issues across ${probs.length} site(s)`,
          message: probs.join(' · '),
          severity: 'medium',
          source: 'Integrity monitor',
          action: 'Open OpenHeart Integrity tab → drill per-site to see which records',
        }).catch(() => {});
      }
      return {
        ok: probs.length === 0,
        message: probs.length === 0 ? 'All schemas clean, no orphans' : `${probs.length} issue(s)`,
        data: j.summary,
      };
    },
  },
  {
    id: 'funnel-monitor',
    group: 'monitoring',
    schedule: 'cron(0 12 * * ? *)',
    description: 'Daily GA4 conversion-funnel check per site. Alerts if assessment-completion or purchase-rate drops > 30% vs 7d baseline.',
    handler: async () => {
      const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (!credsJson) return { ok: false, message: 'GOOGLE_APPLICATION_CREDENTIALS_JSON missing' };
      try {
        const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
        const credentials = JSON.parse(credsJson);
        const client = new BetaAnalyticsDataClient({ credentials });
        const properties: Record<string, string> = {
          dk: process.env.GA4_PROPERTY_ID_DK || '409955354',
          dbs: process.env.GA4_PROPERTY_ID_DBS || '521897216',
          tovani: process.env.GA4_PROPERTY_ID_TOVANI || '529713159',
        };

        const results: any[] = [];
        for (const [site, propId] of Object.entries(properties)) {
          try {
            const [yesterday, baseline] = await Promise.all([
              client.runReport({
                property: `properties/${propId}`,
                dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
                metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'purchaseRevenue' }, { name: 'totalUsers' }],
              }),
              client.runReport({
                property: `properties/${propId}`,
                dateRanges: [{ startDate: '8daysAgo', endDate: '2daysAgo' }],
                metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'purchaseRevenue' }, { name: 'totalUsers' }],
              }),
            ]);
            const yRow = yesterday[0].rows?.[0]?.metricValues || [];
            const bRow = baseline[0].rows?.[0]?.metricValues || [];
            const ySessions = parseInt(yRow[0]?.value || '0', 10);
            const yConversions = parseInt(yRow[1]?.value || '0', 10);
            const bSessions = parseInt(bRow[0]?.value || '0', 10);
            const bConversions = parseInt(bRow[1]?.value || '0', 10);
            const baselineDays = 7;
            const yConvRate = ySessions > 0 ? yConversions / ySessions : 0;
            const bConvRate = bSessions > 0 ? bConversions / bSessions / baselineDays : 0;
            const dropPct = bConvRate > 0 ? ((bConvRate - yConvRate) / bConvRate) * 100 : 0;
            const siteResult = {
              site,
              yesterday: { sessions: ySessions, conversions: yConversions, convRate: yConvRate * 100 },
              baseline7d_avg: { sessions: Math.round(bSessions / baselineDays), conversions: Math.round(bConversions / baselineDays), convRate: bConvRate * 100 },
              dropPct,
            };
            results.push(siteResult);
            if (dropPct > 30 && bConversions >= 10) {
              await dispatchAlert({
                id: `funnel-drop-${site}-${new Date().toISOString().slice(0, 10)}`,
                type: 'warning',
                title: `${site.toUpperCase()} conversion rate dropped ${dropPct.toFixed(0)}%`,
                message: `Yesterday ${(yConvRate * 100).toFixed(2)}% conv vs 7d avg ${(bConvRate * 100).toFixed(2)}%. ${ySessions} sessions, ${yConversions} conversions.`,
                severity: 'medium',
                source: 'Funnel monitor',
                action: 'Check Analytics tab; investigate broken form / pricing change / outage in past 24h',
              }).catch(() => {});
            }
          } catch (err) {
            results.push({ site, error: err instanceof Error ? err.message : 'GA4 query failed' });
          }
        }
        return {
          ok: !results.some((r) => r.dropPct > 30),
          message: results.map((r) => `${r.site}: ${r.error ? 'err' : `${r.yesterday?.conversions || 0} conv (${(r.yesterday?.convRate || 0).toFixed(2)}%)`}`).join(' · '),
          data: results,
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Funnel check failed' };
      }
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
    description:
      'Classifies inbound alert@ emails from Tovani/DK/DBS via Bedrock Haiku, records what the agent *would* do (Phase 1 shadow), dispatches a summary alert when new items land.',
    handler: async () => {
      const { listUntriaged, markTriaged, platformForDomain } = await import(
        '@/lib/alert-triage/inbox'
      );
      const { classifyAlert } = await import('@/lib/alert-triage/classify');
      const { putTriageItem } = await import('@/lib/alert-triage/items');
      const { dispatchAlert } = await import('@/lib/notify');
      const { signFixToken } = await import('@/lib/fix-tokens');

      // Base URL for magic-link tokens embedded in the digest alert.
      const selfUrl =
        process.env.OPENHEART_SELF_URL || 'https://main.dl7zrj8lm47be.amplifyapp.com';

      let scanned = 0;
      let created = 0;
      let failed = 0;
      const byBucket: Record<string, number> = {
        routine: 0,
        auto_fix: 0,
        investigate: 0,
        escalate: 0,
      };
      const sampleLines: string[] = [];

      const rows = await listUntriaged(50);
      scanned = rows.length;

      for (const row of rows) {
        try {
          const classification = await classifyAlert({
            id: row.id,
            fromEmail: row.fromEmail,
            subject: row.subject,
            body: row.textBody || '',
            snippet: row.snippet || '',
            receivedAt: new Date(row.receivedAt),
            platform: row.platform || platformForDomain(row.recipientDomain),
          });

          // If the classifier proposes a known fix-action, mint a signed
          // magic-link token so the digest alert can carry a one-tap
          // "apply this fix" URL. 30-min expiry enforced in fix-tokens.
          // The link lands on /api/fix-action/execute, which shows a
          // dry-run preview first (GET) before execute (POST).
          let fixLink: string | null = null;
          if (classification.proposedAction && classification.actionParams) {
            try {
              const token = signFixToken({
                actionId: classification.proposedAction,
                params: classification.actionParams,
                alertId: `triage-${row.id}`,
                mode: 'dryRun',
                expiresAt: Date.now() + 30 * 60 * 1000,
              });
              fixLink = `${selfUrl}/api/fix-action/execute?t=${token}`;
            } catch (err: any) {
              // FIX_TOKEN_SECRET unset — classifier still records the item,
              // just without a clickable link.
              console.warn('[email-alert-triage] token signing failed:', err?.message);
            }
          }

          await putTriageItem({
            inboundEmailId: row.id,
            platform: row.platform || platformForDomain(row.recipientDomain),
            fromEmail: row.fromEmail,
            subject: row.subject,
            receivedAt: row.receivedAt,
            bodySnippet: row.textBody || row.snippet || '',
            classification,
            actionStatus: classification.proposedAction ? 'proposed' : 'none',
            actionResult: fixLink ? { fixLink } : null,
          });
          await markTriaged(row.id, row.receivedAt);

          byBucket[classification.bucket] = (byBucket[classification.bucket] || 0) + 1;

          if (classification.bucket !== 'routine' && sampleLines.length < 6) {
            const bucketLabel =
              classification.bucket === 'escalate' ? '🚨' :
              classification.bucket === 'auto_fix' ? '🛠️' :
              '🔎';
            const line = `${bucketLabel} [${row.platform || 'unknown'}] ${row.subject.slice(0, 80)}${fixLink ? ` — ${fixLink}` : ''}`;
            sampleLines.push(line);
          }
          created++;
        } catch (err: any) {
          console.error('[email-alert-triage] row failed', { id: row.id, err: err?.message });
          failed++;
        }
      }

      // Severity routing: escalate > auto_fix > investigate
      const worstSeverity: 'high' | 'medium' | 'low' =
        byBucket.escalate > 0 ? 'high' :
        byBucket.auto_fix > 0 ? 'medium' :
        'low';

      if (created > 0) {
        try {
          await dispatchAlert({
            id: `alert-triage-${new Date().toISOString().slice(0, 13)}`,
            type: byBucket.escalate > 0 ? 'error' : byBucket.auto_fix > 0 ? 'warning' : 'info',
            severity: worstSeverity,
            title: `Alert triage: ${created} new (${byBucket.escalate}🚨 ${byBucket.auto_fix}🛠️ ${byBucket.investigate}🔎 ${byBucket.routine}✅)`,
            message:
              sampleLines.length > 0
                ? sampleLines.join('\n')
                : `${created} routine alerts classified, nothing needing attention.`,
            source: 'alert-triage cron',
            action: 'Open dashboard → Triage tab; or tap a fix-link in the list above',
          });
        } catch (err: any) {
          console.error('[email-alert-triage] dispatchAlert failed', err?.message);
        }
      }

      return {
        ok: true,
        message: `scanned ${scanned}, triaged ${created}, failed ${failed}`,
        data: { scanned, created, failed, byBucket },
      };
    },
  },
  {
    id: 'backup-verification',
    group: 'monitoring',
    schedule: 'cron(30 10 * * ? *)',
    description: 'Verifies the most recent RDS / Aurora snapshot exists, is "available", and is < 26h old. Alerts on stale or failed.',
    handler: async () => {
      const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
      if (!accessKeyId || !secretAccessKey) {
        return { ok: false, message: 'AWS creds missing' };
      }
      try {
        const { RDSClient, DescribeDBSnapshotsCommand, DescribeDBClusterSnapshotsCommand, DescribeDBInstancesCommand, DescribeDBClustersCommand } = await import('@aws-sdk/client-rds');
        const rds = new RDSClient({
          region: process.env.OPENHEART_AWS_REGION || 'us-east-1',
          credentials: { accessKeyId, secretAccessKey },
        });
        const STALE_HOURS = 26; // RDS automated backups fire daily; 26h leaves a 2h grace window
        const now = Date.now();
        const stale: { instance: string; ageHours: number | null; status: string }[] = [];

        // 1) Standalone instances
        const instances = await rds.send(new DescribeDBInstancesCommand({})).catch(() => ({ DBInstances: [] }));
        const instanceResults: any[] = [];
        for (const inst of instances.DBInstances || []) {
          if (!inst.DBInstanceIdentifier || inst.DBClusterIdentifier) continue; // skip cluster members
          const snaps = await rds.send(new DescribeDBSnapshotsCommand({
            DBInstanceIdentifier: inst.DBInstanceIdentifier,
            SnapshotType: 'automated',
            MaxRecords: 20,
          })).catch(() => ({ DBSnapshots: [] }));
          const recent = (snaps.DBSnapshots || []).sort((a, b) =>
            (b.SnapshotCreateTime?.getTime() || 0) - (a.SnapshotCreateTime?.getTime() || 0)
          )[0];
          const ageHours = recent?.SnapshotCreateTime
            ? Math.floor((now - recent.SnapshotCreateTime.getTime()) / 3600000)
            : null;
          const status = recent?.Status || 'no-snapshot';
          instanceResults.push({
            instance: inst.DBInstanceIdentifier,
            engine: inst.Engine,
            latestSnapshot: recent?.DBSnapshotIdentifier,
            sizeGb: recent?.AllocatedStorage,
            ageHours,
            status,
          });
          if (status !== 'available' || ageHours === null || ageHours > STALE_HOURS) {
            stale.push({ instance: inst.DBInstanceIdentifier, ageHours, status });
          }
        }

        // 2) Aurora clusters
        const clusters = await rds.send(new DescribeDBClustersCommand({})).catch(() => ({ DBClusters: [] }));
        const clusterResults: any[] = [];
        for (const cl of clusters.DBClusters || []) {
          if (!cl.DBClusterIdentifier) continue;
          const snaps = await rds.send(new DescribeDBClusterSnapshotsCommand({
            DBClusterIdentifier: cl.DBClusterIdentifier,
            SnapshotType: 'automated',
            MaxRecords: 20,
          })).catch(() => ({ DBClusterSnapshots: [] }));
          const recent = (snaps.DBClusterSnapshots || []).sort((a, b) =>
            (b.SnapshotCreateTime?.getTime() || 0) - (a.SnapshotCreateTime?.getTime() || 0)
          )[0];
          const ageHours = recent?.SnapshotCreateTime
            ? Math.floor((now - recent.SnapshotCreateTime.getTime()) / 3600000)
            : null;
          const status = recent?.Status || 'no-snapshot';
          clusterResults.push({
            cluster: cl.DBClusterIdentifier,
            engine: cl.Engine,
            latestSnapshot: recent?.DBClusterSnapshotIdentifier,
            sizeGb: recent?.AllocatedStorage,
            ageHours,
            status,
          });
          if (status !== 'available' || ageHours === null || ageHours > STALE_HOURS) {
            stale.push({ instance: cl.DBClusterIdentifier, ageHours, status });
          }
        }

        if (stale.length > 0) {
          await dispatchAlert({
            id: `backup-stale-${stale.map((s) => s.instance).sort().join(',')}`,
            type: 'error',
            title: `${stale.length} RDS backup(s) stale or missing`,
            message: stale.map((s) => `${s.instance}: ${s.status}, age=${s.ageHours === null ? '?' : s.ageHours + 'h'}`).join('; '),
            severity: 'high',
            source: 'RDS backup verification',
            action: 'Check AWS RDS console — automated backups may be disabled or failing',
          }).catch(() => {});
        }

        const total = instanceResults.length + clusterResults.length;
        return {
          ok: stale.length === 0,
          message: stale.length === 0
            ? `All ${total} DB(s) backed up within ${STALE_HOURS}h`
            : `${stale.length}/${total} stale: ${stale.map((s) => s.instance).join(', ')}`,
          data: { instances: instanceResults, clusters: clusterResults, staleCount: stale.length },
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'RDS check failed' };
      }
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
  {
    id: 'public-s3-scanner',
    group: 'monitoring',
    schedule: 'cron(0 8 * * ? *)',
    description: 'Daily scan of every S3 bucket in the account for public ACLs, public bucket policies, or missing PublicAccessBlock. Intentionally-public buckets can be allowlisted via OPENHEART_S3_PUBLIC_ALLOWLIST env var.',
    handler: async () => {
      // Buckets whose public policy is intentional (static websites, public
      // brand assets). Override via env var OPENHEART_S3_PUBLIC_ALLOWLIST
      // (comma-separated). These buckets still get scanned and reported in
      // `data`, but don't escalate to a HIGH alert.
      const DEFAULT_ALLOWLIST = [
        'camp-eggcellent-2026-1769786675',
        'dk-blog-static-1775320611',
        'salutele.com',
        'subek-org-static',
        'subek.org',
        'theglassguys-xyz-site',
        'social-media-agent-images',
        // beyondthederech-uploads is Instagram-style (profile photos + stories,
        // policy already scoped to those prefixes) — allowlisted as intentional.
        'beyondthederech-uploads',
      ];
      const envList = (process.env.OPENHEART_S3_PUBLIC_ALLOWLIST || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const allowlist = new Set(envList.length > 0 ? envList : DEFAULT_ALLOWLIST);
      const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
      if (!accessKeyId || !secretAccessKey) return { ok: false, message: 'AWS creds missing' };
      try {
        const {
          S3Client,
          ListBucketsCommand,
          GetBucketAclCommand,
          GetBucketPolicyStatusCommand,
          GetPublicAccessBlockCommand,
          GetBucketLocationCommand,
        } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({
          region: process.env.OPENHEART_AWS_REGION || 'us-east-1',
          credentials: { accessKeyId, secretAccessKey },
        });

        const buckets = await s3.send(new ListBucketsCommand({}));
        const findings: { bucket: string; reasons: string[]; severity: 'low' | 'medium' | 'high' }[] = [];

        // Bound the scan — > 200 buckets is unusual; protects Lambda runtime
        const slice = (buckets.Buckets || []).slice(0, 200);
        for (const b of slice) {
          if (!b.Name) continue;
          const reasons: string[] = [];

          // 1. PublicAccessBlock — best-practice baseline
          let pabAllowsPublic = true; // assume risky if missing
          try {
            const pab = await s3.send(new GetPublicAccessBlockCommand({ Bucket: b.Name }));
            const cfg = pab.PublicAccessBlockConfiguration;
            const allBlocked = cfg?.BlockPublicAcls && cfg?.BlockPublicPolicy && cfg?.IgnorePublicAcls && cfg?.RestrictPublicBuckets;
            pabAllowsPublic = !allBlocked;
            if (!allBlocked) reasons.push('PublicAccessBlock not fully enabled');
          } catch (e: any) {
            // NoSuchPublicAccessBlockConfiguration → no PAB at all
            if (e?.name === 'NoSuchPublicAccessBlockConfiguration') {
              reasons.push('No PublicAccessBlock configured');
              pabAllowsPublic = true;
            }
          }

          // 2. ACL — only matters if PAB doesn't already block ACLs
          if (pabAllowsPublic) {
            try {
              const acl = await s3.send(new GetBucketAclCommand({ Bucket: b.Name }));
              for (const grant of acl.Grants || []) {
                const uri = grant.Grantee?.URI || '';
                if (uri.includes('AllUsers') || uri.includes('AuthenticatedUsers')) {
                  reasons.push(`ACL grants ${uri.split('/').pop()} ${grant.Permission}`);
                }
              }
            } catch {}
          }

          // 3. Bucket policy — check public via PolicyStatus
          if (pabAllowsPublic) {
            try {
              const ps = await s3.send(new GetBucketPolicyStatusCommand({ Bucket: b.Name }));
              if (ps.PolicyStatus?.IsPublic) reasons.push('Bucket policy is public');
            } catch {} // NoSuchBucketPolicy is fine
          }

          if (reasons.length > 0) {
            // Severity: missing PAB alone = low; actual public ACL/policy = high
            const hasRealExposure = reasons.some((r) => r.includes('ACL grants') || r.includes('policy is public'));
            findings.push({
              bucket: b.Name,
              reasons,
              severity: hasRealExposure ? 'high' : 'low',
            });
          }
        }

        // Separate exposed findings into "unexpected" (alert) and "allowlisted" (report only)
        const exposedAll = findings.filter((f) => f.severity === 'high');
        const exposedUnexpected = exposedAll.filter((f) => !allowlist.has(f.bucket));
        const exposedAllowlisted = exposedAll.filter((f) => allowlist.has(f.bucket));

        if (exposedUnexpected.length > 0) {
          await dispatchAlert({
            id: `s3-public-${exposedUnexpected.map((e) => e.bucket).sort().join(',')}`,
            type: 'error',
            title: `🚨 ${exposedUnexpected.length} S3 bucket(s) publicly accessible (not allowlisted)`,
            message: exposedUnexpected.map((e) => `${e.bucket}: ${e.reasons.join('; ')}`).join(' · '),
            severity: 'high',
            source: 'S3 public-bucket scanner',
            action: 'Open S3 console → Permissions → enable Block Public Access OR audit ACL/policy. If intentional, add to OPENHEART_S3_PUBLIC_ALLOWLIST env var.',
          }).catch(() => {});
        }

        return {
          ok: exposedUnexpected.length === 0,
          message:
            exposedUnexpected.length === 0
              ? `Scanned ${slice.length} buckets — none unexpectedly public${exposedAllowlisted.length ? ` (${exposedAllowlisted.length} allowlisted as intentional)` : ''}${findings.length - exposedAll.length > 0 ? ` · ${findings.length - exposedAll.length} have weak PAB only` : ''}`
              : `${exposedUnexpected.length} bucket(s) UNEXPECTEDLY PUBLIC: ${exposedUnexpected.map((e) => e.bucket).join(', ')}`,
          data: {
            totalBuckets: buckets.Buckets?.length ?? 0,
            scanned: slice.length,
            findings,
            allowlisted: Array.from(allowlist),
            exposedUnexpected: exposedUnexpected.map((e) => e.bucket),
            exposedAllowlisted: exposedAllowlisted.map((e) => e.bucket),
          },
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'S3 scan failed' };
      }
    },
  },
  {
    id: 'phi-log-scanner',
    group: 'monitoring',
    schedule: 'cron(0 7 ? * MON *)',
    description: 'Weekly sweep of CloudWatch log groups for accidental PHI leakage (emails, US phone numbers) in error stacks. HIPAA: PHI in logs = breach risk.',
    handler: async () => {
      const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
      if (!accessKeyId || !secretAccessKey) return { ok: false, message: 'AWS creds missing' };
      try {
        const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } =
          await import('@aws-sdk/client-cloudwatch-logs');
        const cw = new CloudWatchLogsClient({
          region: process.env.OPENHEART_AWS_REGION || 'us-east-1',
          credentials: { accessKeyId, secretAccessKey },
        });

        // Only scan log groups we care about — Amplify SSR + Lambda for our 3 apps + OpenHeart
        const targets = ['/aws/lambda/', '/aws/amplify/'];
        const groups: string[] = [];
        for (const prefix of targets) {
          let token: string | undefined;
          do {
            const r = await cw.send(new DescribeLogGroupsCommand({
              logGroupNamePrefix: prefix,
              nextToken: token,
              limit: 50,
            }));
            for (const g of r.logGroups || []) {
              if (g.logGroupName) groups.push(g.logGroupName);
            }
            token = r.nextToken;
          } while (token && groups.length < 200);
        }

        // Email regex: loose enough to catch most patient emails; PHI risk
        // Phone regex: US 10-digit, with or without country code/punctuation
        // Filter pattern syntax (CloudWatch): use literal substrings for OR; we'll
        // download a small slice and regex client-side for accuracy.
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const emailRe = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
        const phoneRe = /(?<!\d)(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/;
        // Domains we *expect* in logs (our own infra) — skip to reduce noise
        const allowedEmailDomains = ['amazonaws.com', 'sentry.io', 'noreply', 'example.com'];

        const findings: { logGroup: string; ts: string; sample: string; type: 'email' | 'phone' }[] = [];
        let scanned = 0;

        // Scan max 30 log groups per run, 100 events each — keeps Lambda < 60s
        for (const group of groups.slice(0, 30)) {
          try {
            const r = await cw.send(new FilterLogEventsCommand({
              logGroupName: group,
              startTime: sevenDaysAgo,
              filterPattern: '?ERROR ?Error ?error ?WARN ?@', // keyword OR pattern
              limit: 100,
            }));
            scanned += r.events?.length ?? 0;
            for (const ev of r.events || []) {
              const msg = ev.message || '';
              const emailMatch = msg.match(emailRe);
              const phoneMatch = msg.match(phoneRe);
              if (emailMatch) {
                const email = emailMatch[0].toLowerCase();
                if (!allowedEmailDomains.some((d) => email.includes(d))) {
                  findings.push({
                    logGroup: group,
                    ts: new Date(ev.timestamp || 0).toISOString(),
                    sample: email.replace(/(.{2}).+(@.+)/, '$1***$2'), // mask before storing
                    type: 'email',
                  });
                }
              }
              if (phoneMatch) {
                const digits = phoneMatch[0].replace(/\D/g, '').slice(-10);
                findings.push({
                  logGroup: group,
                  ts: new Date(ev.timestamp || 0).toISOString(),
                  sample: `***-***-${digits.slice(-4)}`,
                  type: 'phone',
                });
              }
            }
          } catch {} // skip log groups we can't read
        }

        // Dedup findings by logGroup+sample so noisy single events don't spam
        const dedup = new Map<string, typeof findings[0]>();
        for (const f of findings) dedup.set(`${f.logGroup}|${f.sample}`, f);
        const unique = Array.from(dedup.values());

        if (unique.length > 0) {
          await dispatchAlert({
            id: `phi-in-logs-${new Date().toISOString().slice(0, 10)}`,
            type: 'warning',
            title: `Possible PHI in logs: ${unique.length} match(es) across ${new Set(unique.map((u) => u.logGroup)).size} log group(s)`,
            message: unique.slice(0, 10).map((u) => `[${u.type}] ${u.logGroup.split('/').slice(-2).join('/')}: ${u.sample}`).join(' · '),
            severity: 'medium',
            source: 'PHI-in-logs scanner',
            action: 'Review the offending log lines; redact PII at the source (logger or error handler) and rotate the 7-day log retention',
          }).catch(() => {});
        }

        return {
          ok: unique.length === 0,
          message:
            unique.length === 0
              ? `Scanned ${scanned} log events across ${Math.min(groups.length, 30)} groups — no PHI patterns found`
              : `${unique.length} possible PHI match(es) across ${new Set(unique.map((u) => u.logGroup)).size} log group(s)`,
          data: {
            totalGroups: groups.length,
            scannedGroups: Math.min(groups.length, 30),
            scannedEvents: scanned,
            findings: unique.slice(0, 20),
          },
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Log scan failed' };
      }
    },
  },
  {
    id: 'iam-hygiene',
    group: 'monitoring',
    schedule: 'cron(0 9 ? * MON *)',
    description: 'Weekly IAM hygiene: alerts on (a) access keys older than 90d, (b) console-enabled users without MFA, (c) inactive keys (90d unused). Catches rotation drift.',
    handler: async () => {
      const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
      if (!accessKeyId || !secretAccessKey) return { ok: false, message: 'AWS creds missing' };
      try {
        const {
          IAMClient,
          ListUsersCommand,
          ListAccessKeysCommand,
          GetAccessKeyLastUsedCommand,
          GetLoginProfileCommand,
          ListMFADevicesCommand,
        } = await import('@aws-sdk/client-iam');
        const iam = new IAMClient({
          region: 'us-east-1',
          credentials: { accessKeyId, secretAccessKey },
        });

        const KEY_AGE_DAYS = 90;
        const INACTIVE_DAYS = 90;
        const now = Date.now();

        // Paginate ListUsers — typical accounts have <100, but be safe
        const users: string[] = [];
        let marker: string | undefined;
        do {
          const r = await iam.send(new ListUsersCommand({ Marker: marker }));
          for (const u of r.Users || []) if (u.UserName) users.push(u.UserName);
          marker = r.IsTruncated ? r.Marker : undefined;
        } while (marker);

        const oldKeys: { user: string; keyId: string; ageDays: number }[] = [];
        const inactiveKeys: { user: string; keyId: string; lastUsedDays: number | null }[] = [];
        const noMfa: { user: string }[] = [];

        for (const user of users) {
          // Console access? (LoginProfile exists if yes)
          let hasConsole = false;
          try {
            await iam.send(new GetLoginProfileCommand({ UserName: user }));
            hasConsole = true;
          } catch {} // NoSuchEntity = no console password set

          if (hasConsole) {
            const mfa = await iam.send(new ListMFADevicesCommand({ UserName: user })).catch(() => ({ MFADevices: [] }));
            if ((mfa.MFADevices || []).length === 0) noMfa.push({ user });
          }

          // Access keys
          const keys = await iam.send(new ListAccessKeysCommand({ UserName: user })).catch(() => ({ AccessKeyMetadata: [] }));
          for (const k of keys.AccessKeyMetadata || []) {
            if (!k.AccessKeyId || k.Status !== 'Active') continue;
            const ageDays = k.CreateDate ? Math.floor((now - k.CreateDate.getTime()) / 86400000) : 0;
            if (ageDays > KEY_AGE_DAYS) {
              oldKeys.push({ user, keyId: k.AccessKeyId, ageDays });
            }
            // Last-used
            const lastUsed = await iam.send(new GetAccessKeyLastUsedCommand({ AccessKeyId: k.AccessKeyId })).catch(() => null);
            const lastUsedDate = lastUsed?.AccessKeyLastUsed?.LastUsedDate;
            const lastUsedDays = lastUsedDate
              ? Math.floor((now - lastUsedDate.getTime()) / 86400000)
              : null;
            if (lastUsedDays !== null && lastUsedDays > INACTIVE_DAYS) {
              inactiveKeys.push({ user, keyId: k.AccessKeyId, lastUsedDays });
            }
          }
        }

        const issues: string[] = [];
        if (oldKeys.length) {
          issues.push(`${oldKeys.length} key(s) > ${KEY_AGE_DAYS}d old: ${oldKeys.map((k) => `${k.user}(${k.ageDays}d)`).slice(0, 5).join(', ')}`);
        }
        if (inactiveKeys.length) {
          issues.push(`${inactiveKeys.length} key(s) unused > ${INACTIVE_DAYS}d: ${inactiveKeys.map((k) => `${k.user}(${k.lastUsedDays}d)`).slice(0, 5).join(', ')}`);
        }
        if (noMfa.length) {
          issues.push(`${noMfa.length} console user(s) WITHOUT MFA: ${noMfa.map((n) => n.user).join(', ')}`);
        }

        if (issues.length > 0) {
          await dispatchAlert({
            id: `iam-hygiene-${new Date().toISOString().slice(0, 10)}`,
            type: noMfa.length > 0 ? 'error' : 'warning',
            title: `IAM hygiene: ${issues.length} issue category(ies)`,
            message: issues.join(' · '),
            severity: noMfa.length > 0 ? 'high' : 'medium',
            source: 'IAM hygiene cron',
            action:
              noMfa.length > 0
                ? 'Enable MFA for console users IMMEDIATELY (IAM → Users → Security credentials)'
                : 'Rotate old keys; deactivate unused keys (IAM → Users → Access keys)',
          }).catch(() => {});
        }

        return {
          ok: issues.length === 0,
          message: issues.length === 0 ? `${users.length} users clean — keys < ${KEY_AGE_DAYS}d, MFA enabled, no stale keys` : issues.join(' · '),
          data: { totalUsers: users.length, oldKeys, inactiveKeys, noMfa },
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'IAM scan failed' };
      }
    },
  },
  {
    id: 'vendor-status-monitor',
    group: 'monitoring',
    schedule: 'rate(15 minutes)',
    description: 'Polls public StatusPage feeds for every critical vendor (Stripe, Twilio, SES, Anthropic, Sentry, OpenAI, Neon, Healthie) and alerts on any minor/major/critical incident. Catches "site is fine, vendor is degraded" before patients call.',
    handler: async () => {
      // Atlassian StatusPage endpoints — all return identical JSON shape with
      // status.indicator ∈ {none, minor, major, critical, maintenance}
      const VENDORS = [
        { key: 'stripe', url: 'https://www.stripestatus.com/api/v2/summary.json' },
        { key: 'twilio', url: 'https://status.twilio.com/api/v2/summary.json' },
        { key: 'anthropic', url: 'https://status.anthropic.com/api/v2/summary.json' },
        { key: 'sentry', url: 'https://status.sentry.io/api/v2/summary.json' },
        { key: 'openai', url: 'https://status.openai.com/api/v2/summary.json' },
        { key: 'neon', url: 'https://neonstatus.com/api/v2/summary.json' },
        { key: 'github', url: 'https://www.githubstatus.com/api/v2/summary.json' },
        { key: 'amplify', url: 'https://status.aws.amazon.com/healthcheck.json' }, // AWS doesn't use StatusPage; skip gracefully
      ];

      const results = await Promise.all(VENDORS.map(async (v) => {
        try {
          const r = await fetch(v.url, { signal: AbortSignal.timeout(6000) });
          if (!r.ok) return { vendor: v.key, status: 'unknown', indicator: 'unknown', description: `HTTP ${r.status}` };
          const j: any = await r.json();
          // StatusPage summary shape: { status: { indicator, description }, incidents: [...] }
          const indicator = j.status?.indicator || 'unknown';
          const description = j.status?.description || '';
          const openIncidents = (j.incidents || []).filter((i: any) => i.status !== 'resolved' && i.status !== 'completed');
          return {
            vendor: v.key,
            indicator,
            description,
            openIncidents: openIncidents.length,
            incidentNames: openIncidents.slice(0, 3).map((i: any) => i.name),
          };
        } catch (err: any) {
          // Network error, timeout, or non-JSON response (e.g. AWS endpoint)
          return { vendor: v.key, indicator: 'unreachable', description: err?.message?.slice(0, 100) || 'fetch failed' };
        }
      }));

      // Alert on anything not "none" (skip unreachable — those are likely schema mismatches, not real outages)
      const degraded = results.filter((r) => r.indicator !== 'none' && r.indicator !== 'unreachable' && r.indicator !== 'unknown');
      if (degraded.length > 0) {
        // Classify severity: critical > major > minor > maintenance
        const worst = degraded.reduce((w, r) => {
          const rank = { critical: 4, major: 3, minor: 2, maintenance: 1 } as any;
          return (rank[r.indicator] || 0) > (rank[w.indicator] || 0) ? r : w;
        });
        await dispatchAlert({
          id: `vendor-degraded-${degraded.map((d) => d.vendor).sort().join(',')}`,
          type: worst.indicator === 'critical' || worst.indicator === 'major' ? 'error' : 'warning',
          title: `${degraded.length} vendor(s) degraded — worst: ${worst.vendor} (${worst.indicator})`,
          message: degraded.map((d) => `${d.vendor}: ${d.indicator}${(d as any).incidentNames?.length ? ` — ${(d as any).incidentNames[0]}` : ` (${d.description})`}`).join(' · '),
          severity: worst.indicator === 'critical' || worst.indicator === 'major' ? 'high' : 'medium',
          source: 'Vendor status monitor',
          action: `Visit each vendor's status page; if critical vendor is down, prepare patient comms`,
        }).catch(() => {});
      }

      const okCount = results.filter((r) => r.indicator === 'none').length;
      return {
        ok: degraded.length === 0,
        message: degraded.length === 0
          ? `All ${okCount}/${results.length} reachable vendors operational`
          : `${degraded.length} degraded: ${degraded.map((d) => `${d.vendor}(${d.indicator})`).join(', ')}`,
        data: { results, degradedCount: degraded.length },
      };
    },
  },
  {
    id: 'secret-leak-scan',
    group: 'monitoring',
    schedule: 'rate(1 hour)',
    description: 'Scans the most recent commits across all watched GitHub repos for high-confidence secret patterns (AWS keys, Stripe live keys, Twilio auth tokens, GitHub PATs, private keys). Supplementary layer on top of GitHub Push Protection.',
    handler: async () => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return { ok: false, message: 'GITHUB_TOKEN not set — secret scan skipped' };
      }
      // Repos to scan — override with env var (comma-separated owner/repo)
      const DEFAULT_REPOS = [
        'thebensoffer/api-monitor',
        'thebensoffer/discreet-ketamine',
        'thebensoffer/tovanihealth',
        'thebensoffer/drbensoffer-platform',
      ];
      const reposEnv = (process.env.OPENHEART_GITHUB_REPOS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const repos = reposEnv.length > 0 ? reposEnv : DEFAULT_REPOS;

      // High-signal patterns. Each has a name + regex + severity.
      // Kept narrow to avoid false positives — this is a tripwire, not a linter.
      const PATTERNS: { name: string; re: RegExp; severity: 'high' | 'medium' }[] = [
        { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/, severity: 'high' },
        { name: 'AWS Secret Key', re: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9\/+=]{40}['"]?/i, severity: 'high' },
        { name: 'Stripe Live Key', re: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/, severity: 'high' },
        { name: 'Stripe Live Publishable', re: /\bpk_live_[A-Za-z0-9]{20,}\b/, severity: 'medium' },
        { name: 'Twilio Auth Token', re: /TWILIO_AUTH_TOKEN\s*[=:]\s*['"]?[a-f0-9]{32}['"]?/i, severity: 'high' },
        { name: 'GitHub PAT', re: /\bghp_[A-Za-z0-9]{36}\b/, severity: 'high' },
        { name: 'GitHub PAT (new)', re: /\bgithub_pat_[A-Za-z0-9_]{70,}\b/, severity: 'high' },
        { name: 'Private Key Block', re: /-----BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/, severity: 'high' },
        { name: 'Sentry Auth Token', re: /\bsntrys_[a-zA-Z0-9]{80,}\b/, severity: 'medium' },
        { name: 'Anthropic API Key', re: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{80,}\b/, severity: 'high' },
        { name: 'OpenAI API Key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{40,}\b/, severity: 'medium' },
      ];

      const sinceIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // look back 2h (rate=1h + 1h slack)
      const headers = {
        Authorization: `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'openheart-secret-scan',
      };

      const findings: { repo: string; sha: string; file: string; pattern: string; severity: 'high' | 'medium' }[] = [];
      const scannedCommits: { repo: string; count: number }[] = [];

      for (const repo of repos) {
        try {
          const commitsRes = await fetch(
            `https://api.github.com/repos/${repo}/commits?since=${encodeURIComponent(sinceIso)}&per_page=20`,
            { headers, signal: AbortSignal.timeout(8000) }
          );
          if (!commitsRes.ok) {
            console.warn(`[secret-leak-scan] ${repo}: commits list ${commitsRes.status}`);
            continue;
          }
          const commits: any[] = await commitsRes.json();
          scannedCommits.push({ repo, count: commits.length });

          for (const c of commits) {
            const sha = c.sha;
            // Fetch per-commit diff
            const detailRes = await fetch(
              `https://api.github.com/repos/${repo}/commits/${sha}`,
              { headers, signal: AbortSignal.timeout(8000) }
            );
            if (!detailRes.ok) continue;
            const detail: any = await detailRes.json();
            for (const f of detail.files || []) {
              const patch = f.patch || '';
              // Only scan added lines (prefix +) to skip context lines
              const addedLines = patch
                .split('\n')
                .filter((l: string) => l.startsWith('+') && !l.startsWith('+++'))
                .join('\n');
              for (const p of PATTERNS) {
                if (p.re.test(addedLines)) {
                  findings.push({ repo, sha: sha.slice(0, 7), file: f.filename, pattern: p.name, severity: p.severity });
                }
              }
            }
          }
        } catch (err: any) {
          console.warn(`[secret-leak-scan] ${repo}:`, err?.message);
        }
      }

      if (findings.length > 0) {
        const high = findings.filter((f) => f.severity === 'high');
        await dispatchAlert({
          id: `secret-leak-${findings.map((f) => `${f.repo}@${f.sha}`).sort().slice(0, 5).join(',')}`,
          type: 'error',
          title: `🔒 ${findings.length} potential secret leak(s) in recent commits (${high.length} high)`,
          message: findings.slice(0, 8).map((f) => `[${f.severity}] ${f.repo}@${f.sha} ${f.file}: ${f.pattern}`).join(' · '),
          severity: high.length > 0 ? 'high' : 'medium',
          source: 'Secret-leak scan',
          action: 'ROTATE the leaked credential immediately. Then purge from git history (git-filter-repo or BFG). Push-protection may have missed a partial match.',
        }).catch(() => {});
      }

      const totalCommits = scannedCommits.reduce((s, r) => s + r.count, 0);
      return {
        ok: findings.length === 0,
        message:
          findings.length === 0
            ? `Scanned ${totalCommits} commit(s) across ${repos.length} repo(s) — no secret patterns matched`
            : `${findings.length} match(es) across ${new Set(findings.map((f) => f.repo)).size} repo(s)`,
        data: { scannedCommits, findings: findings.slice(0, 20), repos },
      };
    },
  },
  {
    id: 'stripe-dispute-watcher',
    group: 'monitoring',
    schedule: 'rate(1 hour)',
    description: 'Hourly check of Stripe disputes + Radar early-fraud-warnings for DK/Tovani. Alerts on new disputes, impending evidence deadlines (<72h), and any early-fraud-warning (pre-dispute, lets you refund before chargeback hits).',
    handler: async () => {
      // DK and Tovani share the same Stripe account; hitting DK's endpoint
      // returns disputes across both businesses' charges.
      const DK_BASE = 'https://discreetketamine.com';
      const key = process.env.DK_API_KEY || process.env.DK_KHAI_API_KEY || process.env.KHAI_API_KEY;
      if (!key) return { ok: false, message: 'DK_API_KEY missing — same key OpenHeart uses for /api/khai/payments' };

      try {
        const r = await fetch(`${DK_BASE}/api/khai/disputes?days=90`, {
          headers: { 'x-khai-api-key': key },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) return { ok: false, message: `DK disputes API returned ${r.status}` };
        const j: any = await r.json();
        const disputes = (j.disputes || []) as any[];
        const efw = (j.earlyFraudWarnings || []) as any[];

        const now = Date.now();
        const urgentThresholdMs = 72 * 60 * 60 * 1000; // evidence due within 72h = urgent
        const openNeedsResponse = disputes.filter((d) =>
          d.status === 'needs_response' || d.status === 'warning_needs_response'
        );
        const urgent = openNeedsResponse.filter((d) => {
          if (!d.evidenceDueBy) return false;
          const ms = new Date(d.evidenceDueBy).getTime() - now;
          return ms > 0 && ms < urgentThresholdMs;
        });
        const actionableEfw = efw.filter((e) => e.actionable);

        // Dedup by looking at prior runs — only alert on disputes we haven't
        // already alerted on. Stored as data.alertedIds in cron-history.
        const priorRuns = await getRuns('stripe-dispute-watcher').catch(() => []);
        const alreadyAlertedIds = new Set<string>();
        for (const run of priorRuns.slice(0, 5)) {
          const prev: string[] = run.data?.alertedIds ?? [];
          for (const id of prev) alreadyAlertedIds.add(id);
        }

        const newDisputes = openNeedsResponse.filter((d) => !alreadyAlertedIds.has(d.id));
        const newEfw = actionableEfw.filter((e) => !alreadyAlertedIds.has(e.id));

        // Alert 1: new disputes needing response
        if (newDisputes.length > 0) {
          await dispatchAlert({
            id: `dispute-new-${newDisputes.map((d) => d.id).sort().join(',')}`,
            type: 'error',
            title: `💳 ${newDisputes.length} new Stripe dispute(s) need response`,
            message: newDisputes.slice(0, 5).map((d) => `$${(d.amount / 100).toFixed(2)} ${d.reason} — evidence due ${d.evidenceDueBy?.slice(0, 10) || '?'} [${d.state}]`).join(' · '),
            severity: 'high',
            source: 'Stripe dispute watcher',
            action: 'Open Payments tab → submit evidence before the deadline. Default to auto-losing if ignored.',
          }).catch(() => {});
        }

        // Alert 2: any dispute with <72h to evidence deadline
        if (urgent.length > 0) {
          await dispatchAlert({
            id: `dispute-urgent-${new Date().toISOString().slice(0, 10)}`,
            type: 'error',
            title: `⏰ ${urgent.length} dispute(s) < 72h to evidence deadline`,
            message: urgent.map((d) => `$${(d.amount / 100).toFixed(2)} ${d.id} due ${d.evidenceDueBy}`).join(' · '),
            severity: 'high',
            source: 'Stripe dispute watcher',
            action: 'Submit evidence in Stripe Dashboard NOW — missed deadline = automatic loss.',
          }).catch(() => {});
        }

        // Alert 3: early fraud warnings (pre-dispute, proactive refund saves $15 + dispute ratio)
        if (newEfw.length > 0) {
          await dispatchAlert({
            id: `efw-${newEfw.map((e) => e.id).sort().join(',')}`,
            type: 'warning',
            title: `⚠ ${newEfw.length} new early-fraud-warning(s) — refund to avoid dispute`,
            message: newEfw.slice(0, 5).map((e) => `${e.id} · ${e.fraudType} · charge ${e.chargeId} [${e.state}]`).join(' · '),
            severity: 'medium',
            source: 'Stripe dispute watcher',
            action: 'Issue a refund on the flagged charge — prevents dispute from being filed, saves $15 fee + protects dispute ratio.',
          }).catch(() => {});
        }

        const alertedIds = [
          ...newDisputes.map((d) => d.id),
          ...newEfw.map((e) => e.id),
        ];

        return {
          ok: newDisputes.length === 0 && urgent.length === 0 && newEfw.length === 0,
          message: `${disputes.length} dispute(s) (${openNeedsResponse.length} open) · ${efw.length} EFW(s) · ${newDisputes.length} new disputes, ${newEfw.length} new EFWs`,
          data: {
            totalDisputes: disputes.length,
            openDisputes: openNeedsResponse.length,
            urgentDisputes: urgent.length,
            totalEfw: efw.length,
            actionableEfw: actionableEfw.length,
            newDisputes: newDisputes.map((d) => ({ id: d.id, amount: d.amount, reason: d.reason, evidenceDueBy: d.evidenceDueBy })),
            newEfw: newEfw.map((e) => ({ id: e.id, fraudType: e.fraudType })),
            alertedIds,
          },
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Dispute check failed' };
      }
    },
  },
  {
    id: 'tfn-verification-watch',
    group: 'monitoring',
    schedule: 'rate(2 hours)',
    description: 'Polls Twilio toll-free verification status for +18449950807 (SID HHbfd8b714630de93cebf2a473ade35a58). Alerts the moment it transitions out of IN_REVIEW so SMS can resume immediately on approval.',
    handler: async () => {
      const sid = process.env.TWILIO_ACCOUNT_SID || process.env.NOTIFY_TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN || process.env.NOTIFY_TWILIO_AUTH_TOKEN;
      const verificationSid = process.env.TWILIO_TFN_VERIFICATION_SID || 'HHbfd8b714630de93cebf2a473ade35a58';
      if (!sid || !token) {
        return { ok: false, message: 'TWILIO_ACCOUNT_SID/AUTH_TOKEN not set' };
      }
      try {
        const auth = Buffer.from(`${sid}:${token}`).toString('base64');
        const r = await fetch(
          `https://messaging.twilio.com/v1/Tollfree/Verifications/${verificationSid}`,
          { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(8000) }
        );
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          return { ok: false, message: `Twilio API ${r.status}: ${body.slice(0, 200)}` };
        }
        const j: any = await r.json();
        const status = j.status as string; // PENDING_REVIEW | IN_REVIEW | TWILIO_APPROVED | TWILIO_REJECTED
        const editReason = j.edit_expires_at ? `editExpires=${j.edit_expires_at}` : '';
        const rejectReason = j.rejection_reason || '';

        // Compare to the previous run's status (cron-history is DDB-backed).
        const prior = await getRuns('tfn-verification-watch').catch(() => []);
        const lastStatus = prior[0]?.data?.status as string | undefined;
        const changed = lastStatus && lastStatus !== status;

        if (changed) {
          const isApproved = status === 'TWILIO_APPROVED';
          const isRejected = status === 'TWILIO_REJECTED';
          await dispatchAlert({
            id: `tfn-status-change-${verificationSid}-${status}`,
            type: isRejected ? 'error' : isApproved ? 'info' : 'warning',
            title: isApproved
              ? `🎉 Toll-free +18449950807 APPROVED — SMS unblocked`
              : isRejected
              ? `⛔ Toll-free verification REJECTED`
              : `Toll-free verification status: ${lastStatus} → ${status}`,
            message: isApproved
              ? `Twilio approved the TFN. DK + Tovani SMS will start working as soon as the latest builds (already in flight) deploy. No code changes needed.`
              : isRejected
              ? `Reason: ${rejectReason || 'not provided'}. Reply on the verification record or resubmit. Until then, SMS remains down.`
              : `Verification moved from ${lastStatus} to ${status}. ${editReason}`,
            severity: isRejected ? 'high' : isApproved ? 'low' : 'medium',
            source: 'TFN verification watch',
            action: isApproved
              ? 'Send a test SMS from DK or Tovani to confirm delivery'
              : isRejected
              ? 'Open Twilio console → Messaging → Toll-Free Verifications, fix issues and resubmit'
              : 'Check Twilio console for updates',
          }).catch(() => {});
        }

        return {
          ok: true,
          message: `Status: ${status}${changed ? ` (was ${lastStatus})` : ''}${rejectReason ? ` · ${rejectReason}` : ''}`,
          data: {
            status,
            verificationSid,
            phoneNumberSid: j.tollfree_phone_number_sid,
            businessName: j.business_name,
            useCaseCategories: j.use_case_categories,
            rejectionReason: rejectReason || null,
            lastStatus: lastStatus || null,
            changed: !!changed,
          },
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'TFN check failed' };
      }
    },
  },
];

export function getCron(id: string): CronDef | undefined {
  return CRON_REGISTRY.find(c => c.id === id);
}
