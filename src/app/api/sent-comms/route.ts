import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface SentEmail {
  site: string;
  type: 'email';
  id: string;
  recipient: string;
  recipientName?: string | null;
  subject: string;
  body: string | null;
  htmlBody?: string | null;
  templateKey?: string | null;
  status: string;
  resendId?: string | null;
  errorMessage?: string | null;
  sentByUser?: { name?: string; email?: string } | null;
  createdAt: string;
  isAutomatic?: boolean;
}

interface SentSms {
  site: string;
  type: 'sms';
  id: string;
  recipient: string;
  body: string;
  twilioSid?: string | null;
  twilioStatus?: string | null;
  sentBy?: string | null;
  channel?: string;
  createdAt: string;
}

const SITES = [
  {
    key: 'tovani',
    label: 'Tovani Health',
    base: process.env.TOVANI_BASE_URL || 'https://tovanihealth.com',
    apiKey: process.env.TOVANI_KHAI_API_KEY || '',
  },
  {
    key: 'dk',
    label: 'Discreet Ketamine',
    base: 'https://discreetketamine.com',
    apiKey: process.env.DK_API_KEY || '',
  },
  {
    key: 'dbs',
    label: 'Dr Ben Soffer',
    base: 'https://drbensoffer.com',
    apiKey: process.env.DBS_API_KEY || '',
  },
];

async function fetchSite(site: typeof SITES[0], since: string, limit: number) {
  if (!site.apiKey) {
    return { site: site.key, label: site.label, error: `No API key (set ${site.key.toUpperCase()}_API_KEY)`, emails: [], sms: [] };
  }
  try {
    const url = `${site.base}/api/khai/sent-communications?type=all&since=${encodeURIComponent(since)}&limit=${limit}`;
    const r = await fetch(url, {
      headers: { 'x-khai-api-key': site.apiKey },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!r.ok) {
      return { site: site.key, label: site.label, error: `HTTP ${r.status}`, emails: [], sms: [] };
    }
    const j = await r.json();
    const emails: SentEmail[] = (j.sent?.emails ?? []).map((e: any) => ({
      site: site.key,
      type: 'email' as const,
      id: e.id,
      recipient: e.recipientEmail,
      recipientName: e.recipientName,
      subject: e.subject,
      body: e.textBody ?? null,
      htmlBody: e.htmlBody,
      templateKey: e.templateKey,
      status: e.status,
      resendId: e.resendId,
      errorMessage: e.errorMessage,
      sentByUser: e.User || null,
      createdAt: e.createdAt,
      isAutomatic: e.isAutomatic,
    }));
    const sms: SentSms[] = (j.sent?.sms ?? []).map((s: any) => ({
      site: site.key,
      type: 'sms' as const,
      id: s.id,
      recipient: s.phoneNumber,
      body: s.body,
      twilioSid: s.twilioSid,
      twilioStatus: s.twilioStatus,
      sentBy: s.sentBy ?? s.User?.email ?? null,
      channel: s.channel,
      createdAt: s.createdAt,
    }));
    return { site: site.key, label: site.label, error: null, emails, sms };
  } catch (err) {
    return {
      site: site.key,
      label: site.label,
      error: err instanceof Error ? err.message : 'fetch failed',
      emails: [],
      sms: [],
    };
  }
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-monitor-key');
  if (!apiKey || apiKey !== process.env.MONITOR_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const hours = Math.max(1, parseInt(searchParams.get('hours') || '24', 10));
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const results = await Promise.all(SITES.map((s) => fetchSite(s, since, limit)));

  const allEmails = results.flatMap((r) => r.emails);
  const allSms = results.flatMap((r) => r.sms);
  // Sort merged + descending
  const items = [...allEmails, ...allSms].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    since,
    summary: {
      totalEmails: allEmails.length,
      totalSms: allSms.length,
      bySite: results.map((r) => ({
        site: r.site,
        label: r.label,
        emails: r.emails.length,
        sms: r.sms.length,
        error: r.error,
      })),
    },
    items,
  });
}
