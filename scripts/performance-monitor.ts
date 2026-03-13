import { PerformanceMonitor } from '@/lib/performance';
import { dynamodb, TABLES } from '@/lib/dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { PerformanceAlert } from '@/types/performance';
import { v4 as uuidv4 } from 'uuid';

// Performance thresholds for alerting
const THRESHOLDS = {
  lcp: { good: 2500, needs: 4000 }, // Largest Contentful Paint (ms)
  fid: { good: 100, needs: 300 },   // First Input Delay (ms)
  cls: { good: 0.1, needs: 0.25 },  // Cumulative Layout Shift
  performanceScore: { good: 90, needs: 70 } // Overall performance score
};

const CRITICAL_URLS = [
  'https://discreetketamine.com',
  'https://discreetketamine.com/at-home-ketamine-therapy',
  'https://drbensoffer.com'
];

class PerformanceAlertManager {
  async checkPerformanceThresholds(audits: any[]) {
    const alerts: PerformanceAlert[] = [];
    
    for (const audit of audits) {
      const url = audit.url;
      const device = audit.device;
      const siteName = url.includes('discreet') ? 'DK' : 'DBS';
      
      // Check LCP (Largest Contentful Paint)
      if (audit.coreWebVitals.lcp > THRESHOLDS.lcp.needs) {
        alerts.push({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          url,
          alertType: 'cwv_degradation',
          severity: audit.coreWebVitals.lcp > 6000 ? 'critical' : 'high',
          metric: 'lcp',
          currentValue: audit.coreWebVitals.lcp,
          previousValue: 0, // Would need historical comparison
          threshold: THRESHOLDS.lcp.needs,
          message: `${siteName} ${device} LCP is ${(audit.coreWebVitals.lcp / 1000).toFixed(1)}s (threshold: ${THRESHOLDS.lcp.needs / 1000}s)`,
          recommendations: [
            'Optimize largest image/video loading',
            'Reduce server response time',
            'Remove render-blocking resources'
          ]
        });
      }
      
      // Check Performance Score
      if (audit.performanceScore < THRESHOLDS.performanceScore.needs) {
        alerts.push({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          url,
          alertType: 'performance_drop',
          severity: audit.performanceScore < 50 ? 'critical' : 'medium',
          metric: 'performance_score',
          currentValue: audit.performanceScore,
          previousValue: 0,
          threshold: THRESHOLDS.performanceScore.needs,
          message: `${siteName} ${device} performance score dropped to ${audit.performanceScore}/100`,
          recommendations: [
            'Review performance opportunities',
            'Optimize Core Web Vitals',
            'Compress and optimize assets'
          ]
        });
      }
      
      // Check mobile vs desktop performance gap
      const mobileAudit = audits.find(a => a.url === url && a.device === 'mobile');
      const desktopAudit = audits.find(a => a.url === url && a.device === 'desktop');
      
      if (mobileAudit && desktopAudit) {
        const scoreDiff = desktopAudit.performanceScore - mobileAudit.performanceScore;
        if (scoreDiff > 30) { // More than 30 point difference
          alerts.push({
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            url,
            alertType: 'mobile_desktop_gap',
            severity: 'medium',
            metric: 'performance_score',
            currentValue: mobileAudit.performanceScore,
            previousValue: desktopAudit.performanceScore,
            threshold: 30,
            message: `${siteName} has large mobile/desktop performance gap: Mobile ${mobileAudit.performanceScore} vs Desktop ${desktopAudit.performanceScore}`,
            recommendations: [
              'Focus on mobile-specific optimizations',
              'Reduce mobile payload size',
              'Implement progressive loading'
            ]
          });
        }
      }
    }
    
    // Store alerts in DynamoDB
    for (const alert of alerts) {
      const command = new PutCommand({
        TableName: TABLES.ALERTS,
        Item: alert
      });
      await dynamodb.send(command);
    }
    
    return alerts;
  }
  
  async sendAlertNotification(alert: PerformanceAlert) {
    // This would integrate with your existing heartbeat system
    // For now, just log the alert
    console.log(`🚨 PERFORMANCE ALERT: ${alert.message}`);
    console.log(`Severity: ${alert.severity.toUpperCase()}`);
    console.log(`URL: ${alert.url}`);
    console.log(`Recommendations: ${alert.recommendations?.join(', ')}`);
  }
}

// Main scheduled monitoring function
async function runScheduledPerformanceMonitoring() {
  console.log('🚀 Starting scheduled performance monitoring...');
  
  const monitor = new PerformanceMonitor();
  const alertManager = new PerformanceAlertManager();
  
  try {
    // Run performance audits
    console.log('Running PageSpeed Insights audits...');
    const audits = await monitor.runFullAudit();
    
    console.log(`✅ Completed ${audits.length} audits`);
    
    // Store results
    for (const audit of audits) {
      const command = new PutCommand({
        TableName: TABLES.METRICS,
        Item: {
          id: uuidv4(),
          service: 'performance',
          type: 'pagespeed',
          timestamp: new Date().toISOString(),
          data: audit,
          url: audit.url,
          device: audit.device,
        }
      });
      
      await dynamodb.send(command);
    }
    
    // Check for performance issues and create alerts
    const alerts = await alertManager.checkPerformanceThresholds(audits);
    
    if (alerts.length > 0) {
      console.log(`⚠️  Generated ${alerts.length} performance alerts`);
      
      // Send notifications for critical alerts
      for (const alert of alerts.filter(a => a.severity === 'critical')) {
        await alertManager.sendAlertNotification(alert);
      }
    } else {
      console.log('✅ No performance issues detected');
    }
    
    // Summary
    const summary = {
      timestamp: new Date().toISOString(),
      auditsCompleted: audits.length,
      alertsGenerated: alerts.length,
      criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
      avgMobileScore: Math.round(
        audits.filter(a => a.device === 'mobile')
          .reduce((acc, a) => acc + a.performanceScore, 0) / 
        audits.filter(a => a.device === 'mobile').length || 0
      ),
      avgDesktopScore: Math.round(
        audits.filter(a => a.device === 'desktop')
          .reduce((acc, a) => acc + a.performanceScore, 0) / 
        audits.filter(a => a.device === 'desktop').length || 0
      )
    };
    
    console.log('📊 Performance Monitoring Summary:');
    console.log(`  • ${summary.auditsCompleted} audits completed`);
    console.log(`  • ${summary.alertsGenerated} alerts generated`);
    console.log(`  • Mobile avg: ${summary.avgMobileScore}/100`);
    console.log(`  • Desktop avg: ${summary.avgDesktopScore}/100`);
    
    return summary;
    
  } catch (error) {
    console.error('❌ Performance monitoring failed:', error);
    throw error;
  }
}

// Export for API endpoint usage
export { runScheduledPerformanceMonitoring, PerformanceAlertManager };

// CLI execution if running directly
if (require.main === module) {
  runScheduledPerformanceMonitoring()
    .then((summary) => {
      console.log('✅ Performance monitoring completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Performance monitoring failed:', error);
      process.exit(1);
    });
}