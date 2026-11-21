import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStarMap } from '../src/lib/star-map.ts';

const statement = (value, rank = 'normal') => ({ value, rank });
const item = (id, type, props = {}) => ({
  id, type, statements: {}, names: { en: { text: id, language: 'en' } }, ...props,
});

test('the sky includes every artist and release with only sourced, reciprocal links', () => {
  const singer = item('singer', 'person', { statements: { 'member of': [statement('band')] } });
  const band = item('band', 'act', { page: 'band' });
  const other = item('other', 'person');
  const song = item('song', 'release', {
    anchor: 'song',
    names: { en: { text: 'Song', language: 'en' }, fa: { text: 'ترانه', language: 'fa' } },
    statements: {
      performer: [statement('band'), statement('other', 'deprecated')],
      contributor: [statement('singer'), statement('singer')],
    },
  });
  const record = {
    artists: ['band'], panelHosts: { song: 'band' },
    items: { singer, band, other, song, demo: item('demo', 'release'), label: item('label', 'organization') },
  };
  const sky = buildStarMap(record, 'en');
  const byId = Object.fromEntries(sky.map(star => [star.id, star]));
  assert.equal(sky.length, 5);
  assert.deepEqual(byId.band.connections, ['singer', 'song']);
  assert.deepEqual(byId.singer.connections, ['band', 'song']);
  assert.deepEqual(byId.song.connections, ['band', 'singer']);
  assert.deepEqual(byId.other.connections, []);
  assert.deepEqual(byId.demo.connections, []);
  assert.equal(byId.singer.href, null);
  assert.equal(byId.song.href, '/en/band/#song');
  assert.equal(byId.song.kind, 'recording');
  assert.equal(byId.singer.kind, 'artist');
  assert.equal(byId.song.alternate, 'ترانه');

  const positions = stars => stars.map(({ id, x, y }) => [id, x, y]);
  const reversed = { ...record, items: Object.fromEntries(Object.entries(record.items).reverse()) };
  assert.deepEqual(positions(buildStarMap(reversed, 'fa')), positions(sky));
  assert.equal(new Set(sky.map(star => [star.x, star.y].join(','))).size, sky.length);
  assert.ok(sky.every(({ x, y }) => x > 0 && x < 1 && y > 0 && y < 1));
  assert.deepEqual(buildStarMap({ items: {} }, 'en'), []);
});
