import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batches, changedUrls, findKey, locations } from './indexnow.mjs';

test('pings only the sitemap pages that changed in the given build', () => {
  const state = {
    '/en/': { sha: 'old' },
    '/en/a/': { sha: 'new' },
    '/fa/a/': { sha: 'new' },
    '/404.html': { sha: 'new' },
  };
  const sitemap = '<urlset><url><loc>https://naghva.com/en/</loc></url><url><loc>https://naghva.com/fa/a/</loc></url><url><loc>https://naghva.com/en/a/</loc></url></urlset>';
  assert.deepEqual(changedUrls(state, 'new', locations(sitemap)), ['https://naghva.com/en/a/', 'https://naghva.com/fa/a/']);
});

test('reads escaped and non-Latin addresses as the state names them', () => {
  const state = { '/fa/سنم/': { sha: 'new' }, '/en/a&b/': { sha: 'new' } };
  const listed = locations('<loc>https://naghva.com/fa/%D8%B3%D9%86%D9%85/</loc><loc> https://naghva.com/en/a&amp;b/ </loc>');
  assert.deepEqual(changedUrls(state, 'new', listed), ['https://naghva.com/en/a&b/', 'https://naghva.com/fa/%D8%B3%D9%86%D9%85/']);
});

test('sends at most the IndexNow limit per ping', () => {
  assert.deepEqual(batches(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(batches([]), []);
});

test('the key is the one key file the site serves', () => {
  assert.match(findKey(), /^[a-f0-9]{32}$/);
});
