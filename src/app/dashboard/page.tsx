'use client';

import { useEffect, useState } from 'react';
import { APILog, SERVICES } from '@/types/api';

export default function Dashboard() {
  const [logs, setLogs] = useState<APILog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetch('/api/logs', {
          headers: {
            'x-monitor-key': process.env.NEXT_PUBLIC_MONITOR_API_KEY || ''
          }
        });
        const data = await response.json();
        setLogs(data.logs || []);
      } catch (error) {
        console.error('Failed to fetch logs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            API Monitor Dashboard
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Unified monitoring for DK + DBS medical practice operations
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Service Status Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {Object.entries(SERVICES).map(([key, name]) => (
            <div key={key} className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  </div>
                  <div className="ml-3 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">
                        {name}
                      </dt>
                      <dd className="text-lg font-medium text-gray-900">
                        Online
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Real-time Activity Feed */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              Real-time API Activity
            </h3>
            <div className="mt-5">
              {loading ? (
                <div className="text-center py-4">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  <p className="mt-2 text-sm text-gray-500">Loading activity...</p>
                </div>
              ) : logs.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  No API activity yet. Start monitoring to see real-time data.
                </p>
              ) : (
                <div className="space-y-3">
                  {logs.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 border rounded">
                      <div className="flex items-center space-x-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          log.direction === 'inbound' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {log.direction}
                        </span>
                        <span className="text-sm font-medium">{SERVICES[log.service as keyof typeof SERVICES]}</span>
                        <span className="text-sm text-gray-500">{log.method} {log.endpoint}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        {log.statusCode && (
                          <span className={`text-sm ${
                            log.statusCode >= 200 && log.statusCode < 300 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {log.statusCode}
                          </span>
                        )}
                        {log.responseTime && (
                          <span className="text-sm text-gray-500">
                            {log.responseTime}ms
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}