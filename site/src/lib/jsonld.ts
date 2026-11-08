import { isoDate } from './dates';
import { strings } from './i18n';
import { COVER_WIDTHS, imageOf, type LinkedImage } from './images';
import {
  best, datesDisagree, isDate, isText, nameOf, recordingArtists, releaseDates, releasesOf, url,
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
const imageLd = (image: LinkedImage) =>
  image.credit || image.license
    ? {
        '@type': 'ImageObject',
        contentUrl: image.url,
        ...(image.credit ? { creditText: image.credit.text } : {}),
        ...(image.license ? { license: image.license } : {}),
      }
    : image.url;

const linked = (record: SiteRecord, statements: Item['statements'][string] | undefined) =>
  best(statements).map((s) => record.items[s.value as string]).filter((x): x is Item => Boolean(x));

/** `photo` is the artist's photo when the page shows one. */
export function artistJsonLd(record: SiteRecord, artist: Item, lang: Lang, site: URL, photo: LinkedImage | null = null) {
  const page = new URL(url(lang, artist.page), site).href;
  const id = `${page}#artist`;
  const at = (item: Item) => (item.page ? { url: new URL(url(lang, item.page), site).href } : {});
  const node: { [key: string]: unknown } = {
    '@type': artist.type === 'person' ? 'Person' : 'MusicGroup',
    '@id': id,
    ...names(artist, lang),
    url: page,
    ...(photo ? { image: imageLd(photo) } : {}),
  };
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
  const albums = releasesOf(record, artist).map((r) => {
    const released = releaseDates(r);
    const date = released.length && !datesDisagree(released) ? isoDate(released[0]) : null;
    const listen = (r.statements['listen link'] ?? []).filter((s) => s.rank !== 'deprecated').map((s) => String(s.value));
    const cover = imageOf(r, 'cover art', COVER_WIDTHS);
    return {
      '@type': 'MusicAlbum',
      ...names(r, lang),
      url: `${page}#${encodeURIComponent(r.anchor ?? r.id)}`,
      byArtist: recordingArtists(record, r).map((p) => p.id === artist.id ? { '@id': id } : {
        '@type': p.type === 'act' ? 'MusicGroup' : 'Person',
        ...names(p, lang),
        ...(p.page ? { '@id': `${new URL(url(lang, p.page), site).href}#artist`, ...at(p) } : {}),
      }),
      ...(date ? { datePublished: date } : {}),
      ...(cover ? { image: imageLd(cover) } : {}),
      ...(listen.length ? { sameAs: [...new Set(listen)] } : {}),
    };
  });
  // A group lists its albums; a person's releases stand beside them with their recorded performers.
  const standalone = artist.type === 'person' ? albums : [];
  if (albums.length && artist.type !== 'person') node.album = albums;

  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: strings(lang).siteName, item: new URL(url(lang), site).href },
      { '@type': 'ListItem', position: 2, name: nameOf(artist, lang).text, item: page },
    ],
  };
  return { '@context': 'https://schema.org', '@graph': [node, ...standalone, breadcrumbs] };
}

export function siteJsonLd(lang: Lang, site: URL) {
  const t = strings(lang);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: strings('en').siteName,
    alternateName: [strings('fa').siteName, 'نقوا'],
    url: new URL('/', site).href,
    inLanguage: ['en', 'fa'],
    description: t.homeDescription,
  };
}
