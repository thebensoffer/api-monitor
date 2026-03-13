import { dynamodb, TABLES } from '@/lib/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const service = searchParams.get('service');
    const limit = parseInt(searchParams.get('limit') || '50');
    
    const command = new ScanCommand({
      TableName: TABLES.API_LOGS,
      Limit: limit,
      ...(service && {
        FilterExpression: 'service = :service',
        ExpressionAttributeValues: {
          ':service': service
        }
      })
    });
    
    const result = await dynamodb.send(command);
    
    return Response.json({
      logs: result.Items || [],
      count: result.Count || 0
    });
  } catch (error) {
    console.error('API Logs fetch error:', error);
    return Response.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}