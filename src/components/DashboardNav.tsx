'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// Top nav deep-links into a tab inside /dashboard. The tabs UI inside
// the page reads `?tab=` from the URL and switches accordingly.
const navigation = [
  { name: 'Overview', tab: 'overview' },
  { name: 'Sent Comms', tab: 'sent' },
  { name: 'Performance', tab: 'performance' },
  { name: 'API Logs', tab: 'logs' },
  { name: 'Crons', tab: 'crons' },
  { name: 'Alerts', tab: 'business' },
];

export function DashboardNav() {
  const params = useSearchParams();
  const activeTab = params?.get('tab') || 'overview';

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/dashboard" className="text-xl font-bold text-gray-900 hover:opacity-80">
                ❤️ OpenHeart
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navigation.map((item) => {
                const isActive = activeTab === item.tab;
                return (
                  <Link
                    key={item.name}
                    href={`/dashboard?tab=${item.tab}`}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      isActive
                        ? 'border-blue-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center">
            <span className="text-sm text-gray-500">Medical Practice Command Center</span>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div className="sm:hidden border-t border-gray-100">
        <div className="pt-2 pb-3 space-y-1">
          {navigation.map((item) => {
            const isActive = activeTab === item.tab;
            return (
              <Link
                key={item.name}
                href={`/dashboard?tab=${item.tab}`}
                className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                  isActive
                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
