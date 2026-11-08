import { fill, num, strings } from './i18n';
import type { DateValue, Lang } from './record';

/**
 * Dates are shown in the page's calendar: Gregorian on English pages, Jalali
 * on Persian ones. A date keeps its source's precision, so a Jalali month
 * reads as the Gregorian months it covers; the date as the source gave it
 * is kept for the tooltip.
 */

type Precision = 'day' | 'month' | 'year' | 'decade';
interface Parts { y: number; m: number; d: number }

const calendarOf = (lang: Lang) => (lang === 'fa' ? 'persian' : 'gregory');

function precision(date: string): Precision {
  const first = date.split('/')[0].replace(/[~?%]$/, '');
  if (first.endsWith('X')) return 'decade';
  return (['year', 'month', 'day'] as const)[first.split('-').length - 1];
}

const utc = (iso: string) => new Date(iso + 'T12:00:00Z');

/** Year, month and day of a Gregorian ISO day in the page's calendar. */
export function partsOf(iso: string, lang: Lang): Parts {
  const parts = new Intl.DateTimeFormat(`en-u-ca-${calendarOf(lang)}-nu-latn`, {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
  }).formatToParts(utc(iso));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const formatter = (lang: Lang, calendar: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(`${lang === 'fa' ? 'fa-IR' : 'en-GB'}-u-ca-${calendar}`, { ...options, timeZone: 'UTC' });

const day = (iso: string, lang: Lang, calendar = calendarOf(lang)) =>
  formatter(lang, calendar, { day: 'numeric', month: 'long', year: 'numeric' }).format(utc(iso));
const monthYear = (iso: string, lang: Lang, calendar = calendarOf(lang)) =>
  formatter(lang, calendar, { month: 'long', year: 'numeric' }).format(utc(iso));
const month = (iso: string, lang: Lang) => formatter(lang, calendarOf(lang), { month: 'long' }).format(utc(iso));

function years(lang: Lang, a: number, b: number): string {
  if (a === b) return num(lang, a);
  // English shortens a span within one century, 2018–19; Persian writes both years.
  if (lang === 'en' && Math.floor(a / 100) === Math.floor(b / 100) && b - a < 10) return `${a}–${String(b).slice(2)}`;
  return `${num(lang, a)}–${num(lang, b)}`;
}

/** The text of a date in the page's calendar, at the source's precision. */
export function formatDate(value: DateValue, lang: Lang): string {
  if (value.date.includes('/')) {
    const [left, right] = endpoints(value).map((v) => formatDate(v, lang));
    return span(left, right);
  }
  const [start, end] = value.range;
  const p = precision(value.date);
  const a = partsOf(start, lang);
  const b = partsOf(end, lang);
  let text: string;
  if (p === 'day') {
    text = day(start, lang);
  } else if (p === 'month') {
    if (a.y === b.y && a.m === b.m) text = monthYear(start, lang);
    else if (a.y === b.y) text = `${month(start, lang)}–${monthYear(end, lang)}`;
    else text = `${monthYear(start, lang)} – ${monthYear(end, lang)}`;
  } else if (p === 'decade' && sameCalendar(value, lang)) {
    text = fill(strings(lang).dates.decade, { year: num(lang, a.y - (a.y % 10)) });
  } else {
    text = years(lang, a.y, b.y);
  }
  return qualify(value.date, lang, text);
}

const span = (left: string, right: string) => left === right ? left : `${left} – ${right}`;

function endpoints(value: DateValue): [DateValue, DateValue] {
  if (!value.endpoints) throw new Error('Interval endpoint ranges are missing; regenerate the site record.');
  return value.endpoints;
}

function qualify(date: string, lang: Lang, text: string): string {
  const q = date.split('/')[0].match(/[~?%]$/)?.[0];
  const words = strings(lang).dates;
  if (q === '~' || q === '%') text = fill(words.circa, { date: text });
  if (q === '?' || q === '%') text = fill(words.uncertain, { date: text });
  return text;
}

const sameCalendar = (value: DateValue, lang: Lang) =>
  (value.calendar === 'jalali') === (lang === 'fa');

/** The date as its source gave it, when the page shows it in another calendar. */
export function originalDate(value: DateValue, lang: Lang): string | null {
  if (sameCalendar(value, lang)) return null;
  const values = value.date.includes('/') ? endpoints(value) : [value];
  const labels = values.map((v) => originalEndpoint(v, lang));
  return fill(strings(lang).dates.original, { date: span(labels[0], labels.at(-1)!) });
}

function originalEndpoint(value: DateValue, lang: Lang): string {
  const words = strings(lang).dates;
  const p = precision(value.date);
  let text: string;
  if (lang === 'en') {
    // A Jalali date on an English page, written out: 3 Esfand 1397 SH.
    const [y, m, d] = value.date.replace(/[~?%]$/, '').split('-');
    const name = m ? words.jalaliMonths[parseInt(m, 10) - 1] : '';
    text = [d ? String(parseInt(d, 10)) : '', name, y.replace('X', '0s')].filter(Boolean).join(' ');
  } else {
    const start = value.range[0];
    text = p === 'day' ? day(start, lang, 'gregory') : p === 'month' ? monthYear(start, lang, 'gregory')
      : p === 'decade' ? fill(words.decade, { year: num(lang, value.date.slice(0, 3) + '0') }) : num(lang, value.date.slice(0, 4));
  }
  return qualify(value.date, lang, text);
}

/** The machine-readable form for `<time datetime>` and structured data, when one is exact. */
export function isoDate(value: DateValue): string | null {
  if (/[~?%X/]/.test(value.date)) return null;
  const [start, end] = value.range;
  if (start === end) return start;
  if (start.slice(0, 7) === end.slice(0, 7) && start.endsWith('-01') && isMonthEnd(end)) return start.slice(0, 7);
  if (start.slice(0, 4) === end.slice(0, 4) && start.endsWith('-01-01') && end.endsWith('-12-31')) return start.slice(0, 4);
  return null;
}

const isMonthEnd = (iso: string) => {
  const next = utc(iso);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
};

/** The year a date belongs to on a page: Gregorian in English, Jalali in Persian. */
export const yearOf = (value: DateValue, lang: Lang): number => partsOf(value.range[0], lang).y;

/** A Gregorian day written for a page, as in “Accessed 15 October 2026”. */
export const formatDay = (iso: string, lang: Lang): string => day(iso, lang);
