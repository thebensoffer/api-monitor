'use client';

interface LinkDef {
  label: string;
  href: string;
  // Inline SVG / text logo so we don't depend on remote images
  logo: React.ReactNode;
  tagline: string;
  accent: string; // tailwind border accent
}

const LINKS: LinkDef[] = [
  {
    label: 'Discreet Ketamine',
    href: 'https://discreetketamine.com',
    tagline: 'Patient platform',
    accent: 'border-emerald-500',
    logo: (
      <div className="text-emerald-700 font-extrabold text-2xl tracking-tight leading-none">
        DK
      </div>
    ),
  },
  {
    label: 'Tovani Health',
    href: 'https://tovanihealth.com',
    tagline: 'B2B clinical',
    accent: 'border-indigo-500',
    logo: (
      <div className="text-indigo-700 font-extrabold text-2xl tracking-tight leading-none">
        TH
      </div>
    ),
  },
  {
    label: 'Dr Ben Soffer',
    href: 'https://drbensoffer.com',
    tagline: 'Concierge',
    accent: 'border-amber-500',
    logo: (
      <div className="text-amber-700 font-extrabold text-2xl tracking-tight leading-none">
        DBS
      </div>
    ),
  },
  {
    label: 'Infrastructure',
    href: 'https://main.dps2xg5sooc9j.amplifyapp.com/',
    tagline: 'AWS dashboard',
    accent: 'border-slate-500',
    logo: (
      <div className="text-slate-700 font-extrabold text-2xl tracking-tight leading-none">
        ☁
      </div>
    ),
  },
];

export function QuickLinks() {
  return (
    <div className="bg-white shadow rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Jump to</h3>
        <span className="text-xs text-gray-400">Opens in new tab</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`group flex items-center gap-3 p-3 rounded-lg border-l-4 ${l.accent} bg-gray-50 hover:bg-white hover:shadow-md transition-all`}
          >
            <div className="w-12 h-12 rounded-md bg-white shadow-sm flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              {l.logo}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{l.label}</div>
              <div className="text-xs text-gray-500 truncate">{l.tagline}</div>
              <div className="text-[10px] text-blue-600 font-mono truncate group-hover:underline">
                {l.href.replace(/^https?:\/\//, '')} ↗
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
