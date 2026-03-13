# API Monitor Dashboard

Unified monitoring and command center for medical practice operations (DK + DBS).

## Architecture

- **Frontend:** Next.js 16 with TypeScript + Tailwind CSS
- **Database:** AWS DynamoDB (serverless, real-time)
- **Auth:** Simple API key authentication
- **Hosting:** AWS Amplify
- **Real-time:** Server-Sent Events for live updates

## Features

- 🔄 **Real-time API monitoring** - All DK/DBS API calls tracked
- 📊 **Performance metrics** - Response times, error rates, trends  
- 🚨 **Smart alerting** - Integrates with existing heartbeat system
- 📱 **Mobile-friendly** - Optimized for team access on phones
- 🏥 **Medical practice focused** - HIPAA-compliant logging & monitoring

## Services Monitored

### DK (Discreet Ketamine)
- DrChrono EHR integration
- Stripe payments
- Twilio SMS notifications  
- Resend email delivery

### DBS (Dr Ben Soffer)
- DrChrono EHR integration
- AWS WorkMail
- S3 document storage

### External Services  
- Google Search Console
- Google Analytics 4
- Sentry error monitoring
- AWS Amplify builds

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.local` and update:
- `MONITOR_API_KEY` - Dashboard access key
- AWS credentials for DynamoDB
- External API keys (GSC, Sentry, etc.)

### 3. Create DynamoDB Tables
```bash
npm run setup:tables
```

### 4. Start Development
```bash
npm run dev
```

Dashboard will be available at: http://localhost:3000

## API Key Usage

All API routes and dashboard pages require the API key header:
```bash
curl -H "x-monitor-key: your-api-key" https://api-monitor.discreetketamine.com/api/logs
```

## Deployment

Deploy to AWS Amplify:
1. Connect GitHub repository
2. Set environment variables in Amplify console
3. Deploy with automatic builds on push

## Team Access

The dashboard is optimized for small medical practice teams:
- **Ben:** Full access to all metrics and controls
- **Brooke:** Patient communication monitoring
- **Staff:** Service status and basic metrics

Mobile-responsive design works great on phones for on-the-go monitoring.

## Integration with Heartbeat

This dashboard enhances the existing heartbeat system by providing:
- Richer data for alert decisions
- Visual confirmation of automated checks  
- Historical trend analysis
- Team visibility into operations

The heartbeat system continues to send WhatsApp alerts while the dashboard provides detailed investigation capabilities.

## Development Roadmap

### Week 1: Foundation ✅
- [x] Basic Amplify app structure
- [x] DynamoDB integration  
- [x] API key authentication
- [x] Simple dashboard UI

### Week 2: Core Monitoring
- [ ] DK API instrumentation
- [ ] DBS API integration
- [ ] Real-time activity feed
- [ ] Basic performance metrics

### Week 3: External Services
- [ ] GSC/GA4 integration
- [ ] Sentry monitoring
- [ ] Amplify build tracking
- [ ] Enhanced alerting

### Week 4: Advanced Features  
- [ ] Custom reporting
- [ ] Analytics engine
- [ ] Mobile optimizations
- [ ] Team role management