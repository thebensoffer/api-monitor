/**
 * Triage agent — calls Claude (Anthropic API) to analyze an alert and
 * return structured diagnosis + suggested fix.
 *
 * Returns null silently if ANTHROPIC_API_KEY is unset, so the system
 * still works without it (alerts just don't get auto-diagnosis).
 */

import { FIX_ACTIONS, type FixActionId } from './fix-actions';

export interface TriageResult {
  diagnosis: string;          // 1-2 sentence root-cause analysis
  severity: 'low' | 'medium' | 'high';   // confirmed/adjusted severity
  actionNeeded: 'none' | 'monitor' | 'human' | 'auto-fixable';
  recommendedFix: string;     // human-readable description of fix
  fixAction?: {               // only if actionNeeded === 'auto-fixable'
    id: FixActionId;
    params: Record<string, any>;
    requiresConfirmation: boolean;
  };
  confidence: 'low' | 'medium' | 'high';
  raw?: string;
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

const MODEL = 'claude-sonnet-4-5-20250929';

const SYSTEM_PROMPT = `You are the triage agent for OpenHeart, a monitoring dashboard for a small medical practice running 3 Next.js apps on AWS:
- Discreet Ketamine (DK) — patient-facing telehealth at discreetketamine.com
- Tovani Health — B2B clinical platform at tovanihealth.com
- Dr Ben Soffer (DBS) — concierge medicine at drbensoffer.com

Each app: Next.js SSR on AWS Amplify, Aurora/RDS PostgreSQL, Stripe + Twilio + SES, Sentry.

You receive monitoring alerts from OpenHeart. For each alert:
1. Diagnose the root cause in 1-2 sentences. Be concrete.
2. Confirm or adjust severity (low/medium/high).
3. Decide what action is needed:
   - "none" — informational only, no impact (e.g. third-party status page noise)
   - "monitor" — keep an eye on it, no action yet
   - "human" — requires human judgment, code change, or operation outside the allowlist
   - "auto-fixable" — matches one of the safe fix actions below; specify which
4. Recommend a concrete fix (1 sentence).

Available auto-fix actions (only suggest these if the alert clearly maps):
${FIX_ACTIONS.map((a) => `- ${a.id}: ${a.description} (params: ${a.paramSchema})`).join('\n')}

Return strict JSON only:
{"diagnosis": "...", "severity": "low|medium|high", "actionNeeded": "none|monitor|human|auto-fixable", "recommendedFix": "...", "fixAction": {"id": "...", "params": {...}, "requiresConfirmation": true|false} | null, "confidence": "low|medium|high"}

NEVER suggest a fix that touches patient records, money movement, or unverified Anthropic actions. When unsure, return actionNeeded="human".`;

export async function triageAlert(input: TriageInput): Promise<TriageResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const userPrompt = `Alert ID: ${input.id}
Title: ${input.title}
Message: ${input.message}
Source: ${input.source}
Reported severity: ${input.severity}
Suggested action (from probe): ${input.action || '(none)'}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('[triage] Anthropic API failed:', r.status, errText.slice(0, 200));
      return null;
    }
    const j = await r.json();
    const text = j.content?.[0]?.text || '';
    // Extract JSON (Claude usually returns clean JSON but be defensive)
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      diagnosis: parsed.diagnosis || '(no diagnosis)',
      severity: parsed.severity || input.severity,
      actionNeeded: parsed.actionNeeded || 'monitor',
      recommendedFix: parsed.recommendedFix || '(no recommendation)',
      fixAction: parsed.fixAction || undefined,
      confidence: parsed.confidence || 'low',
      raw: text,
    };
  } catch (err) {
    console.error('[triage] error:', err instanceof Error ? err.message : err);
    return null;
  }
}
