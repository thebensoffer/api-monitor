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
      const { getActionHandler, isActionEnabled } = await import('@/lib/alert-triage/actions');
      const { putTriageItem } = await import('@/lib/alert-triage/items');
      const { dispatchAlert } = await import('@/lib/notify');

      let scanned = 0;
      let created = 0;
      let failed = 0;
      const byBucket: Record<string, number> = {
        routine: 0,
        auto_fix: 0,
        investigate: 0,
        escalate: 0,
      };
      const sampleSubjects: string[] = [];

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

          // Phase-1 shadow: invoke handler stub when present, never execute real work.
          let actionResult: Record<string, unknown> | null = null;
          if (classification.proposedAction) {
            const handler = getActionHandler(classification.proposedAction);
            if (handler) {
              const mode = isActionEnabled(classification.proposedAction) ? 'executed' : 'shadow';
              try {
                const r = await handler(classification.actionParams, {
                  platform: (row.platform as any) || 'unknown',
                  sourceMessageId: row.id,
                  subject: row.subject,
                });
                actionResult = { ...r, intendedMode: mode };
              } catch (err: any) {
                actionResult = { ok: false, mode, summary: `Handler threw: ${err?.message}` };
              }
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
            actionStatus: actionResult ? 'shadow' : 'skipped',
            actionResult,
          });
          await markTriaged(row.id, row.receivedAt);

          byBucket[classification.bucket] = (byBucket[classification.bucket] || 0) + 1;
          if (
            classification.bucket !== 'routine' &&
            sampleSubjects.length < 5
          ) {
            sampleSubjects.push(`[${classification.bucket}] ${row.subject.slice(0, 80)}`);
          }
          created++;
        } catch (err: any) {
          console.error('[email-alert-triage] row failed', { id: row.id, err: err?.message });
          failed++;
        }
      }

      // Severity routing: escalate > auto_fix > investigate > routine
      const worstSeverity: 'high' | 'medium' | 'low' =
        byBucket.escalate > 0 ? 'high' : byBucket.auto_fix > 0 ? 'medium' : byBucket.investigate > 0 ? 'low' : 'low';

      // Only emit a notification when something new landed
      if (created > 0) {
        try {
          await dispatchAlert({
            id: `alert-triage-${new Date().toISOString().slice(0, 13)}`, // hourly dedup bucket
            type:
              byBucket.escalate > 0 ? 'error' : byBucket.auto_fix > 0 ? 'warning' : 'info',
            severity: worstSeverity,
            title: `Alert triage: ${created} new (${byBucket.escalate}🚨 ${byBucket.auto_fix}🛠️ ${byBucket.investigate}🔎 ${byBucket.routine}✅)`,
            message:
              sampleSubjects.length > 0
                ? sampleSubjects.join('\n')
                : `${created} routine alerts classified, nothing needing attention.`,
            source: 'alert-triage cron',
            action: 'Open dashboard → Triage tab for details',
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
];

export function getCron(id: string): CronDef | undefined {
  return CRON_REGISTRY.find(c => c.id === id);
}
