/** Search over names, shared by the index the build writes and the search box that reads it. */

interface Text { text: string; language: string }

export interface SearchEntry {
  /** The item's ID: several entries can share an address, as people do the page they appear on. */
  i: string;
  k: 'artist' | 'release' | 'person';
  /** Its address without the language, which the search box adds. */
  h: string;
  n: { en: Text | null; fa: Text | null };
  /** The artist whose page shows it, for releases and people. */
  a?: string;
  /** Every name, folded. */
  f: string[];
}
export interface SearchIndex { artists: { [id: string]: { en: Text | null; fa: Text | null } }; entries: SearchEntry[] }

/**
 * Folds text for search, so a query matches however it is typed: Arabic and
 * Persian letter forms, diacritics, zero-width joiners, Persian and Arabic
 * digits, case and accents.
 */
const LETTERS: { [c: string]: string } = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی', 'ك': 'ک', 'ة': 'ه', 'ە': 'ه', 'ۀ': 'ه', 'ؤ': 'و', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
};
const DIGITS = /[۰-۹٠-٩]/g;

export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
    .replace(/[يىئكةەۀؤأإآٱ]/g, (c) => LETTERS[c])
    .replace(DIGITS, (d) => String((d.charCodeAt(0) - (d >= '\u06f0' ? 0x06f0 : 0x0660)) % 10))
    .replace(/[\u200c\u200d\u200e\u200f\u0640]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Higher is better; 0 means no match. */
export function score(query: string, folded: string): number {
  if (!query) return 0;
  const compact = folded.replace(/ /g, '');
  const q = query.replace(/ /g, '');
  if (compact.startsWith(q)) return 3;
  if (folded.split(' ').some((word) => word.startsWith(query.split(' ')[0])) && compact.includes(q)) return 2;
  return compact.includes(q) ? 1 : 0;
}


/** One deterministic ranking for quick suggestions and paginated results. */
export function ranked(index: SearchIndex, query: string, lang: 'en' | 'fa'): SearchEntry[] {
  const q = fold(query);
  if (!q) return [];
  const order = { artist: 0, release: 1, person: 2 };
  const length = (e: SearchEntry) => (e.n[lang] ?? e.n[lang === 'en' ? 'fa' : 'en'])?.text.length ?? 0;
  return index.entries.map((entry) => ({ entry, score: Math.max(0, ...entry.f.map((f) => score(q, f))) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || order[a.entry.k] - order[b.entry.k] || length(a.entry) - length(b.entry) || a.entry.i.localeCompare(b.entry.i))
    .map((r) => r.entry);
}

export const PAGE_SIZE = 24;
export function searchPage(index: SearchIndex, query: string, lang: 'en' | 'fa', requested: number) {
  const all = ranked(index, query, lang);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1));
  return { total: all.length, pages, page, entries: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}
