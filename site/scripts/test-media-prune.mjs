import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orphans } from './media.mjs';

const entry = (sha256, ext = 'jpg') => ({ sha256, ext });

test('prune keeps every original that this media.json or main lists', () => {
  const keys = ['originals/aa.jpg', 'originals/bb.png', 'originals/cc.jpg'];
  const here = { 'https://example.com/a.jpg': entry('aa') };
  const main = { 'https://example.com/b.png': entry('bb', 'png') };
  assert.deepEqual(orphans(keys, here, main), ['originals/cc.jpg']);
  // A branch behind main lists less than main: main's images stay.
  assert.deepEqual(orphans(keys, {}, main), ['originals/aa.jpg', 'originals/cc.jpg']);
  assert.deepEqual(orphans(keys, here, { ...main, 'https://example.com/c.jpg': entry('cc') }), []);
});
