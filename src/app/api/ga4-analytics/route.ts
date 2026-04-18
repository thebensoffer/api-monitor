import { NextRequest, NextResponse } from 'next/server';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

// Real Google Analytics 4 integration for DK and DBS
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '7d';
    const site = searchParams.get('site') || 'both'; // 'dk', 'dbs', or 'both'
    
    // Parse Google service account credentials
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
    
    if (!credentials.client_email) {
      throw new Error('Google Analytics credentials not configured');
    }

    // Initialize GA4 client
    const analyticsDataClient = new BetaAnalyticsDataClient({
      credentials
    });

    const results: any = {};

    // Property IDs
    const properties = {
      dk: '409955354',
      dbs: '521897216'
    };

    // Date range calculation
    const getDateRange = (range: string) => {
      const today = new Date();
      const endDate = new Date(today.getTime() - 24 * 60 * 60 * 1000); // Yesterday for completed data
      
      let startDate: Date;
      let granularity: 'day' | 'week' | 'month' = 'day';
      
      switch (range) {
        case '1d':
          startDate = new Date(endDate);
          granularity = 'day';
          break;
        case '3d':
          startDate = new Date(endDate.getTime() - 2 * 24 * 60 * 60 * 1000);
          granularity = 'day';
          break;
        case '7d':
          startDate = new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000);
          granularity = 'day';
          break;
        case '15d':
          startDate = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1000);
          granularity = 'day';
          break;
        case '30d':
          startDate = new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);
          granularity = 'day';
          break;
        case '90d':
          startDate = new Date(endDate.getTime() - 89 * 24 * 60 * 60 * 1000);
          granularity = 'week';
          break;
        case '6m':
          startDate = new Date(endDate.getTime() - 6 * 30 * 24 * 60 * 60 * 1000);
          granularity = 'week';
          break;
        case '12m':
          startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
          granularity = 'month';
          break;
        case '18m':
          startDate = new Date(endDate.getTime() - 18 * 30 * 24 * 60 * 60 * 1000);
          granularity = 'month';
          break;
        case '5y':
          startDate = new Date(endDate.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
          granularity = 'month';
          break;
        default:
          startDate = new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000);
          granularity = 'day';
      }
      
      // Format dates for GA4 API (YYYY-MM-DD)
      const formatDate = (date: Date) => {
        return date.toISOString().split('T')[0];
      };
      
      return { 
        startDate: formatDate(startDate), 
        endDate: formatDate(endDate),
        granularity
      };
    };

    const dateRange = getDateRange(range);

    // Sites to fetch data for
    const sitesToFetch = site === 'both' ? ['dk', 'dbs'] : [site];

    for (const siteKey of sitesToFetch) {
      if (!properties[siteKey as keyof typeof properties]) continue;
      
      const propertyId = properties[siteKey as keyof typeof properties];
      
      try {
        // Basic metrics report
        const [basicResponse] = await analyticsDataClient.runReport({
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
          dimensions: [],
          metrics: [
            { name: 'sessions' },
            { name: 'screenPageViews' },
            { name: 'totalUsers' },
            { name: 'averageSessionDuration' },
            { name: 'bounceRate' },
            { name: 'conversions' }
          ]
        });

        // Time series data for charts
        const timeDimension = dateRange.granularity === 'month' ? 'yearMonth' : 
                             dateRange.granularity === 'week' ? 'yearWeek' : 'date';
                             
        const [timeSeriesResponse] = await analyticsDataClient.runReport({
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
          dimensions: [{ name: timeDimension }],
          metrics: [
            { name: 'sessions' },
            { name: 'conversions' },
            { name: 'totalUsers' }
          ],
          orderBys: [{ dimension: { dimensionName: timeDimension }, desc: false }]
        });

        // Top pages report  
        const [pagesResponse] = await analyticsDataClient.runReport({
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [
            { name: 'sessions' },
            { name: 'conversions' }
          ],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 10
        });

        // Traffic sources report
        const [sourcesResponse] = await analyticsDataClient.runReport({
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
          dimensions: [
            { name: 'sessionDefaultChannelGroup' },
            { name: 'sessionSource' }
          ],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 10
        });

        // Process basic metrics
        const basicMetrics = basicResponse.rows?.[0]?.metricValues || [];
        const sessions = parseInt(basicMetrics[0]?.value || '0');
        const pageviews = parseInt(basicMetrics[1]?.value || '0');
        const users = parseInt(basicMetrics[2]?.value || '0');
        const avgDurationSeconds = parseFloat(basicMetrics[3]?.value || '0');
        const bounceRate = parseFloat(basicMetrics[4]?.value || '0');
        const conversions = parseInt(basicMetrics[5]?.value || '0');

        // Format average duration
        const avgDuration = avgDurationSeconds > 0 
          ? `${Math.floor(avgDurationSeconds / 60)}m ${Math.floor(avgDurationSeconds % 60)}s`
          : '0m 0s';

        // Calculate conversion rate
        const conversionRate = sessions > 0 ? ((conversions / sessions) * 100).toFixed(2) + '%' : '0%';

        // Process top pages
        const topPages = pagesResponse.rows?.map(row => {
          const pagePath = row.dimensionValues?.[0]?.value || '';
          const pageSessions = parseInt(row.metricValues?.[0]?.value || '0');
          const pageConversions = parseInt(row.metricValues?.[1]?.value || '0');
          const pageCvr = pageSessions > 0 ? ((pageConversions / pageSessions) * 100).toFixed(1) + '%' : '0%';
          
          return {
            page: pagePath,
            sessions: pageSessions,
            cvr: pageCvr
          };
        }).slice(0, 5) || [];

        // Process traffic sources
        const trafficSources = sourcesResponse.rows?.map(row => {
          const channel = row.dimensionValues?.[0]?.value || 'Unknown';
          const source = row.dimensionValues?.[1]?.value || 'Unknown';
          const sourceSessions = parseInt(row.metricValues?.[0]?.value || '0');
          const percentage = sessions > 0 ? ((sourceSessions / sessions) * 100).toFixed(1) + '%' : '0%';
          
          return {
            source: `${source} / ${channel.toLowerCase()}`,
            sessions: sourceSessions,
            percentage
          };
        }).slice(0, 5) || [];

        // Process time series data for charts
        const chartData = timeSeriesResponse.rows?.map(row => {
          const dateKey = row.dimensionValues?.[0]?.value || '';
          const sessions = parseInt(row.metricValues?.[0]?.value || '0');
          const conversions = parseInt(row.metricValues?.[1]?.value || '0');
          const users = parseInt(row.metricValues?.[2]?.value || '0');
          
          // Format date for display
          let formattedDate = dateKey;
          if (timeDimension === 'date') {
            // Format YYYYMMDD to readable date
            const year = dateKey.slice(0, 4);
            const month = dateKey.slice(4, 6);
            const day = dateKey.slice(6, 8);
            formattedDate = `${year}-${month}-${day}`;
          } else if (timeDimension === 'yearWeek') {
            // Format YYYYWW to readable week
            const year = dateKey.slice(0, 4);
            const week = dateKey.slice(4, 6);
            formattedDate = `${year} W${week}`;
          } else if (timeDimension === 'yearMonth') {
            // Format YYYYMM to readable month
            const year = dateKey.slice(0, 4);
            const month = dateKey.slice(4, 6);
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            formattedDate = `${monthNames[parseInt(month) - 1]} ${year}`;
          }
          
          return {
            date: formattedDate,
            dateKey,
            sessions,
            conversions,
            users,
            conversionRate: sessions > 0 ? ((conversions / sessions) * 100).toFixed(2) : '0'
          };
        }) || [];

        results[siteKey] = {
          sessions,
          pageviews,
          users,
          avgDuration,
          bounceRate: bounceRate.toFixed(1) + '%',
          conversions,
          conversionRate,
          topPages,
          traffic_sources: trafficSources,
          chartData, // Add time series data for charts
          dateRange: {
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            granularity: dateRange.granularity
          }
        };

      } catch (siteError) {
        console.error(`Error fetching GA4 data for ${siteKey}:`, siteError);
        results[siteKey] = {
          error: 'Failed to fetch analytics data',
          sessions: 0,
          pageviews: 0,
          users: 0,
          avgDuration: '0m 0s',
          bounceRate: '0%',
          conversions: 0,
          conversionRate: '0%',
          topPages: [],
          traffic_sources: []
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: results,
      range,
      lastUpdated: new Date().toISOString(),
      source: 'ga4_api',
      properties: {
        dk: properties.dk,
        dbs: properties.dbs
      }
    });

  } catch (error) {
    console.error('GA4 Analytics API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch analytics data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}