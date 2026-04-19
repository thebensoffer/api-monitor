#!/usr/bin/env node
/**
 * Khai-side synthetic runner. Runs scripted patient flows via Khai's
 * action API and POSTs results to OpenHeart.
 *
 * Run from your Mac (where Khai is installed):
 *   OPENHEART_URL=https://main.dl7zrj8lm47be.amplifyapp.com \
 *   OPENHEART_BASIC_AUTH=$(echo -n 'ben:PASSWORD' | base64) \
 *   MONITOR_API_KEY=kai-monitor-2026-super-secret-key \
 *   node ~/api-monitor/scripts/khai-synthetic-runner.js
 *
 * Set up as a launchd plist or run via Khai's existing node-cron scheduler
 * to fire hourly.
 */

const KHAI_URL = process.env.KHAI_URL || 'http://localhost:3001';
const OPENHEART_URL = process.env.OPENHEART_URL || 'https://main.dl7zrj8lm47be.amplifyapp.com';
const OPENHEART_BASIC_AUTH = process.env.OPENHEART_BASIC_AUTH || '';
const MONITOR_API_KEY = process.env.MONITOR_API_KEY || '';

if (!MONITOR_API_KEY) {
  console.error('MONITOR_API_KEY env required');
  process.exit(1);
}

// Each scenario: a sequence of Khai actions that exercise a real user flow.
// Action shape per Khai's /api/actions/execute API.
const SCENARIOS = [
  {
    id: 'dk-public-pages-render',
    description: 'DK homepage + assessment + pricing pages render with expected content',
    actions: [
      { type: 'navigate', url: 'https://discreetketamine.com/' },
      { type: 'screenshot', filename: 'dk-home' },
      { type: 'wait_for_text', text: 'ketamine', timeout: 5000 },
      { type: 'navigate', url: 'https://discreetketamine.com/eligibility' },
      { type: 'wait_for_selector', selector: 'form, [data-testid="eligibility-form"]', timeout: 5000 },
    ],
  },
  {
    id: 'dbs-public-pages-render',
    description: 'DBS homepage + concierge pages render with expected content',
    actions: [
      { type: 'navigate', url: 'https://drbensoffer.com/' },
      { type: 'screenshot', filename: 'dbs-home' },
      { type: 'wait_for_text', text: 'concierge', timeout: 5000 },
    ],
  },
  {
    id: 'tovani-public-pages-render',
    description: 'Tovani homepage renders',
    actions: [
      { type: 'navigate', url: 'https://tovanihealth.com/' },
      { type: 'screenshot', filename: 'tovani-home' },
    ],
  },
  // Add more scenarios as you set up sentinel test patients in each app:
  // {
  //   id: 'dk-test-patient-login',
  //   description: 'Sentinel test patient can log in to DK',
  //   actions: [
  //     { type: 'navigate', url: 'https://discreetketamine.com/login' },
  //     { type: 'fill', selector: '[name="email"]', value: 'sentinel+dk@drbensoffer.com' },
  //     { type: 'click', selector: 'button[type="submit"]' },
  //     { type: 'wait_for_navigation', timeout: 10000 },
  //     { type: 'wait_for_selector', selector: '[data-testid="dashboard"]', timeout: 10000 },
  //   ],
  // },
];

async function runScenario(scenario) {
  const t0 = Date.now();
  try {
    // Kick off the Khai actions sequence
    const resp = await fetch(`${KHAI_URL}/api/actions/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: scenario.actions, headless: true }),
    });
    if (!resp.ok) throw new Error(`Khai start failed: ${resp.status}`);
    const { sessionId } = await resp.json();
    if (!sessionId) throw new Error('Khai returned no sessionId');

    // Poll until complete (max 90s)
    let result;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch(`${KHAI_URL}/api/actions/status/${sessionId}`).then((r) => r.json()).catch(() => null);
      if (s?.status === 'complete' || s?.status === 'failed') {
        const full = await fetch(`${KHAI_URL}/api/actions/results/${sessionId}`).then((r) => r.json()).catch(() => null);
        result = { ...s, ...full };
        break;
      }
    }

    if (!result) throw new Error('Khai timeout (90s)');
    const ok = result.status === 'complete' && !(result.results || []).some((a) => a.error);
    const failedSteps = (result.results || []).filter((a) => a.error);
    return {
      scenario: scenario.id,
      ok,
      durationMs: Date.now() - t0,
      message: ok
        ? `All ${(result.results || []).length} actions passed`
        : `Failed at step ${failedSteps[0]?.action?.type || '?'}: ${failedSteps[0]?.error || 'unknown'}`,
      steps: (result.results || []).map((a) => ({
        name: `${a.action?.type || 'step'}${a.action?.url ? ' ' + a.action.url : ''}`,
        ok: !a.error,
        durationMs: a.duration,
        error: a.error,
      })),
      source: 'khai',
      metadata: { sessionId, description: scenario.description },
    };
  } catch (err) {
    return {
      scenario: scenario.id,
      ok: false,
      durationMs: Date.now() - t0,
      message: err.message,
      source: 'khai',
      metadata: { description: scenario.description },
    };
  }
}

async function reportToOpenHeart(report) {
  const headers = {
    'x-monitor-key': MONITOR_API_KEY,
    'Content-Type': 'application/json',
  };
  if (OPENHEART_BASIC_AUTH) headers['Authorization'] = `Basic ${OPENHEART_BASIC_AUTH}`;
  const r = await fetch(`${OPENHEART_URL}/api/synthetic/report`, {
    method: 'POST',
    headers,
    body: JSON.stringify(report),
  });
  if (!r.ok) {
    console.error(`OpenHeart report failed for ${report.scenario}: HTTP ${r.status}`);
  }
  return r.ok;
}

async function main() {
  console.log(`[khai-synthetic] starting ${SCENARIOS.length} scenarios`);
  for (const s of SCENARIOS) {
    const report = await runScenario(s);
    const sent = await reportToOpenHeart(report);
    console.log(`  ${report.ok ? '✓' : '✗'} ${s.id}: ${report.message} (${report.durationMs}ms) reported=${sent}`);
  }
  console.log('[khai-synthetic] done');
}

main().catch((e) => {
  console.error('[khai-synthetic] crashed:', e);
  process.exit(1);
});
