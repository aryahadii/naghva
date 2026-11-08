import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignProperties, landingSearch, sanitizeEvent, trafficProperties } from '../src/lib/analytics.ts';

test('attribution keeps categorical sources and strips all free-form URL data', () => {
  assert.deepEqual(campaignProperties('?utm_source=Instagram&utm_medium=social&utm_campaign=private-name&utm_term=secret&email=private@example.com&gclid=secret'), {
    utm_source: 'instagram', utm_medium: 'social',
  });
  assert.deepEqual(campaignProperties('?utm_source=private-person&utm_medium=private-person'), {});
  assert.deepEqual(trafficProperties('https://naghva.com/fa/search/?q=private&email=private#secret', 'https://www.google.com/search?q=private#secret'), {
    $referrer: 'https://www.google.com', $referring_domain: 'www.google.com',
  });
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
