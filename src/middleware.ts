import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // Only protect API routes and dashboard pages
  if (request.nextUrl.pathname.startsWith('/api') || 
      request.nextUrl.pathname.startsWith('/dashboard')) {
    
    const apiKey = request.headers.get('x-monitor-key');
    const expectedKey = process.env.MONITOR_API_KEY;
    
    if (!apiKey || apiKey !== expectedKey) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*']
};