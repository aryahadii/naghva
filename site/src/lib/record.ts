import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { performs } from './roles';
import { compareDates } from './catalogue';

/** The record tools/derive.py writes; the site reads nothing else. */

export type Lang = 'en' | 'fa';
/** Where the record and the site's code are published. */
export const REPOSITORY = 'https://github.com/aryahadii/naghva';
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
  /** A name spelled by Naghva for display; its references support the original name. */
  editorial?: true;
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
  /** A release's credited host: the artist whose page shows it (derive). */
  host?: string;
  /** An artist's releases: performed on or hosted (derive). */
  releases?: string[];
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
  kind: 'release' | 'component' | 'posting' | 'formation' | 'event' | 'joined' | 'left' | 'life';
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
  /** Each role term's kind, from the registry's `creation roles`. */
  roles: { [role: string]: 'performance' | 'creation' };
  /** The registry's listening platforms: key and the hosts it answers at. */
  platforms: { [key: string]: string[] };
  /** The Statistics page's counts, made by tools/stats.py. */
  stats: any;
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

/** The artist page that shows a release: the credited one derive chose, else
 * the page that showed it before (panelHosts), so its address keeps working. */
export function releaseHost(record: SiteRecord, release: Item): Item | undefined {
  const host = record.items[record.panelHosts?.[release.id] ?? ''];
  return host?.page ? host : undefined;
}

/** The credited artist (or a documented member of a credited act) whose page shows a release. */
export function creditedReleaseHost(record: SiteRecord, release: Item): Item | undefined {
  return release.host ? record.items[release.host] : undefined;
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

/** The releases an artist performs on or whose panel its page hosts, oldest first. */
export function releasesOf(record: SiteRecord, artist: Item): Item[] {
  return (artist.releases ?? []).map((id) => record.items[id]).filter((x): x is Item => Boolean(x)).sort(byRecordingDate);
}

/** The catalogue includes work the artist wrote, arranged or produced. */
export function catalogueReleasesOf(record: SiteRecord, artist: Item): Item[] {
  const ids = new Set(artist.releases ?? []);
  for (const credit of artist.incoming) {
    if (credit.property !== 'contributor') continue;
    const release = record.items[credit.item];
    if (release?.type === 'release' && best(release.statements.contributor).some((s) => s.value === artist.id)) {
      ids.add(release.id);
    }
  }
  return [...ids].map((id) => record.items[id]).filter((item): item is Item => Boolean(item)).sort(byRecordingDate);
}

/** Include historical panels without adding them to the artist's recordings. */
export function panelReleasesOf(record: SiteRecord, artist: Item, releases = catalogueReleasesOf(record, artist)): Item[] {
  const ids = new Set(releases.map((release) => release.id));
  for (const [releaseId, artistId] of Object.entries(record.panelHosts ?? {})) {
    const release = record.items[releaseId];
    if (artistId === artist.id && release?.type === 'release' && releaseHost(record, release)?.id === artist.id) ids.add(releaseId);
  }
  return [...ids].map((id) => record.items[id]).sort(byRecordingDate);
}

/** Keep active source alternatives; an array's order is not a date decision. */
export function releaseDates(release: Item): DateValue[] {
  return recordingDatesFor(release, 'release date');
}

function recordingDatesFor(release: Item, property: 'release date' | 'platform posting date'): DateValue[] {
  return (release.statements[property] ?? []).filter((s) => s.rank !== 'deprecated')
    .sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'))
    .map((s) => s.value).filter(isDate)
    .filter((d, i, all) => all.findIndex((v) => v.date === d.date && v.calendar === d.calendar) === i)
}

/** Display and sort dates are not claims about release history. */
export function recordingDates(release: Item): { values: DateValue[]; isPosting: boolean } {
  const released = releaseDates(release);
  return released.length
    ? { values: released, isPosting: false }
    : { values: recordingDatesFor(release, 'platform posting date'), isPosting: true };
}

export function recordingDate(release: Item): DateValue | undefined {
  return recordingDates(release).values.reduce<DateValue | undefined>(
    (earliest, date) => !earliest || date.range[0] < earliest.range[0] ? date : earliest, undefined);
}

export function datesDisagree(dates: DateValue[]): boolean {
  return dates.some((a) => dates.some((b) => a.range[1] < b.range[0] || b.range[1] < a.range[0]));
}

export function byRecordingDate(a: Item, b: Item): number {
  return compareDates({ id: a.id, date: recordingDate(a)?.range[0] }, { id: b.id, date: recordingDate(b)?.range[0] });
}

/** Release types that make a whole record: what a newcomer can take in at a glance. */
const WHOLE_RECORDS = new Set(['album', 'ep', 'live album', 'soundtrack']);

/** The homepage's new records: whole records with a release date and cover art, newest
 * first, one per credited host, so one prolific artist doesn't fill the row. Tracks, singles,
 * compilations of earlier work, clips and uploads dated only by posting stay on artist pages
 * and the Timeline. Keying on the credited host means a record whose page is only a former
 * host can never take an artist's slot. */
export function newRecords(record: SiteRecord, limit: number): Item[] {
  const candidates = Object.values(record.items).filter((i) => {
    const types = best(i.statements['release type']).map((s) => s.value as string);
    return i.type === 'release' && types.some((t) => WHOLE_RECORDS.has(t)) && !types.includes('single') && !types.includes('compilation')
      && releaseDates(i).length > 0 && Boolean(creditedReleaseHost(record, i))
      // A release's link is the same in both languages, so either one answers whether it has one.
      && Boolean(href(record, 'en', i))
      && best(i.statements['cover art']).some((s) => typeof s.value === 'string' && /^https?:\/\//.test(s.value));
  }).sort(byRecordingDate).reverse();
  const shelf: Item[] = [];
  const hosts = new Set<string>();
  for (const release of candidates) {
    if (shelf.length === limit) break;
    const host = creditedReleaseHost(record, release)!.id;
    if (hosts.has(host)) continue;
    hosts.add(host);
    shelf.push(release);
  }
  return shelf;
}

/** The names for a short line about a release, such as a shelf card: anyone credited without a role, and `also`,
 * the artist the line belongs to, when the release credits them as a performer. Players credited only for an
 * instrument or part stay off the line. With neither, the release's recording artists. */
export function cardArtists(record: SiteRecord, release: Item, also?: Item): Item[] {
  const credits = best(release.statements.performer);
  const named = performers(record, release).filter((person) =>
    person.id === also?.id || credits.some((s) => s.value === person.id && !s.qualifiers?.role?.length));
  return named.length ? named : recordingArtists(record, release);
}

/** A title without a trailing EP marker, for a shelf that already presents whole records
 * (in Persian, آلبوم covers EPs too). */
export function withoutEpMarker(title: Text): Text {
  const text = title.text.replace(/\s*(?:[-–—]\s*EP|\(EP\)|\[EP\])$/i, '');
  return text ? { ...title, text } : title;
}

export function artistPages(record: SiteRecord): Item[] {
  return record.artists.map((id) => record.items[id]).filter((x): x is Item => Boolean(x?.page));
}
