import { readdir, readFile, writeFile } from 'node:fs/promises';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { buildIdentity } from '../scripts/deployment.mjs';
import { fingerprint, nextState, previousSource, readPrevious, w3cDate } from '../scripts/freshness.mjs';

/** Decoded path (such as /en/) -> when that page last changed, filled after a build for the sitemap. */
export const lastmod = new Map<string, string>();

/**
 * Dates every page by when what it says last changed, and writes
 * /lastmod.json for the next build and for the IndexNow ping
 * (scripts/indexnow.mjs). Must come before the sitemap, which reads `lastmod`.
 */
export default function freshness(): AstroIntegration {
  let site = '';
  return {
    name: 'naghva-freshness',
    hooks: {
      'astro:config:done': ({ config }) => { site = config.site ?? ''; },
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const hashes: Record<string, string> = {};
        const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('.html'));
        for (const file of files.map((f) => f.split(sep).join('/'))) {
          const path = '/' + file.replace(/(^|\/)index\.html$/, '$1');
          hashes[path] = fingerprint(await readFile(root + file, 'utf8'));
        }
        const { state: previous, note } = await readPrevious(previousSource(site));
        if (note) logger.warn(note);
        const { state, changed } = nextState(hashes, previous, { date: w3cDate(), sha: buildIdentity() });
        await writeFile(new URL('lastmod.json', dir), JSON.stringify(state, null, 1) + '\n');
        lastmod.clear();
        for (const [path, page] of Object.entries(state)) lastmod.set(path, page.date);
        logger.info(`${changed.length} of ${Object.keys(state).length} pages new or changed since the published build`);
      },
    },
  };
}
