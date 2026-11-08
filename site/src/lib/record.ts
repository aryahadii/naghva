import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { performs } from './roles';
import { compareDates } from './catalogue';

/** The record tools/derive.py writes; the site reads nothing else. */

export type Lang = 'en' | 'fa';
export const LANGS: Lang[] = ['en', 'fa'];

export interface Text { text: string; language: string }
export interface DateValue {
  date: string;
  calendar?: 'gregorian' | 'jalali';
  range: [string, string];
  /** The full precision ranges of both source endpoints of an interval. */
  endpoints?: [DateValue, DateValue];
}
export type Value = string | Text | DateValue;

export interface Reference { source: string; quote: string; accessed: string; locator?: string }
export interface Statement {
  value: Value;
  rank: 'preferred' | 'normal' | 'deprecated';
  qualifiers?: Record<string, Value[]>;
  references: Reference[];
}
export interface Incoming { property: string; item: string; rank: Statement['rank']; qualifiers?: Record<string, Value[]> }

export interface Item {
  id: string;
  type: 'person' | 'act' | 'release' | 'organization' | 'event' | 'place';
  names: Record<Lang, Text | null>;
  statements: Record<string, Statement[]>;
  incoming: Incoming[];
  page?: string;
  anchor?: string;
}

export interface Note extends Reference { key: string }
export interface Article {
  lead: string;
  sections: { heading: string; anchor: string; markdown: string }[];
  notes: Note[];
}

export interface Source {
  title: string;
  url?: string;
  publisher?: string;
  author?: string;
  issued?: DateValue | string;
  archive?: string;
  language?: string;
  kind?: string;
}

export interface TimelineEntry {
  anchor: string;
  kind: 'release' | 'formation' | 'event' | 'joined' | 'left' | 'life';
  item: string;
  about: string[];
  date: DateValue;
  alternatives?: DateValue[];
  /** A life event's own words, in the source's language. */
  text?: Text;
}

export interface SiteRecord {
  examples: boolean;
  languages: Lang[];
  artists: string[];
  items: { [id: string]: Item };
  articles: { [id: string]: Partial<{ [lang in Lang]: Article }> };
  sources: { [name: string]: Source };
  timeline: TimelineEntry[];
  redirects: { from: string; to: string }[];
  /** Every release panel address ever issued, and the release it belongs to. */
  panels: { [anchor: string]: string };
  /** Routing history for panels whose former artist credit was corrected. */
  panelHosts?: { [release: string]: string };
}

// npm scripts run in site/, so the record is found from there however the build bundles this file.
const file = resolve(process.env.NAGHVA_RECORD ?? 'generated/record.json');
let cached: { mtime: number; record: SiteRecord } | undefined;

export function loadRecord(): SiteRecord {
  const mtime = statSync(file).mtimeMs;
  if (!cached || cached.mtime !== mtime) {
    cached = { mtime, record: JSON.parse(readFileSync(file, 'utf8')) };
  }
  return cached.record;
}

// --- Statements -----------------------------------------------------------------

/** The statements a page shows first: the preferred ones, else every normal one. */
export function best(statements: Statement[] | undefined): Statement[] {
  const all = statements ?? [];
  const preferred = all.filter((s) => s.rank === 'preferred');
  return preferred.length ? preferred : all.filter((s) => s.rank === 'normal');
}

export const isDate = (v: Value | undefined): v is DateValue => typeof v === 'object' && v !== null && 'range' in v;
export const isText = (v: Value | undefined): v is Text => typeof v === 'object' && v !== null && 'text' in v;

/** The name to show on a page in `lang`; derive has already fallen back to the other script. */
export function nameOf(item: Item, lang: Lang): Text {
  return item.names[lang] ?? item.names[lang === 'en' ? 'fa' : 'en'] ?? { text: item.id, language: 'en' };
}

/** The name in the other script, when it differs: shown beside the main one. */
export function otherName(item: Item, lang: Lang): Text | null {
  const main = nameOf(item, lang);
  const other = item.names[lang === 'en' ? 'fa' : 'en'];
  return other && other.text !== main.text ? other : null;
}

export function url(lang: Lang, page = ''): string {
  return page ? `/${lang}/${page}/` : `/${lang}/`;
}

/** Where an item is shown: its own page, or the panel on its first performer's page. */
export function href(record: SiteRecord, lang: Lang, item: Item): string | null {
  if (item.page) return url(lang, item.page);
  if (item.type === 'release') {
    const artist = releaseHost(record, item);
    if (artist && item.anchor) return `${url(lang, artist.page)}#${item.anchor}`;
  }
  if (item.type === 'event') {
    const artist = performers(record, item).find((p) => p.page);
    if (artist) return `${url(lang, artist.page)}#events`;
  }
  // A credit without its own article remains plain text, not a link to a collaborator.
  return null;
}

/** Prefer a credited artist's page. A band without a page can be shown on a
 * documented member's page, while retaining the band's own performer credit. */
export function releaseHost(record: SiteRecord, release: Item): Item | undefined {
  const current = creditedReleaseHost(record, release);
  if (current) return current;
  const former = record.items[record.panelHosts?.[release.id] ?? ''];
  return former?.page ? former : undefined;
}

export function creditedReleaseHost(record: SiteRecord, release: Item): Item | undefined {
  const credited = performers(record, release);
  const direct = credited.find((p) => p.page);
  if (direct) return direct;
  return credited.flatMap((act) => act.type === 'act'
    ? act.incoming.filter((i) => i.property === 'member of' && i.rank !== 'deprecated')
      .map((i) => record.items[i.item]) : []).find((p) => p?.page);
}

export function performers(record: SiteRecord, release: Item): Item[] {
  return best(release.statements.performer)
    .map((s) => record.items[s.value as string])
    .filter((x): x is Item => Boolean(x))
    .filter((x, i, all) => all.findIndex((p) => p.id === x.id) === i);
}

/** Who wrote, arranged or produced a release: its `contributor` credits, each once. */
export function contributors(record: SiteRecord, release: Item): Item[] {
  return best(release.statements.contributor)
    .map((s) => record.items[s.value as string])
    .filter((x): x is Item => Boolean(x))
    .filter((x, i, all) => all.findIndex((p) => p.id === x.id) === i);
}

/** Preserve explicit artist billing as its own unqualified statement, alongside
 * qualified contributions. Writing-only and producer-only rows stay in the full
 * panel; their reference text cannot establish a separate billing claim here. */
export function recordingArtists(record: SiteRecord, release: Item): Item[] {
  const credits = best(release.statements.performer);
  return performers(record, release).filter((person) => {
    const own = credits.filter((s) => s.value === person.id);
    if (own.some((s) => !s.qualifiers?.role?.length)) return true;
    const roles = own.flatMap((s) => s.qualifiers?.role ?? []);
    return roles.some(performs);
  });
}

/** The releases an artist performs on, oldest first. */
export function releasesOf(record: SiteRecord, artist: Item): Item[] {
  const ids = new Set(artist.incoming.filter((i) => i.property === 'performer'
    && record.items[i.item]?.type === 'release'
    && best(record.items[i.item].statements.performer).some((s) => s.value === artist.id)).map((i) => i.item));
  for (const release of Object.values(record.items)) {
    if (release.type === 'release' && creditedReleaseHost(record, release)?.id === artist.id) ids.add(release.id);
  }
  return [...ids].map((id) => record.items[id]).filter((x): x is Item => Boolean(x)).sort(byReleaseDate);
}

/** Include historical panels without adding them to the artist's recordings. */
export function panelReleasesOf(record: SiteRecord, artist: Item): Item[] {
  const releases = releasesOf(record, artist);
  const ids = new Set(releases.map((release) => release.id));
  for (const [releaseId, artistId] of Object.entries(record.panelHosts ?? {})) {
    const release = record.items[releaseId];
    if (artistId === artist.id && release?.type === 'release' && releaseHost(record, release)?.id === artist.id) ids.add(releaseId);
  }
  return [...ids].map((id) => record.items[id]).sort(byReleaseDate);
}

export function releaseDate(release: Item): DateValue | undefined {
  // A stable chronological sort key, not a choice between source claims.
  return [...releaseDates(release)].sort((a, b) => a.range[0].localeCompare(b.range[0]))[0];
}

/** Keep active source alternatives; an array's order is not a date decision. */
export function releaseDates(release: Item): DateValue[] {
  return (release.statements['release date'] ?? []).filter((s) => s.rank !== 'deprecated')
    .sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'))
    .map((s) => s.value).filter(isDate)
    .filter((d, i, all) => all.findIndex((v) => v.date === d.date && v.calendar === d.calendar) === i)
}

export function datesDisagree(dates: DateValue[]): boolean {
  return dates.some((a) => dates.some((b) => a.range[1] < b.range[0] || b.range[1] < a.range[0]));
}

export function byReleaseDate(a: Item, b: Item): number {
  return compareDates({ id: a.id, date: releaseDate(a)?.range[0] }, { id: b.id, date: releaseDate(b)?.range[0] });
}

export function artistPages(record: SiteRecord): Item[] {
  return record.artists.map((id) => record.items[id]).filter((x): x is Item => Boolean(x?.page));
}
