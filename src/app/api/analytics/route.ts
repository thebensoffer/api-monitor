import { NextRequest, NextResponse } from 'next/server';

// GA4 Analytics Data - Mock for now, will integrate with real GA4 API
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get('range') || '7d'; // 1d, 7d, 30d
    const site = searchParams.get('site') || 'both'; // dk, dbs, both
    
    // Mock GA4 data - would be replaced with real GA4 API calls
    const mockData = {
      dk: {
        sessions: {
          current: 1247,
          previous: 1156,
          change: 7.9
        },
        users: {
          current: 1100,
          previous: 1020,
          change: 7.8
        },
        pageviews: {
          current: 3421,
          previous: 3180,
          change: 7.6
        },
        bounceRate: {
          current: 89.2,
          previous: 90.1,
          change: -0.9
        },
        avgSessionDuration: {
          current: 42,
          previous: 36,
          change: 16.7
        },
        conversions: {
          eligibility_started: 127,
          eligibility_completed: 23,
          purchases: 2,
          cvr: 1.8
        },
        topPages: [
          { page: '/', sessions: 856, bounceRate: 89.2 },
          { page: '/eligibility', sessions: 127, bounceRate: 5.1 },
          { page: '/how-it-works', sessions: 89, bounceRate: 67.4 },
          { page: '/pricing', sessions: 67, bounceRate: 78.2 },
          { page: '/faq', sessions: 45, bounceRate: 72.1 }
        ],
        topSources: [
          { source: 'Direct', sessions: 798, percentage: 64.0 },
          { source: 'Google Organic', sessions: 312, percentage: 25.0 },
          { source: 'Google Ads', sessions: 89, percentage: 7.1 },
          { source: 'ChatGPT.com', sessions: 23, percentage: 1.8 },
          { source: 'Social', sessions: 25, percentage: 2.0 }
        ],
        hourlyTrend: [
          { hour: '00', sessions: 12 }, { hour: '01', sessions: 8 }, { hour: '02', sessions: 5 },
          { hour: '03', sessions: 3 }, { hour: '04', sessions: 7 }, { hour: '05', sessions: 15 },
          { hour: '06', sessions: 28 }, { hour: '07', sessions: 45 }, { hour: '08', sessions: 67 },
          { hour: '09', sessions: 89, peak: true }, { hour: '10', sessions: 78 }, { hour: '11', sessions: 65 },
          { hour: '12', sessions: 72 }, { hour: '13', sessions: 84 }, { hour: '14', sessions: 92, peak: true },
          { hour: '15', sessions: 88 }, { hour: '16', sessions: 74 }, { hour: '17', sessions: 58 },
          { hour: '18', sessions: 45 }, { hour: '19', sessions: 38 }, { hour: '20', sessions: 32 },
          { hour: '21', sessions: 28 }, { hour: '22', sessions: 22 }, { hour: '23', sessions: 18 }
        ]
      },
      dbs: {
        sessions: {
          current: 28,
          previous: 15,
          change: 86.7
        },
        users: {
          current: 25,
          previous: 13,
          change: 92.3
        },
        pageviews: {
          current: 142,
          previous: 67,
          change: 112.0
        },
        bounceRate: {
          current: 42.1,
          previous: 53.3,
          change: -21.0
        },
        avgSessionDuration: {
          current: 180,
          previous: 120,
          change: 50.0
        },
        conversions: {
          contact_form: 5,
          consultation_requests: 3,
          phone_calls: 2
        },
        topPages: [
          { page: '/', sessions: 15, bounceRate: 40.0 },
          { page: '/services', sessions: 8, bounceRate: 25.0 },
          { page: '/about', sessions: 5, bounceRate: 60.0 },
          { page: '/contact', sessions: 7, bounceRate: 14.3 },
          { page: '/pricing', sessions: 3, bounceRate: 0.0 }
        ],
        topSources: [
          { source: 'Google Organic', sessions: 18, percentage: 64.3 },
          { source: 'Direct', sessions: 7, percentage: 25.0 },
          { source: 'Referral', sessions: 2, percentage: 7.1 },
          { source: 'Social', sessions: 1, percentage: 3.6 }
        ],
        gscData: {
          clicks: 90,
          impressions: 2847,
          ctr: 3.16,
          position: 12.4,
          topQueries: [
            { query: 'concierge medicine boca raton', clicks: 23, impressions: 156, ctr: 14.7, position: 8.2 },
            { query: 'private doctor florida', clicks: 18, impressions: 267, ctr: 6.7, position: 11.3 },
            { query: 'dr ben soffer', clicks: 15, impressions: 89, ctr: 16.9, position: 2.1 },
            { query: 'boutique medicine', clicks: 12, impressions: 445, ctr: 2.7, position: 18.7 }
          ]
        }
      }
    };
    
    const result = site === 'both' ? mockData : { [site]: mockData[site as keyof typeof mockData] };
    
    return NextResponse.json({
      success: true,
      data: result,
      timeRange,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch analytics data' },
      { status: 500 }
    );
  }
}