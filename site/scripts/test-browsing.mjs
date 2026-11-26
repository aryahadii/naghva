import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { best, byRecordingDate, orderParts, catalogueReleasesOf, creditedReleaseHost, newRecords, recordingArtists, recordingDates, releaseDates, withoutEpMarker } from '../src/lib/record.ts';
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
test('a dated programme segment does not say Released in either language', () => {
  const artist = published.items.Qyw49hh;
  const segment = published.items.Qs6vktc;
  const dated = {
    ...segment,
    statements: {
      ...segment.statements,
      'release date': published.items.Qtseyat.statements['release date'],
    },
  };
  const record = { ...published, items: { ...published.items, [segment.id]: dated } };
  for (const lang of ['en', 'fa']) {
    const labels = JSON.parse(readFileSync(`src/strings/${lang}.json`, 'utf8')).release;
    const panel = artistView(record, artist, lang).releasePanels.find((p) => p.item.id === segment.id);
    assert.ok(panel.facts.some((f) => f.label === labels.segmentDate), lang);
    assert.ok(!panel.facts.some((f) => f.label === labels.released), lang);
  }
});

test('album tracks fold into their album card and are listed on its panel in both languages', () => {
  const artist = published.items.Qhebfsp;
  const album = published.items.Qb74q2p;
  const tracks = album.incoming.filter((i) => i.property === 'track of').map((i) => i.item);
  assert.ok(tracks.length > 1);
  for (const lang of ['en', 'fa']) {
    const labels = JSON.parse(readFileSync(`src/strings/${lang}.json`, 'utf8')).release;
    const view = artistView(published, artist, lang);
    assert.ok(view.shelf.some((r) => r.item.id === album.id), lang);
    assert.ok(!view.shelf.some((r) => tracks.includes(r.item.id)), lang);
    // Tracks keep their panels and stay among the artist's recordings for structured data.
    for (const id of tracks) assert.ok(view.releases.some((r) => r.item.id === id), `${lang} ${id}`);
    const panel = view.releasePanels.find((r) => r.item.id === album.id);
    const listed = panel.facts.find((f) => f.label === labels.tracks);
    assert.ok(listed, lang);
    for (const id of tracks) assert.ok(listed.html.includes(`href="#${published.items[id].anchor}"`), `${lang} ${id}`);
    assert.ok(panel.trackNames.length >= tracks.length, lang);
    const track = view.releasePanels.find((r) => r.item.id === tracks[0]);
    assert.ok(track.facts.find((f) => f.label === labels.trackOf).html.includes(`href="#${album.anchor}"`), lang);
  }
});

test('programme segments are listed as segments, and a track of an album not credited to the artist keeps its card', () => {
  const artist = published.items.Qyw49hh;
  const labels = JSON.parse(readFileSync('src/strings/en.json', 'utf8')).release;
  const view = artistView(published, artist, 'en');
  const shelf = new Set(view.shelf.map((r) => r.item.id));
  const own = new Set(view.releases.map((r) => r.item.id));
  for (const r of view.releases) {
    const wholes = ['track of', 'programme segment of'].flatMap((p) => best(r.item.statements[p]).map((s) => s.value));
    if (wholes.length && !wholes.some((w) => own.has(w))) assert.ok(shelf.has(r.item.id), r.item.id);
  }
  const programmes = view.releasePanels.filter((p) => p.facts.some((f) => f.label === labels.segments));
  assert.ok(programmes.length > 0);
  for (const p of programmes) assert.ok(!p.facts.some((f) => f.label === labels.tracks) || p.item.incoming.some((i) => i.property === 'track of'));
});

test('components follow their source numbers, else one source\'s quote order, else numbered ones first', () => {
  const part = (id, position) => ({ id, positions: { W: position } });
  const order = (parts) => { const sourced = orderParts(parts, 'W'); return [parts.map((p) => p.id), sourced]; };
  assert.deepEqual(order([part('a', { source: 's', number: 3, at: 1 }), part('b', { source: 't', number: 1 })]), [['b', 'a'], true]);
  assert.deepEqual(order([part('a', { source: 's', at: 9 }), part('b', { source: 's', number: 1, at: 4 })]), [['b', 'a'], true]);
  assert.deepEqual(order([part('a', { source: 's', at: 9 }), part('b', { source: 't', at: 4 })]), [['a', 'b'], false]);
  assert.deepEqual(order([{ id: 'c' }, part('a', { source: 's', number: 2 }), part('b', { source: 't', number: 1 })]), [['b', 'a', 'c'], false]);
});

test('a track on two of the artist\'s albums is listed on both, and the list is cited', () => {
  const record = structuredClone(published);
  const artist = record.items.Qhebfsp;
  const [album, other] = catalogueReleasesOf(record, artist).filter((r) => r.incoming.some((i) => i.property === 'track of'));
  const track = record.items[album.incoming.find((i) => i.property === 'track of').item];
  track.statements['track of'].push({ ...track.statements['track of'][0], value: other.id });
  const view = artistView(record, artist, 'en');
  const labels = JSON.parse(readFileSync('src/strings/en.json', 'utf8')).release;
  for (const whole of [album, other]) {
    const listed = view.releasePanels.find((r) => r.item.id === whole.id).facts.find((f) => f.label === labels.tracks);
    assert.ok(listed.html.includes(`href="#${track.anchor}"`), whole.id);
    assert.ok(listed.html.includes('class="cite"'), whole.id);
  }
  assert.ok(!view.shelf.some((r) => r.item.id === track.id));
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

test('recordings fall back to a labeled platform date without changing release dates', () => {
  const date = (value) => ({ date: value, calendar: 'gregorian', precision: 'day', range: [value, value] });
  const post = date('2018-04-27');
  const issued = date('2017-05-01');
  const by = (id, statements) => ({ id, statements });
  const posted = by('posted', { 'platform posting date': [{ value: post, rank: 'normal' }] });
  const released = by('released', { ...posted.statements, 'release date': [{ value: issued, rank: 'normal' }] });
  const undated = by('undated', {});
  assert.deepEqual(releaseDates(posted), []);
  assert.deepEqual(recordingDates(posted), { values: [post], isPosting: true });
  assert.deepEqual(recordingDates(released), { values: [issued], isPosting: false });
  assert.deepEqual([undated, posted, released].sort(byRecordingDate).map(({ id }) => id), ['released', 'posted', 'undated']);
});

test('the homepage shelf holds whole records, newest first, one per artist', () => {
  const shelf = newRecords(published, 12);
  assert.equal(shelf.length, 12);
  const hosts = shelf.map((r) => creditedReleaseHost(published, r)?.id);
  assert.ok(hosts.every(Boolean));
  assert.equal(new Set(hosts).size, shelf.length);
  for (const r of shelf) {
    const types = best(r.statements['release type']).map((s) => s.value);
    assert.ok(types.some((t) => ['album', 'ep', 'live album', 'soundtrack'].includes(t)) && !types.includes('single') && !types.includes('compilation'), r.id);
    assert.ok(releaseDates(r).length > 0 && best(r.statements['cover art']).some((s) => /^https?:\/\//.test(s.value)), r.id);
  }
  assert.deepEqual(shelf, [...shelf].sort(byRecordingDate).reverse());
});
test('a trailing EP marker leaves the shelf title, never the whole title', () => {
  const name = (text) => ({ text, language: 'en' });
  assert.equal(withoutEpMarker(name('Structura I - EP')).text, 'Structura I');
  assert.equal(withoutEpMarker(name('Vittrine (EP)')).text, 'Vittrine');
  assert.equal(withoutEpMarker(name('Deep EP')).text, 'Deep EP');
  assert.equal(withoutEpMarker(name('(EP)')).text, '(EP)');
});


test('component JSON-LD distinguishes tracks, historical compilation parents and programme segments in both languages', () => {
  const site = new URL('https://example.org');
  const artist = published.items.Qyw49hh;
  const nodes = (record, lang) => artistJsonLd(record, artist, lang, site)['@graph']
    .flatMap((node) => [node, ...(node.album ?? []), ...(node.track ?? [])]);
  for (const lang of ['en', 'fa']) {
    const graph = nodes(published, lang);
    const entry = (id) => graph.find((node) => node.url?.endsWith('#' + published.items[id].anchor));
    for (const [id, parent] of [['Qtseyat', 'Qbfzmwg'], ['Q2ea9bv', 'Qmx2hcr']]) {
      const track = entry(id);
      assert.equal(track['@type'], 'MusicRecording');
      const host = published.items[published.panelHosts[parent]];
      assert.deepEqual(track.inAlbum.map((album) => [album['@type'], album.url]), [
        ['MusicAlbum', `https://example.org/${lang}/${host.page}/#${published.items[parent].anchor}`],
      ]);
    }
    assert.equal(entry('Qmx2hcr'), undefined, 'historical compilation panel must not become an artist catalogue credit');
    assert.equal(entry('Qs6vktc')['@type'], 'MusicRecording');
    assert.equal(entry('Qs6vktc').inAlbum, undefined);
    // A separately issued single stays an edition; a title is not album membership.
    const single = Object.values(published.items).find((r) => r.type === 'release'
      && best(r.statements['release type']).some((s) => s.value === 'single')
      && !best(r.statements['track of']).length && !best(r.statements['programme segment of']).length
      && recordingArtists(published, r).some((person) => person.page));
    assert.ok(single);
    const singleArtist = recordingArtists(published, single).find((person) => person.page);
    const singleNode = artistJsonLd(published, singleArtist, lang, site)['@graph']
      .flatMap((node) => [node, ...(node.album ?? []), ...(node.track ?? [])])
      .find((node) => node.url?.endsWith('#' + single.anchor));
    assert.equal(singleNode['@type'], 'MusicAlbum');
    assert.equal(singleNode.inAlbum, undefined);

    const otherHost = Object.values(published.items).find((item) => item.page && item.id !== artist.id);
    const crossHost = { ...published, panelHosts: { ...published.panelHosts, Qmx2hcr: otherHost.id } };
    const crossTrack = nodes(crossHost, lang).find((node) => node.url?.endsWith('#' + published.items.Q2ea9bv.anchor));
    assert.equal(crossTrack.inAlbum[0].url, `https://example.org/${lang}/${otherHost.page}/#${published.items.Qmx2hcr.anchor}`);

    // A typed album that is itself a component is not an evidenced whole album.
    const parent = structuredClone(published.items.Qmx2hcr);
    parent.statements['programme segment of'] = [{ rank: 'normal', value: 'Qsjwcjr', references: [] }];
    const chained = { ...published, items: { ...published.items, Qmx2hcr: parent } };
    assert.equal(nodes(chained, lang).find((node) => node.url?.endsWith('#' + published.items.Q2ea9bv.anchor)).inAlbum, undefined);
    delete parent.statements['programme segment of'];
    delete parent.statements['release type'];
    assert.equal(nodes(chained, lang).find((node) => node.url?.endsWith('#' + published.items.Q2ea9bv.anchor)).inAlbum, undefined);
  }
});

test('a group lists component recordings as tracks rather than albums', () => {
  const group = Object.values(published.items).find((item) => item.type === 'act' && item.page
    && catalogueReleasesOf(published, item).some((r) => best(r.statements['track of']).some((s) => published.items[s.value])));
  assert.ok(group);
  for (const lang of ['en', 'fa']) {
    const graph = artistJsonLd(published, group, lang, new URL('https://example.org'))['@graph'];
    assert.ok(graph[0].track.length);
    assert.ok(graph[0].track.every((node) => node['@type'] === 'MusicRecording'));
    assert.ok((graph[0].album ?? []).every((node) => node['@type'] === 'MusicAlbum'));
  }
});
