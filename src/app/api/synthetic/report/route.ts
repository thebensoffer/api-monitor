import { NextRequest, NextResponse } from 'next/server';
import { saveReport } from '@/lib/synthetic';

export const dynamic = 'force-dynamic';

/**
 * Ingestion endpoint for external synthetic-test runners (Khai locally,
 * future remote). POST with { scenario, ok, durationMs, message, steps?, source?, metadata? }.
 *
 * Auth: x-monitor-key (same as the rest of /api/*).
 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body?.scenario || typeof body.ok !== 'boolean') {
    return NextResponse.json(
      { error: 'scenario (string) and ok (bool) required' },
      { status: 400 }
    );
  }

  await saveReport({
    scenario: body.scenario,
    ts: new Date().toISOString(),
    ok: body.ok,
    durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
    message: typeof body.message === 'string' ? body.message : '',
    steps: Array.isArray(body.steps) ? body.steps : undefined,
    source: typeof body.source === 'string' ? body.source : 'unknown',
    metadata: body.metadata ?? undefined,
  });

  return NextResponse.json({ success: true });
}
