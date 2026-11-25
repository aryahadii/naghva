import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSky } from '../src/lib/sky-data.ts';
import { buildSky } from '../src/lib/star-map.ts';

const statement = (value, rank = 'normal') => ({ value, rank });
const item = (id, type, props = {}) => ({
  id, type, statements: {}, names: { en: { text: id, language: 'en' } }, ...props,
});
const day = (date) => ({ date, calendar: 'gregorian', precision: 'day', range: [date, date] });

const singer = item('singer', 'person', { statements: { 'member of': [statement('band')] } });
const band = item('band', 'act', {
  page: 'band', releases: ['song', 'demo'], statements: { 'based in': [statement('city')] },
});
const other = item('other', 'person');
const song = item('song', 'release', {
  anchor: 'song',
  names: { en: { text: 'Song', language: 'en' }, fa: { text: 'ترانه', language: 'fa' } },
  statements: {
    performer: [statement('band'), statement('other', 'deprecated')],
    contributor: [statement('singer'), statement('singer')],
    'release date': [statement(day('2019-05-04'))],
  },
});
const demo = item('demo', 'release', { statements: { 'release date': [statement(day('2023-01-20'))] } });
const city = item('city', 'place', { names: { en: { text: 'Tehran', language: 'en' }, fa: { text: 'تهران', language: 'fa' } } });
const record = {
  artists: ['band'], panelHosts: { song: 'band' },
  items: { singer, band, other, song, demo, city, label: item('label', 'organization') },
};

test('the sky includes every artist and release with only sourced, reciprocal links', () => {
  const sky = buildSky(record, (it) => (it.id === 'band' ? '/media/band.webp' : undefined));
  const stars = readSky(sky, 'en');
  const byName = Object.fromEntries(stars.map((star) => [star.name, star]));
  const linked = (star) => star.links.map((index) => stars[index].name).sort();
  assert.equal(stars.length, 5);
  assert.deepEqual(linked(byName.band), ['Song', 'singer']);
  assert.deepEqual(linked(byName.singer), ['Song', 'band']);
  assert.deepEqual(linked(byName.Song), ['band', 'singer']);
  assert.deepEqual(linked(byName.other), []);
  assert.deepEqual(linked(byName.demo), []);
  // Each link is written once in the file, on the earlier of its two stars.
  assert.equal(sky.stars.reduce((sum, star) => sum + star.l.length, 0), 3);
  assert.ok(sky.stars.every((star, index) => star.l.every((link) => link > index)));

  // A star is known by its page, its panel, or else its ID.
  assert.deepEqual([byName.band.key, byName.Song.key, byName.singer.key], ['band', 'song', 'singer']);
  assert.equal(byName.band.href, '/en/band/');
  assert.equal(byName.Song.href, '/en/band/#song');
  assert.equal(byName.singer.href, null);
  assert.equal(byName.demo.href, null);
  assert.deepEqual([byName.band.page, byName.band.group], [true, true]);
  assert.deepEqual([byName.singer.page, byName.singer.group, byName.singer.kind], [false, false, 'artist']);
  assert.deepEqual([byName.Song.page, byName.Song.kind], [false, 'recording']);

  // The few facts a card shows.
  assert.equal(byName.band.image, '/media/band.webp');
  assert.equal(byName.Song.image, null);
  assert.deepEqual([byName.band.place, byName.band.years], ['Tehran', '2019–2023']);
  assert.deepEqual([byName.Song.years, byName.Song.by, byName.Song.alternate], ['2019', 'band', 'ترانه']);
  assert.deepEqual([byName.singer.place, byName.singer.years, byName.demo.by], ['', '', '']);
});

test('the sky reads the same in Persian, in Persian words and digits', () => {
  const stars = readSky(buildSky(record), 'fa');
  const byKey = Object.fromEntries(stars.map((star) => [star.key, star]));
  assert.deepEqual([byKey.song.name, byKey.song.alternate, byKey.song.href], ['ترانه', 'Song', '/fa/band/#song']);
  assert.deepEqual([byKey.band.place, byKey.band.years, byKey.song.years], ['تهران', '۱۳۹۸–۱۴۰۱', '۱۳۹۸']);
  // A name written in one language only shows as it is, with no second name.
  assert.deepEqual([byKey.band.name, byKey.band.alternate], ['band', '']);
});

test('every star has its own place, wherever the record lists it', () => {
  const sky = buildSky(record);
  const places = (file) => file.stars.map(({ n, x, y }) => [n[0], x, y]);
  const reversed = { ...record, items: Object.fromEntries(Object.entries(record.items).reverse()) };
  assert.deepEqual(places(buildSky(reversed)), places(sky));
  assert.equal(new Set(sky.stars.map((star) => [star.x, star.y].join(','))).size, sky.stars.length);
  assert.ok(sky.stars.every(({ x, y }) => Number.isInteger(x) && Number.isInteger(y) && x > 0 && x < 100_000 && y > 0 && y < 100_000));
  assert.deepEqual(buildSky({ items: {} }), { places: [], stars: [] });
});

test('a post-only recording keeps its year without posing as a release', () => {
  const posted = day('2023-02-01');
  const post = { ...demo, statements: { 'platform posting date': [statement(posted)] } };
  const both = { ...song, statements: { ...song.statements, 'platform posting date': [statement(posted)] } };
  const sky = buildSky({ ...record, items: { ...record.items, demo: post, song: both } });
  const en = (key) => readSky(sky, 'en').find((star) => star.key === key);
  const fa = (key) => readSky(sky, 'fa').find((star) => star.key === key);
  assert.equal(en('demo').years, 'Posted 2023');
  assert.equal(fa('demo').years, 'بارگذاری: ۱۴۰۱');
  assert.equal(en('song').years, '2019');
  assert.equal(en('band').years, '2019');
});
