import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Live Tovani Health probe — turn into a real alert if it's not healthy
    const tovaniAlerts: any[] = [];
    try {
      const t0 = Date.now();
      const url = process.env.TOVANI_HEALTH_URL || 'https://tovanihealth.com/api/health';
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const responseTime = Date.now() - t0;
      const text = await resp.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch {}

      if (!resp.ok) {
        tovaniAlerts.push({
          id: 'tovani-health-down',
          type: 'error',
          title: 'Tovani Health endpoint returned ' + resp.status,
          message: body?.checks?.database?.error
            ? `Database check: ${body.checks.database.error}`
            : `Health check failed in ${responseTime}ms`,
          severity: 'high',
          timestamp: new Date().toISOString(),
          source: 'Tovani Health',
          action: 'Check tovanihealth.com /api/health and RDS instance',
          metadata: { url, httpStatus: resp.status, responseTime, payloadPreview: text.slice(0, 400) }
        });
      } else if (responseTime > 1500) {
        tovaniAlerts.push({
          id: 'tovani-health-slow',
          type: 'warning',
          title: 'Tovani Health responding slowly',
          message: `Health endpoint responded in ${responseTime}ms (threshold 1500ms)`,
          severity: 'medium',
          timestamp: new Date().toISOString(),
          source: 'Tovani Health',
          action: 'Investigate RDS / Vercel function cold start',
          metadata: { url, httpStatus: resp.status, responseTime, dbLatencyMs: body?.checks?.database?.latencyMs }
        });
      } else {
        tovaniAlerts.push({
          id: 'tovani-health-ok',
          type: 'success',
          title: 'Tovani Health is healthy',
          message: `DB latency ${body?.checks?.database?.latencyMs ?? '?'}ms · response ${responseTime}ms`,
          severity: 'low',
          timestamp: new Date().toISOString(),
          source: 'Tovani Health',
          action: 'No action required',
          metadata: { url, httpStatus: resp.status, responseTime, version: body?.version, environment: body?.environment }
        });
      }
    } catch (err) {
      tovaniAlerts.push({
        id: 'tovani-health-unreachable',
        type: 'error',
        title: 'Tovani Health unreachable',
        message: err instanceof Error ? err.message : 'Network/timeout error',
        severity: 'high',
        timestamp: new Date().toISOString(),
        source: 'Tovani Health',
        action: 'Verify deployment and DNS for tovanihealth.com'
      });
    }

    const alerts = [
      ...tovaniAlerts,
      {
        id: 'bounce-rate-high',
        type: 'warning',
        title: 'DK Bounce Rate Above Threshold', 
        message: '89% bounce rate exceeds 85% threshold',
        severity: 'high',
        timestamp: new Date(Date.now() - 300000).toISOString(), // 5 min ago
        source: 'Analytics',
        action: 'Optimize homepage CTA'
      },
      {
        id: 'conversion-spike',
        type: 'success',
        title: 'DBS Consultation Bookings Peak',
        message: '91% conversion rate - best performance on record',
        severity: 'low',
        timestamp: new Date(Date.now() - 600000).toISOString(), // 10 min ago  
        source: 'Business Intelligence',
        action: 'Replicate successful messaging'
      },
      {
        id: 'email-decline', 
        type: 'info',
        title: 'Email Response Rate Declining',
        message: 'Follow-up emails: 67% open rate (down from 78%)',
        severity: 'medium',
        timestamp: new Date(Date.now() - 1800000).toISOString(), // 30 min ago
        source: 'Communications',
        action: 'Update email templates'
      }
    ];

    return NextResponse.json({
      success: true,
      alerts,
      total: alerts.length,
      active: alerts.filter(a => a.type !== 'success').length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch alerts'
    }, { status: 500 });
  }
}