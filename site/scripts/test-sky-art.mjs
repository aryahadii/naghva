import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUES, chance, hueOf } from '../src/lib/sky-art.ts';

const star = (key, kind = 'artist', page = false) => ({ key, kind, page });

test('a star keeps its pigment, and each kind leans on its own', () => {
  assert.equal(hueOf(star('kiosk-x1', 'artist', true)), hueOf(star('kiosk-x1', 'artist', true)));
  const count = (kind, page) => {
    const tally = Object.fromEntries(HUES.map((hue) => [hue, 0]));
    for (let i = 0; i < 2000; i++) tally[hueOf(star(`star-${i}`, kind, page))]++;
    return tally;
  };
  const pages = count('artist', true), recordings = count('recording', false);
  // Gold leads among the artists with a page, and no artist is painted in the recordings' lapis.
  assert.ok(pages.gold > 900 && pages.gold < 1200);
  assert.equal(pages.lapis, 0);
  assert.equal(pages.cream, 0);
  // Cream leads among the recordings, and every pigment but rose is among them.
  assert.ok(recordings.cream > recordings.gold && recordings.gold > recordings.coral);
  assert.ok(recordings.lapis > 100);
  assert.equal(recordings.rose, 0);
});

test('a chance is a fixed number below one that differs by salt', () => {
  for (const key of ['a', 'kiosk-x1', 'نغوا']) {
    assert.ok(chance(key) >= 0 && chance(key) < 1);
    assert.equal(chance(key, 4), chance(key, 4));
    assert.notEqual(chance(key, 4), chance(key, 5));
  }
});
