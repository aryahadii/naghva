import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIdentity, isCurrentBuild, verifyDeployment } from './deployment.mjs';

const sha = 'a'.repeat(40), newer = 'b'.repeat(40);

test('CI identity requires a full commit SHA; local builds identify themselves', () => {
  assert.equal(buildIdentity({}), 'local');
  assert.equal(buildIdentity({ CI: 'true', NAGHVA_BUILD_SHA: sha }), sha);
  assert.throws(() => buildIdentity({ CI: 'true' }));
  assert.throws(() => buildIdentity({ NAGHVA_BUILD_SHA: 'broken' }));
});

test('freshness check permits current SHA, skips stale SHA, and fails closed', async () => {
  assert.equal(await isCurrentBuild(sha, async () => `${sha}\trefs/heads/main\n`), true);
  assert.equal(await isCurrentBuild(sha, async () => `${newer}\trefs/heads/main\n`), false);
  await assert.rejects(isCurrentBuild(sha, async () => { throw new Error('network down'); }));
  await assert.rejects(isCurrentBuild(sha, async () => ''));
  await assert.rejects(isCurrentBuild(sha, async () => `${sha}\trefs/heads/other`));
});

test('verification retries stale builds and checks both domains plus pages and sitemap', async () => {
  const urls = [];
  let pauses = 0;
  const fetcher = async (url) => {
    urls.push(url);
    return url.includes('build.json') ? Response.json({sha: pauses ? sha : newer}) : new Response('ok');
  };
  await verifyDeployment(sha, { fetcher, attempts: 2, pause: async () => { pauses++; } });
  assert.equal(pauses, 1);
  for (const domain of ['naghva.com', 'naqva.com']) {
    for (const path of ['build.json?', 'fa/', 'en/', 'sitemap-index.xml']) {
      assert.ok(urls.some((url) => url.startsWith(`https://${domain}/${path}`)));
    }
  }
  assert.ok(urls.some((url) => url.includes(`build=${sha}`) && url.includes('attempt=1')));
});

test('persistent SHA mismatch, missing pages, and unreachable domains fail verification', async () => {
  for (const fetcher of [
    async () => Response.json({sha: newer}),
    async (url) => url.includes('build.json') ? Response.json({sha}) : new Response('', {status: 404}),
    async () => { throw new Error('unreachable'); },
  ]) await assert.rejects(verifyDeployment(sha, { fetcher, attempts: 2, pause: async () => {} }));
});
