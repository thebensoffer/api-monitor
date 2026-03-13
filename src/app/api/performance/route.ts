import { NextRequest } from 'next/server';
import { PerformanceMonitor } from '@/lib/performance';
import { dynamodb, TABLES } from '@/lib/dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const performanceMonitor = new PerformanceMonitor();

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'full'; // 'full' or 'crux'
    
    let results;
    
    if (type === 'crux') {
      console.log('Running Chrome UX Report audit...');
      results = await performanceMonitor.getCruxDataForUrls();
    } else {
      console.log('Running full PageSpeed Insights audit...');
      results = await performanceMonitor.runFullAudit();
    }
    
    // Store results in DynamoDB
    for (const result of results) {
      const command = new PutCommand({
        TableName: TABLES.METRICS,
        Item: {
          id: uuidv4(),
          service: 'performance',
          type: type === 'crux' ? 'crux' : 'pagespeed',
          timestamp: new Date().toISOString(),
          data: result,
          url: result.url,
          device: 'device' in result ? result.device : undefined,
        }
      });
      
      await dynamodb.send(command);
    }
    
    return Response.json({
      success: true,
      type,
      results,
      count: results.length,
      message: `${type === 'crux' ? 'Chrome UX Report' : 'PageSpeed Insights'} audit complete`
    });
    
  } catch (error) {
    console.error('Performance audit error:', error);
    return Response.json({ 
      error: 'Performance audit failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    const device = searchParams.get('device');
    const limit = parseInt(searchParams.get('limit') || '20');
    
    // Query performance history from DynamoDB
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    
    let filterExpression = 'service = :service';
    let expressionAttributeValues: any = {
      ':service': 'performance'
    };
    
    if (url) {
      filterExpression += ' AND #url = :url';
      expressionAttributeValues[':url'] = url;
    }
    
    if (device) {
      filterExpression += ' AND #device = :device';
      expressionAttributeValues[':device'] = device;
    }
    
    const command = new ScanCommand({
      TableName: TABLES.METRICS,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(url && { ExpressionAttributeNames: { '#url': 'url' } }),
      ...(device && { ExpressionAttributeNames: { '#device': 'device' } }),
      Limit: limit,
      ScanIndexForward: false // Most recent first
    });
    
    const result = await dynamodb.send(command);
    
    return Response.json({
      performance: result.Items || [],
      count: result.Count || 0
    });
    
  } catch (error) {
    console.error('Performance history fetch error:', error);
    return Response.json({ error: 'Failed to fetch performance history' }, { status: 500 });
  }
}