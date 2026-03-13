export interface APILog {
  id: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  service: 'dk' | 'dbs' | 'gsc' | 'ga4' | 'sentry' | 'amplify' | 'stripe' | 'twilio' | 'resend' | 'drchrono' | 'workmail' | 's3';
  endpoint: string;
  method: string;
  statusCode?: number;
  responseTime?: number;
  requestBody?: any;
  responseBody?: any;
  errorMessage?: string;
  userId?: string;
  patientId?: string;
  metadata?: Record<string, any>;
}

export interface APIMetrics {
  id: string;
  service: string;
  endpoint: string;
  date: string; // YYYY-MM-DD
  hour: string; // HH
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
}

export interface Alert {
  id: string;
  timestamp: string;
  type: 'error_spike' | 'latency_high' | 'service_down' | 'quota_exceeded';
  service: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  resolved?: boolean;
  resolvedAt?: string;
  metadata?: Record<string, any>;
}

export const SERVICES = {
  dk: 'Discreet Ketamine',
  dbs: 'Dr Ben Soffer',
  gsc: 'Google Search Console',
  ga4: 'Google Analytics',
  sentry: 'Sentry Monitoring', 
  amplify: 'AWS Amplify',
  stripe: 'Stripe Payments',
  twilio: 'Twilio SMS',
  resend: 'Resend Email',
  drchrono: 'DrChrono EHR',
  workmail: 'AWS WorkMail',
  s3: 'AWS S3 Storage',
} as const;