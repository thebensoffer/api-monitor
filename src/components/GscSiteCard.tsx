'use client';

interface GscSite {
  totalClicks?: number;
  totalImpressions?: number;
  averageCtr?: string;
  averagePosition?: string | number;
  topQueries?: { query: string; clicks: number; ctr: string; position: number }[];
  topPages?: { page: string; clicks: number; ctr: string }[];
  indexing_status?: { valid_pages?: number | string; coverage_issues?: number };
}

const accents: Record<string, { title: string; clicks: string; coverage: string; emoji: string }> = {
  dk: { title: 'text-blue-800', clicks: 'bg-blue-50 text-blue-600', coverage: 'bg-blue-50 text-blue-700', emoji: '🚀' },
  dbs: { title: 'text-emerald-800', clicks: 'bg-emerald-50 text-emerald-600', coverage: 'bg-emerald-50 text-emerald-700', emoji: '🏥' },
  tovani: { title: 'text-indigo-800', clicks: 'bg-indigo-50 text-indigo-600', coverage: 'bg-indigo-50 text-indigo-700', emoji: '🩺' },
};

export function GscSiteCard({
  siteKey,
  label,
  data,
}: {
  siteKey: 'dk' | 'dbs' | 'tovani';
  label: string;
  data: GscSite | undefined;
}) {
  const a = accents[siteKey];

  return (
    <div>
      <h4 className={`font-medium mb-4 flex items-center ${a.title}`}>
        <span className="mr-1">{a.emoji}</span>
        {label} Search Performance
        <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">✅ Indexed</span>
      </h4>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className={`${a.clicks} p-3 rounded-lg text-center`}>
          <div className="text-xl font-bold">{data?.totalClicks?.toLocaleString() || '0'}</div>
          <div className="text-xs">Total Clicks</div>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg text-center">
          <div className="text-xl font-bold text-gray-600">{data?.totalImpressions?.toLocaleString() || '0'}</div>
          <div className="text-xs text-gray-700">Impressions</div>
        </div>
        <div className="bg-green-50 p-3 rounded-lg text-center">
          <div className="text-lg font-bold text-green-600">{data?.averageCtr || '0%'}</div>
          <div className="text-xs text-green-700">Avg CTR</div>
        </div>
        <div className="bg-purple-50 p-3 rounded-lg text-center">
          <div className="text-lg font-bold text-purple-600">{data?.averagePosition || '0'}</div>
          <div className="text-xs text-purple-700">Avg Position</div>
        </div>
      </div>

      {data?.topQueries && data.topQueries.length > 0 && (
        <div className="mb-4">
          <h5 className="text-sm font-medium text-gray-900 mb-2">🔍 Top Search Queries</h5>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {data.topQueries.slice(0, 5).map((query, i) => (
              <div key={i} className="flex justify-between items-center text-xs p-2 bg-gray-50 rounded">
                <span className="font-medium truncate flex-1 mr-2">{query.query}</span>
                <div className="flex space-x-2 text-gray-600">
                  <span>{query.clicks}c</span>
                  <span>{query.ctr}</span>
                  <span>#{query.position}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data?.topPages && data.topPages.length > 0 && (
        <div>
          <h5 className="text-sm font-medium text-gray-900 mb-2">📄 Top Landing Pages</h5>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {data.topPages.slice(0, 4).map((page, i) => (
              <div key={i} className="flex justify-between items-center text-xs p-2 bg-gray-50 rounded">
                <span className="font-medium truncate flex-1 mr-2">{page.page}</span>
                <div className="flex space-x-2 text-gray-600">
                  <span>{page.clicks}c</span>
                  <span>{page.ctr}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!data && (
        <div className="text-sm text-gray-500 italic">No GSC data — verify property is added to Search Console.</div>
      )}
    </div>
  );
}
