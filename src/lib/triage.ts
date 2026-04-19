/**
 * Triage agent — calls Claude (via AWS Bedrock — HIPAA-covered under BAA)
 * to analyze an alert and return structured diagnosis + suggested fix.
 *
 * Returns null silently if Bedrock isn't reachable or credentials are
 * unavailable, so the system still works without it (alerts just don't
 * get auto-diagnosis).
 */

import { askClaudeJSON, CLAUDE_MODELS } from './bedrock';
import { FIX_ACTIONS, type FixActionId } from './fix-actions';

export interface TriageResult {
  diagnosis: string;
  severity: 'low' | 'medium' | 'high';
  actionNeeded: 'none' | 'monitor' | 'human' | 'auto-fixable';
  recommendedFix: string;
  fixAction?: {
    id: FixActionId;
    params: Record<string, any>;
    requiresConfirmation: boolean;
  };
  confidence: 'low' | 'medium' | 'high';
}

interface TriageInput {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  source: string;
  action?: string;
}

const SYSTEM_PROMPT = `You are the triage agent for OpenHeart, a monitoring dashboard for a small medical practice running 3 Next.js apps on AWS:
- Discreet Ketamine (DK) — patient-facing telehealth at discreetketamine.com
- Tovani Health — B2B clinical at tovanihealth.com
- Dr Ben Soffer (DBS) — concierge medicine at drbensoffer.com

Each app: Next.js SSR on AWS Amplify, Aurora/RDS PostgreSQL, Stripe + Twilio + SES, Sentry.

You receive monitoring alerts. For each alert:
1. Diagnose root cause in 1-2 sentences. Be concrete.
2. Confirm or adjust severity (low/medium/high).
3. Decide what action is needed:
   - "none" — informational only (e.g. third-party status page noise)
   - "monitor" — keep an eye on it, no action yet
   - "human" — requires human judgment, code change, or operation outside the allowlist
   - "auto-fixable" — clearly maps to a safe fix-action below; specify which
4. Recommend a concrete fix (1 sentence).

Available auto-fix actions (only suggest these if the alert clearly maps):
${FIX_ACTIONS.map((a) => `- ${a.id}: ${a.description} (params: ${a.paramSchema})`).join('\n')}

Return strict JSON only:
{"diagnosis":"...","severity":"low|medium|high","actionNeeded":"none|monitor|human|auto-fixable","recommendedFix":"...","fixAction":{"id":"...","params":{},"requiresConfirmation":true}|null,"confidence":"low|medium|high"}

NEVER suggest a fix that touches patient records, money movement, or actions not in the allowlist. When unsure, return actionNeeded="human".`;

export async function triageAlert(input: TriageInput): Promise<TriageResult | null> {
  // Skip silently if AWS creds unavailable (Bedrock client will throw)
  if (!process.env.OPENHEART_AWS_ACCESS_KEY_ID && !process.env.AWS_ACCESS_KEY_ID) {
    return null;
  }

  const userPrompt = `Alert ID: ${input.id}
Title: ${input.title}
Message: ${input.message}
Source: ${input.source}
Reported severity: ${input.severity}
Suggested action (from probe): ${input.action || '(none)'}`;

  try {
    const parsed = await askClaudeJSON<any>(userPrompt, {
      model: CLAUDE_MODELS.HAIKU_35,
      maxTokens: 600,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
    });
    return {
      diagnosis: parsed.diagnosis || '(no diagnosis)',
      severity: parsed.severity || input.severity,
      actionNeeded: parsed.actionNeeded || 'monitor',
      recommendedFix: parsed.recommendedFix || '(no recommendation)',
      fixAction: parsed.fixAction || undefined,
      confidence: parsed.confidence || 'low',
    };
  } catch (err) {
    console.error('[triage] error:', err instanceof Error ? err.message : err);
    return null;
  }
}
