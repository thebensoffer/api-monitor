export async function runScheduledPerformanceMonitoring() {
  console.log('Starting scheduled performance monitoring...');
  
  const results = {
    timestamp: new Date().toISOString(),
    checks: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0
    }
  };

  try {
    // Check DK health
    const dkStart = Date.now();
    const dkResponse = await fetch('https://discreetketamine.com/api/health');
    const dkTime = Date.now() - dkStart;
    const dkHealthy = dkResponse.ok;
    
    results.checks.push({
      service: 'DK Health',
      url: 'https://discreetketamine.com/api/health',
      status: dkHealthy ? 'PASS' : 'FAIL',
      responseTime: dkTime,
      httpStatus: dkResponse.status
    });

    // Check DBS health
    const dbsStart = Date.now();
    const dbsResponse = await fetch('https://drbensoffer.com/api/health');
    const dbsTime = Date.now() - dbsStart;
    const dbsHealthy = dbsResponse.ok;
    
    results.checks.push({
      service: 'DBS Health',
      url: 'https://drbensoffer.com/api/health',
      status: dbsHealthy ? 'PASS' : 'FAIL',
      responseTime: dbsTime,
      httpStatus: dbsResponse.status
    });

    // Calculate summary
    results.summary.total = results.checks.length;
    results.summary.passed = results.checks.filter(c => c.status === 'PASS').length;
    results.summary.failed = results.checks.filter(c => c.status === 'FAIL').length;
    results.summary.warnings = results.checks.filter(c => c.status === 'WARNING').length;

    console.log(`Performance monitoring completed: ${results.summary.passed}/${results.summary.total} passed`);
    return results;

  } catch (error) {
    console.error('Performance monitoring error:', error);
    results.summary.failed = results.summary.total = 1;
    results.checks.push({
      service: 'Performance Monitor',
      status: 'FAIL',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return results;
  }
}