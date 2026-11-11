import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { campaignProperties, landingSearch, sanitizeEvent, trafficProperties } from '../src/lib/analytics.ts';

test('attribution preserves all five UTM values while excluding unrelated URL data', () => {
  const campaign = {
    utm_source: 'New Partner / Music', utm_medium: 'Shared Link',
    utm_campaign: 'Fall 2026 + نغوا', utm_content: 'README:hero&footer',
    utm_term: 'independent music? #1',
  };
  const search = `?${new URLSearchParams(campaign)}&email=private@example.com&gclid=secret&utm_extra=private`;
  assert.deepEqual(campaignProperties(search), campaign);
  assert.deepEqual(campaignProperties('?utm_source=&utm_medium=Another-Medium'), {
    utm_source: '', utm_medium: 'Another-Medium',
  });
  assert.deepEqual(campaignProperties(''), {});
  assert.deepEqual(trafficProperties('https://naghva.com/fa/search/?q=private&email=private#secret', 'https://www.google.com/search?q=private#secret'), {
    $referrer: 'https://www.google.com', $referring_domain: 'www.google.com',
  });
  for (const lang of ['en', 'fa']) {
    const redirected = landingSearch(search, 'https://example.com/path?email=private', 'https://naghva.com');
    const context = trafficProperties(`https://naghva.com/${lang}/${redirected}`, 'https://naghva.com/');
    const event = sanitizeEvent({ event: '$pageview', properties: {} }, context);
    for (const [key, value] of Object.entries(campaign)) assert.equal(event.properties[key], value);
    assert.equal(event.properties.$referring_domain, 'example.com');
    assert.doesNotMatch(JSON.stringify(event), /private|secret/);
  }
});

test('root redirect preserves sanitized attribution without copying unknown parameters', () => {
  const search = landingSearch('?utm_source=telegram&utm_medium=social&token=secret', 'https://t.me/private-chat?token=secret', 'https://naghva.com');
  assert.equal(search, '?utm_source=telegram&utm_medium=social&naghva_referrer=https%3A%2F%2Ft.me');
  assert.deepEqual(trafficProperties(`https://naghva.com/fa/${search}`, 'https://naghva.com/'), {
    utm_source: 'telegram', utm_medium: 'social', $referrer: 'https://t.me', $referring_domain: 't.me',
  });
  assert.equal(landingSearch('?q=private', 'javascript:private', 'https://naghva.com'), '');
  // A direct visit cannot spoof the redirect hint.
  assert.equal(trafficProperties(`https://naghva.com/fa/${search}`, '').$referring_domain, '$direct');
});

test('the README link stays attributable through either language redirect and the final payload', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const link = new URL(readme.match(/\[naghva\.com\]\((https:\/\/naghva\.com[^)]+)\)/)[1]);
  const campaign = { utm_source: 'github', utm_medium: 'referral', utm_content: 'readme' };
  assert.deepEqual(campaignProperties(link.search), campaign);
  for (const lang of ['en', 'fa']) {
    for (const referrer of ['https://github.com/aryahadii/naghva', '']) {
      const search = landingSearch(`${link.search}&token=private`, referrer, link.origin);
      const context = trafficProperties(`${link.origin}/${lang}/${search}`, `${link.origin}/`);
      const event = sanitizeEvent({ event: '$pageview', properties: {} }, context);
      assert.equal(event.properties.utm_source, campaign.utm_source);
      assert.equal(event.properties.utm_medium, campaign.utm_medium);
      assert.equal(event.properties.utm_content, campaign.utm_content);
      if (referrer) assert.equal(event.properties.$referring_domain, 'github.com');
      assert.equal(JSON.stringify(event).includes('private'), false);
    }
  }
});

test('the final payload boundary drops SDK URL fields, person updates and unexpected events', () => {
  const context = { $current_url: 'https://naghva.com/fa/', $pathname: '/fa/', language: 'fa' };
  const event = {
    uuid: 'event-id', event: 'search_used',
    properties: {
      token: 'phc_test', distinct_id: '$posthog_cookieless', $cookieless_mode: true,
      $current_url: 'https://naghva.com/fa/?q=private', $initial_current_url: 'private',
      $session_entry_url: 'private', $referrer: 'private', $initial_referrer: 'private',
      $set: { email: 'private' }, $set_once: { email: 'private' }, query: 'private',
      $raw_user_agent: 'Mozilla/5.0 test-browser', utm_term: 'private', gclid: 'private',
      surface: 'home', $browser: 'Chrome',
    },
    $set: { email: 'private' }, $set_once: { email: 'private' }, $unset: ['private'],
  };
  const safe = sanitizeEvent(event, context);
  assert.equal(JSON.stringify(safe).includes('private'), false);
  assert.equal(safe.properties.surface, 'home');
  assert.equal(safe.properties.distinct_id, '$posthog_cookieless');
  assert.equal(safe.properties.$cookieless_mode, true);
  assert.equal(safe.properties.$raw_user_agent, 'Mozilla/5.0 test-browser');
  const identified = sanitizeEvent({ ...event, properties: { ...event.properties, distinct_id: 'persistent-id', $cookieless_mode: false } }, context);
  assert.equal(identified.properties.$raw_user_agent, undefined);
  assert.equal(safe.properties.$process_person_profile, false);
  assert.equal(sanitizeEvent({ ...event, event: '$autocapture' }, context), null);
  assert.equal(sanitizeEvent({ ...event, event: '$snapshot' }, context), null);
});

test('page leave and web vitals keep only their numeric measurements', () => {
  const context = { $current_url: 'https://naghva.com/en/', $pathname: '/en/', language: 'en' };
  const leave = sanitizeEvent({ event: '$pageleave', properties: {
    distinct_id: '$posthog_cookieless',
    $prev_pageview_duration: 42.5, $prev_pageview_max_scroll_percentage: 0.8,
    $prev_pageview_last_content: 1200, $prev_pageview_pathname: '/en/sanam-maroufkhani-a84/',
    $prev_pageview_id: 'private-id', $prev_pageview_max_scroll: 'private',
  } }, context);
  assert.equal(leave.properties.$prev_pageview_duration, 42.5);
  assert.equal(leave.properties.$prev_pageview_max_scroll_percentage, 0.8);
  assert.equal(leave.properties.$prev_pageview_last_content, 1200);
  assert.equal(leave.properties.$prev_pageview_pathname, '/en/sanam-maroufkhani-a84/');
  assert.equal(leave.properties.$pathname, '/en/');
  assert.equal(JSON.stringify(leave).includes('private'), false);
  const odd = sanitizeEvent({ event: '$pageleave', properties: { $prev_pageview_pathname: '/en/?q=private' } }, context);
  assert.equal(odd.properties.$prev_pageview_pathname, undefined);
  const vitals = sanitizeEvent({ event: '$web_vitals', properties: {
    $web_vitals_LCP_value: 1834.2, $web_vitals_CLS_value: 0.01,
    $web_vitals_LCP_event: { name: 'LCP', value: 1834.2, $current_url: 'https://naghva.com/en/?q=private', attribution: { element: 'private' } },
    $web_vitals_TTFB_value: 99, $current_url: 'https://naghva.com/en/?q=private',
  } }, context);
  assert.equal(vitals.properties.$web_vitals_LCP_value, 1834.2);
  assert.equal(vitals.properties.$web_vitals_CLS_value, 0.01);
  assert.equal(vitals.properties.$web_vitals_TTFB_value, undefined);
  assert.equal(vitals.properties.$current_url, 'https://naghva.com/en/');
  assert.equal(JSON.stringify(vitals).includes('private'), false);
  // Other events never carry these measurements.
  const search = sanitizeEvent({ event: 'search_used', properties: { surface: 'home', $prev_pageview_duration: 3, $web_vitals_LCP_value: 1 } }, context);
  assert.equal(search.properties.$prev_pageview_duration, undefined);
  assert.equal(search.properties.$web_vitals_LCP_value, undefined);
});
