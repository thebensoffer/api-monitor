import { NextRequest, NextResponse } from 'next/server';

const SENTRY_TOKEN = process.env.SENTRY_AUTH_TOKEN || '';
const SENTRY_ORG = 'bensoffer';
const PROJECTS = ['discreetketamine', 'drbensoffer', 'beyondthederech'];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project') || 'all';
    const timeRange = searchParams.get('range') || '24h'; // 1h, 24h, 7d, 30d
    
    const results = {
      summary: {
        totalIssues: 0,
        newToday: 0,
        resolved: 0,
        autoFixed: 0,
        critical: 0
      },
      projects: [] as any[],
      recentIssues: [] as any[],
      errorTrends: [] as any[],
      autoFixQueue: [] as any[],
      performanceIssues: [] as any[]
    };

    // Fetch issues for each project
    for (const projectName of PROJECTS) {
      if (project !== 'all' && project !== projectName) continue;
      
      try {
        // Get project issues
        const issuesResponse = await fetch(
          `https://sentry.io/api/0/projects/${SENTRY_ORG}/${projectName}/issues/?limit=50&query=is:unresolved&sort=date`,
          {
            headers: { 'Authorization': `Bearer ${SENTRY_TOKEN}` },
            signal: AbortSignal.timeout(8000)
          }
        );

        if (!issuesResponse.ok) {
          console.log(`Sentry API error for ${projectName}: ${issuesResponse.status}`);
          continue;
        }

        const issues = await issuesResponse.json();
        
        // Get project stats
        const statsResponse = await fetch(
          `https://sentry.io/api/0/projects/${SENTRY_ORG}/${projectName}/stats/?stat=received&since=${getTimestamp(timeRange)}`,
          {
            headers: { 'Authorization': `Bearer ${SENTRY_TOKEN}` },
            signal: AbortSignal.timeout(5000)
          }
        );

        let stats = [];
        if (statsResponse.ok) {
          stats = await statsResponse.json();
        }

        // Process issues
        const projectIssues = issues.map((issue: any) => {
          const isNew = new Date(issue.firstSeen) > new Date(Date.now() - 24 * 60 * 60 * 1000);
          const isCritical = issue.level === 'fatal' || issue.count > 100;
          const canAutoFix = hasReadableStackTrace(issue) && !isSensitiveCode(issue);
          
          results.summary.totalIssues++;
          if (isNew) results.summary.newToday++;
          if (isCritical) results.summary.critical++;
          
          return {
            id: issue.id,
            title: issue.title,
            culprit: issue.culprit,
            level: issue.level,
            count: issue.count,
            userCount: issue.userCount || 0,
            firstSeen: issue.firstSeen,
            lastSeen: issue.lastSeen,
            permalink: issue.permalink,
            project: projectName,
            isNew,
            isCritical,
            canAutoFix,
            shortId: issue.shortId,
            status: issue.status,
            tags: issue.tags?.slice(0, 3) || []
          };
        });

        results.projects.push({
          name: projectName,
          displayName: getProjectDisplayName(projectName),
          issueCount: projectIssues.length,
          newIssues: projectIssues.filter(i => i.isNew).length,
          criticalIssues: projectIssues.filter(i => i.isCritical).length,
          autoFixable: projectIssues.filter(i => i.canAutoFix).length,
          stats: stats.slice(-24), // Last 24 hours
          health: getProjectHealth(projectIssues),
          lastDeployment: getLastDeployment(projectName)
        });

        // Add to recent issues (top 10 most recent)
        results.recentIssues.push(...projectIssues.slice(0, 10));
        
        // Add auto-fixable issues to queue
        results.autoFixQueue.push(...projectIssues.filter(i => i.canAutoFix).slice(0, 5));

      } catch (error) {
        console.error(`Error fetching Sentry data for ${projectName}:`, error);
        
        // Add project with error status
        results.projects.push({
          name: projectName,
          displayName: getProjectDisplayName(projectName),
          issueCount: 0,
          error: 'API Error',
          health: 'unknown'
        });
      }
    }

    // Sort recent issues by date
    results.recentIssues.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    results.recentIssues = results.recentIssues.slice(0, 20);

    // Generate error trends (mock data for now)
    results.errorTrends = generateErrorTrends();
    
    // Performance issues (mock)
    results.performanceIssues = [
      {
        id: 'perf-1',
        title: 'High TTFB on /eligibility',
        project: 'discreetketamine',
        impact: 'high',
        affectedUsers: 156,
        avgDuration: '2.4s',
        trend: 'increasing'
      },
      {
        id: 'perf-2', 
        title: 'Large DOM size on homepage',
        project: 'drbensoffer',
        impact: 'medium',
        affectedUsers: 23,
        avgDuration: '1.8s',
        trend: 'stable'
      }
    ];

    return NextResponse.json({
      success: true,
      data: results,
      lastUpdated: new Date().toISOString(),
      timeRange
    });

  } catch (error) {
    console.error('Enhanced Sentry API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch enhanced Sentry data' },
      { status: 500 }
    );
  }
}

function getTimestamp(range: string): string {
  const now = Date.now();
  switch (range) {
    case '1h': return new Date(now - 60 * 60 * 1000).toISOString();
    case '24h': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    default: return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  }
}

function getProjectDisplayName(project: string): string {
  switch (project) {
    case 'discreetketamine': return 'Discreet Ketamine';
    case 'drbensoffer': return 'Dr Ben Soffer';
    case 'beyondthederech': return 'Beyond The Derech';
    default: return project;
  }
}

function hasReadableStackTrace(issue: any): boolean {
  return issue.culprit && 
         issue.culprit.includes('.tsx') || 
         issue.culprit.includes('.ts') ||
         issue.culprit.includes('.js');
}

function isSensitiveCode(issue: any): boolean {
  const sensitive = ['auth', 'billing', 'stripe', 'prescription', 'patient', 'hipaa', 'phi'];
  const culprit = (issue.culprit || '').toLowerCase();
  const title = (issue.title || '').toLowerCase();
  
  return sensitive.some(word => culprit.includes(word) || title.includes(word));
}

function getProjectHealth(issues: any[]): 'excellent' | 'good' | 'warning' | 'critical' {
  const criticalCount = issues.filter(i => i.isCritical).length;
  const totalCount = issues.length;
  
  if (criticalCount > 3) return 'critical';
  if (totalCount > 10) return 'warning';
  if (totalCount > 3) return 'good';
  return 'excellent';
}

function getLastDeployment(project: string): any {
  // Mock deployment data - would integrate with Amplify API
  const deployments = {
    discreetketamine: { build: '735', status: 'SUCCEED', time: '4 min ago' },
    drbensoffer: { build: '734', status: 'SUCCEED', time: '8 min ago' },
    beyondthederech: { build: '156', status: 'SUCCEED', time: '2 days ago' }
  };
  
  return deployments[project as keyof typeof deployments] || null;
}

function generateErrorTrends(): any[] {
  const hours = [];
  for (let i = 23; i >= 0; i--) {
    const time = new Date(Date.now() - i * 60 * 60 * 1000);
    hours.push({
      hour: time.getHours(),
      timestamp: time.toISOString(),
      errors: Math.floor(Math.random() * 20) + 1,
      newErrors: Math.floor(Math.random() * 5),
      resolvedErrors: Math.floor(Math.random() * 8)
    });
  }
  return hours;
}