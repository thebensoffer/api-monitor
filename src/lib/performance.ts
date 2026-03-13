import { PerformanceAudit, CruxData, CoreWebVitals } from '@/types/performance';

const PSI_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CRUX_API_BASE = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

// Google API key will be needed for higher quotas (5 QPM vs 25 QPM)
const API_KEY = process.env.GOOGLE_API_KEY || '';

export class PageSpeedInsightsClient {
  async auditUrl(url: string, strategy: 'mobile' | 'desktop'): Promise<PerformanceAudit> {
    const params = new URLSearchParams({
      url,
      strategy,
      category: 'performance,accessibility,best-practices,seo',
      ...(API_KEY && { key: API_KEY })
    });

    const response = await fetch(`${PSI_API_BASE}?${params}`);
    
    if (!response.ok) {
      throw new Error(`PageSpeed Insights API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this.parsePageSpeedData(data, url, strategy);
  }

  private parsePageSpeedData(data: any, url: string, strategy: 'mobile' | 'desktop'): PerformanceAudit {
    const lighthouse = data.lighthouseResult;
    const loadingExperience = data.loadingExperience;
    
    // Extract Core Web Vitals from lab data (Lighthouse)
    const labMetrics = lighthouse.audits;
    const labData: CoreWebVitals = {
      lcp: labMetrics['largest-contentful-paint']?.numericValue || 0,
      fid: labMetrics['max-potential-fid']?.numericValue || 0, // Estimated FID
      cls: labMetrics['cumulative-layout-shift']?.numericValue || 0,
      fcp: labMetrics['first-contentful-paint']?.numericValue || 0,
      ttfb: labMetrics['server-response-time']?.numericValue || 0,
      si: labMetrics['speed-index']?.numericValue || 0,
    };

    // Extract field data if available (real users)
    let fieldData: CoreWebVitals | undefined;
    if (loadingExperience?.metrics) {
      const metrics = loadingExperience.metrics;
      fieldData = {
        lcp: metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile || 0,
        fid: metrics.FIRST_INPUT_DELAY_MS?.percentile || 0,
        cls: metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile || 0,
        fcp: metrics.FIRST_CONTENTFUL_PAINT_MS?.percentile || 0,
        ttfb: 0, // Not available in loading experience
        si: 0, // Not available in loading experience
      };
    }

    // Extract performance opportunities
    const opportunities = Object.values(labMetrics)
      .filter((audit: any) => audit.details?.type === 'opportunity')
      .map((audit: any) => ({
        id: audit.id,
        title: audit.title,
        description: audit.description,
        savings: audit.numericValue || 0
      }));

    return {
      id: `${url}-${strategy}-${Date.now()}`,
      url,
      device: strategy,
      timestamp: new Date().toISOString(),
      strategy,
      
      coreWebVitals: labData,
      labData,
      fieldData,
      
      performanceScore: Math.round((lighthouse.categories.performance?.score || 0) * 100),
      accessibilityScore: Math.round((lighthouse.categories.accessibility?.score || 0) * 100),
      bestPracticesScore: Math.round((lighthouse.categories['best-practices']?.score || 0) * 100),
      seoScore: Math.round((lighthouse.categories.seo?.score || 0) * 100),
      
      diagnostics: {
        totalBlockingTime: labMetrics['total-blocking-time']?.numericValue || 0,
        cumulativeLayoutShift: labData.cls,
        serverResponseTime: labData.ttfb,
      },
      
      opportunities: opportunities.slice(0, 10) // Top 10 opportunities
    };
  }
}

export class ChromeUXReportClient {
  async getFieldData(url: string, formFactor?: 'PHONE' | 'DESKTOP' | 'TABLET'): Promise<CruxData> {
    const payload = {
      url,
      ...(formFactor && { formFactor })
    };

    const response = await fetch(CRUX_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY && { 'X-Goog-Api-Key': API_KEY })
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Chrome UX Report API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this.parseCruxData(data, url);
  }

  private parseCruxData(data: any, url: string): CruxData {
    const record = data.record;
    const metrics = record?.metrics || {};
    
    return {
      url,
      timestamp: new Date().toISOString(),
      
      metrics: {
        lcp: {
          histogram: metrics.largest_contentful_paint?.histogram || [],
          percentiles: {
            p75: metrics.largest_contentful_paint?.percentiles?.p75 || 0
          }
        },
        fid: {
          histogram: metrics.first_input_delay?.histogram || [],
          percentiles: {
            p75: metrics.first_input_delay?.percentiles?.p75 || 0
          }
        },
        cls: {
          histogram: metrics.cumulative_layout_shift?.histogram || [],
          percentiles: {
            p75: metrics.cumulative_layout_shift?.percentiles?.p75 || 0
          }
        }
      },
      
      phone: record?.key?.formFactor === 'PHONE',
      desktop: record?.key?.formFactor === 'DESKTOP', 
      tablet: record?.key?.formFactor === 'TABLET',
    };
  }
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private psi = new PageSpeedInsightsClient();
  private crux = new ChromeUXReportClient();
  
  private readonly MONITORING_URLS = [
    'https://discreetketamine.com',
    'https://discreetketamine.com/at-home-ketamine-therapy', 
    'https://discreetketamine.com/ketamine-cost',
    'https://drbensoffer.com',
    'https://drbensoffer.com/concierge-medicine-tax-deduction'
  ];

  async runFullAudit(): Promise<PerformanceAudit[]> {
    const audits: PerformanceAudit[] = [];
    
    for (const url of this.MONITORING_URLS) {
      try {
        // Run both mobile and desktop audits
        const [mobileAudit, desktopAudit] = await Promise.allSettled([
          this.psi.auditUrl(url, 'mobile'),
          this.psi.auditUrl(url, 'desktop')
        ]);

        if (mobileAudit.status === 'fulfilled') audits.push(mobileAudit.value);
        if (desktopAudit.status === 'fulfilled') audits.push(desktopAudit.value);
        
        // Rate limiting: wait 2 seconds between URLs
        if (url !== this.MONITORING_URLS[this.MONITORING_URLS.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`Failed to audit ${url}:`, error);
      }
    }
    
    return audits;
  }

  async getCruxDataForUrls(): Promise<CruxData[]> {
    const cruxData: CruxData[] = [];
    
    for (const url of this.MONITORING_URLS) {
      try {
        // Get data for mobile and desktop
        const [phoneData, desktopData] = await Promise.allSettled([
          this.crux.getFieldData(url, 'PHONE'),
          this.crux.getFieldData(url, 'DESKTOP')
        ]);

        if (phoneData.status === 'fulfilled') cruxData.push(phoneData.value);
        if (desktopData.status === 'fulfilled') cruxData.push(desktopData.value);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to get CrUX data for ${url}:`, error);
      }
    }
    
    return cruxData;
  }
}