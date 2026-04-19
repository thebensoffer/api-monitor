import { NextRequest, NextResponse } from 'next/server';
import { getAllLatest, getRecent } from '@/lib/synthetic';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scenario = searchParams.get('scenario');

  if (scenario) {
    const recent = await getRecent(scenario, 25);
    return NextResponse.json({ success: true, scenario, recent });
  }

  const latest = await getAllLatest();
  const now = Date.now();
  const entries = Object.values(latest).map((r) => ({
    ...r,
    ageMinutes: Math.floor((now - new Date(r.ts).getTime()) / 60000),
  }));
  entries.sort((a, b) => a.scenario.localeCompare(b.scenario));

  return NextResponse.json({
    success: true,
    summary: {
      scenarios: entries.length,
      ok: entries.filter((e) => e.ok).length,
      failed: entries.filter((e) => !e.ok).length,
      stale: entries.filter((e) => e.ageMinutes > 120).length,
    },
    latest: entries,
  });
}
