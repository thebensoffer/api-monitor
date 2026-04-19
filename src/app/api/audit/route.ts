import { NextRequest, NextResponse } from 'next/server';
import { listAllRecent, listByActor } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const actor = searchParams.get('actor');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  const items = actor ? await listByActor(actor, limit) : await listAllRecent(limit);

  return NextResponse.json({
    success: true,
    count: items.length,
    items,
  });
}
