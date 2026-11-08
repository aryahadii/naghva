import { formatDate, isoDate, originalDate } from './dates';
import { dirOf } from './i18n';
import type { DateValue, Lang, Text } from './record';

/** Small pieces of markup that pages build in their frontmatter and place with set:html. */

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The lang and dir a piece of text needs when it is not in the page's language. */
export function langAttrs(language: string, page: Lang): string {
  const base = language.split('-')[0];
  if (base === page) return '';
  return ` lang="${esc(language)}" dir="${dirOf(language)}"`;
}

/** The same, as attributes for an element whose whole text is one name. */
export function textAttrs(text: Text, page: Lang): { lang?: string; dir?: 'rtl' | 'ltr' } {
  return text.language.split('-')[0] === page ? {} : { lang: text.language, dir: dirOf(text.language) };
}

/** A name in its own language and direction, linked when it has somewhere to go. */
export function nameHtml(text: Text, page: Lang, href?: string | null, extra = ''): string {
  const attrs = langAttrs(text.language, page);
  return href
    ? `<a href="${esc(href)}"${attrs}${extra}>${esc(text.text)}</a>`
    : `<span${attrs}${extra}>${esc(text.text)}</span>`;
}

export function dateHtml(value: DateValue, lang: Lang): string {
  const original = originalDate(value, lang);
  const title = original ? ` title="${esc(original)}"` : '';
  const iso = isoDate(value);
  const text = esc(formatDate(value, lang));
  return iso ? `<time datetime="${iso}"${title}>${text}</time>` : `<span${title}>${text}</span>`;
}

const ARABIC = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const PERSIAN_RUN = new RegExp(`[${ARABIC}](?:[${ARABIC}\\u200c\\u200d«»\\s-]*[${ARABIC}»])?`, 'g');
const LATIN = 'A-Za-z\\u00C0-\\u024F';
// A run ends on a letter, a digit or a closed bracket, so the brackets around it stay with the sentence.
const ENTITY = '&(?:#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);';
const LATIN_MID = `(?:${ENTITY}|[${LATIN}0-9'’.:\\s–-])*`;
const LATIN_RUN = new RegExp(`[${LATIN}](?:${LATIN_MID}(?:[${LATIN}0-9]|\\([${LATIN}0-9'’.&:\\s–-]*\\)))*`, 'g');

/**
 * Wraps runs of the other script in their own lang and dir, so a Persian
 * title in an English sentence (or the reverse) keeps its order and font.
 * Works on finished HTML, touching only the text between tags.
 */
export function isolate(html: string, page: Lang): string {
  const run = page === 'en' ? PERSIAN_RUN : LATIN_RUN;
  const attrs = page === 'en' ? ' lang="fa" dir="rtl"' : ' lang="en" dir="ltr"';
  const open: boolean[] = []; // for each open inline element, whether it already says its language
  return html
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<(span|a|i|em|strong|cite|sup)\b/.test(part)) open.push(/\blang=/.test(part));
        else if (/^<\/(span|a|i|em|strong|cite|sup)>/.test(part)) open.pop();
        return part;
      }
      return open.includes(true) ? part : part.replace(new RegExp(`${ENTITY}|${run.source}`, 'g'), (m) => m.startsWith('&') ? m : `<span${attrs}>${m}</span>`);
    })
    .join('');
}

/** Plain text of a Markdown passage with its citations removed, for descriptions. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[\^[^\]\s]+\]/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentences of a text, up to about 160 characters. */
export function summary(text: string, max = 160): string {
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?؟]+[.!?؟]+(\s|$)/g) ?? [];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  if (out.trim()) return out.trim();
  const cut = text.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}
