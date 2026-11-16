import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint, nextState, pageContent, previousSource, readPrevious, w3cDate } from './freshness.mjs';

const page = (main, extra = '') => `<html><head><link rel="stylesheet" href="/_astro/a.${extra}css"></head>
<body><header>Naghva ${extra}</header><main class="article" id="content">${main}</main><footer>${extra}</footer></body></html>`;

test('only what the main content says moves the fingerprint', () => {
  const base = fingerprint(page('<h1>Sanam</h1><p>Singer from <a href="/en/tehran/">Tehran</a>.</p>'));
  // Restyling, renamed assets, new classes and a changed header or footer are not content.
  assert.equal(fingerprint(page('<h1 class="big" data-astro-cid-x1>Sanam</h1>\n  <p style="color:red">Singer from <a class="l" href="/en/tehran/">Tehran</a>.</p>', 'zz')), base);
  // Words, links and data are.
  assert.notEqual(fingerprint(page('<h1>Sanam</h1><p>Singer from <a href="/en/tehran/">Tehran</a>!</p>')), base);
  assert.notEqual(fingerprint(page('<h1>Sanam</h1><p>Singer from <a href="/en/shiraz/">Tehran</a>.</p>')), base);
  assert.notEqual(fingerprint(page('<h1 data-n="3">Sanam</h1><p>Singer from <a href="/en/tehran/">Tehran</a>.</p>')), base);
});

test('page content drops scripts, styles, comments and hashed build files', () => {
  const content = pageContent(page('<style>p{}</style><script type="module">go()</script><!-- x --><img src="/_astro/x.123.webp" alt="Cover"><time datetime="2020-01-01">2020</time><script type="application/json">{"n":1}</script>'));
  assert.equal(content, '<main>\n<img alt=Cover>\n<time datetime=2020-01-01>\n2020\n<script>\n{"n":1}');
});

test('unchanged pages keep their date; new and changed pages take the build', () => {
  const previous = {
    '/en/': { hash: 'aaa', date: '2026-01-01T00:00:00Z', sha: 'old' },
    '/en/a/': { hash: 'bbb', date: '2026-01-02T00:00:00Z', sha: 'old' },
    '/en/gone/': { hash: 'ccc', date: '2026-01-03T00:00:00Z', sha: 'old' },
  };
  const build = { date: '2026-11-16T10:00:00Z', sha: 'new' };
  const { state, changed } = nextState({ '/en/': 'aaa', '/en/a/': 'bbx', '/en/b/': 'ddd' }, previous, build);
  assert.deepEqual(changed, ['/en/a/', '/en/b/']);
  assert.deepEqual(state['/en/'], previous['/en/']);
  assert.deepEqual(state['/en/a/'], { hash: 'bbx', ...build });
  assert.equal(state['/en/gone/'], undefined);
});

test('dates are UTC to the second', () => {
  assert.equal(w3cDate(new Date('2026-11-16T10:20:30.456Z')), '2026-11-16T10:20:30Z');
});

test('the previous state comes from the published site, never from a local server', () => {
  assert.equal(previousSource('https://naghva.com', {}), 'https://naghva.com/lastmod.json');
  assert.equal(previousSource('http://localhost:4321', {}), undefined);
  assert.equal(previousSource('http://localhost:4321', { NAGHVA_LASTMOD_FROM: 'x.json' }), 'x.json');
});

test('a missing state starts fresh; any other failure stops the build', async () => {
  const answer = (status, body = {}) => async () => new Response(JSON.stringify(body), { status });
  assert.deepEqual((await readPrevious('https://x/lastmod.json', answer(404))).state, {});
  assert.deepEqual((await readPrevious('https://x/lastmod.json', answer(200, { '/': {} }))).state, { '/': {} });
  await assert.rejects(readPrevious('https://x/lastmod.json', answer(503)));
  assert.deepEqual((await readPrevious(undefined)).state, {});
});
