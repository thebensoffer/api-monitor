export interface CoreWebVitals {
  lcp: number; // Largest Contentful Paint (ms)
  fid: number; // First Input Delay (ms) 
  cls: number; // Cumulative Layout Shift (score)
  fcp: number; // First Contentful Paint (ms)
  ttfb: number; // Time to First Byte (ms)
  si: number; // Speed Index (score)
}

export interface PerformanceAudit {
  id: string;
  url: string;
  device: 'mobile' | 'desktop';
  timestamp: string;
  strategy: 'mobile' | 'desktop';
  
  // Core Web Vitals
  coreWebVitals: CoreWebVitals;
  
  // PageSpeed Insights scores
  performanceScore: number; // 0-100
  accessibilityScore: number; // 0-100
  bestPracticesScore: number; // 0-100
  seoScore: number; // 0-100
  
  // Lab vs Field data
  labData: CoreWebVitals;
  fieldData?: CoreWebVitals; // From Chrome UX Report (real users)
  
  // Additional metrics
  diagnostics: {
    totalBlockingTime: number;
    cumulativeLayoutShift: number;
    serverResponseTime: number;
  };
  
  // Opportunities (performance improvements)
  opportunities: Array<{
    id: string;
    title: string;
    description: string;
    savings: number; // estimated ms saved
  }>;
}

export interface CruxData {
  url: string;
  timestamp: string;
  
  // 28-day aggregated data from real users
  metrics: {
    lcp: {
      histogram: Array<{ start: number; end?: number; density: number }>;
      percentiles: { p75: number };
    };
    fid: {
      histogram: Array<{ start: number; end?: number; density: number }>;
      percentiles: { p75: number };
    };
    cls: {
      histogram: Array<{ start: number; end?: number; density: number }>;
      percentiles: { p75: number };
    };
  };
  
  // Form factor breakdown  
  phone?: boolean;
  desktop?: boolean;
  tablet?: boolean;
}

export interface PerformanceAlert {
  id: string;
  timestamp: string;
  url: string;
  alertType: 'cwv_degradation' | 'performance_drop' | 'mobile_desktop_gap' | 'field_lab_mismatch';
  severity: 'low' | 'medium' | 'high' | 'critical';
  
  // Alert details
  metric: 'lcp' | 'fid' | 'cls' | 'performance_score';
  currentValue: number;
  previousValue: number;
  threshold: number;
  
  message: string;
  recommendations?: string[];
}