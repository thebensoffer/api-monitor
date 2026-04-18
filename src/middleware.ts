import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!path.startsWith('/api')) return NextResponse.next();

  const monitorKey = request.headers.get('x-monitor-key');
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  const expectedMonitor = process.env.MONITOR_API_KEY;
  const expectedCron = process.env.CRON_SECRET;

  // Cron dispatcher accepts either monitor key (manual UI) or cron secret (EventBridge).
  if (path.startsWith('/api/cron')) {
    const okMonitor = !!expectedMonitor && monitorKey === expectedMonitor;
    const okCron = !!expectedCron && cronSecret === expectedCron;
    if (okMonitor || okCron) return NextResponse.next();
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // All other /api/* routes require monitor key.
  if (!monitorKey || monitorKey !== expectedMonitor) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};