import { Marked } from 'marked';
import type { Citations } from './citations';
import { isolate } from './html';
import type { Lang, Note } from './record';

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SAFE_HREF = /^(?:https?:\/\/|#|\/(?!\/))/i;

// Articles are Markdown only: raw HTML is shown as text, and a link must go
// to a web page, an anchor or a path on the site.
const marked = new Marked({
  gfm: true,
  async: false,
  renderer: {
    html: ({ text }) => escape(text),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      return SAFE_HREF.test(href) ? false : label;
    },
  },
});
const RUN = /(?:\[\^[^\]\s]+\])+/g;
const KEY = /\[\^([^\]\s]+)\]/g;

/** An article passage as HTML: `[^key]` citations become numbered links, other scripts are isolated. */
export function renderArticle(markdown: string, lang: Lang, notes: Note[], citations: Citations): string {
  const byKey = new Map(notes.map((n) => [n.key, n]));
  const html = (marked.parse(markdown) as string).replace(RUN, (run) =>
    citations.run([...run.matchAll(KEY)].map((m) => byKey.get(m[1])).filter((n): n is Note => Boolean(n))),
  );
  return isolate(html, lang);
}
