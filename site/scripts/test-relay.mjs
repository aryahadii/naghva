import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { relay, UPSTREAM } from '../worker/relay.ts';

function withUpstream(run) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? await new Response(init.body).text() : '' });
    return new Response('{"status":1}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'private=1' } });
  };
  return run(calls).finally(() => { globalThis.fetch = original; });
}

test('event posts reach PostHog EU with the visitor IP and without cookies or other headers', () => withUpstream(async (calls) => {
  const response = await relay(new Request('https://naqva.com/relay/e/?ip=0&compression=gzip-js&ver=1', {
    method: 'POST', body: 'payload',
    headers: {
      'content-type': 'text/plain', 'content-encoding': 'gzip', 'user-agent': 'Test Browser',
      'cf-connecting-ip': '203.0.113.7', cookie: 'private=1', referer: 'https://naqva.com/fa/?q=private',
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"status":1}');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${UPSTREAM}/e/?ip=0&compression=gzip-js&ver=1`);
  assert.equal(calls[0].body, 'payload');
  const headers = Object.fromEntries(calls[0].init.headers);
  assert.deepEqual(headers, {
    'content-type': 'text/plain', 'content-encoding': 'gzip', 'user-agent': 'Test Browser', 'x-forwarded-for': '203.0.113.7',
  });
}));

test('the relay forwards nothing but event posts', () => withUpstream(async (calls) => {
  for (const [url, method, status] of [
    ['https://naghva.com/relay/flags/', 'POST', 404],
    ['https://naghva.com/relay/static/array.js', 'GET', 404],
    ['https://naghva.com/relay/', 'POST', 404],
    ['https://naghva.com/relay/../decide/', 'POST', 404],
    ['https://naghva.com/relayx/e/', 'POST', 404],
    ['https://naghva.com/relay/e/', 'GET', 405],
  ]) {
    const response = await relay(new Request(url, { method, body: method === 'POST' ? 'x' : undefined }));
    assert.equal(response.status, status, `${method} ${url}`);
  }
  assert.equal(calls.length, 0);
}));

function post(url, body, headers, country) {
  const request = new Request(url, { method: 'POST', body, headers });
  if (country) Object.defineProperty(request, 'cf', { value: { country, region: 'Private', city: 'Private' } });
  return request;
}

test('events get the visitor country from Cloudflare, in every body format posthog-js sends', () => withUpstream(async (calls) => {
  const events = [{ event: '$pageview', properties: { $pathname: '/fa/' } }, { event: '$web_vitals', properties: {} }];
  const json = JSON.stringify(events);
  const bodies = [
    ['https://naghva.com/relay/e/?ver=1', json, {}],
    ['https://naghva.com/relay/e/?compression=gzip-js&ver=1', gzipSync(json), { 'content-encoding': 'gzip' }],
    ['https://naghva.com/relay/e/?compression=base64', `data=${encodeURIComponent(Buffer.from(json).toString('base64'))}`, {}],
    ['https://naghva.com/relay/batch/', JSON.stringify({ batch: events }), {}],
  ];
  for (const [url, body, headers] of bodies) await relay(post(url, body, { 'content-type': 'text/plain', ...headers }, 'IR'));
  assert.equal(calls.length, bodies.length);
  for (const call of calls) {
    assert.doesNotMatch(call.url, /compression/);
    const sent = Object.fromEntries(call.init.headers);
    assert.equal(sent['content-type'], 'application/json');
    assert.equal(sent['content-encoding'], undefined);
    const payload = JSON.parse(call.body);
    for (const event of Array.isArray(payload) ? payload : payload.batch) {
      assert.equal(event.properties.$geoip_country_code, 'IR');
      assert.equal(event.properties.$geoip_country_name, 'Iran');
      assert.equal(event.properties.$geoip_disable, true);
    }
    assert.doesNotMatch(call.body, /Private/);
  }
  assert.equal(JSON.parse(calls[0].body)[0].properties.$pathname, '/fa/');
}));

test('unknown countries and unreadable bodies pass through unchanged', () => withUpstream(async (calls) => {
  await relay(post('https://naghva.com/relay/e/', '[{"event":"$pageview"}]', { 'content-type': 'text/plain' }, 'XX'));
  await relay(post('https://naghva.com/relay/e/', '[{"event":"$pageview"}]', { 'content-type': 'text/plain' }, 'T1'));
  await relay(post('https://naghva.com/relay/e/?compression=gzip-js', 'not gzip', { 'content-encoding': 'gzip' }, 'DE'));
  assert.deepEqual(calls.map((call) => call.body), ['[{"event":"$pageview"}]', '[{"event":"$pageview"}]', 'not gzip']);
  assert.match(calls[2].url, /compression=gzip-js/);
}));
