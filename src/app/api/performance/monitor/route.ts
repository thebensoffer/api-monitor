import { NextRequest } from 'next/server';
import { runScheduledPerformanceMonitoring } from '@/scripts/performance-monitor';

export async function POST(request: NextRequest) {
  try {
    console.log('Running scheduled performance monitoring via API...');
    const result = await runScheduledPerformanceMonitoring();
    
    return Response.json({
      success: true,
      message: 'Performance monitoring completed successfully',
      summary: result
    });
  } catch (error) {
    console.error('Scheduled performance monitoring failed:', error);
    return Response.json({
      success: false,
      error: 'Performance monitoring failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}