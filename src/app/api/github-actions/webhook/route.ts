/**
 * GitHub Actions push-model webhook.
 *
 * Each watched workflow POSTs here at the end of its run via curl + an
 * HMAC-signed payload. Uses an HMAC shared secret (GH_ACTIONS_WEBHOOK_SECRET)
 * instead of a static bearer so a leaked GitHub repo log can't be replayed
 * with a different repo/conclusion.
 *
 * Why push (not poll): the existing GitHub PAT only has metadata+contents
 * scope; bumping it to actions:read for run-history would widen the blast
 * radius for an unrelated cron. Push is one-shot, scoped, and authenticates
 * via a per-workflow HMAC, never a repo-scoped token.
 *
 * Payload shape (POST application/json):
 *   {
 *     repo: "thebensoffer/drbensoffer-platform",
 *     workflow: "Weekly pg_dump → WORM S3",
 *     run_id: "12345",
 *     conclusion: "success" | "failure" | "cancelled",
 *     run_url: "https://github.com/.../actions/runs/12345",
 *     started_at: "2026-04-23T11:00:01Z",
 *     completed_at: "2026-04-23T11:02:11Z",
 *     branch: "main",
 *     trigger: "schedule" | "workflow_dispatch" | "push"
 *   }
 *
 * Headers:
 *   x-openheart-sig: hex(hmac-sha256(GH_ACTIONS_WEBHOOK_SECRET, raw_body))
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { dispatchAlert } from '@/lib/notify';
import { recordRun } from '@/lib/cron-history';

export const dynamic = 'force-dynamic';

interface GHActionsPayload {
  repo: string;
  workflow: string;
  run_id?: string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'skipped';
  run_url?: string;
  started_at?: string;
  completed_at?: string;
  branch?: string;
  trigger?: string;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  try {
    const aa = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.GH_ACTIONS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 503 });
  }

  // Read raw body for HMAC verification (parsing first would lose exact bytes)
  const raw = await req.text();
  const expectedSig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const providedSig = (req.headers.get('x-openheart-sig') || '').toLowerCase();
  if (!timingSafeHexEqual(expectedSig, providedSig)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: GHActionsPayload;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { repo, workflow, run_id, conclusion, run_url, started_at, completed_at, branch, trigger } = body;
  if (!repo || !workflow || !conclusion) {
    return NextResponse.json({ error: 'missing required fields (repo, workflow, conclusion)' }, { status: 400 });
  }

  // Persist the run as a "cron-like" record so the dashboard's cron-history
  // view shows GH workflows alongside our AWS EventBridge crons. Use a
  // synthetic id namespaced by repo+workflow.
  const cronId = `gh:${repo}:${workflow}`.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 100);
  const startedAt = started_at || new Date().toISOString();
  const finishedAt = completed_at || new Date().toISOString();
  const durationMs = completed_at && started_at
    ? new Date(completed_at).getTime() - new Date(started_at).getTime()
    : 0;
  const ok = conclusion === 'success' || conclusion === 'skipped';

  try {
    await recordRun({
      id: cronId,
      startedAt,
      finishedAt,
      durationMs,
      ok,
      message: `${workflow} ${conclusion} on ${branch || '?'} (${trigger || '?'})`,
      source: 'dispatcher',
      data: { repo, workflow, run_id, run_url, branch, trigger, conclusion },
    });
  } catch (err) {
    console.error('[gh-actions-webhook] recordRun failed', err);
  }

  // Alert on failure (and cancelled/timed_out, which usually need attention).
  // 'success' and 'skipped' are silent — same convention as our EventBridge
  // crons.
  if (conclusion !== 'success' && conclusion !== 'skipped') {
    await dispatchAlert({
      id: `gh-actions-${cronId}-${run_id || Date.now()}`,
      type: conclusion === 'failure' || conclusion === 'timed_out' ? 'error' : 'warning',
      title: `❌ GitHub Actions: ${workflow} ${conclusion}`,
      message: `${repo}@${branch || '?'} via ${trigger || '?'}${run_url ? `\n${run_url}` : ''}`,
      severity: conclusion === 'failure' || conclusion === 'timed_out' ? 'high' : 'medium',
      source: 'GitHub Actions webhook',
      action: run_url ? `Open run: ${run_url}` : 'Open the GitHub Actions tab on the repo',
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, recorded: cronId });
}
