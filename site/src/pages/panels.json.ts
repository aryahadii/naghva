import type { APIRoute } from 'astro';
import { href, LANGS, loadRecord } from '../lib/record';

/**
 * Where every release panel address ever issued leads now, without the
 * language. The server never sees what follows #, so an Artist page looks an
 * address up here when it has no panel by that name.
 */
export const GET: APIRoute = () => {
  const record = loadRecord();
  const lang = LANGS[0];
  const moved: { [anchor: string]: string } = {};
  for (const [anchor, id] of Object.entries(record.panels)) {
    const at = href(record, lang, record.items[id]);
    if (at) moved[anchor] = at.slice(`/${lang}`.length);
  }
  return new Response(JSON.stringify(moved), { headers: { 'Content-Type': 'application/json' } });
};
