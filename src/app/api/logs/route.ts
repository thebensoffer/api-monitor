import { NextRequest, NextResponse } from 'next/server';
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

export const dynamic = 'force-dynamic';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  service: string;
  message: string;
  metadata?: Record<string, any>;
}

function classify(message: string): 'info' | 'warning' | 'error' {
  const m = message.toLowerCase();
  if (/error|failed|exception|fatal|stack:|traceback|\bmessage:.*error\b/.test(m)) return 'error';
  if (/warn|deprecated|timeout|retr(y|ying)|throttle/.test(m)) return 'warning';
  return 'info';
}

function deriveService(logGroupName: string): string {
  if (logGroupName.includes('amplify')) {
    const m = logGroupName.match(/d[a-z0-9]{12,}/);
    return m ? `amplify/${m[0]}` : 'amplify';
  }
  if (logGroupName.includes('lambda')) {
    return logGroupName.replace(/^\/aws\/lambda\//, 'λ/');
  }
  return logGroupName;
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return NextResponse.json({
      success: false,
      error: 'AWS credentials not configured',
      hint: 'Set OPENHEART_AWS_ACCESS_KEY_ID + OPENHEART_AWS_SECRET_ACCESS_KEY',
    }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const levelFilter = searchParams.get('level') as 'info' | 'warning' | 'error' | null;
  const sinceParam = searchParams.get('since');
  const groupFilter = searchParams.get('service'); // partial match against log group name
  const sinceMs = sinceParam ? new Date(sinceParam).getTime() : Date.now() - 60 * 60 * 1000; // last hour default

  const client = new CloudWatchLogsClient({
    region: process.env.OPENHEART_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    // Pull a focused set of relevant log groups (Amplify SSR + the openheart cron Lambda)
    const groupsResp = await client.send(new DescribeLogGroupsCommand({ limit: 50 }));
    const allGroups = groupsResp.logGroups ?? [];
    const focused = allGroups.filter((g) => {
      const n = g.logGroupName || '';
      return (
        n.includes('amplify') ||
        n.includes('openheart') ||
        n.includes('discreet') ||
        n.includes('tovani') ||
        n.includes('drbensoffer')
      );
    });

    const target = groupFilter
      ? focused.filter((g) => g.logGroupName?.toLowerCase().includes(groupFilter.toLowerCase()))
      : focused.slice(0, 10);

    const eventArrays = await Promise.all(
      target.map(async (g) => {
        try {
          const ev = await client.send(
            new FilterLogEventsCommand({
              logGroupName: g.logGroupName!,
              startTime: sinceMs,
              limit: 30,
            })
          );
          return (ev.events ?? []).map((e): LogEntry => {
            const msg = (e.message || '').trim();
            return {
              timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString(),
              level: classify(msg),
              service: deriveService(g.logGroupName!),
              message: msg.slice(0, 500),
              metadata: { logGroup: g.logGroupName, logStream: e.logStreamName, eventId: e.eventId },
            };
          });
        } catch {
          return [];
        }
      })
    );

    let logs: LogEntry[] = eventArrays.flat();
    if (levelFilter) logs = logs.filter((l) => l.level === levelFilter);
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    logs = logs.slice(0, limit);

    return NextResponse.json({
      success: true,
      source: 'cloudwatch',
      logs,
      total: logs.length,
      groupsScanned: target.length,
      filters: { limit, level: levelFilter, service: groupFilter, since: new Date(sinceMs).toISOString() },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
