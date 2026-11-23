import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { catalogueReleasesOf, recordingArtists } from '../src/lib/record.ts';
import { artistView } from '../src/lib/artist.ts';
import { artistJsonLd, siteJsonLd } from '../src/lib/jsonld.ts';
import { fold, ranked, searchPage } from '../src/lib/search.ts';
import { compareDates } from '../src/lib/catalogue.ts';

const published = JSON.parse(readFileSync('generated/record.json', 'utf8'));
test('every registered role is classed as performance or creation', () => {
  const roles = JSON.parse(execFileSync('python3', ['-c', "import yaml,json; print(json.dumps(yaml.safe_load(open('../data/schema/properties.yaml'))['terms']['role']))"], { encoding: 'utf8' }));
  const ROLE_CLASSIFICATION = published.roles;
  assert.deepEqual(Object.keys(ROLE_CLASSIFICATION).sort(), roles.sort());
  assert.ok(Object.values(ROLE_CLASSIFICATION).every((kind) => kind === 'performance' || kind === 'creation'));
  for (const role of roles) {
    const person = { id: 'person' };
    const release = { statements: { performer: [{ value: 'person', rank: 'normal', qualifiers: { role: [role] } }] } };
    assert.equal(recordingArtists({ items: { person } }, release).length, ROLE_CLASSIFICATION[role] === 'performance' ? 1 : 0, role);
    release.statements.performer.push({ value: 'person', rank: 'normal' });
    assert.equal(recordingArtists({ items: { person } }, release).length, 1, `${role} with explicit billing`);
  }
});
test('based-in evidence never implies a founding location', () => {
  // The published artists are people, so the fictional band in the examples stands in.
  const out = join(mkdtempSync(join(tmpdir(), 'naghva-')), 'record.json');
  execFileSync('python3', ['../tools/derive.py', '--root', '../data/examples', '--out', out]);
  const examples = JSON.parse(readFileSync(out, 'utf8'));
  const artist = Object.values(examples.items).find((a) => a.type === 'act' && a.page && a.statements['based in']);
  assert.ok(artist);
  const graph = artistJsonLd(examples, artist, 'en', new URL('https://example.org'))['@graph'];
  assert.equal(graph[0].foundingLocation, undefined);
});

test('search engines are told both names of Naghva and which artist a page is about', () => {
  const site = new URL('https://example.org');
  const [website, organization] = siteJsonLd('fa', site, 'https://example.org/logo.png')['@graph'];
  for (const node of [website, organization]) {
    assert.equal(node.name, 'Naghva');
    assert.ok(node.alternateName.includes('نغوا'));
    assert.equal(node.url, 'https://example.org/');
  }
  assert.equal(website.publisher['@id'], organization['@id']);
  assert.equal(organization.logo, 'https://example.org/logo.png');

  const artist = published.items.Qa84h2k;
  const profiles = artist.statements['profile link'].filter((s) => s.rank !== 'deprecated').map((s) => s.value);
  const node = artistJsonLd(published, artist, 'en', site, null, 'A one-line summary.')['@graph'][0];
  assert.deepEqual(node.sameAs, [...new Set(profiles)]);
  assert.equal(node.description, 'A one-line summary.');
});

test('listening URLs combine distinct evidence and render independent citations in both languages', () => {
  const record = structuredClone(published);
  const artist = record.items.Qa84h2k;
  const release = Object.values(record.items).find((r) => r.type === 'release' && r.statements.performer?.some((s) => s.value === artist.id) && r.statements['listen link']?.length);
  const first = release.statements['listen link'][0];
  const extra = { ...first.references[0], quote: 'A distinct supported passage.' };
  release.statements['listen link'].push({ ...first, references: [first.references[0], extra] });
  for (const lang of ['en', 'fa']) {
    const view = artistView(record, artist, lang);
    const panel = view.releasePanels.find((r) => r.item.id === release.id);
    const links = panel.listen.filter((l) => l.href === first.value);
    assert.equal(links.length, 1);
    assert.ok(links[0].references.some((r) => r.quote === extra.quote));
    assert.ok(links[0].citations.includes('class="cite"'));
    assert.ok(view.sources.some((s) => s.quotes.some((q) => q.quote === extra.quote)));
  }
});
test('catalogue dates put undated last in both directions with stable ID ties', () => {
  const values = [{ id: 'z' }, { id: 'b', date: '2020' }, { id: 'a', date: '2020' }, { id: 'c', date: '1999' }];
  assert.deepEqual([...values].sort((a,b) => compareDates(a,b)).map((r) => r.id), ['c','a','b','z']);
  assert.deepEqual([...values].sort((a,b) => compareDates(a,b,true)).map((r) => r.id), ['a','b','c','z']);
});
test('quick and paginated search share normalization, ranking, accurate totals and stable ties', () => {
  const entries = Array.from({ length: 55 }, (_, i) => ({ i: String(i).padStart(3,'0'), k: 'artist', h: '/artist/', n: { en: { text: 'Artist', language: 'en' }, fa: null }, f: [fold('كيان ۱۲')] }));
  const index = { entries: [...entries].reverse(), artists: {} };
  for (const lang of ['en','fa']) {
    const all = ranked(index, 'کیان 12', lang);
    assert.equal(all.length, 55);
    assert.deepEqual(all.map((e) => e.i), entries.map((e) => e.i));
    assert.deepEqual(searchPage(index, 'کیان 12', lang, 2).entries, all.slice(24,48));
    assert.equal(searchPage(index, 'کیان 12', lang, 99).page, 3);
    assert.equal(searchPage(index, 'missing', lang, 1).total, 0);
  }
});

test('release panels show writing and production credits in their own row, with roles', () => {
  let checked = 0;
  for (const lang of ['en', 'fa']) {
    const strings = JSON.parse(readFileSync(`src/strings/${lang}.json`, 'utf8')).release;
    for (const artist of Object.values(published.items).filter((a) => a.page)) {
      for (const panel of artistView(published, artist, lang).releasePanels) {
        const facts = Object.fromEntries(panel.facts.map((f) => [f.label, f.html]));
        const credited = (panel.item.statements.contributor ?? []).length > 0;
        assert.equal(Boolean(facts[strings.contributors]), credited, `${lang} ${panel.item.id}`);
        if (credited) { assert.ok(facts[strings.contributors].includes('class="role"'), `${lang} ${panel.item.id}`); checked++; }
      }
    }
  }
  assert.ok(checked > 0);
});

test('a contributor can browse a recording on their page with the original performer billing', () => {
  // A release the artist wrote or produced but doesn't perform on.
  const creditOf = (artist) => catalogueReleasesOf(published, artist).find((release) => !(artist.releases ?? []).includes(release.id));
  const composer = Object.values(published.items).find((item) => item.page && creditOf(item));
  assert.ok(composer);
  const credit = { item: creditOf(composer).id };
  for (const lang of ['en', 'fa']) {
    const view = artistView(published, composer, lang);
    const panels = view.releases.filter((panel) => panel.item.id === credit.item);
    assert.equal(panels.length, 1);
    const graph = artistJsonLd(published, composer, lang, new URL('https://example.org'))['@graph'];
    const album = graph.find((node) => node.url?.endsWith('#' + encodeURIComponent(panels[0].anchor)));
    assert.ok(album);
    assert.ok(album.byArtist.every((performer) => performer['@id'] !== graph[0]['@id']));
  }
});
