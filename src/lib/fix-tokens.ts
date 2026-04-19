/**
 * Signed magic-link tokens for reply-to-fix flow.
 *
 * Token format: base64url(payload).hmac
 * Payload includes: actionId, params, alertId, expiresAt, mode (dryRun|execute)
 *
 * Verified server-side using FIX_TOKEN_SECRET shared secret.
 */

import crypto from 'node:crypto';

export interface FixToken {
  actionId: string;
  params: Record<string, any>;
  alertId: string;
  mode: 'dryRun' | 'execute';
  expiresAt: number; // unix ms
}

function getSecret(): string {
  const s = process.env.FIX_TOKEN_SECRET;
  if (!s) throw new Error('FIX_TOKEN_SECRET not set');
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signFixToken(payload: FixToken): string {
  const json = JSON.stringify(payload);
  const payloadEnc = b64url(json);
  const hmac = crypto.createHmac('sha256', getSecret()).update(payloadEnc).digest();
  return `${payloadEnc}.${b64url(hmac)}`;
}

export function verifyFixToken(token: string): FixToken | null {
  try {
    const [payloadEnc, sig] = token.split('.');
    if (!payloadEnc || !sig) return null;
    const expected = crypto.createHmac('sha256', getSecret()).update(payloadEnc).digest();
    const provided = fromB64url(sig);
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
    const payload = JSON.parse(fromB64url(payloadEnc).toString('utf8')) as FixToken;
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}
