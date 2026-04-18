import { NextRequest, NextResponse } from 'next/server';
import { AmplifyClient, ListAppsCommand, ListJobsCommand } from '@aws-sdk/client-amplify';

export const dynamic = 'force-dynamic';

/**
 * Real Amplify build status — pulls every app + most-recent jobs from
 * the AWS Amplify API. Replaces the old Math.random() mock.
 */
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
      hint: 'Set OPENHEART_AWS_ACCESS_KEY_ID + OPENHEART_AWS_SECRET_ACCESS_KEY (openheart-monitor IAM user)',
    }, { status: 503 });
  }

  const client = new AmplifyClient({
    region: process.env.OPENHEART_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });
  const startedAt = new Date().toISOString();

  try {
    const appsResp = await client.send(new ListAppsCommand({ maxResults: 50 }));
    const apps = appsResp.apps ?? [];

    const summaries = await Promise.all(
      apps.map(async (app) => {
        // Pick the production-ish branch: prefer main, then master, else first
        const branches = (app.productionBranch ? [app.productionBranch.branchName] : []) as string[];
        const branchName = branches.find(Boolean) || 'main';
        let jobs: any[] = [];
        try {
          const jobsResp = await client.send(
            new ListJobsCommand({ appId: app.appId!, branchName, maxResults: 5 })
          );
          jobs = jobsResp.jobSummaries ?? [];
        } catch (err) {
          // ignore branch-not-found errors
        }
        const latest = jobs[0];
        const success = jobs.filter((j) => j.status === 'SUCCEED').length;
        const total = jobs.length;
        return {
          appId: app.appId,
          name: app.name,
          domain: app.defaultDomain,
          branch: branchName,
          updateTime: app.updateTime?.toISOString() ?? null,
          latestJob: latest
            ? {
                jobId: latest.jobId,
                status: latest.status,
                jobType: latest.jobType,
                commitId: latest.commitId,
                commitMessage: latest.commitMessage,
                commitTime: latest.commitTime?.toISOString() ?? null,
                startTime: latest.startTime?.toISOString() ?? null,
                endTime: latest.endTime?.toISOString() ?? null,
                durationSeconds:
                  latest.startTime && latest.endTime
                    ? Math.round((latest.endTime.getTime() - latest.startTime.getTime()) / 1000)
                    : null,
              }
            : null,
          recentJobs: jobs.map((j) => ({
            jobId: j.jobId,
            status: j.status,
            startTime: j.startTime?.toISOString() ?? null,
          })),
          successRate: total > 0 ? Math.round((success / total) * 100) : null,
        };
      })
    );

    const aggregate = {
      apps: summaries.length,
      latestStatuses: {
        SUCCEED: summaries.filter((s) => s.latestJob?.status === 'SUCCEED').length,
        FAILED: summaries.filter((s) => s.latestJob?.status === 'FAILED').length,
        RUNNING: summaries.filter((s) => s.latestJob?.status === 'RUNNING').length,
        OTHER: summaries.filter((s) => s.latestJob && !['SUCCEED', 'FAILED', 'RUNNING'].includes(s.latestJob.status!)).length,
      },
      generatedAt: new Date().toISOString(),
      generationDurationMs: Date.now() - new Date(startedAt).getTime(),
    };

    return NextResponse.json({
      success: true,
      summary: aggregate,
      apps: summaries,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
