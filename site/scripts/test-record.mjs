import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { best, recordingArtists, datesDisagree, href, performers, releaseDates, releasesOf } from '../src/lib/record.ts';
import { ROLE_CLASSIFICATION } from '../src/lib/roles.ts';

const artist = { id: 'artist', type: 'person', page: 'artist', statements: {}, incoming: [] };
const band = { id: 'band', type: 'act', statements: {}, incoming: [{ property: 'member of', item: 'artist', rank: 'normal' }] };
const release = { id: 'release', type: 'release', anchor: 'album', statements: { performer: [{ value: 'band', rank: 'normal' }] }, incoming: [] };
const event = { id: 'event', type: 'event', statements: { performer: [{ value: 'artist', rank: 'normal' }] }, incoming: [] };

test('an announced event never becomes a recording on its performer’s page', () => {
  const person = { ...artist, incoming: [{ property: 'performer', item: 'event', rank: 'normal' }] };
  assert.deepEqual(releasesOf({ items: { artist: person, event } }, person), []);
  assert.equal(href({ items: { artist: person, event } }, 'en', event), '/en/artist/#events');
});

test('a band recording without a curated band page has a working member-page panel', () => {
  const record = { items: { artist, band, release } };
  assert.equal(href(record, 'en', release), '/en/artist/#album');
  assert.deepEqual(releasesOf(record, artist).map((r) => r.id), ['release']);
  assert.equal(release.statements.performer[0].value, 'band');
});

test('a release retains sourced date alternatives and ignores deprecated dates', () => {
  const date = (value, rank = 'normal') => ({ rank, value: { date: value, range: [`${value}-01-01`, `${value}-12-31`] } });
  const dates = releaseDates({ statements: { 'release date': [date('2005'), date('2003', 'preferred'), date('1999', 'deprecated')] } });
  assert.deepEqual(dates.map((d) => d.date), ['2003', '2005']);
  assert.equal(datesDisagree(dates), true);
});

test('multiple credited roles do not repeat an artist in the performer list', () => {
  const recording = { ...release, statements: { performer: [
    { value: 'artist', rank: 'normal', qualifiers: { role: ['vocals'] } },
    { value: 'artist', rank: 'normal', qualifiers: { role: ['producer'] } },
  ] } };
  assert.deepEqual(performers({ items: { artist } }, recording), [artist]);
  assert.equal(recording.statements.performer.length, 2);
});

test('a cover song card keeps recording collaborators without implying its original lyricist performed', () => {
  const originalLyricist = { ...artist, id: 'original-lyricist' };
  const singingWriter = { ...artist, id: 'singing-writer' };
  const billedArtist = { ...artist, id: 'billed-artist' };
  const recording = { ...release, statements: { performer: [
    { value: 'artist', rank: 'normal', qualifiers: { role: ['vocals'] } },
    { value: 'original-lyricist', rank: 'normal', qualifiers: { role: ['lyricist'] } },
    { value: 'singing-writer', rank: 'normal', qualifiers: { role: ['lyricist'] } },
    { value: 'singing-writer', rank: 'normal', qualifiers: { role: ['backing vocals'] } },
    { value: 'billed-artist', rank: 'normal' },
  ] } };
  const record = { items: { artist, 'original-lyricist': originalLyricist, 'singing-writer': singingWriter, 'billed-artist': billedArtist } };
  assert.deepEqual(recordingArtists(record, recording).map((p) => p.id), ['artist', 'singing-writer', 'billed-artist']);
  assert.deepEqual(performers(record, recording).map((p) => p.id), ['artist', 'original-lyricist', 'singing-writer', 'billed-artist']);
});

test('an adaptation credits underlying writers without implying they performed', () => {
  const writer = { ...artist, id: 'original-writer' };
  const returningWriter = { ...artist, id: 'returning-writer' };
  const billedComposer = { ...artist, id: 'billed-composer' };
  const recording = { ...release, statements: { performer: [
    { value: 'artist', rank: 'normal', qualifiers: { role: ['vocals'] } },
    { value: 'original-writer', rank: 'normal', qualifiers: { role: ['original composer', 'original lyricist'] } },
    { value: 'returning-writer', rank: 'normal', qualifiers: { role: ['original composer', 'piano'] } },
    { value: 'billed-composer', rank: 'normal', qualifiers: { role: ['composer', 'producer'] } },
    { value: 'billed-composer', rank: 'normal' },
  ] } };
  const record = { items: { artist, 'original-writer': writer, 'returning-writer': returningWriter, 'billed-composer': billedComposer } };
  assert.deepEqual(recordingArtists(record, recording).map((p) => p.id), ['artist', 'returning-writer', 'billed-composer']);
  assert.equal(performers(record, recording).length, 4);
});

test('production credits stay complete without replacing explicit artist billing', () => {
  const producer = { ...artist, id: 'producer' };
  const billedProducer = { ...artist, id: 'billed-producer' };
  const playingProducer = { ...artist, id: 'playing-producer' };
  const recording = { ...release, statements: { performer: [
    { value: 'artist', rank: 'normal', qualifiers: { role: ['vocals'] } },
    { value: 'producer', rank: 'normal', qualifiers: { role: ['producer'] } },
    { value: 'billed-producer', rank: 'normal', qualifiers: { role: ['producer'] } },
    { value: 'billed-producer', rank: 'normal' },
    { value: 'playing-producer', rank: 'normal', qualifiers: { role: ['producer', 'guitar'] } },
  ] } };
  const record = { items: { artist, producer, 'billed-producer': billedProducer, 'playing-producer': playingProducer } };
  assert.deepEqual(recordingArtists(record, recording).map((p) => p.id), ['artist', 'billed-producer', 'playing-producer']);
  assert.deepEqual(performers(record, recording).map((p) => p.id), ['artist', 'producer', 'billed-producer', 'playing-producer']);
});

test('billing evidence combined into a producer row needs a separate curated billing claim', () => {
  // The original Baroon Baroon shape: two different claims in one qualified row.
  const billing = { source: 'music.apple.com-us-album-baroon-baroon-single-1722935539',
    quote: 'Baroon Baroon - Single - Album by Sharyar & Rian - Apple Music', accessed: '2026-10-22' };
  const production = { source: 'www.shazam.com-song-1722935540-baroon-baroon',
    quote: 'Rian\n\nProducer', accessed: '2026-10-22' };
  const rian = { ...artist, id: 'Qvhgfe7' };
  const sharyar = { ...artist, id: 'Qrfxgfs' };
  const record = { items: { Qvhgfe7: rian, Qrfxgfs: sharyar } };
  const combined = { ...release, id: 'Q399z73', statements: { performer: [
    { value: sharyar.id, rank: 'normal', references: [billing] },
    { value: rian.id, rank: 'normal', qualifiers: { role: ['producer'] }, references: [billing, production] },
  ] } };
  assert.deepEqual(recordingArtists(record, combined).map((p) => p.id), [sharyar.id]);

  const curated = { ...combined, statements: { performer: [
    combined.statements.performer[0],
    { value: rian.id, rank: 'normal', references: [billing] },
    { value: rian.id, rank: 'normal', qualifiers: { role: ['producer'] }, references: [production] },
  ] } };
  assert.deepEqual(recordingArtists(record, curated).map((p) => p.id), [sharyar.id, rian.id]);
  assert.deepEqual(performers(record, curated).map((p) => p.id), [sharyar.id, rian.id]);
  assert.deepEqual(curated.statements.performer.flatMap((s) => s.qualifiers?.role ?? []), ['producer']);
  assert.deepEqual(curated.statements.performer[2].references, [production]);
});

// CI and the documented verification sequence derive the published record before
// npm test. These checks catch curation regressions that synthetic rows cannot.
const published = JSON.parse(readFileSync(new URL('../generated/record.json', import.meta.url), 'utf8'));
const releases = Object.values(published.items).filter((item) => item.type === 'release');

test('published performer credits carry no writing or production role', () => {
  for (const release of releases) {
    for (const s of release.statements.performer ?? []) {
      assert.equal((s.qualifiers?.role ?? []).some((role) => ROLE_CLASSIFICATION[role] === 'creation'), false,
        `${release.id}/${s.value}: ${s.qualifiers?.role} belongs under contributor`);
    }
    for (const s of release.statements.contributor ?? []) {
      assert.ok(s.qualifiers.role.every((role) => ROLE_CLASSIFICATION[role] === 'creation'), `${release.id}/${s.value}`);
    }
  }
});

test('published life events reach the timeline in the source’s own words', () => {
  const life = published.timeline.filter((e) => e.kind === 'life');
  assert.ok(life.length > 0);
  for (const entry of life) {
    const own = best(published.items[entry.item].statements['life event']).map((s) => s.value.text.split(/\s+/).join(' '));
    assert.ok(own.includes(entry.text.text), entry.anchor);
  }
});

test('a credited collaborator without an article never links to someone else’s page', () => {
  const collaborator = { ...artist, id: 'collaborator', page: undefined,
    statements: { 'member of': [{ value: 'band', rank: 'normal' }] },
    incoming: [{ property: 'performer', item: 'release', rank: 'normal' }] };
  const recording = { ...release, statements: { performer: [
    { value: 'artist', rank: 'normal' }, { value: 'collaborator', rank: 'normal' },
  ] } };
  const record = { items: { artist, collaborator, band, release: recording } };
  assert.equal(href(record, 'en', collaborator), null);
});
