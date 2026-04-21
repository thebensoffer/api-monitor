import { NextRequest, NextResponse } from 'next/server';
import { CRON_REGISTRY } from '@/lib/cron-registry';
import { getAllLatest, getRuns } from '@/lib/cron-history';

export const dynamic = 'force-dynamic';

/**
 * Index endpoint — lists every cron OpenHeart owns, with its schedule,
 * last-run, and full recent-run history.
 */
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const latest = await getAllLatest();
  const crons = await Promise.all(
    CRON_REGISTRY.map(async (c) => ({
      id: c.id,
      group: c.group,
      schedule: c.schedule,
      description: c.description,
      addedAt: c.addedAt ?? null,
      lastRun: latest[c.id] ?? null,
      history: await getRuns(c.id),
    }))
  );

  const summary = {
    total: crons.length,
    everRun: crons.filter((c) => c.lastRun).length,
    lastRunOk: crons.filter((c) => c.lastRun?.ok).length,
    lastRunFail: crons.filter((c) => c.lastRun && !c.lastRun.ok).length,
  };

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    summary,
    crons,
  });
}
