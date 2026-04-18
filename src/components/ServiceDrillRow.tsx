'use client';

import { useState } from 'react';
import { ProbeRow, ProbeLike } from './ProbeRow';

interface ServiceLike {
  key: string;
  name: string;
  status: 'online' | 'warning' | 'error';
  responseTime?: number | null;
  lastCheck: string;
  error?: string;
  metadata?: Record<string, any>;
  transmission?: ProbeLike;
}

export function ServiceDrillRow({ service }: { service: ServiceLike }) {
  const [open, setOpen] = useState(false);
  const drillable = !!service.transmission;

  return (
    <li>
      <div
        className={`px-4 py-4 flex items-center justify-between ${drillable ? 'hover:bg-gray-50 cursor-pointer' : ''}`}
        onClick={() => drillable && setOpen((o) => !o)}
      >
        <div className="flex items-center min-w-0 flex-1">
          {drillable && (
            <span className="text-gray-400 text-xs font-mono mr-2 w-3">{open ? '▼' : '▶'}</span>
          )}
          <div
            className={`flex-shrink-0 w-3 h-3 rounded-full ${
              service.status === 'online'
                ? 'bg-green-500'
                : service.status === 'warning'
                ? 'bg-yellow-500'
                : 'bg-red-500'
            }`}
          />
          <div className="ml-4 flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{service.name}</p>
            <div className="flex items-center text-sm text-gray-500 space-x-4">
              <span>{service.responseTime ? `${service.responseTime}ms` : 'N/A'}</span>
              <span>{new Date(service.lastCheck).toLocaleTimeString()}</span>
              {service.metadata?.httpStatus && (
                <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">
                  HTTP {service.metadata.httpStatus}
                </span>
              )}
              {service.metadata?.contentLength != null && (
                <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">
                  {Number(service.metadata.contentLength).toLocaleString()}B
                </span>
              )}
              {service.metadata?.dbLatencyMs != null && (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-mono">
                  DB {service.metadata.dbLatencyMs}ms
                </span>
              )}
              {service.metadata?.buildVersion && (
                <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-mono">
                  v{service.metadata.buildVersion}
                </span>
              )}
            </div>
            {service.error && <p className="text-xs text-red-600 mt-1">{service.error}</p>}
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
              service.status === 'online'
                ? 'bg-green-100 text-green-800'
                : service.status === 'warning'
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {service.status}
          </span>
        </div>
      </div>
      {open && service.transmission && (
        <div className="px-6 pb-4 bg-gray-50">
          <ProbeRow probe={service.transmission} />
        </div>
      )}
    </li>
  );
}
