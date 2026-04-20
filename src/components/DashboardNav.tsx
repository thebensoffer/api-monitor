'use client';

import Link from 'next/link';

/**
 * Top header strip — logo + tagline only. Tab navigation lives below in
 * TabbedDashboard so the header stays simple and there's only one nav
 * system on the page.
 */
export function DashboardNav() {
  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          <Link href="/dashboard" className="text-xl font-bold text-gray-900 hover:opacity-80">
            ❤️ OpenHeart
          </Link>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="hidden sm:inline">Medical Practice Command Center</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-xs">live</span>
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
}
