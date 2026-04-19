/**
 * Allowlist of safe, hand-written fix operations Claude is permitted to
 * trigger via OpenHeart. Each action is idempotent / dry-runnable / audit-logged.
 *
 * Adding an action: define a new entry below. Each must:
 *   - declare paramSchema as a description for the triage agent
 *   - implement dryRun() that returns what WOULD happen (no side effects)
 *   - implement execute() that performs the action and returns a result
 *   - have riskLevel that determines whether confirmation is required
 *
 * Kill switch: set OPENHEART_AUTOPILOT=off to disable all execute() (dryRun still works).
 */

import { recordAudit } from './audit';

export type FixActionId =
  | 'enable-eventbridge-rule'
  | 'restart-amplify-app'
  | 'set-rds-retention'
  | 'rebuild-amplify-app'
  | 'acknowledge-alert';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface FixActionResult {
  ok: boolean;
  message: string;
  before?: any;
  after?: any;
  data?: any;
}

export interface FixAction {
  id: FixActionId;
  description: string;
  riskLevel: RiskLevel;
  paramSchema: string; // human-readable for the triage agent's prompt
  dryRun(params: any): Promise<FixActionResult>;
  execute(params: any): Promise<FixActionResult>;
}

function awsCreds() {
  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('AWS credentials missing');
  return { accessKeyId, secretAccessKey };
}

function awsRegion() {
  return process.env.OPENHEART_AWS_REGION || 'us-east-1';
}

export const FIX_ACTIONS: FixAction[] = [
  {
    id: 'enable-eventbridge-rule',
    description: 'Re-enable a disabled EventBridge rule (e.g., a cron that stopped firing)',
    riskLevel: 'low',
    paramSchema: '{ ruleName: string }',
    async dryRun({ ruleName }: { ruleName: string }) {
      const { EventBridgeClient, DescribeRuleCommand } = await import('@aws-sdk/client-eventbridge');
      const client = new EventBridgeClient({ region: awsRegion(), credentials: awsCreds() });
      try {
        const r = await client.send(new DescribeRuleCommand({ Name: ruleName }));
        if (r.State === 'ENABLED') {
          return { ok: true, message: `Rule ${ruleName} is already ENABLED — nothing to do`, before: r.State };
        }
        return { ok: true, message: `Would enable rule ${ruleName} (currently ${r.State})`, before: r.State, after: 'ENABLED' };
      } catch (err: any) {
        return { ok: false, message: `Rule ${ruleName} not found: ${err?.message}` };
      }
    },
    async execute({ ruleName }: { ruleName: string }) {
      const { EventBridgeClient, EnableRuleCommand, DescribeRuleCommand } = await import('@aws-sdk/client-eventbridge');
      const client = new EventBridgeClient({ region: awsRegion(), credentials: awsCreds() });
      const before = await client.send(new DescribeRuleCommand({ Name: ruleName })).catch(() => null);
      if (before?.State === 'ENABLED') {
        return { ok: true, message: `Rule ${ruleName} already ENABLED`, before: before.State, after: before.State };
      }
      await client.send(new EnableRuleCommand({ Name: ruleName }));
      const after = await client.send(new DescribeRuleCommand({ Name: ruleName }));
      return {
        ok: after.State === 'ENABLED',
        message: `Rule ${ruleName} → ${after.State}`,
        before: before?.State,
        after: after.State,
      };
    },
  },

  {
    id: 'restart-amplify-app',
    description: 'Restart an Amplify SSR app by triggering a fresh build (clears Lambda containers, refreshes env)',
    riskLevel: 'medium',
    paramSchema: '{ appId: string, branchName: string }',
    async dryRun({ appId, branchName }: { appId: string; branchName: string }) {
      const { AmplifyClient, GetBranchCommand } = await import('@aws-sdk/client-amplify');
      const client = new AmplifyClient({ region: awsRegion(), credentials: awsCreds() });
      try {
        const r = await client.send(new GetBranchCommand({ appId, branchName }));
        return {
          ok: true,
          message: `Would trigger RELEASE build on ${appId}/${branchName} (currently active job: ${r.branch?.activeJobId || 'none'})`,
          before: { activeJobId: r.branch?.activeJobId },
        };
      } catch (err: any) {
        return { ok: false, message: `Branch not found: ${err?.message}` };
      }
    },
    async execute({ appId, branchName }: { appId: string; branchName: string }) {
      const { AmplifyClient, StartJobCommand } = await import('@aws-sdk/client-amplify');
      const client = new AmplifyClient({ region: awsRegion(), credentials: awsCreds() });
      const r = await client.send(new StartJobCommand({ appId, branchName, jobType: 'RELEASE' }));
      return {
        ok: !!r.jobSummary?.jobId,
        message: `Started build job #${r.jobSummary?.jobId} on ${appId}/${branchName} (status: ${r.jobSummary?.status})`,
        data: r.jobSummary,
      };
    },
  },

  {
    id: 'set-rds-retention',
    description: 'Increase RDS BackupRetentionPeriod (only allowed to GO UP, never down — never destroys backups)',
    riskLevel: 'low',
    paramSchema: '{ dbInstanceIdentifier: string, retentionDays: number (must be > current value) }',
    async dryRun({ dbInstanceIdentifier, retentionDays }: { dbInstanceIdentifier: string; retentionDays: number }) {
      const { RDSClient, DescribeDBInstancesCommand } = await import('@aws-sdk/client-rds');
      const client = new RDSClient({ region: awsRegion(), credentials: awsCreds() });
      try {
        const r = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceIdentifier }));
        const current = r.DBInstances?.[0]?.BackupRetentionPeriod ?? 0;
        if (retentionDays <= current) {
          return { ok: false, message: `Refusing: requested ${retentionDays}d but current is ${current}d. Action only allowed to INCREASE retention.`, before: current };
        }
        return {
          ok: true,
          message: `Would set ${dbInstanceIdentifier} retention from ${current}d → ${retentionDays}d`,
          before: current,
          after: retentionDays,
        };
      } catch (err: any) {
        return { ok: false, message: `Instance not found: ${err?.message}` };
      }
    },
    async execute({ dbInstanceIdentifier, retentionDays }: { dbInstanceIdentifier: string; retentionDays: number }) {
      const { RDSClient, ModifyDBInstanceCommand, DescribeDBInstancesCommand } = await import('@aws-sdk/client-rds');
      const client = new RDSClient({ region: awsRegion(), credentials: awsCreds() });
      const before = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceIdentifier }));
      const currentValue = before.DBInstances?.[0]?.BackupRetentionPeriod ?? 0;
      if (retentionDays <= currentValue) {
        return { ok: false, message: `Refused: ${retentionDays}d not > current ${currentValue}d`, before: currentValue };
      }
      await client.send(new ModifyDBInstanceCommand({
        DBInstanceIdentifier: dbInstanceIdentifier,
        BackupRetentionPeriod: retentionDays,
        ApplyImmediately: true,
      }));
      return {
        ok: true,
        message: `Set ${dbInstanceIdentifier} retention ${currentValue}d → ${retentionDays}d (apply-immediately)`,
        before: currentValue,
        after: retentionDays,
      };
    },
  },

  {
    id: 'rebuild-amplify-app',
    description: 'Trigger a fresh Amplify build for an app (use when SSR Lambda has stale env or cached state)',
    riskLevel: 'medium',
    paramSchema: '{ appId: string, branchName: string }',
    async dryRun({ appId, branchName }: { appId: string; branchName: string }) {
      return { ok: true, message: `Would trigger RELEASE build on ${appId}/${branchName}` };
    },
    async execute({ appId, branchName }: { appId: string; branchName: string }) {
      // Same impl as restart-amplify-app — kept as separate action for triage clarity
      const { AmplifyClient, StartJobCommand } = await import('@aws-sdk/client-amplify');
      const client = new AmplifyClient({ region: awsRegion(), credentials: awsCreds() });
      const r = await client.send(new StartJobCommand({ appId, branchName, jobType: 'RELEASE' }));
      return {
        ok: !!r.jobSummary?.jobId,
        message: `Triggered build #${r.jobSummary?.jobId} on ${appId}/${branchName}`,
        data: r.jobSummary,
      };
    },
  },

  {
    id: 'acknowledge-alert',
    description: 'Suppress this specific alert ID for 24h (use when issue is known and being tracked elsewhere)',
    riskLevel: 'low',
    paramSchema: '{ alertId: string, reason: string }',
    async dryRun({ alertId, reason }: { alertId: string; reason: string }) {
      return { ok: true, message: `Would suppress alert ${alertId} for 24h. Reason: ${reason}` };
    },
    async execute({ alertId, reason }: { alertId: string; reason: string }) {
      // Reuse notification dedup table to suppress
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient, PutCommand } = await import('@aws-sdk/lib-dynamodb');
      const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: awsRegion(), credentials: awsCreds() }));
      const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      await Promise.all(['email', 'sms', 'slack'].map((channel) =>
        ddb.send(new PutCommand({
          TableName: 'openheart-notifications',
          Item: {
            alertKey: `${alertId}:${channel}`,
            sentAt: new Date().toISOString(),
            detail: `acknowledged: ${reason}`,
            ttl: expires,
          },
        }))
      ));
      return { ok: true, message: `Suppressed ${alertId} for 24h. Reason: ${reason}` };
    },
  },
];

export function getFixAction(id: string): FixAction | undefined {
  return FIX_ACTIONS.find((a) => a.id === id);
}

export function autopilotEnabled(): boolean {
  const v = (process.env.OPENHEART_AUTOPILOT || 'on').toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

/**
 * Wrap execution with: kill-switch check, audit logging, error capture.
 */
export async function executeFixAction(
  id: string,
  params: any,
  actor: string
): Promise<FixActionResult> {
  if (!autopilotEnabled()) {
    return { ok: false, message: 'Autopilot is OFF (OPENHEART_AUTOPILOT env var)' };
  }
  const action = getFixAction(id);
  if (!action) return { ok: false, message: `Unknown fix-action: ${id}` };

  await recordAudit({
    actor,
    action: `fix.${id}.attempt`,
    resource: JSON.stringify(params).slice(0, 200),
    metadata: { params, riskLevel: action.riskLevel },
  }).catch(() => {});

  try {
    const result = await action.execute(params);
    await recordAudit({
      actor,
      action: `fix.${id}.${result.ok ? 'success' : 'failed'}`,
      resource: JSON.stringify(params).slice(0, 200),
      metadata: { params, result },
    }).catch(() => {});
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await recordAudit({
      actor,
      action: `fix.${id}.error`,
      resource: JSON.stringify(params).slice(0, 200),
      metadata: { params, error: message },
    }).catch(() => {});
    return { ok: false, message };
  }
}

export async function dryRunFixAction(id: string, params: any): Promise<FixActionResult> {
  const action = getFixAction(id);
  if (!action) return { ok: false, message: `Unknown fix-action: ${id}` };
  try {
    return await action.dryRun(params);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'dry-run failed' };
  }
}
