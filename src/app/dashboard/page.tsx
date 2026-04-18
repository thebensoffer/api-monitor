'use client';

import { DashboardNav } from '@/components/DashboardNav';
import { TabbedDashboard } from '@/components/TabbedDashboard';
import { useState, useEffect } from 'react';

export default function Dashboard() {
  const [currentTime, setCurrentTime] = useState('--:--:-- --');

  useEffect(() => {
    // Set initial time after hydration
    setCurrentTime(new Date().toLocaleTimeString());
    
    // Update time every 30 seconds
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <DashboardNav />
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <div className="md:flex md:items-center md:justify-between">
              <div className="flex-1 min-w-0">
                <h1 className="text-3xl font-bold leading-tight text-gray-900 flex items-center">
                  ❤️ <span className="ml-2">OpenHeart</span>
                  <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Live
                  </span>
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  Real-time monitoring for DK & DBS platforms • Enhanced with business intelligence
                </p>
              </div>
              <div className="mt-4 flex md:mt-0 md:ml-4">
                <div className="text-sm text-gray-500">
                  Last updated: {currentTime}
                </div>
              </div>
            </div>
          </div>

          <TabbedDashboard />
        </div>
      </div>
    </div>
  );
}