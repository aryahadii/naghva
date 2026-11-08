import { formatDay } from './dates';
import { esc } from './html';
import { fill, num, strings } from './i18n';
import type { Lang, SiteRecord, Reference, Source } from './record';

export interface Quote extends Reference { id: string }
export interface CitedSource { name: string; n: number; source: Source; quotes: Quote[] }

/**
 * The sources a page cites, numbered in the order a reader meets them. A
 * number stands for a source; each citation also points at the quote it
 * rests on, which the page keeps under that source in its Sources list.
 */
export class Citations {
  private sources = new Map<string, CitedSource>();
  private quotes = new Map<string, Quote>();

  private record: SiteRecord;
  private lang: Lang;

  constructor(record: SiteRecord, lang: Lang) { this.record = record; this.lang = lang; }

  private register(ref: Reference): { n: number; quote: string } | null {
    const source = this.record.sources[ref.source];
    if (!source) return null;
    let cited = this.sources.get(ref.source);
    if (!cited) {
      cited = { name: ref.source, n: this.sources.size + 1, source, quotes: [] };
      this.sources.set(ref.source, cited);
    }
    const key = `${ref.source}\n${ref.quote}\n${ref.locator ?? ''}`;
    let quote = this.quotes.get(key);
    if (!quote) {
      quote = { ...ref, id: `q${this.quotes.size + 1}` };
      this.quotes.set(key, quote);
      cited.quotes.push(quote);
    }
    return { n: cited.n, quote: quote.id };
  }

  /** One superscript for a run of citations: a number per source, each pointing at its quotes. */
  run(refs: Reference[]): string {
    const bySource = new Map<number, Set<string>>();
    for (const ref of refs) {
      const r = this.register(ref);
      if (r) bySource.set(r.n, (bySource.get(r.n) ?? new Set()).add(r.quote));
    }
    if (!bySource.size) return '';
    const links = [...bySource].map(([n, quotes]) => {
      const shown = num(this.lang, n);
      const label = fill(strings(this.lang).cite.source, { n: shown });
      return `<a class="cite" href="#source-${n}" data-quote="${[...quotes].join(' ')}" aria-label="${esc(label)}">${shown}</a>`;
    });
    return `<sup class="cites">${links.join('')}</sup>`;
  }

  list(): CitedSource[] {
    return [...this.sources.values()];
  }
}

export const accessed = (ref: Reference, lang: Lang): string =>
  fill(strings(lang).cite.accessed, { date: formatDay(ref.accessed, lang) });
