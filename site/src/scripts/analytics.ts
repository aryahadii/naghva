import type { PostHog, Properties } from 'posthog-js';
import { clearLegacyReplayState, privacyRequested, PRODUCTION_ORIGINS, REFERRER_PARAM, sanitizeEvent, trafficProperties, type AnalyticsEvent } from '../lib/analytics';

let client: Promise<PostHog | undefined> | undefined;
const searched = new Set<string>();

function getClient(): Promise<PostHog | undefined> {
  return client ??= start().catch(() => undefined);
}

async function start(): Promise<PostHog | undefined> {
  const config = document.querySelector<HTMLMetaElement>('meta[name="naghva-analytics"]');
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const landing = location.href;
  // Remove the redirect hint even when tracking is disabled or opted out.
  const current = new URL(landing);
  if (current.searchParams.has(REFERRER_PARAM)) {
    current.searchParams.delete(REFERRER_PARAM);
    history.replaceState(history.state, '', current);
  }
  if (!config?.content || !config.dataset.host || !canonical || privacyRequested()) return;
  // Configuration alone cannot enable tracking on a local server or a preview.
  const address = new URL(canonical.href);
  if (!PRODUCTION_ORIGINS.has(location.origin) || !PRODUCTION_ORIGINS.has(address.origin)) return;
  // An https URL posts to PostHog directly; a path such as /relay posts to
  // this site's own relay (worker/relay.ts), which forwards to PostHog EU.
  const host = new URL(config.dataset.host, location.origin);
  if (host.protocol !== 'https:') return;
  const apiHost = host.origin + host.pathname.replace(/\/+$/, '');

  const context: Properties = {
    $current_url: new URL(address.pathname, location.origin).href,
    $pathname: address.pathname,
    $host: location.host,
    language: document.documentElement.lang,
    page_type: config.dataset.page,
    ...trafficProperties(landing, document.referrer),
  };
  if (config.dataset.artist) context.artist_id = config.dataset.artist;
  const [{ default: posthog }] = await Promise.all([
    import('posthog-js/no-external'),
    // Bundled here because external script loading stays disabled.
    import('posthog-js/dist/web-vitals'),
  ]);
  posthog.init(config.content, {
    api_host: apiHost,
    cookieless_mode: 'always',
    person_profiles: 'never',
    persistence: 'memory',
    autocapture: false,
    capture_pageview: false,
    // Needed for bounce rate, time on page and scroll depth.
    capture_pageleave: true,
    capture_dead_clicks: false,
    rageclick: false,
    capture_heatmaps: false,
    // Core Web Vitals only, without attribution (element selectors), which
    // would also need a script that external loading cannot fetch. Network
    // timing would record resource URLs.
    capture_performance: { web_vitals: true, web_vitals_attribution: false, network_timing: false },
    capture_exceptions: false,
    disable_session_recording: true,
    enable_recording_console_log: false,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    remote_config_refresh_interval_ms: 0,
    save_referrer: false,
    save_campaign_params: false,
    respect_dnt: true,
    internal_or_test_user_hostname: null,
    before_send: (event) => privacyRequested() ? null : sanitizeEvent(event, context),
  });
  const pageview = () => {
    posthog.capture('$pageview');
    if (context.artist_id) posthog.capture('artist_viewed');
  };
  pageview();
  addEventListener('pageshow', (event) => { if (event.persisted) pageview(); });
  return posthog;
}

function capture(event: AnalyticsEvent, properties?: Properties) {
  // In particular, language switches leave this document immediately. Use the
  // SDK's keepalive transport rather than waiting for the next queue flush.
  void getClient().then((posthog) => posthog?.capture(event, properties, { send_instantly: true })).catch(() => undefined);
}

/** One use per search surface per document, never one event per keystroke. */
export function trackSearchUse(surface: 'home' | 'header' | 'results') {
  if (searched.has(surface)) return;
  searched.add(surface);
  capture('search_used', { surface });
}

export function initAnalytics() {
  clearLegacyReplayState();
  void getClient();
  const onClick = (event: MouseEvent) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = (event.target as Element).closest?.<HTMLAnchorElement>('a');
    if (link?.dataset.listenPlatform) capture('listen_clicked', {
      platform: link.dataset.listenPlatform,
      release_id: link.dataset.releaseId,
    });
    if (link?.matches('a.language')) capture('language_switched', { to_language: link.hreflang });
  };
  document.addEventListener('click', onClick);
  document.addEventListener('auxclick', onClick);
}
