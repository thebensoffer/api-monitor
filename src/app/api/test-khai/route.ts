import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Verify API key
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Test multiple endpoints to verify functionality
    const testResults = {
      timestamp: new Date().toISOString(),
      tests: [] as any[]
    };

    // Test 1: Basic API functionality
    testResults.tests.push({
      name: 'Basic API Response',
      status: 'success',
      result: 'API is responding correctly'
    });

    // Test 2: Environment variables
    testResults.tests.push({
      name: 'Environment Variables',
      status: process.env.NEXT_PUBLIC_MONITOR_API_KEY ? 'success' : 'warning',
      result: {
        hasMonitorKey: !!process.env.MONITOR_API_KEY,
        hasPublicKey: !!process.env.NEXT_PUBLIC_MONITOR_API_KEY,
        hasDkApiKey: !!process.env.DK_API_KEY,
        hasDbsApiKey: !!process.env.DBS_API_KEY
      }
    });

    // Test 3: External API connectivity
    try {
      const dkResponse = await fetch(process.env.DK_HEALTH_URL || 'https://discreetketamine.com/api/health', {
        method: 'GET',
        timeout: 5000
      });
      testResults.tests.push({
        name: 'DK Health Check',
        status: dkResponse.ok ? 'success' : 'error',
        result: {
          status: dkResponse.status,
          responseTime: dkResponse.headers.get('x-response-time') || 'N/A'
        }
      });
    } catch (error) {
      testResults.tests.push({
        name: 'DK Health Check',
        status: 'error',
        result: `Connection failed: ${error}`
      });
    }

    // Test 4: DBS connectivity
    try {
      const dbsResponse = await fetch(process.env.DBS_HEALTH_URL || 'https://drbensoffer.com/api/health', {
        method: 'GET',
        timeout: 5000
      });
      testResults.tests.push({
        name: 'DBS Health Check',
        status: dbsResponse.ok ? 'success' : 'error',
        result: {
          status: dbsResponse.status,
          responseTime: dbsResponse.headers.get('x-response-time') || 'N/A'
        }
      });
    } catch (error) {
      testResults.tests.push({
        name: 'DBS Health Check',
        status: 'error',
        result: `Connection failed: ${error}`
      });
    }

    // Test 5: GA4 Integration
    testResults.tests.push({
      name: 'GA4 Integration',
      status: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? 'success' : 'warning',
      result: {
        hasCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
        dkPropertyId: process.env.GA4_PROPERTY_ID_DK || 'Not set',
        dbsPropertyId: process.env.GA4_PROPERTY_ID_DBS || 'Not set'
      }
    });

    // Test 6: Current time and timezone
    testResults.tests.push({
      name: 'System Time',
      status: 'success',
      result: {
        utc: new Date().toISOString(),
        est: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Khai API test completed successfully',
      ...testResults
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Test failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Verify API key
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    return NextResponse.json({
      success: true,
      message: 'POST request received successfully',
      receivedData: body,
      timestamp: new Date().toISOString(),
      echo: body
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to process POST request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}