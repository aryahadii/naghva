import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIdentity } from './deployment.mjs';

const sha = 'a'.repeat(40), newer = 'b'.repeat(40);

test('CI identity requires a full commit SHA; local builds identify themselves', () => {
  assert.equal(buildIdentity({}), 'local');
  assert.equal(buildIdentity({ CI: 'true', NAGHVA_BUILD_SHA: sha }), sha);
  assert.throws(() => buildIdentity({ CI: 'true' }));
  assert.throws(() => buildIdentity({ NAGHVA_BUILD_SHA: 'broken' }));
});

test('Cloudflare builds use their native commit SHA and reject invalid identities', () => {
  assert.equal(buildIdentity({ CI: 'true', WORKERS_CI_COMMIT_SHA: sha }), sha);
  assert.throws(() => buildIdentity({ CI: 'true', WORKERS_CI_COMMIT_SHA: 'broken' }));
  assert.throws(() => buildIdentity({ CI: 'true', WORKERS_CI_COMMIT_SHA: '' }));
});

test('explicit and GitHub commit identities keep their precedence', () => {
  assert.equal(buildIdentity({ CI: 'true', GITHUB_SHA: sha }), sha);
  assert.equal(buildIdentity({ NAGHVA_BUILD_SHA: sha, GITHUB_SHA: newer, WORKERS_CI_COMMIT_SHA: newer }), sha);
  assert.equal(buildIdentity({ GITHUB_SHA: sha, WORKERS_CI_COMMIT_SHA: newer }), sha);
  assert.throws(() => buildIdentity({ NAGHVA_BUILD_SHA: 'broken', WORKERS_CI_COMMIT_SHA: sha }));
});
