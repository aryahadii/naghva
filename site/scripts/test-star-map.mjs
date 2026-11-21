import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStarMap } from '../src/lib/star-map.ts';

const statement = (value, rank = 'normal', qualifiers) => ({ value, rank, qualifiers });
const artist = (id, type = 'person') => ({
  id, type, page: id, statements: {}, names: { en: { text: id, language: 'en' } },
});

test('the star map keeps distinct shared credits, historical memberships and isolated artists', () => {
  const singer = artist('singer');
  singer.statements['member of'] = [statement('band', 'normal', { 'end time': ['unknown value'] })];
  const band = artist('band', 'act');
  const other = artist('other');
  const release = {
    ...artist('song', 'release'), page: undefined, anchor: 'song',
    statements: {
      performer: [statement('band'), statement('other', 'deprecated')],
      contributor: [statement('singer'), statement('singer')],
    },
  };
  const record = { artists: ['band', 'singer', 'other'], items: { singer, band, other, song: release }, panelHosts: { song: 'band' } };
  const map = buildStarMap(record, 'en');
  const byId = Object.fromEntries(map.artists.map(a => [a.id, a]));
  assert.deepEqual(map.recordings, [{ name: 'song', href: '/en/band/#song' }]);
  assert.deepEqual(byId.band.connections, [{ artist: 'singer', membership: 'formerMember', recording: 0 }]);
  assert.deepEqual(byId.singer.connections, [{ artist: 'band', membership: 'formerGroup', recording: 0 }]);
  assert.deepEqual(byId.singer.recordings, [0]);
  assert.deepEqual(byId.other.connections, []);
  assert.deepEqual(byId.other.recordings, []);
});
