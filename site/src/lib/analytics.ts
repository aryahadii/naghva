import type { CaptureResult, Properties } from 'posthog-js';

/** Remove only the retired replay integration's saved choice and identity. */
export function clearLegacyReplayState() {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[name];
      for (const key of Object.keys(storage)) {
        if (key === 'naghva-replay-consent-v1' || key === 'naghva-replay-consent-v1-probe' ||
          key === 'ph_naghva-replay' || key.startsWith('ph_naghva-replay_')) storage.removeItem(key);
      }
    } catch { /* Storage may be unavailable; cookieless capture needs none. */ }
  }
}

export function privacyRequested(): boolean {
  const browser = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const windowDnt = (window as Window & { doNotTrack?: string }).doNotTrack;
  return browser.globalPrivacyControl === true ||
    [browser.doNotTrack, browser.msDoNotTrack, windowDnt].some((value) => value === '1' || value === 'yes');
}

// Keep all values for the five standard UTM fields. Other query parameters,
// search input, click IDs, URL fragments, and referrer paths stay excluded.
const UTM_PARAMETERS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export const REFERRER_PARAM = 'naghva_referrer';
export const PRODUCTION_ORIGINS = new Set(['https://naghva.com', 'https://naqva.com']);

export function campaignProperties(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const result: Record<string, string> = {};
  for (const key of UTM_PARAMETERS) {
    const value = params.get(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

export function referrerOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return /^(https?:)$/.test(url.protocol) ? url.origin : undefined;
  } catch { return undefined; }
}

/** Carry only sanitized attribution through the root's language redirect. */
export function landingSearch(search: string, referrer: string, origin: string): string {
  const params = new URLSearchParams(campaignProperties(search));
  const source = referrerOrigin(referrer);
  if (source && source !== origin) params.set(REFERRER_PARAM, source);
  return params.size ? `?${params}` : '';
}

export function trafficProperties(href: string, referrer: string): Record<string, string> {
  const current = new URL(href);
  let source = referrerOrigin(referrer);
  // Only accept the root's forwarded referrer after a same-origin root redirect.
  if (source === current.origin && new URL(referrer).pathname === '/') {
    source = referrerOrigin(current.searchParams.get(REFERRER_PARAM) ?? '') ?? source;
  }
  return {
    ...campaignProperties(current.search),
    $referrer: source ?? '$direct',
    $referring_domain: source ? new URL(source).hostname : '$direct',
  };
}

export const EVENTS = ['$pageview', '$pageleave', '$web_vitals', 'artist_viewed', 'listen_clicked', 'search_used', 'language_switched'] as const;
export type AnalyticsEvent = typeof EVENTS[number];

// Keep the SDK's cookieless protocol and coarse device dimensions. Everything
// else must be supplied explicitly below; new SDK properties fail closed.
const SDK_PROPERTIES = new Set([
  'token', 'distinct_id', '$device_id', '$cookieless_mode', '$lib', '$lib_version',
  '$browser', '$browser_version', '$os', '$os_version', '$device_type',
  '$screen_width', '$screen_height', '$viewport_width', '$viewport_height',
]);
// Time on page and scroll depth of the page being left (on $pageleave) or of
// the previous page (on the next $pageview). Numbers only.
const PAGE_METRICS = new Set([
  '$prev_pageview_duration',
  '$prev_pageview_last_scroll', '$prev_pageview_last_scroll_percentage',
  '$prev_pageview_max_scroll', '$prev_pageview_max_scroll_percentage',
  '$prev_pageview_last_content', '$prev_pageview_last_content_percentage',
  '$prev_pageview_max_content', '$prev_pageview_max_content_percentage',
]);
// Metric values only; the *_event objects carry element selectors and URLs.
const WEB_VITALS = /^\$web_vitals_(LCP|CLS|FCP|INP)_value$/;
const PATH = /^\/(?:[a-z0-9-]+\/)*$/;
const ID = /^Q[a-z0-9]{6}$/;
const PLATFORMS = new Set(['youtube', 'spotify', 'soundcloud', 'bandcamp', 'apple', 'telegram']);

/** Last boundary before network transmission, including SDK-added properties. */
export function sanitizeEvent(event: CaptureResult | null, context: Properties): CaptureResult | null {
  if (!event || !EVENTS.includes(event.event as AnalyticsEvent)) return null;
  const properties: Properties = {};
  for (const [key, value] of Object.entries(event.properties)) {
    if (SDK_PROPERTIES.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) properties[key] = value;
  }
  // Cookieless hashing requires the SDK's raw user agent as a protocol input.
  // PostHog removes it after deriving the daily ID; do not retain it otherwise.
  if (event.properties.distinct_id === '$posthog_cookieless' && typeof event.properties.$raw_user_agent === 'string') {
    properties.$raw_user_agent = event.properties.$raw_user_agent;
  }
  Object.assign(properties, context, { $process_person_profile: false, $is_identified: false });
  if (event.event === '$pageview' || event.event === '$pageleave') {
    for (const [key, value] of Object.entries(event.properties)) {
      if (PAGE_METRICS.has(key) && typeof value === 'number' && Number.isFinite(value)) properties[key] = value;
    }
    const previous = event.properties.$prev_pageview_pathname;
    if (typeof previous === 'string' && PATH.test(previous)) properties.$prev_pageview_pathname = previous;
  }
  if (event.event === '$web_vitals') {
    for (const [key, value] of Object.entries(event.properties)) {
      if (WEB_VITALS.test(key) && typeof value === 'number' && Number.isFinite(value)) properties[key] = value;
    }
  }
  if (event.event === 'listen_clicked') {
    if (ID.test(event.properties.release_id ?? '')) properties.release_id = event.properties.release_id;
    if (PLATFORMS.has(event.properties.platform)) properties.platform = event.properties.platform;
  }
  if (event.event === 'search_used' && ['home', 'header', 'results'].includes(event.properties.surface)) properties.surface = event.properties.surface;
  if (event.event === 'language_switched' && ['en', 'fa'].includes(event.properties.to_language)) properties.to_language = event.properties.to_language;
  return { uuid: event.uuid, event: event.event, timestamp: event.timestamp, properties };
}
