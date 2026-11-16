import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batches, changedUrls, findKey } from './indexnow.mjs';

test('pings only the sitemap pages that changed in the given build', () => {
  const state = {
    '/en/': { sha: 'old' },
    '/en/a/': { sha: 'new' },
    '/fa/a/': { sha: 'new' },
    '/404.html': { sha: 'new' },
  };
  const sitemap = '<urlset><url><loc>https://naghva.com/en/</loc></url><url><loc>https://naghva.com/fa/a/</loc></url><url><loc>https://naghva.com/en/a/</loc></url></urlset>';
  assert.deepEqual(changedUrls(state, 'new', sitemap), ['https://naghva.com/en/a/', 'https://naghva.com/fa/a/']);
});

test('sends at most the IndexNow limit per ping', () => {
  assert.deepEqual(batches(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(batches([]), []);
});

test('the key is the one key file the site serves', () => {
  assert.match(findKey(), /^[a-f0-9]{32}$/);
});
