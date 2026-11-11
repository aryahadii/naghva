import assert from 'node:assert/strict';
import test from 'node:test';
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
