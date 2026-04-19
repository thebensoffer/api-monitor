/**
 * Bedrock client for OpenHeart.
 *
 * Used by the alert-triage classifier. Uses cross-region inference profiles
 * (`us.*` prefix). HIPAA-covered under the AWS BAA.
 *
 * Env vars:
 *   OPENHEART_AWS_ACCESS_KEY_ID / OPENHEART_AWS_SECRET_ACCESS_KEY (preferred)
 *   AWS_ACCESS_KEY_ID          / AWS_SECRET_ACCESS_KEY            (fallback)
 *   OPENHEART_AWS_REGION       / AWS_REGION                        (default us-east-1)
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

let _client: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
  if (_client) return _client;
  const accessKeyId = process.env.OPENHEART_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENHEART_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.OPENHEART_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Bedrock: missing AWS credentials');
  }
  _client = new BedrockRuntimeClient({ region, credentials: { accessKeyId, secretAccessKey } });
  return _client;
}

export const CLAUDE_MODELS = {
  SONNET_4: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  HAIKU_35: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

export interface InvokeOptions {
  model?: ClaudeModel;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export async function askClaude(prompt: string, options: InvokeOptions = {}): Promise<string> {
  const { model = CLAUDE_MODELS.HAIKU_35, maxTokens = 1024, temperature = 0.3, system } = options;
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: prompt }],
    ...(system && { system }),
  };
  const resp = await getClient().send(
    new InvokeModelCommand({
      modelId: model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    })
  );
  const parsed = JSON.parse(new TextDecoder().decode(resp.body));
  if (!parsed.content?.[0]?.text) throw new Error('Bedrock: empty response');
  return parsed.content[0].text as string;
}

export async function askClaudeJSON<T>(prompt: string, options: InvokeOptions = {}): Promise<T> {
  const raw = await askClaude(prompt, { ...options, temperature: options.temperature ?? 0.2 });
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) return JSON.parse(braceMatch[0]) as T;
    throw new Error(`Bedrock: failed to parse JSON response: ${raw.slice(0, 200)}`);
  }
}
