import { NextRequest, NextResponse } from 'next/server';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  service: string;
  message: string;
  metadata?: Record<string, any>;
}

// Mock log data - in a real app this would come from a logging service
const generateMockLogs = (): LogEntry[] => {
  const logs: LogEntry[] = [];
  const services = ['DK', 'DBS', 'Tovani', 'Analytics', 'Sentry', 'Stripe', 'Communications'];
  const messages = [
    'Health check completed successfully',
    'New patient registration processed',
    'Payment processed successfully',
    'Email sent to patient',
    'Error auto-fixed and deployed',
    'Database query optimized',
    'Cache refreshed',
    'API response time improved',
    'Session started from Miami, FL',
    'Form submission received',
    'Prescription sent to pharmacy',
    'Appointment scheduled',
    'Tovani lead captured via /api/leads/email-capture',
    'Tovani patient onboarding step submitted',
    'Tovani DrChrono sync completed',
    'Tovani Stripe webhook received',
    'Tovani eligibility check passed'
  ];

  const now = new Date();
  
  // Generate logs for the past 2 hours
  for (let i = 0; i < 50; i++) {
    const timestamp = new Date(now.getTime() - (i * 2 * 60 * 1000)).toISOString();
    const service = services[Math.floor(Math.random() * services.length)];
    const message = messages[Math.floor(Math.random() * messages.length)];
    
    let level: 'info' | 'warning' | 'error' = 'info';
    if (Math.random() < 0.1) level = 'warning';
    if (Math.random() < 0.05) level = 'error';
    
    logs.push({
      timestamp,
      level,
      service,
      message,
      metadata: {
        responseTime: Math.floor(Math.random() * 500) + 50,
        ip: `192.168.1.${Math.floor(Math.random() * 255)}`,
        userAgent: 'Dashboard Monitor'
      }
    });
  }
  
  return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

export async function GET(request: NextRequest) {
  // Verify API key
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);
    const level = searchParams.get('level') as 'info' | 'warning' | 'error' | null;
    const service = searchParams.get('service');
    const since = searchParams.get('since');

    let logs = generateMockLogs();

    // Apply filters
    if (level) {
      logs = logs.filter(log => log.level === level);
    }

    if (service) {
      logs = logs.filter(log => log.service.toLowerCase().includes(service.toLowerCase()));
    }

    if (since) {
      const sinceDate = new Date(since);
      logs = logs.filter(log => new Date(log.timestamp) > sinceDate);
    }

    // Apply limit
    logs = logs.slice(0, limit);

    return NextResponse.json({
      success: true,
      logs,
      total: logs.length,
      filters: {
        limit,
        level,
        service,
        since
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch logs',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}