import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Mock but realistic Core Web Vitals data
    const performanceData = {
      dk: {
        url: 'discreetketamine.com',
        performance_score: 87,
        accessibility_score: 94,
        best_practices_score: 92,
        seo_score: 96,
        core_web_vitals: {
          lcp: { value: 2.1, rating: 'good', unit: 's' }, // Largest Contentful Paint
          fid: { value: 89, rating: 'good', unit: 'ms' }, // First Input Delay
          cls: { value: 0.08, rating: 'good', unit: '' }, // Cumulative Layout Shift
          fcp: { value: 1.4, rating: 'good', unit: 's' }, // First Contentful Paint
          ttfb: { value: 320, rating: 'good', unit: 'ms' } // Time to First Byte
        },
        mobile: {
          performance_score: 82,
          lcp: 2.8,
          fid: 110,
          cls: 0.12
        },
        desktop: {
          performance_score: 91,
          lcp: 1.6,
          fid: 45,
          cls: 0.05
        },
        trends: [
          { date: '2026-03-13', score: 87, lcp: 2.1 },
          { date: '2026-03-12', score: 85, lcp: 2.3 },
          { date: '2026-03-11', score: 89, lcp: 1.9 },
          { date: '2026-03-10', score: 86, lcp: 2.2 },
          { date: '2026-03-09', score: 88, lcp: 2.0 }
        ]
      },
      dbs: {
        url: 'drbensoffer.com',
        performance_score: 93,
        accessibility_score: 98,
        best_practices_score: 95,
        seo_score: 99,
        core_web_vitals: {
          lcp: { value: 1.8, rating: 'good', unit: 's' },
          fid: { value: 65, rating: 'good', unit: 'ms' },
          cls: { value: 0.04, rating: 'good', unit: '' },
          fcp: { value: 1.1, rating: 'good', unit: 's' },
          ttfb: { value: 180, rating: 'good', unit: 'ms' }
        },
        mobile: {
          performance_score: 89,
          lcp: 2.3,
          fid: 85,
          cls: 0.06
        },
        desktop: {
          performance_score: 96,
          lcp: 1.3,
          fid: 32,
          cls: 0.02
        },
        trends: [
          { date: '2026-03-13', score: 93, lcp: 1.8 },
          { date: '2026-03-12', score: 91, lcp: 1.9 },
          { date: '2026-03-11', score: 94, lcp: 1.7 },
          { date: '2026-03-10', score: 92, lcp: 1.8 },
          { date: '2026-03-09', score: 95, lcp: 1.6 }
        ]
      },
      recent_audits: [
        {
          id: 'audit-001',
          site: 'DK',
          timestamp: new Date(Date.now() - 300000).toISOString(), // 5 min ago
          performance_score: 87,
          issues: ['Optimize images', 'Reduce unused CSS'],
          improvements: ['+2 points from image optimization']
        },
        {
          id: 'audit-002', 
          site: 'DBS',
          timestamp: new Date(Date.now() - 900000).toISOString(), // 15 min ago
          performance_score: 93,
          issues: ['Minify JavaScript'],
          improvements: ['+1 point from code minification']
        }
      ],
      summary: {
        avg_performance: 90,
        sites_above_90: 1,
        core_vitals_passing: 2,
        total_issues: 3,
        last_audit: new Date().toISOString()
      }
    };

    return NextResponse.json({
      success: true,
      data: performanceData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch performance data'
    }, { status: 500 });
  }
}