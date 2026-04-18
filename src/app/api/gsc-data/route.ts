import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

// Real Google Search Console integration for DK and DBS
export async function GET(request: NextRequest) {
  // Verify API key
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '7d';
    const site = searchParams.get('site') || 'both'; // 'dk', 'dbs', or 'both'
    
    // Parse Google service account credentials
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
    
    if (!credentials.client_email) {
      throw new Error('Google Search Console credentials not configured');
    }

    // Initialize Google Auth
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
    });

    const authClient = await auth.getClient();
    const webmasters = google.webmasters({ version: 'v3', auth: authClient });

    const results: any = {};

    // Site URLs - try both URL property and domain property formats
    const siteUrls: Record<string, string> = {
      dk: 'https://discreetketamine.com/',
      dbs: 'https://drbensoffer.com/',
      tovani: 'https://tovanihealth.com/',
    };

    const domainUrls: Record<string, string> = {
      dk: 'sc-domain:discreetketamine.com',
      dbs: 'sc-domain:drbensoffer.com',
      tovani: 'sc-domain:tovanihealth.com',
    };

    // Date range calculation
    const getDateRange = (range: string) => {
      const today = new Date();
      const endDate = new Date(today.getTime() - 24 * 60 * 60 * 1000); // Yesterday for complete data
      
      let days: number;
      switch (range) {
        case '1d': days = 1; break;
        case '3d': days = 3; break;
        case '7d': days = 7; break;
        case '15d': days = 15; break;
        case '30d': days = 30; break;
        case '90d': days = 90; break;
        default: days = 7;
      }
      
      const startDate = new Date(endDate.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
      
      return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      };
    };

    const dateRange = getDateRange(range);
    const sitesToFetch =
      site === 'both' || site === 'all' ? ['dk', 'dbs', 'tovani'] : [site];

    for (const siteKey of sitesToFetch) {
      if (!siteUrls[siteKey as keyof typeof siteUrls]) continue;
      
      const siteUrl = siteUrls[siteKey as keyof typeof siteUrls];
      
      try {
        // Verify site ownership/access first - try both URL and domain properties
        const sitesList = await webmasters.sites.list({});
        
        const siteUrl = siteUrls[siteKey as keyof typeof siteUrls];
        const domainUrl = domainUrls[siteKey as keyof typeof domainUrls];
        
        const hasUrlAccess = sitesList.data.siteEntry?.some(entry => entry.siteUrl === siteUrl);
        const hasDomainAccess = sitesList.data.siteEntry?.some(entry => entry.siteUrl === domainUrl);
        
        let activeUrl = siteUrl;
        let hasAccess = hasUrlAccess || hasDomainAccess;
        
        if (hasDomainAccess && !hasUrlAccess) {
          activeUrl = domainUrl; // Use domain property if that's what we have access to
        }

        if (!hasAccess) {
          results[siteKey] = {
            error: `No Search Console access to ${siteUrl} or ${domainUrl}. Please verify site ownership.`,
            hasAccess: false,
            siteUrl,
            availableProperties: sitesList.data.siteEntry?.map(entry => entry.siteUrl) || []
          };
          continue;
        }

        // Query 1: Overall performance summary
        const overallResponse = await webmasters.searchanalytics.query({
          siteUrl: activeUrl,
          requestBody: {
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            dimensions: [], // No dimensions = aggregate data
            aggregationType: 'auto'
          }
        });

        // Query 2: Top queries
        const queriesResponse = await webmasters.searchanalytics.query({
          siteUrl: activeUrl,
          requestBody: {
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            dimensions: ['query'],
            rowLimit: 10,
            aggregationType: 'auto'
          }
        });

        // Query 3: Top pages
        const pagesResponse = await webmasters.searchanalytics.query({
          siteUrl: activeUrl,
          requestBody: {
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            dimensions: ['page'],
            rowLimit: 10,
            aggregationType: 'auto'
          }
        });

        // Query 4: Index coverage
        let indexingStatus: any = {
          verdict: 'UNKNOWN',
          canBeIndexed: null,
          lastCrawlTime: null,
          pageFetchState: 'UNKNOWN',
          coverage_issues: 0,
          valid_pages: 0,
          last_check: new Date().toISOString()
        };

        try {
          const inspectUrl = `${activeUrl}`;
          const inspectResponse = await webmasters.urlInspection.index.inspect({
            requestBody: {
              inspectionUrl: inspectUrl,
              siteUrl: activeUrl,
              languageCode: 'en'
            }
          });

          if (inspectResponse.data.inspectionResult) {
            const result = inspectResponse.data.inspectionResult;
            indexingStatus = {
              verdict: result.indexStatusResult?.verdict || 'UNKNOWN',
              canBeIndexed: result.indexStatusResult?.coverageState === 'Submitted and indexed',
              lastCrawlTime: result.indexStatusResult?.lastCrawlTime || null,
              pageFetchState: result.indexStatusResult?.pageFetchState || 'UNKNOWN',
              coverage_issues: 0, // Would need sitemap data for accurate count
              valid_pages: 0, // Would need sitemap data for accurate count
              last_check: new Date().toISOString()
            };
          }
        } catch (inspectError) {
          console.log(`URL inspection failed for ${siteKey}:`, inspectError);
          // Keep default values
        }

        // Process overall data
        const overall = overallResponse.data.rows?.[0] || {};
        const totalClicks = overall.clicks || 0;
        const totalImpressions = overall.impressions || 0;
        const averageCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + '%' : '0%';
        const averagePosition = overall.position?.toFixed(1) || '0.0';

        // Process top queries
        const topQueries = queriesResponse.data.rows?.map(row => {
          const query = row.keys?.[0] || 'Unknown';
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) + '%' : '0%';
          const position = row.position?.toFixed(1) || '0.0';
          
          return { query, clicks, impressions, ctr, position };
        }).slice(0, 5) || [];

        // Process top pages  
        const topPages = pagesResponse.data.rows?.map(row => {
          const page = row.keys?.[0]?.replace(activeUrl.startsWith('sc-domain:') ? `https://${activeUrl.replace('sc-domain:', '')}/` : activeUrl, '/') || '/';
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) + '%' : '0%';
          const position = row.position?.toFixed(1) || '0.0';
          
          return { page, clicks, impressions, ctr, position };
        }).slice(0, 5) || [];

        results[siteKey] = {
          totalClicks,
          totalImpressions,
          averageCtr,
          averagePosition,
          topQueries,
          topPages,
          indexing_status: indexingStatus,
          dateRange,
          hasAccess: true
        };

      } catch (siteError) {
        console.error(`GSC API error for ${siteKey}:`, siteError);
        results[siteKey] = {
          error: `Failed to fetch Search Console data for ${siteUrl}`,
          details: siteError instanceof Error ? siteError.message : 'Unknown error',
          hasAccess: false,
          siteUrl
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: results,
      range,
      lastUpdated: new Date().toISOString(),
      source: 'gsc_api',
      sites: siteUrls,
      note: 'Real Google Search Console data via API'
    });

  } catch (error) {
    console.error('GSC API initialization error:', error);
    return NextResponse.json({
      success: false,
      error: 'Search Console API error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}