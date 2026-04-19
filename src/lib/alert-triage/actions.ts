/**
 * Alert-triage action registry for OpenHeart.
 *
 * Phase 1 (current): every handler is a STUB that only logs intent and
 * returns a "would-have" result. Nothing external is touched. Watch the
 * classifier on real mail for a week or two before any remediation goes live.
 *
 * Phase 2: replace stub bodies with real calls (Stripe retry webhook, IAM
 * rotation, Amplify build restart, etc.) behind per-handler feature flags.
 * The registry shape stays the same so the cron doesn't change.
 *
 * Constraints for any real handler:
 *   - Idempotent (safe to re-run)
 *   - Narrow blast radius (one env, one resource)
 *   - Never touch PHI or payment state (those go to "escalate")
 *   - Record what they did; never swallow errors
 */

export interface ActionContext {
  platform: 'tovani' | 'dk' | 'dbs' | 'unknown';
  sourceMessageId: string;
  subject: string;
}

export interface ActionResult {
  ok: boolean;
  mode: 'shadow' | 'executed';
  summary: string;
  details?: Record<string, unknown>;
}

export type ActionHandler = (
  params: Record<string, unknown> | null,
  ctx: ActionContext
) => Promise<ActionResult>;

const stripeRetryWebhook: ActionHandler = async (params, ctx) => {
  const eventId = typeof params?.eventId === 'string' ? params.eventId : null;
  console.log('[alert-triage][shadow] would retry Stripe webhook', { eventId, ctx });
  return {
    ok: true,
    mode: 'shadow',
    summary: eventId
      ? `Would retry Stripe event ${eventId}`
      : 'Would retry Stripe webhook (event id not extracted)',
    details: { eventId },
  };
};

const rotateIamKey: ActionHandler = async (params, ctx) => {
  const userName = typeof params?.userName === 'string' ? params.userName : null;
  console.log('[alert-triage][shadow] would rotate IAM key', { userName, ctx });
  return {
    ok: true,
    mode: 'shadow',
    summary: userName
      ? `Would rotate IAM access key for user ${userName}`
      : 'Would rotate IAM key (user name not extracted)',
    details: { userName },
  };
};

const restartAmplifyBuild: ActionHandler = async (params, ctx) => {
  const appId = typeof params?.appId === 'string' ? params.appId : null;
  const branch = typeof params?.branch === 'string' ? params.branch : 'main';
  console.log('[alert-triage][shadow] would restart Amplify build', { appId, branch, ctx });
  return {
    ok: true,
    mode: 'shadow',
    summary: `Would trigger Amplify RELEASE job on ${appId ?? ctx.platform} / ${branch}`,
    details: { appId, branch },
  };
};

const recheckSslCert: ActionHandler = async (params, ctx) => {
  const hostname = typeof params?.hostname === 'string' ? params.hostname : null;
  console.log('[alert-triage][shadow] would re-probe SSL cert', { hostname, ctx });
  return {
    ok: true,
    mode: 'shadow',
    summary: hostname
      ? `Would re-probe TLS cert on ${hostname}`
      : 'Would re-probe SSL cert (hostname not extracted)',
    details: { hostname },
  };
};

const REGISTRY: Record<string, ActionHandler> = {
  stripe_retry_webhook: stripeRetryWebhook,
  rotate_iam_key: rotateIamKey,
  restart_amplify_build: restartAmplifyBuild,
  recheck_ssl_cert: recheckSslCert,
};

export function knownActionNames(): string[] {
  return Object.keys(REGISTRY);
}

export function getActionHandler(name: string): ActionHandler | null {
  return REGISTRY[name] ?? null;
}

/**
 * Hard gate. Phase 1 = always false; nothing actually executes even if the
 * classifier proposes an action. Phase 2 flips this to a per-handler flag.
 */
export function isActionEnabled(_name: string): boolean {
  return false;
}
