import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// When each page last changed, for the sitemap's <lastmod> and for IndexNow.
//
// A build fingerprints what each page says: its title, description and
// structured data, the text of its <main> and the attributes there that carry
// content (links, alt text, dates, chart data, island props), but not
// classes, styles or the hashed /_astro/ files a redesign renames. It then
// reads the state the live site published with its own build (/lastmod.json).
// A page whose fingerprint is unchanged keeps its date; a new or changed page
// takes this build's time and commit, so a rebuild alone moves nothing.

const KEEP = /^(?:alt|title|href|src|srcset|datetime|value|content|aria-label|props|data-(?!astro-)[\w-]+)$/;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * What a page says, as one string: its title, description and structured
 * data, then the text and content-bearing attributes inside <main> (or the
 * whole page without one).
 * @param {string} html
 */
export function pageContent(html) {
  const head = html.slice(0, Math.max(0, html.search(/<body[\s>]/i)));
  const meta = [
    ...head.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi),
    ...head.matchAll(/<meta\s[^>]*name=["']description["'][^>]*>/gi),
    ...head.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ].map((m) => m[0].trim());
  const start = html.search(/<main[\s>]/i);
  const end = html.lastIndexOf('</main>');
  let part = start >= 0 && end > start ? html.slice(start, end) : html;
  part = part
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script(?![^>]*application\/(?:ld\+)?json)[^>]*>[\s\S]*?<\/script>/gi, '');
  const out = [];
  part.replace(/<([a-zA-Z][\w-]*)([^>]*)>|<\/[^>]*>|([^<]+)/g, (_, tag, attrs, text) => {
    if (text) {
      const words = text.replace(/\s+/g, ' ').trim();
      if (words) out.push(words);
    } else if (tag) {
      const kept = [];
      for (const [, name, a, b, c] of (attrs ?? '').matchAll(ATTRIBUTE)) {
        const value = a ?? b ?? c ?? '';
        if (!KEEP.test(name) || /(^|[\s,])\/_astro\//.test(value)) continue;
        kept.push(`${name}=${value}`);
      }
      out.push(`<${tag.toLowerCase()}${kept.length ? ' ' + kept.join(' ') : ''}>`);
    }
    return '';
  });
  return [...meta, ...out].join('\n');
}

/** @param {string} html */
export function fingerprint(html) {
  return createHash('sha256').update(pageContent(html)).digest('hex').slice(0, 16);
}

/**
 * @typedef {{ hash: string, date: string, sha: string }} PageState
 * @typedef {Record<string, PageState>} State   keyed by path, such as /en/
 */

/**
 * Carries each unchanged page's date forward and dates new or changed pages
 * now. Pages that are gone drop out.
 * @param {Record<string, string>} hashes  path -> fingerprint, this build
 * @param {State} previous                 what the live site published
 * @param {{ date: string, sha: string }} build
 * @returns {{ state: State, changed: string[] }}
 */
export function nextState(hashes, previous, build) {
  /** @type {State} */
  const state = {};
  const changed = [];
  for (const path of Object.keys(hashes).sort()) {
    const before = previous[path];
    if (before && before.hash === hashes[path] && before.date) {
      state[path] = before;
    } else {
      state[path] = { hash: hashes[path], date: build.date, sha: build.sha };
      changed.push(path);
    }
  }
  return { state, changed };
}

/** A build's time as the sitemap writes it: UTC, to the second. */
export function w3cDate(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * Where the previous state comes from: NAGHVA_LASTMOD_FROM (a URL or a file),
 * else, in Cloudflare's production build, the published site's
 * /lastmod.json. Other builds (local, pull requests, the examples) have no
 * published state to follow and date every page now.
 * @param {string} site
 * @param {NodeJS.ProcessEnv} [env]
 */
export function previousSource(site, env = process.env) {
  if (env.NAGHVA_LASTMOD_FROM) return env.NAGHVA_LASTMOD_FROM;
  const url = new URL(site);
  if (!env.WORKERS_CI_COMMIT_SHA || url.protocol !== 'https:') return undefined;
  return new URL('/lastmod.json', url).href;
}

/**
 * Reads the previous state. A missing file (the first build) is an empty
 * state; any other failure stops the build, because carrying on would date
 * every page today.
 * @param {string | undefined} source
 * @param {typeof fetch} [get]
 * @returns {Promise<{ state: State, note?: string }>}
 */
export async function readPrevious(source, get = fetch) {
  if (!source) return { state: {}, note: 'not a production build: no published state to compare with; every page is dated now' };
  if (!/^https?:/.test(source)) return { state: JSON.parse(await readFile(source, 'utf8')) };
  const response = await get(source, { headers: { 'cache-control': 'no-cache' } });
  if (response.status === 404) return { state: {}, note: `${source} is not published yet; every page is dated now` };
  if (!response.ok) throw new Error(`Could not read ${source}: HTTP ${response.status}. Without it every page would be dated today.`);
  return { state: await response.json() };
}
