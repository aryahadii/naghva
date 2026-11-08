import { Marked } from 'marked';
import type { Citations } from './citations';
import { isolate } from './html';
import type { Lang, Note } from './record';

const marked = new Marked({ gfm: true, async: false });
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
