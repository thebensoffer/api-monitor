'use client';

import { DashboardNav } from '@/components/DashboardNav';
import { TabbedDashboard } from '@/components/TabbedDashboard';
import { useState, useEffect, Suspense } from 'react';

export default function Dashboard() {
  const [currentTime, setCurrentTime] = useState('--:--:-- --');

  useEffect(() => {
    setCurrentTime(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <Suspense fallback={<div className="bg-white shadow-sm border-b h-14" />}>
        <DashboardNav />
      </Suspense>
      <div className="max-w-7xl mx-auto py-4 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <div className="mb-3 flex items-center justify-end">
            <div className="text-xs text-gray-500">Updated {currentTime}</div>
          </div>
          <Suspense fallback={<div className="text-gray-500">Loading dashboard…</div>}>
            <TabbedDashboard />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
