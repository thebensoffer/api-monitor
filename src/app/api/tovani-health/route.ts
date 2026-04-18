import { NextRequest, NextResponse } from 'next/server';
import { probe } from '@/lib/probe';
import { recordVersion, getVersionHistory } from '@/lib/version-tracker';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base = process.env.TOVANI_BASE_URL || 'https://tovanihealth.com';
  const healthUrl = process.env.TOVANI_HEALTH_URL || `${base}/api/health`;
  const sysUrl = process.env.TOVANI_SYSTEM_HEALTH_URL || `${base}/api/system-health`;
  const commsUrl = process.env.TOVANI_COMMS_URL || `${base}/api/khai/communications`;
  const khaiKey = process.env.TOVANI_KHAI_API_KEY || '';
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const probes = await Promise.all([
    probe({ endpoint: 'health', url: healthUrl }),
    probe({ endpoint: 'system-health', url: sysUrl }),
    probe({ endpoint: 'marketing-site', url: `${base}/`, method: 'HEAD' }),
    probe({
      endpoint: 'khai-communications',
      url: `${commsUrl}?type=all&since=${encodeURIComponent(since)}`,
      headers: khaiKey ? { 'x-khai-api-key': khaiKey } : {},
    }),
  ]);

  // Track build/version drift (deployment markers)
  const sysProbe = probes.find((p) => p.endpoint === 'system-health');
  recordVersion('tovani-system', sysProbe?.response?.parsedBody?.build?.version, {
    httpStatus: sysProbe?.response?.httpStatus,
    durationMs: sysProbe?.response?.durationMs,
  });
  const healthProbe = probes.find((p) => p.endpoint === 'health');
  recordVersion('tovani-health', healthProbe?.response?.parsedBody?.version, {
    environment: healthProbe?.response?.parsedBody?.environment,
  });

  const summary = {
    totalProbes: probes.length,
    ok: probes.filter((p) => p.response?.ok).length,
    failed: probes.filter((p) => p.error || (p.response && !p.response.ok)).length,
    avgResponseMs: Math.round(
      probes.reduce((s, p) => s + (p.response?.durationMs || 0), 0) /
        Math.max(1, probes.filter((p) => p.response).length)
    ),
  };

  return NextResponse.json({
    success: true,
    target: 'tovanihealth.com',
    generatedAt: new Date().toISOString(),
    summary,
    probes,
    deployments: getVersionHistory(),
  });
}
