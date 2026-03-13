'use client';

import { useState, useEffect } from 'react';
import { PerformanceAudit, CoreWebVitals } from '@/types/performance';

interface PerformanceRecord {
  id: string;
  timestamp: string;
  data: PerformanceAudit;
  url: string;
  device?: string;
}

function CoreWebVitalsCard({ title, value, unit, threshold, good, needs }: {
  title: string;
  value: number;
  unit: string;
  threshold: { good: number; needs: number };
  good: boolean;
  needs: boolean;
}) {
  const getColor = () => {
    if (good) return 'text-green-600 bg-green-50 border-green-200';
    if (needs) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  return (
    <div className={`p-4 rounded-lg border ${getColor()}`}>
      <div className="text-sm font-medium opacity-75">{title}</div>
      <div className="text-2xl font-bold mt-1">
        {value.toFixed(unit === 's' ? 1 : 0)}{unit}
      </div>
      <div className="text-xs mt-1 opacity-60">
        Good: &lt;{threshold.good}{unit} | Needs: &lt;{threshold.needs}{unit}
      </div>
    </div>
  );
}

function PerformanceChart({ data, title }: { data: PerformanceRecord[]; title: string }) {
  const mobileData = data.filter(d => d.device === 'mobile').slice(-7);
  const desktopData = data.filter(d => d.device === 'desktop').slice(-7);

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      
      <div className="space-y-4">
        {/* Performance Score Trend */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">Performance Score</span>
            <div className="flex gap-4 text-xs">
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 bg-blue-500 rounded"></div>
                Mobile
              </span>
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 bg-green-500 rounded"></div>
                Desktop
              </span>
            </div>
          </div>
          
          <div className="flex items-end gap-1 h-20">
            {mobileData.map((record, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div 
                  className="w-full bg-blue-500 rounded-t"
                  style={{ height: `${(record.data.performanceScore / 100) * 100}%` }}
                  title={`Mobile: ${record.data.performanceScore}`}
                ></div>
                {desktopData[i] && (
                  <div 
                    className="w-full bg-green-500 rounded-t"
                    style={{ height: `${(desktopData[i].data.performanceScore / 100) * 100}%` }}
                    title={`Desktop: ${desktopData[i].data.performanceScore}`}
                  ></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PerformanceDashboard() {
  const [performanceData, setPerformanceData] = useState<PerformanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAudit, setRunningAudit] = useState(false);

  useEffect(() => {
    fetchPerformanceData();
  }, []);

  const fetchPerformanceData = async () => {
    try {
      const response = await fetch('/api/performance', {
        headers: {
          'x-monitor-key': process.env.NEXT_PUBLIC_MONITOR_API_KEY || ''
        }
      });
      const data = await response.json();
      setPerformanceData(data.performance || []);
    } catch (error) {
      console.error('Failed to fetch performance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const runPerformanceAudit = async (type: 'full' | 'crux' = 'full') => {
    setRunningAudit(true);
    try {
      const response = await fetch(`/api/performance?type=${type}`, {
        method: 'POST',
        headers: {
          'x-monitor-key': process.env.NEXT_PUBLIC_MONITOR_API_KEY || ''
        }
      });
      
      if (response.ok) {
        await fetchPerformanceData(); // Refresh data
      }
    } catch (error) {
      console.error('Performance audit failed:', error);
    } finally {
      setRunningAudit(false);
    }
  };

  // Get latest data for each URL/device combination
  const getLatestData = (url: string, device: string): PerformanceAudit | null => {
    const filtered = performanceData
      .filter(d => d.url === url && d.device === device)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return filtered[0]?.data || null;
  };

  const urls = ['https://discreetketamine.com', 'https://drbensoffer.com'];
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading performance data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Performance Monitoring</h1>
              <p className="text-gray-600 mt-2">
                Core Web Vitals, PageSpeed Insights, and Chrome UX Report data
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => runPerformanceAudit('crux')}
                disabled={runningAudit}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {runningAudit ? 'Running...' : 'CrUX Report'}
              </button>
              <button
                onClick={() => runPerformanceAudit('full')}
                disabled={runningAudit}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {runningAudit ? 'Running...' : 'Full Audit'}
              </button>
            </div>
          </div>
        </div>

        {/* Core Web Vitals Overview */}
        {urls.map(url => {
          const mobileData = getLatestData(url, 'mobile');
          const desktopData = getLatestData(url, 'desktop');
          const siteName = url.includes('discreetketamine') ? 'DK' : 'DBS';

          if (!mobileData && !desktopData) return null;

          return (
            <div key={url} className="mb-8">
              <h2 className="text-xl font-semibold mb-4">{siteName} - {url}</h2>
              
              {/* Mobile Core Web Vitals */}
              {mobileData && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium mb-3 flex items-center gap-2">
                    📱 Mobile Performance
                    <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      Score: {mobileData.performanceScore}/100
                    </span>
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
                    <CoreWebVitalsCard
                      title="LCP"
                      value={mobileData.coreWebVitals.lcp / 1000}
                      unit="s"
                      threshold={{ good: 2.5, needs: 4.0 }}
                      good={mobileData.coreWebVitals.lcp <= 2500}
                      needs={mobileData.coreWebVitals.lcp <= 4000}
                    />
                    <CoreWebVitalsCard
                      title="FID"
                      value={mobileData.coreWebVitals.fid}
                      unit="ms"
                      threshold={{ good: 100, needs: 300 }}
                      good={mobileData.coreWebVitals.fid <= 100}
                      needs={mobileData.coreWebVitals.fid <= 300}
                    />
                    <CoreWebVitalsCard
                      title="CLS"
                      value={mobileData.coreWebVitals.cls}
                      unit=""
                      threshold={{ good: 0.1, needs: 0.25 }}
                      good={mobileData.coreWebVitals.cls <= 0.1}
                      needs={mobileData.coreWebVitals.cls <= 0.25}
                    />
                    <CoreWebVitalsCard
                      title="FCP"
                      value={mobileData.coreWebVitals.fcp / 1000}
                      unit="s"
                      threshold={{ good: 1.8, needs: 3.0 }}
                      good={mobileData.coreWebVitals.fcp <= 1800}
                      needs={mobileData.coreWebVitals.fcp <= 3000}
                    />
                    <CoreWebVitalsCard
                      title="TTFB"
                      value={mobileData.coreWebVitals.ttfb}
                      unit="ms"
                      threshold={{ good: 800, needs: 1800 }}
                      good={mobileData.coreWebVitals.ttfb <= 800}
                      needs={mobileData.coreWebVitals.ttfb <= 1800}
                    />
                  </div>
                </div>
              )}

              {/* Desktop Core Web Vitals */}
              {desktopData && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium mb-3 flex items-center gap-2">
                    🖥️ Desktop Performance
                    <span className="text-sm bg-green-100 text-green-800 px-2 py-1 rounded">
                      Score: {desktopData.performanceScore}/100
                    </span>
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <CoreWebVitalsCard
                      title="LCP"
                      value={desktopData.coreWebVitals.lcp / 1000}
                      unit="s"
                      threshold={{ good: 2.5, needs: 4.0 }}
                      good={desktopData.coreWebVitals.lcp <= 2500}
                      needs={desktopData.coreWebVitals.lcp <= 4000}
                    />
                    <CoreWebVitalsCard
                      title="FID"
                      value={desktopData.coreWebVitals.fid}
                      unit="ms"
                      threshold={{ good: 100, needs: 300 }}
                      good={desktopData.coreWebVitals.fid <= 100}
                      needs={desktopData.coreWebVitals.fid <= 300}
                    />
                    <CoreWebVitalsCard
                      title="CLS"
                      value={desktopData.coreWebVitals.cls}
                      unit=""
                      threshold={{ good: 0.1, needs: 0.25 }}
                      good={desktopData.coreWebVitals.cls <= 0.1}
                      needs={desktopData.coreWebVitals.cls <= 0.25}
                    />
                    <CoreWebVitalsCard
                      title="FCP"
                      value={desktopData.coreWebVitals.fcp / 1000}
                      unit="s"
                      threshold={{ good: 1.8, needs: 3.0 }}
                      good={desktopData.coreWebVitals.fcp <= 1800}
                      needs={desktopData.coreWebVitals.fcp <= 3000}
                    />
                    <CoreWebVitalsCard
                      title="TTFB"
                      value={desktopData.coreWebVitals.ttfb}
                      unit="ms"
                      threshold={{ good: 800, needs: 1800 }}
                      good={desktopData.coreWebVitals.ttfb <= 800}
                      needs={desktopData.coreWebVitals.ttfb <= 1800}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Performance Trends */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <PerformanceChart 
            data={performanceData.filter(d => d.url === 'https://discreetketamine.com')} 
            title="DK Performance Trend"
          />
          <PerformanceChart 
            data={performanceData.filter(d => d.url === 'https://drbensoffer.com')} 
            title="DBS Performance Trend"
          />
        </div>

        {/* Recent Performance Audits */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Audits</h3>
          
          {performanceData.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">No performance data yet</p>
              <button
                onClick={() => runPerformanceAudit('full')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Run First Audit
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {performanceData.slice(0, 10).map((record) => (
                <div key={record.id} className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      record.device === 'mobile' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {record.device}
                    </span>
                    <span className="font-medium">
                      {record.url.includes('discreetketamine') ? 'DK' : 'DBS'}
                    </span>
                    <span className="text-sm text-gray-500">
                      {new URL(record.url).pathname || '/'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className={`font-medium ${
                      record.data.performanceScore >= 90 ? 'text-green-600' :
                      record.data.performanceScore >= 70 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {record.data.performanceScore}/100
                    </span>
                    <span className="text-gray-400">
                      {new Date(record.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}