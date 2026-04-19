import { NextRequest, NextResponse } from 'next/server';
import { probe } from '@/lib/probe';
import { dispatchAlert } from '@/lib/notify';

export const dynamic = 'force-dynamic';

interface Alert {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: string;
  source: string;
  action: string;
  metadata?: Record<string, any>;
}

async function healthAlert(site: string, label: string, baseUrl: string): Promise<Alert> {
  const p = await probe({ endpoint: `${site}.health`, url: `${baseUrl}/api/health`, timeoutMs: 5000 });
  const ms = p.response?.durationMs ?? 0;
  const status = p.response?.httpStatus;
  const ok = p.response?.ok;

  if (!ok) {
    return {
      id: `${site}-health-down`,
      type: 'error',
      title: `${label} health endpoint ${status ?? 'unreachable'}`,
      message: p.error ?? `HTTP ${status}`,
      severity: 'high',
      timestamp: new Date().toISOString(),
      source: `${label} health`,
      action: `Check ${baseUrl}/api/health and the RDS instance`,
      metadata: { url: `${baseUrl}/api/health`, httpStatus: status, responseTime: ms },
    };
  }
  if (ms > 1500) {
    return {
      id: `${site}-health-slow`,
      type: 'warning',
      title: `${label} responding slowly`,
      message: `Health endpoint took ${ms}ms (threshold 1500ms)`,
      severity: 'medium',
      timestamp: new Date().toISOString(),
      source: `${label} health`,
      action: 'Investigate RDS or SSR cold start',
      metadata: { url: `${baseUrl}/api/health`, httpStatus: status, responseTime: ms },
    };
  }
  return {
    id: `${site}-health-ok`,
    type: 'success',
    title: `${label} healthy`,
    message: `Response ${ms}ms`,
    severity: 'low',
    timestamp: new Date().toISOString(),
    source: `${label} health`,
    action: 'No action required',
    metadata: { url: `${baseUrl}/api/health`, httpStatus: status, responseTime: ms },
  };
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Live probes against each site — no hardcoded values
    const alerts = await Promise.all([
      healthAlert('tovani', 'Tovani Health', process.env.TOVANI_BASE_URL || 'https://tovanihealth.com'),
      healthAlert('dk', 'Discreet Ketamine', 'https://discreetketamine.com'),
      healthAlert('dbs', 'Dr Ben Soffer', 'https://drbensoffer.com'),
    ]);

    // Fire notifications for non-success alerts (dispatcher dedups within 4h window)
    const notifications = await Promise.all(
      alerts
        .filter((a) => a.type !== 'success')
        .map(async (a) => ({
          alertId: a.id,
          results: await dispatchAlert({
            id: a.id,
            type: a.type,
            title: a.title,
            message: a.message,
            severity: a.severity,
            source: a.source,
            action: a.action,
          }).catch(() => []),
        }))
    );

    return NextResponse.json({
      success: true,
      alerts,
      total: alerts.length,
      active: alerts.filter((a) => a.type !== 'success').length,
      notifications,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch alerts' },
      { status: 500 }
    );
  }
}
