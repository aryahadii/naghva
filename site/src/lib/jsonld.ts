import { isoDate } from './dates';
import { strings } from './i18n';
import { addressOf, COVER_WIDTHS, imageOf, type LinkedImage } from './images';
import {
  best, COMPONENT_PROPERTIES, datesDisagree, href, isDate, isText, nameOf, recordingArtists, releaseDates, catalogueReleasesOf, REPOSITORY, url,
  type Item, type Lang, type SiteRecord, type Text,
} from './record';

/** Structured data for search engines, in schema.org terms. */

const names = (item: Item, lang: Lang) => {
  const main = nameOf(item, lang).text;
  const all = (item.statements.name ?? [])
    .filter((s) => s.rank !== 'deprecated' && isText(s.value))
    .map((s) => (s.value as Text).text);
  const alternate = [...new Set(all)].filter((n) => n !== main);
  return alternate.length ? { name: main, alternateName: alternate } : { name: main };
};

/** An image as schema.org has it: its address, with who made it and its license when the record says. */
const imageLd = (image: LinkedImage, site: URL) =>
  image.credit || image.license
    ? {
        '@type': 'ImageObject',
        contentUrl: addressOf(image, site),
        ...(image.credit ? { creditText: image.credit.text } : {}),
        ...(image.license ? { license: image.license } : {}),
      }
    : addressOf(image, site);

const linked = (record: SiteRecord, statements: Item['statements'][string] | undefined) =>
  best(statements).map((s) => record.items[s.value as string]).filter((x): x is Item => Boolean(x));

/**
 * `photo` is the artist's photo when the page shows one, and `description` the page's one-line summary.
 * The artist's own profiles go in `sameAs`, so a search engine can tell which person or band this is.
 */
export function artistJsonLd(
  record: SiteRecord, artist: Item, lang: Lang, site: URL, photo: LinkedImage | null = null, description: string | null = null,
) {
  const page = new URL(url(lang, artist.page), site).href;
  const id = `${page}#artist`;
  const at = (item: Item) => (item.page ? { url: new URL(url(lang, item.page), site).href } : {});
  const node: { [key: string]: unknown } = {
    '@type': artist.type === 'person' ? 'Person' : 'MusicGroup',
    '@id': id,
    ...names(artist, lang),
    url: page,
    ...(description ? { description } : {}),
    ...(photo ? { image: imageLd(photo, site) } : {}),
  };
  const profiles = [...new Set((artist.statements['profile link'] ?? [])
    .filter((s) => s.rank !== 'deprecated').map((s) => String(s.value)))];
  if (profiles.length) node.sameAs = profiles;
  if (artist.type === 'person') {
    const born = best(artist.statements['birth date']).find((s) => isDate(s.value));
    const date = born && isDate(born.value) ? isoDate(born.value) : null;
    if (date) node.birthDate = date;
    const place = linked(record, artist.statements.birthplace)[0];
    if (place) node.birthPlace = { '@type': 'Place', name: nameOf(place, lang).text };
    const acts = linked(record, artist.statements['member of']);
    if (acts.length) node.memberOf = acts.map((a) => ({ '@type': 'MusicGroup', name: nameOf(a, lang).text, ...at(a) }));
  } else {
    const formed = (artist.statements['formation date'] ?? []).filter((s) => s.rank !== 'deprecated')
      .map((s) => s.value).filter(isDate);
    const date = formed.length && !datesDisagree(formed) ? isoDate(formed[0]) : null;
    if (date) node.foundingDate = date;
    const members = artist.incoming
      .filter((i) => i.property === 'member of' && i.rank !== 'deprecated')
      .map((i) => record.items[i.item])
      .filter((x): x is Item => Boolean(x));
    if (members.length) node.member = [...new Map(members.map((m) => [m.id, m])).values()].map((m) => ({ '@type': 'Person', ...names(m, lang), ...at(m) }));
  }
  const catalogue = catalogueReleasesOf(record, artist);
  const isComponent = (r: Item) => COMPONENT_PROPERTIES.some((property) =>
    linked(record, r.statements[property]).some((parent) => parent.type === 'release'));
  const albumTypes = new Set(['album', 'ep', 'compilation', 'soundtrack', 'live album']);
  const releases = catalogue.map((r) => {
    const released = releaseDates(r);
    const date = released.length && !datesDisagree(released) ? isoDate(released[0]) : null;
    const listen = (r.statements['listen link'] ?? []).filter((s) => s.rank !== 'deprecated').map((s) => String(s.value));
    const cover = imageOf(r, 'cover art', COVER_WIDTHS);
    const component = isComponent(r);
    // Storage also holds films and videos; unknown form is not an album.
    const musical = component || best(r.statements['release type']).some((s) =>
      albumTypes.has(s.value as string) || s.value === 'single');
    const inAlbum = linked(record, r.statements['track of'])
      .filter((parent) => parent.type === 'release' && parent.id !== r.id
        && best(parent.statements['release type']).some((s) => albumTypes.has(s.value as string))
        && !COMPONENT_PROPERTIES.some((property) => best(parent.statements[property]).some((s) => s.value !== 'no value')))
      .flatMap((parent) => {
        const path = href(record, lang, parent);
        return path ? [{ '@type': 'MusicAlbum', ...names(parent, lang), url: new URL(path, site).href }] : [];
      });
    return {
      '@type': component ? 'MusicRecording' : musical ? 'MusicAlbum' : 'CreativeWork',
      ...names(r, lang),
      url: `${page}#${encodeURIComponent(r.anchor ?? r.id)}`,
      ...(musical ? { byArtist: recordingArtists(record, r).map((p) => p.id === artist.id ? { '@id': id } : {
        '@type': p.type === 'act' ? 'MusicGroup' : 'Person',
        ...names(p, lang),
        ...(p.page ? { '@id': `${new URL(url(lang, p.page), site).href}#artist`, ...at(p) } : {}),
      }) } : {}),
      ...(component && inAlbum.length ? { inAlbum } : {}),
      ...(date ? { datePublished: date } : {}),
      ...(cover ? { image: imageLd(cover, site) } : {}),
      ...(listen.length ? { sameAs: [...new Set(listen)] } : {}),
    };
  });
  // Group catalogue links use the schema property for each kind of record.
  const groupReleases = new Set(artist.type === 'act' ? artist.releases : []);
  const groupAlbums = releases.filter((r, index) => r['@type'] === 'MusicAlbum' && groupReleases.has(catalogue[index].id));
  const groupTracks = releases.filter((r, index) => r['@type'] === 'MusicRecording' && groupReleases.has(catalogue[index].id));
  const standalone = releases.filter((r, index) => r['@type'] === 'CreativeWork' || !groupReleases.has(catalogue[index].id));
  if (groupAlbums.length) node.album = groupAlbums;
  if (groupTracks.length) node.track = groupTracks;

  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: strings(lang).siteName, item: new URL(url(lang), site).href },
      { '@type': 'ListItem', position: 2, name: nameOf(artist, lang).text, item: page },
    ],
  };
  return { '@context': 'https://schema.org', '@graph': [node, ...standalone, breadcrumbs] };
}

/** Where Naghva is kept besides its own site; a search engine reads these as the same organisation. */
const NAGHVA_ELSEWHERE = [REPOSITORY];

/**
 * The site and who publishes it, under both names: a search engine takes the site's name from
 * the WebSite, and learns that «نغوا» and Naghva are one thing from the Organization.
 * `logo` is the address of the Naghva imprint.
 */
export function siteJsonLd(lang: Lang, site: URL, logo: string | null = null) {
  const t = strings(lang);
  const home = new URL('/', site).href;
  const named = {
    name: strings('en').siteName,
    alternateName: [strings('fa').siteName, 'نقوا'],
    url: home,
    description: t.homeDescription,
  };
  const organization = {
    '@type': 'Organization',
    '@id': `${home}#organization`,
    ...named,
    ...(logo ? { logo } : {}),
    sameAs: NAGHVA_ELSEWHERE,
  };
  const website = {
    '@type': 'WebSite',
    '@id': `${home}#website`,
    ...named,
    inLanguage: ['en', 'fa'],
    publisher: { '@id': organization['@id'] },
  };
  return { '@context': 'https://schema.org', '@graph': [website, organization] };
}
