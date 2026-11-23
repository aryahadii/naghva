import type { Sky } from './star-map';

/** Places in `/sky.json` are whole numbers out of this (SCALE in star-map.ts). */
const SCALE = 100_000;

/** The sky as the star map reads it in one language, from `/sky.json`. */

type Lang = 'en' | 'fa';

export interface SkyStar {
  /** Its name in an address: an artist page's slug, a recording's panel, or else its ID. */
  key: string;
  kind: 'artist' | 'recording';
  /** An artist that is a group, not a person. */
  group: boolean;
  /** An artist with a page of its own. */
  page: boolean;
  x: number;
  y: number;
  name: string;
  /** The name in the other script, when it differs. */
  alternate: string;
  href: string | null;
  /** The stars it is linked to, by their place in the list. */
  links: number[];
  image: string | null;
  /** The few facts a card shows, already in the page's language. */
  place: string;
  years: string;
  by: string;
}

const PERSIAN = /[؀-ۿ]/;
/** The language a name is written in, for its font and direction. */
export const scriptOf = (text: string): Lang => (PERSIAN.test(text) ? 'fa' : 'en');

export const digits = (lang: Lang, n: number): string =>
  new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { useGrouping: false }).format(n);

export function readSky(sky: Sky, lang: Lang): SkyStar[] {
  const own = lang === 'en' ? 0 : 1;
  const name = (names: [string | null, string | null]) => names[own] ?? names[1 - own] ?? '';
  const list = new Intl.ListFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { type: 'conjunction' });
  // The file writes each link once, on the earlier star.
  const links: number[][] = sky.stars.map(() => []);
  sky.stars.forEach((entry, index) => {
    for (const other of entry.l) {
      links[index].push(other);
      links[other].push(index);
    }
  });
  return sky.stars.map((entry, index) => {
    const main = name(entry.n);
    const other = entry.n[1 - own];
    const years = entry.d?.slice(own * (entry.d.length / 2), (own + 1) * (entry.d.length / 2)) ?? [];
    return {
      key: entry.h ? entry.h.replace(/^.*#|\//g, '') : entry.i!,
      kind: entry.k === 'r' ? 'recording' : 'artist',
      group: entry.k === 'g',
      page: entry.k !== 'r' && Boolean(entry.h),
      x: entry.x / SCALE,
      y: entry.y / SCALE,
      name: main,
      alternate: other && other !== main ? other : '',
      href: entry.h ? `/${lang}${entry.h}` : null,
      links: links[index],
      image: entry.m ?? null,
      place: entry.p === undefined ? '' : name(sky.places[entry.p]),
      years: [...new Set(years)].map((year) => digits(lang, year)).join('–'),
      by: list.format((entry.b ?? []).map((index) => name(sky.stars[index].n))),
    };
  });
}
