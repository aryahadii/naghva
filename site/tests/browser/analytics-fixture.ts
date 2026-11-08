import { gunzipSync } from 'node:zlib';
import type { Page, Request } from '@playwright/test';

type Captured = { event: string; timestamp: string; properties: Record<string, unknown> };
export const site = 'https://naghva.com';
export const ingestion = 'https://eu.i.posthog.com';

export function decode(request: Request): Captured[] {
  const bytes = request.postDataBuffer()!;
  let body = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(bytes).toString()
    : bytes.toString();
  if (body.startsWith('data=')) body = Buffer.from(new URLSearchParams(body).get('data')!, 'base64').toString();
  const payload = JSON.parse(body);
  return Array.isArray(payload) ? payload : payload.batch ?? [payload];
}

/** Serve the real built site under its production origin, intercepting ALL network access. */
export async function observe(page: Page, enabled = true, replayEnabled = true, canonicalOrigin = site) {
  const events: Captured[] = [];
  const analyticsRequests: string[] = [];
  // Exercise visitor capture without disabling the SDK's production bot filter.
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === ingestion) {
      analyticsRequests.push(url.pathname);
      if (request.method() === 'POST' && ['/e/', '/s/'].includes(url.pathname)) events.push(...decode(request));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
    } else if (url.origin === 'https://eu-assets.i.posthog.com') {
      analyticsRequests.push(url.pathname);
      await route.fulfill({ json: { hasFeatureFlags: false, sessionRecording: replayEnabled ? {
        endpoint: '/s/', recorderVersion: 'v2', scriptConfig: { script: 'posthog-recorder' },
        // Hostile server defaults must not weaken the local privacy settings.
        consoleLogRecordingEnabled: true, recordCanvas: true,
        networkPayloadCapture: { recordHeaders: true, recordBody: true, capturePerformance: true },
        masking: { maskAllInputs: false, maskTextSelector: null },
      } : false, capturePerformance: { network_timing: true, web_vitals: true } } });
    } else if ([site, 'https://naqva.com', 'https://preview.example'].includes(url.origin)) {
      const response = await route.fetch({ url: `http://127.0.0.1:4322${url.pathname}${url.search}` }).catch((error) => {
        // A late static asset can still be in flight when Playwright ends a
        // completed test. Ignore only that cancellation; routing stays active
        // throughout teardown, so no analytics can escape to the real service.
        if (error instanceof Error && error.message.startsWith('route.fetch: Test ended.')) return undefined;
        throw error;
      });
      if (!response) return;
      if (response.headers()['content-type']?.includes('text/html')) {
        // Astro renders empty string attributes without quotes when CI has no
        // repository variables. Replace both forms with isolated test config.
        // Model production even when the real build uses a branch-preview
        // canonical; a separate scenario checks the canonical-origin guard.
        const body = (await response.text())
          .replace(/(<link rel="canonical" href=")https?:\/\/[^/"\s]+/, `$1${canonicalOrigin}`)
          .replace(/<meta name="naghva-analytics"[^>]*>/, (meta) => meta
          .replace(/\s(?:content|data-host)(?:="[^"]*")?(?=\s|>)/g, '')
          .replace(/>$/, ` content="${enabled ? 'phc_naghva_browser_test' : ''}" data-host="${ingestion}">`));
        await route.fulfill({ response, body });
      } else await route.fulfill({ response });
    } else if (url.hostname === '127.0.0.1') await route.continue();
    else await route.abort();
  });
  return { events, analyticsRequests };
}
