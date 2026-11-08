import type { APIRoute } from 'astro';
import { fold, type SearchEntry, type SearchIndex } from '../lib/search';
import { artistPages, creditedReleaseHost, href, isText, LANGS, loadRecord, type Item, type Text } from '../lib/record';

/**
 * The search index: every artist, release and person a page shows, with all
 * their names folded for matching.
 */

const names = (item: Item) =>
  [...new Set((item.statements.name ?? []).filter((s) => s.rank !== 'deprecated' && isText(s.value)).map((s) => fold((s.value as Text).text)))];

export const GET: APIRoute = () => {
  const record = loadRecord();
  const pages = artistPages(record);
  const index: SearchIndex = { artists: {}, entries: [] };
  for (const artist of pages) index.artists[artist.id] = artist.names;
  const shownOn = (path: string) => pages.find((p) => path.startsWith(`/${p.page}/`))?.id;

  for (const item of Object.values(record.items)) {
    const kind = item.page ? 'artist' : item.type === 'release' ? 'release' : item.type === 'person' ? 'person' : null;
    if (!kind) continue;
    const at = href(record, LANGS[0], item);
    if (!at) continue;
    const path = at.slice(`/${LANGS[0]}`.length);
    const entry: SearchEntry = { i: item.id, k: kind, h: path, n: item.names, f: names(item) };
    if (kind === 'release') entry.a = creditedReleaseHost(record, item)?.id;
    else if (kind === 'person') entry.a = shownOn(path);
    index.entries.push(entry);
  }
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
};
