import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { ROLE_CLASSIFICATION } from '../src/lib/roles.ts';
import { recordingArtists } from '../src/lib/record.ts';
import { artistView } from '../src/lib/artist.ts';
import { artistJsonLd } from '../src/lib/jsonld.ts';
import { fold, ranked, searchPage } from '../src/lib/search.ts';
import { compareDates } from '../src/lib/catalogue.ts';

const published = JSON.parse(readFileSync('generated/record.json', 'utf8'));
test('every registered role has an explicit performance or creation classification', () => {
  const roles = JSON.parse(execFileSync('python3', ['-c', "import yaml,json; print(json.dumps(yaml.safe_load(open('../data/schema/properties.yaml'))['terms']['role']))"], { encoding: 'utf8' }));
  assert.deepEqual(Object.keys(ROLE_CLASSIFICATION).sort(), roles.sort());
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

test('a release panel shows performers apart from writing and production credits', () => {
  for (const lang of ['en', 'fa']) {
    const view = artistView(published, published.items.Qa84h2k, lang);
    const panel = view.releasePanels.find((r) => r.item.id === 'Q2zke4v'); // Airplanes
    const strings = JSON.parse(readFileSync(`src/strings/${lang}.json`, 'utf8')).release;
    const facts = Object.fromEntries(panel.facts.map((f) => [f.label, f.html]));
    assert.ok(facts[strings.performers] && facts[strings.contributors], lang);
    assert.equal(facts[strings.performers].includes('class="role"'), false, `${lang}: Airplanes billing carries no roles`);
    assert.ok(facts[strings.contributors].includes('class="role"'), lang);
  }
});
