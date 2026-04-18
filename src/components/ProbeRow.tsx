'use client';

import { useState } from 'react';

export interface ProbeLike {
  endpoint: string;
  url: string;
  method: string;
  request: { headers: Record<string, string>; body?: string | null; sentAt: string };
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

export function StatusPill({ probe }: { probe: ProbeLike }) {
  if (probe.error)
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">ERROR</span>;
  if (!probe.response)
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-800">—</span>;
  const s = probe.response.httpStatus ?? 0;
  if (s >= 200 && s < 300)
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">{s} OK</span>;
  if (s >= 300 && s < 400)
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800">{s} {probe.response.statusText}</span>;
  if (s >= 400 && s < 500)
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">{s} {probe.response.statusText}</span>;
  return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">{s} {probe.response.statusText}</span>;
}

export function ProbeRow({ probe, label }: { probe: ProbeLike; label?: string }) {
  const [open, setOpen] = useState(false);
  const ms = probe.response?.durationMs ?? 0;
  const msColor = ms < 500 ? 'text-green-700' : ms < 1500 ? 'text-yellow-700' : 'text-red-700';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-gray-400 text-xs font-mono">{open ? '▼' : '▶'}</span>
          <span className="font-mono text-xs text-gray-500 uppercase">{probe.method}</span>
          <span className="font-medium text-sm text-gray-900 truncate">{label || probe.endpoint}</span>
          <StatusPill probe={probe} />
        </div>
        <div className="flex items-center gap-4 shrink-0 text-xs text-gray-600">
          <span className={`font-mono ${msColor}`}>{ms}ms</span>
          <span className="font-mono">{(probe.response?.contentLength ?? 0).toLocaleString()}B</span>
          <span className="text-gray-400">{new Date(probe.request.sentAt).toLocaleTimeString()}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 py-3 bg-white space-y-3 text-xs">
          <div>
            <div className="font-semibold text-gray-700 mb-1">URL</div>
            <code className="block bg-gray-50 px-2 py-1 rounded text-gray-800 break-all">{probe.url}</code>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="font-semibold text-gray-700 mb-1">Request headers (sent)</div>
              <pre className="bg-gray-50 px-2 py-1 rounded overflow-x-auto text-[11px] text-gray-800">
                {JSON.stringify(probe.request.headers, null, 2)}
              </pre>
              {probe.request.body && (
                <>
                  <div className="font-semibold text-gray-700 mt-2 mb-1">Request body</div>
                  <pre className="bg-gray-50 px-2 py-1 rounded overflow-x-auto text-[11px] text-gray-800 max-h-40">
                    {probe.request.body}
                  </pre>
                </>
              )}
              <div className="text-gray-500 mt-1">Sent at {new Date(probe.request.sentAt).toLocaleString()}</div>
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-1">Response headers (received)</div>
              {probe.response ? (
                <>
                  <pre className="bg-gray-50 px-2 py-1 rounded overflow-x-auto text-[11px] text-gray-800">
                    {JSON.stringify(probe.response.headers, null, 2)}
                  </pre>
                  <div className="text-gray-500 mt-1">Received at {new Date(probe.response.receivedAt).toLocaleString()}</div>
                </>
              ) : (
                <div className="text-red-700">No response — {probe.error}</div>
              )}
            </div>
          </div>
          {probe.response && (
            <div>
              <div className="font-semibold text-gray-700 mb-1">
                Response body {probe.response.parsedBody ? '(parsed JSON)' : '(raw)'}
              </div>
              <pre className="bg-gray-900 text-green-200 px-3 py-2 rounded overflow-x-auto text-[11px] max-h-72">
                {probe.response.parsedBody
                  ? JSON.stringify(probe.response.parsedBody, null, 2)
                  : probe.response.bodyPreview || '(empty)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
