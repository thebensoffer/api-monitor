/**
 * Shared HTTP probe helper.
 *
 * Captures full transmission detail so any service can be drilled into:
 * URL, method, sent headers (sanitized), response status, headers, body
 * preview, parsed JSON, content length, latency, and timestamps.
 */

export interface ProbeResult {
  endpoint: string;
  url: string;
  method: 'GET' | 'HEAD' | 'POST';
  request: {
    headers: Record<string, string>;
    body: string | null;
    sentAt: string;
  };
  response: {
    ok: boolean;
    httpStatus: number | null;
    statusText: string | null;
    receivedAt: string;
    durationMs: number;
    contentType: string | null;
    contentLength: number;
    headers: Record<string, string>;
    bodyPreview: string;
    parsedBody: any;
  } | null;
  error: string | null;
}

export interface ProbeOptions {
  endpoint: string;
  url: string;
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => {
      const lower = k.toLowerCase();
      const isSecret =
        lower.includes('key') ||
        lower.includes('auth') ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower === 'cookie';
      if (!isSecret || !v) return [k, v];
      return [k, `${v.slice(0, 4)}…(${v.length} chars)`];
    })
  );
}

export async function probe(opts: ProbeOptions): Promise<ProbeResult> {
  const method = opts.method || 'GET';
  const sentAt = new Date().toISOString();
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'OpenHeart-API-Monitor/1.0',
    ...(opts.headers || {}),
  };
  if (method === 'POST' && opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const bodyStr =
    opts.body == null
      ? null
      : typeof opts.body === 'string'
      ? opts.body
      : JSON.stringify(opts.body);

  const t0 = Date.now();
  try {
    const resp = await fetch(opts.url, {
      method,
      headers,
      body: bodyStr ?? undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 7000),
      cache: 'no-store',
    });
    const text = method === 'HEAD' ? '' : await resp.text();
    const durationMs = Date.now() - t0;
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {}
    }
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    return {
      endpoint: opts.endpoint,
      url: opts.url,
      method,
      request: { headers: sanitizeHeaders(headers), body: bodyStr, sentAt },
      response: {
        ok: resp.ok,
        httpStatus: resp.status,
        statusText: resp.statusText,
        receivedAt: new Date().toISOString(),
        durationMs,
        contentType: resp.headers.get('content-type'),
        contentLength: text.length,
        headers: respHeaders,
        bodyPreview: text.slice(0, 1500),
        parsedBody: parsed,
      },
      error: null,
    };
  } catch (err) {
    return {
      endpoint: opts.endpoint,
      url: opts.url,
      method,
      request: { headers: sanitizeHeaders(headers), body: bodyStr, sentAt },
      response: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Map a ProbeResult to the legacy `services[]` shape the existing dashboard
 * expects, while preserving the full transmission detail.
 */
export function probeToService(
  key: string,
  name: string,
  result: ProbeResult,
  extraMetadata: Record<string, any> = {}
) {
  const ok = result.response?.ok ?? false;
  const status: 'online' | 'warning' | 'error' = result.error
    ? 'error'
    : ok
    ? 'online'
    : (result.response?.httpStatus ?? 0) >= 500
    ? 'error'
    : 'warning';

  return {
    key,
    name,
    status,
    responseTime: result.response?.durationMs ?? null,
    lastCheck: result.response?.receivedAt ?? result.request.sentAt,
    error: result.error || (result.response && !ok ? `HTTP ${result.response.httpStatus}` : undefined),
    metadata: {
      url: result.url,
      method: result.method,
      httpStatus: result.response?.httpStatus,
      contentLength: result.response?.contentLength,
      contentType: result.response?.contentType,
      ...extraMetadata,
    },
    transmission: result, // full drillable detail
  };
}
