import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Real-time visitor data (mock but realistic)
    const visitors = {
      active_now: Math.floor(Math.random() * 15) + 8, // 8-22 active
      last_hour: Math.floor(Math.random() * 30) + 40, // 40-70 last hour
      avg_session: `${Math.floor(Math.random() * 3) + 1}m ${Math.floor(Math.random() * 60)}s`,
      new_visitors_pct: Math.floor(Math.random() * 20) + 65, // 65-85%
      
      live_activity: [
        {
          location: "Miami, FL",
          page: "Assessment page",
          duration: "3m 12s",
          status: "active",
          site: "DK"
        },
        {
          location: "Tampa, FL", 
          page: "Checkout",
          duration: "1m 28s",
          status: "converting",
          site: "DK"
        },
        {
          location: "Boca Raton, FL",
          page: "Contact form", 
          duration: "4m 18s",
          status: "active",
          site: "DBS"
        },
        {
          location: "New York, NY",
          page: "Homepage",
          duration: "45s", 
          status: "browsing",
          site: "DK"
        }
      ],
      
      traffic_sources: {
        direct: 58,
        google: 28, 
        social: 8,
        referral: 6
      },
      
      devices: {
        mobile: 67,
        desktop: 28,
        tablet: 5
      },
      
      locations: [
        { state: "Florida", count: 5, pct: 42 },
        { state: "New York", count: 2, pct: 18 },
        { state: "California", count: 1, pct: 12 },
        { state: "Texas", count: 0, pct: 8 }
      ],

      recent_events: [
        { event: "Assessment started", time: "3m ago", site: "DK" },
        { event: "Contact form submitted", time: "7m ago", site: "DBS" },
        { event: "Package purchased", time: "12m ago", site: "DK" },
        { event: "Email sent", time: "15m ago", site: "DK" }
      ]
    };

    return NextResponse.json({
      success: true,
      data: visitors,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch visitor data'
    }, { status: 500 });
  }
}