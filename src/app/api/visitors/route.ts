import { NextRequest, NextResponse } from 'next/server';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

export const dynamic = 'force-dynamic';

/**
 * Real-time visitor data pulled from GA4 Realtime Reporting API.
 * Replaces the old Math.random() mock.
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!credentialsJson) {
      return NextResponse.json({
        success: false,
        error: 'GOOGLE_APPLICATION_CREDENTIALS_JSON not configured',
        hint: 'Set the Google service account JSON in Amplify env vars',
      }, { status: 503 });
    }
    const credentials = JSON.parse(credentialsJson);
    const client = new BetaAnalyticsDataClient({ credentials });

    const properties = {
      dk: process.env.GA4_PROPERTY_ID_DK || '409955354',
      dbs: process.env.GA4_PROPERTY_ID_DBS || '521897216',
      tovani: process.env.GA4_PROPERTY_ID_TOVANI || '529713159',
    };

    async function realtime(propertyId: string) {
      try {
        const [res] = await client.runRealtimeReport({
          property: `properties/${propertyId}`,
          dimensions: [{ name: 'country' }, { name: 'city' }, { name: 'deviceCategory' }, { name: 'unifiedScreenName' }],
          metrics: [{ name: 'activeUsers' }],
        });
        const rows = (res.rows || []).map((r) => ({
          country: r.dimensionValues?.[0]?.value || 'Unknown',
          city: r.dimensionValues?.[1]?.value || 'Unknown',
          device: r.dimensionValues?.[2]?.value || 'Unknown',
          page: r.dimensionValues?.[3]?.value || 'Unknown',
          activeUsers: parseInt(r.metricValues?.[0]?.value || '0', 10),
        }));
        const total = rows.reduce((s, r) => s + r.activeUsers, 0);
        return { total, rows, error: null as string | null };
      } catch (err) {
        return { total: 0, rows: [], error: err instanceof Error ? err.message : 'GA4 error' };
      }
    }

    const [dkRT, dbsRT, tovaniRT] = await Promise.all([
      realtime(properties.dk),
      realtime(properties.dbs),
      realtime(properties.tovani),
    ]);

    async function recent(propertyId: string) {
      try {
        const [res] = await client.runReport({
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: '1daysAgo', endDate: 'today' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' }],
        });
        const [sessions, users, newUsers] = (res.rows?.[0]?.metricValues || []).map((m) => parseInt(m.value || '0', 10));
        return { sessions: sessions ?? 0, users: users ?? 0, newUsers: newUsers ?? 0, error: null as string | null };
      } catch (err) {
        return { sessions: 0, users: 0, newUsers: 0, error: err instanceof Error ? err.message : 'GA4 error' };
      }
    }
    const [dkRecent, dbsRecent, tovaniRecent] = await Promise.all([
      recent(properties.dk),
      recent(properties.dbs),
      recent(properties.tovani),
    ]);

    const flat = [
      ...dkRT.rows.map((r) => ({ ...r, site: 'DK' })),
      ...dbsRT.rows.map((r) => ({ ...r, site: 'DBS' })),
      ...tovaniRT.rows.map((r) => ({ ...r, site: 'Tovani' })),
    ];

    return NextResponse.json({
      success: true,
      data: {
        active_now: dkRT.total + dbsRT.total + tovaniRT.total,
        active_dk: dkRT.total,
        active_dbs: dbsRT.total,
        active_tovani: tovaniRT.total,
        last_24h: {
          dk: dkRecent,
          dbs: dbsRecent,
          tovani: tovaniRecent,
          total_sessions: dkRecent.sessions + dbsRecent.sessions + tovaniRecent.sessions,
        },
        live_activity: flat.slice(0, 30),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
