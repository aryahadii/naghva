import en from '../strings/en.json';
import faStrings from '../strings/fa.json';
import type { Lang } from './record';

/** Interface text. The data itself is never translated; only the words around it are. */
export type Strings = typeof en;
const fa: Strings = faStrings;
const all: Record<Lang, Strings> = { en, fa };

export const strings = (lang: Lang): Strings => all[lang];
export const other = (lang: Lang): Lang => (lang === 'en' ? 'fa' : 'en');

const RTL = /^(fa|ar|ckb|ps|ur|he|yi)\b/;
export const dirOf = (language: string): 'rtl' | 'ltr' => (RTL.test(language) ? 'rtl' : 'ltr');

const locales: Record<Lang, string> = { en: 'en-GB', fa: 'fa-IR' };
export const locale = (lang: Lang): string => locales[lang];

/** A number in the page's digits: Persian digits on Persian pages. */
export function num(lang: Lang, n: number | string): string {
  const value = typeof n === 'number' ? n : Number(n);
  if (Number.isNaN(value)) return String(n);
  return new Intl.NumberFormat(locales[lang], { useGrouping: false }).format(value);
}

/** `{name}` placeholders filled with plain text. */
export function fill(template: string, values: { [key: string]: string | number }): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole));
}

/** A template split around its placeholders, for filling with markup. */
export function parts(template: string): (string | { key: string })[] {
  return template.split(/(\{\w+\})/).filter(Boolean).map((p) => (/^\{\w+\}$/.test(p) ? { key: p.slice(1, -1) } : p));
}

export function plural(lang: Lang, forms: { one: string; other: string }, count: number): string {
  const rule = new Intl.PluralRules(locales[lang]).select(count);
  return fill(rule === 'one' ? forms.one : forms.other, { count: num(lang, count) });
}

/** `a, b and c` in the page's language. */
export function list(lang: Lang, items: string[]): string {
  return new Intl.ListFormat(locales[lang], { type: 'conjunction' }).format(items);
}
