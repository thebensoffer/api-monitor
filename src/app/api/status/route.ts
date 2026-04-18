import { NextRequest } from 'next/server';
import { probe, probeToService } from '@/lib/probe';
import { recordVersion, getVersionHistory } from '@/lib/version-tracker';

export const dynamic = 'force-dynamic';

// Real-time health check for all services — every service captures full
// request/response detail (URL, headers, body, status, ms) so the UI can
// drill into any of them, not just Tovani.
export async function GET(_request: NextRequest) {
  const services: any[] = [];

  // ── Run every external probe in parallel ──
  const [
    dkProbe,
    dbsProbe,
    tovaniHealth,
    tovaniSystem,
    tovaniSite,
    dkComms,
    dbsComms,
    sentryProbe,
    ga4Probe,
    gscProbe,
    stripeStatus,
    twilioStatus,
    resendStatus,
  ] = await Promise.all([
    probe({ endpoint: 'dk-health', url: 'https://discreetketamine.com/api/health' }),
    probe({ endpoint: 'dbs-health', url: 'https://drbensoffer.com/api/health' }),
    probe({
      endpoint: 'tovani-health',
      url: process.env.TOVANI_HEALTH_URL || 'https://tovanihealth.com/api/health',
    }),
    probe({
      endpoint: 'tovani-system-health',
      url: process.env.TOVANI_SYSTEM_HEALTH_URL || 'https://tovanihealth.com/api/system-health',
    }),
    probe({
      endpoint: 'tovani-site',
      url: (process.env.TOVANI_BASE_URL || 'https://tovanihealth.com') + '/',
      method: 'HEAD',
    }),
    probe({
      endpoint: 'dk-comms',
      url:
        'https://discreetketamine.com/api/khai/communications?type=all&since=' +
        new Date(Date.now() - 60000).toISOString(),
      headers: { 'x-khai-api-key': process.env.DK_API_KEY || '' },
    }),
    probe({
      endpoint: 'dbs-comms',
      url:
        'https://drbensoffer.com/api/khai/communications?type=all&since=' +
        new Date(Date.now() - 60000).toISOString(),
      headers: { 'x-khai-api-key': process.env.DBS_API_KEY || '' },
    }),
    probe({
      endpoint: 'sentry',
      url: 'https://sentry.io/api/0/organizations/bensoffer/projects/',
      headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN || ''}` },
    }),
    probe({
      endpoint: 'ga4',
      url: 'http://localhost:3000/api/ga4-analytics?range=1d&site=both',
      headers: { 'x-monitor-key': process.env.MONITOR_API_KEY || '' },
    }),
    probe({
      endpoint: 'gsc',
      url: 'http://localhost:3000/api/gsc-data?range=7d&site=both',
      headers: { 'x-monitor-key': process.env.MONITOR_API_KEY || '' },
    }),
    probe({ endpoint: 'stripe-status', url: 'https://status.stripe.com/api/v2/status.json' }),
    probe({ endpoint: 'twilio-status', url: 'https://status.twilio.com/api/v2/status.json' }),
    probe({ endpoint: 'resend-status', url: 'https://resend-status.com/api/v2/status.json' }),
  ]);

  // Map status.io-style "indicator" -> our status enum
  function indicatorToStatus(p: any, name: string) {
    const ind = p.response?.parsedBody?.status?.indicator;
    const desc = p.response?.parsedBody?.status?.description;
    if (p.error || !p.response?.ok) {
      return probeToService(name.toLowerCase().replace(/ /g, '-'), name, p, { provider: 'status-page' });
    }
    const status: 'online' | 'warning' | 'error' =
      ind === 'none' ? 'online' : ind === 'minor' ? 'warning' : 'error';
    return {
      key: name.toLowerCase().replace(/ /g, '-'),
      name,
      status,
      responseTime: p.response.durationMs,
      lastCheck: p.response.receivedAt,
      metadata: {
        url: p.url,
        httpStatus: p.response.httpStatus,
        contentLength: p.response.contentLength,
        provider: 'status-page',
        indicator: ind,
        statusDescription: desc,
      },
      transmission: p,
    };
  }

  services.push(probeToService('dk', 'Discreet Ketamine', dkProbe));
  services.push(probeToService('dbs', 'Dr Ben Soffer', dbsProbe));

  services.push(
    probeToService('tovani', 'Tovani Health', tovaniHealth, {
      dbLatencyMs: tovaniHealth.response?.parsedBody?.checks?.database?.latencyMs ?? null,
      dbStatus: tovaniHealth.response?.parsedBody?.checks?.database?.status ?? null,
      envStatus: tovaniHealth.response?.parsedBody?.checks?.environment?.status ?? null,
      serviceVersion: tovaniHealth.response?.parsedBody?.version ?? null,
      environment: tovaniHealth.response?.parsedBody?.environment ?? null,
    })
  );
  services.push(
    probeToService('tovani-system', 'Tovani System Health', tovaniSystem, {
      buildVersion: tovaniSystem.response?.parsedBody?.build?.version ?? null,
      buildStatus: tovaniSystem.response?.parsedBody?.build?.status ?? null,
      apiStatus: tovaniSystem.response?.parsedBody?.services?.api ?? null,
    })
  );
  services.push(
    probeToService('tovani-site', 'Tovani Marketing Site', tovaniSite, {
      cacheStatus:
        tovaniSite.response?.headers?.['x-vercel-cache'] ||
        tovaniSite.response?.headers?.['x-cache'] ||
        'n/a',
    })
  );

  // Register deploy versions for the timeline
  recordVersion(
    'tovani-system',
    tovaniSystem.response?.parsedBody?.build?.version,
    { source: 'status' }
  );
  recordVersion('tovani-health', tovaniHealth.response?.parsedBody?.version, {
    source: 'status',
    environment: tovaniHealth.response?.parsedBody?.environment,
  });
  recordVersion('dk-health', dkProbe.response?.parsedBody?.version, { source: 'status' });
  recordVersion('dbs-health', dbsProbe.response?.parsedBody?.version, { source: 'status' });

  services.push(probeToService('dk-comms', 'DK Communications', dkComms, { endpoint: 'khai/communications' }));
  services.push(probeToService('dbs-comms', 'DBS Communications', dbsComms, { endpoint: 'khai/communications' }));

  if (sentryProbe.response?.ok) {
    const projects = sentryProbe.response.parsedBody;
    services.push(
      probeToService('sentry', 'Sentry Monitoring', sentryProbe, {
        org: 'bensoffer',
        projects: Array.isArray(projects) ? projects.length : 0,
        activeProjects: Array.isArray(projects)
          ? projects.filter((p: any) => p.status === 'active').length
          : 0,
      })
    );
  } else {
    services.push(probeToService('sentry', 'Sentry Monitoring', sentryProbe));
  }

  services.push(
    probeToService('ga4', 'Google Analytics', ga4Probe, {
      properties: 'DK, DBS',
      note: 'Mock data - GA4 integration ready',
    })
  );
  services.push(
    probeToService('gsc', 'Google Search Console', gscProbe, {
      properties: 'DK, DBS',
      note: 'Mock data - GSC integration ready',
    })
  );

  // Real status-page probes for the third-party services we depend on
  services.push(indicatorToStatus(stripeStatus, 'Stripe Payments'));
  services.push(indicatorToStatus(twilioStatus, 'Twilio SMS'));
  services.push(indicatorToStatus(resendStatus, 'Resend Email'));

  const summary = {
    total: services.length,
    online: services.filter((s) => s.status === 'online').length,
    warnings: services.filter((s) => s.status === 'warning').length,
    errors: services.filter((s) => s.status === 'error').length,
  };

  return Response.json({
    services,
    lastUpdated: new Date().toISOString(),
    summary,
    deployments: getVersionHistory(),
  });
}
