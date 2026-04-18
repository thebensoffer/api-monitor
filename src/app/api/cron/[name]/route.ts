import { NextRequest, NextResponse } from 'next/server';
import { getCron } from '@/lib/cron-registry';
import { recordRun, type CronRun } from '@/lib/cron-history';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

/**
 * Dynamic cron dispatcher.
 *   GET /api/cron/<id>      → run this cron (auth required)
 *
 * Auth (any of):
 *   Header: x-cron-secret: <CRON_SECRET>
 *   Header: x-monitor-key: <MONITOR_API_KEY>          (manual UI trigger)
 *   Header: Authorization: Bearer <CRON_SECRET>       (EventBridge convention)
 */
function authorized(req: NextRequest): { ok: boolean; source: CronRun['source'] } {
  const cronSecret = process.env.CRON_SECRET || '';
  const monitorKey = process.env.MONITOR_API_KEY || '';
  const provided = req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const monitor = req.headers.get('x-monitor-key');

  if (monitor && monitorKey && safeEqual(monitor, monitorKey)) {
    return { ok: true, source: 'manual' };
  }
  if (provided && cronSecret && safeEqual(provided, cronSecret)) {
    return { ok: true, source: 'eventbridge' };
  }
  return { ok: false, source: 'manual' };
}

function safeEqual(a: string, b: string) {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const auth = authorized(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cron = getCron(name);
  if (!cron) return NextResponse.json({ error: `Unknown cron: ${name}` }, { status: 404 });

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let result;
  let error: string | undefined;
  try {
    result = await cron.handler({ triggeredAt: startedAt, source: auth.source });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    result = { ok: false, message: `Handler threw: ${error}` };
  }
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;

  const run: CronRun = {
    id: cron.id,
    startedAt,
    finishedAt,
    durationMs,
    ok: result.ok,
    message: result.message,
    source: auth.source,
    data: result.data,
    error,
  };
  recordRun(run);

  return NextResponse.json(run, { status: result.ok ? 200 : 500 });
}

export const POST = GET;
