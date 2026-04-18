import { NextRequest, NextResponse } from 'next/server';

// Monitor AWS Amplify builds and deployment status
export async function GET(request: NextRequest) {
  try {
    const builds = [];
    
    // Mock Amplify data - would integrate with AWS CLI/SDK
    const amplifyApps = [
      {
        appId: 'd2p2hplg2fv5vp',
        name: 'discreet-ketamine',
        domain: 'discreetketamine.com',
        branch: 'main'
      },
      {
        appId: 'd6fr3413tgbkk',
        name: 'drbensoffer',
        domain: 'drbensoffer.com', 
        branch: 'main'
      },
      {
        appId: 'diywcibg8pdz8',
        name: 'beyondthederech',
        domain: 'beyondthederech.com',
        branch: 'main'
      }
    ];

    for (const app of amplifyApps) {
      try {
        // In production, this would call AWS Amplify API
        // aws amplify list-jobs --app-id ${app.appId} --branch-name ${app.branch} --max-results 10
        
        const mockBuilds = generateMockBuilds(app);
        builds.push({
          app: app.name,
          appId: app.appId,
          domain: app.domain,
          branch: app.branch,
          builds: mockBuilds,
          latestBuild: mockBuilds[0],
          status: mockBuilds[0].status,
          healthScore: calculateHealthScore(mockBuilds),
          deploymentFrequency: calculateDeploymentFrequency(mockBuilds),
          avgBuildTime: calculateAvgBuildTime(mockBuilds),
          successRate: calculateSuccessRate(mockBuilds)
        });
        
      } catch (error) {
        console.error(`Error fetching builds for ${app.name}:`, error);
        builds.push({
          app: app.name,
          appId: app.appId,
          domain: app.domain,
          error: 'Failed to fetch builds',
          status: 'unknown'
        });
      }
    }

    // Overall deployment metrics
    const allBuilds = builds.flatMap(b => b.builds || []);
    const summary = {
      totalApps: builds.length,
      activeBuilds: builds.filter(b => b.status === 'RUNNING').length,
      failedBuilds: builds.filter(b => b.status === 'FAILED').length,
      successfulBuilds: builds.filter(b => b.status === 'SUCCEED').length,
      avgBuildTime: allBuilds.reduce((acc, b) => acc + (b.duration || 0), 0) / allBuilds.length,
      deploymentsToday: allBuilds.filter(b => 
        new Date(b.startTime).toDateString() === new Date().toDateString()
      ).length,
      lastFailure: allBuilds
        .filter(b => b.status === 'FAILED')
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0]
    };

    return NextResponse.json({
      success: true,
      data: {
        summary,
        builds,
        timeline: generateBuildTimeline(allBuilds)
      },
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Builds API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch build data' },
      { status: 500 }
    );
  }
}

function generateMockBuilds(app: any) {
  const builds = [];
  const statuses = ['SUCCEED', 'SUCCEED', 'SUCCEED', 'FAILED', 'SUCCEED', 'RUNNING'];
  
  for (let i = 0; i < 10; i++) {
    const startTime = new Date(Date.now() - i * 2 * 60 * 60 * 1000); // Every 2 hours
    const duration = Math.floor(Math.random() * 300) + 60; // 1-6 minutes
    const status = i === 0 && app.name === 'discreet-ketamine' ? 'SUCCEED' : 
                   statuses[Math.floor(Math.random() * statuses.length)];
    
    builds.push({
      buildId: `${735 - i}`,
      status,
      startTime: startTime.toISOString(),
      endTime: status === 'RUNNING' ? null : new Date(startTime.getTime() + duration * 1000).toISOString(),
      duration: status === 'RUNNING' ? null : duration,
      commitId: `${Math.random().toString(36).substr(2, 7)}`,
      commitMessage: getMockCommitMessage(),
      sourceVersion: `refs/heads/main`,
      artifacts: status === 'SUCCEED' ? generateArtifacts() : null,
      logs: status === 'FAILED' ? 'Build failed during npm install' : null
    });
  }
  
  return builds;
}

function getMockCommitMessage(): string {
  const messages = [
    '🔄 Revert admin Stripe to live keys — remove test key integration',
    '✅ Fix patient active status display in admin panel',
    '🚀 Add email automation system with trigger integration',
    '🐛 Fix PaymentIntent conflict in admin purchase flow',
    '📱 Optimize KetAI session companion for mobile',
    '🔧 Update DBS communications endpoint URL',
    '🎨 Improve homepage CRO with exit intent popup',
    '⚡ Add sticky CTA component for better conversion'
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

function generateArtifacts(): any {
  return {
    baseArtifact: {
      artifactFileName: 'BaseArtifact.zip',
      artifactId: Math.random().toString(36).substr(2, 9)
    },
    artifacts: [
      {
        artifactFileName: 'manifest.json',
        artifactId: Math.random().toString(36).substr(2, 9)
      }
    ]
  };
}

function calculateHealthScore(builds: any[]): number {
  const recentBuilds = builds.slice(0, 5);
  const successCount = recentBuilds.filter(b => b.status === 'SUCCEED').length;
  return Math.round((successCount / recentBuilds.length) * 100);
}

function calculateDeploymentFrequency(builds: any[]): string {
  // Calculate deployments per day over last 7 days
  const week = builds.filter(b => 
    new Date(b.startTime) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );
  const deploymentsPerDay = week.length / 7;
  
  if (deploymentsPerDay > 2) return 'High';
  if (deploymentsPerDay > 0.5) return 'Medium';
  return 'Low';
}

function calculateAvgBuildTime(builds: any[]): string {
  const completedBuilds = builds.filter(b => b.duration);
  if (completedBuilds.length === 0) return '0s';
  
  const avgSeconds = completedBuilds.reduce((acc, b) => acc + b.duration, 0) / completedBuilds.length;
  const minutes = Math.floor(avgSeconds / 60);
  const seconds = Math.round(avgSeconds % 60);
  
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function calculateSuccessRate(builds: any[]): string {
  const completedBuilds = builds.filter(b => b.status !== 'RUNNING');
  if (completedBuilds.length === 0) return '0%';
  
  const successCount = completedBuilds.filter(b => b.status === 'SUCCEED').length;
  return `${Math.round((successCount / completedBuilds.length) * 100)}%`;
}

function generateBuildTimeline(builds: any[]) {
  // Group builds by day for timeline view
  const timeline = [];
  const sortedBuilds = builds.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  
  const days = new Set();
  sortedBuilds.forEach(build => {
    const day = new Date(build.startTime).toDateString();
    if (!days.has(day) && timeline.length < 7) {
      days.add(day);
      const dayBuilds = sortedBuilds.filter(b => new Date(b.startTime).toDateString() === day);
      
      timeline.push({
        date: day,
        builds: dayBuilds.length,
        successful: dayBuilds.filter(b => b.status === 'SUCCEED').length,
        failed: dayBuilds.filter(b => b.status === 'FAILED').length,
        running: dayBuilds.filter(b => b.status === 'RUNNING').length,
        commits: dayBuilds.length
      });
    }
  });
  
  return timeline;
}