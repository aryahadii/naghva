// Tells Bing, Yandex, Naver, Seznam and Yep which pages a deploy changed, in
// one IndexNow ping (https://www.indexnow.org). Google doesn't take part; it
// reads the sitemap's <lastmod> instead.
//
//   node scripts/indexnow.mjs <commit> [--site https://naghva.com] [--wait <seconds>] [--dry-run]
//
// Waits until the live /build.json names the commit, or a later commit that
// contains it, then pings the pages that /lastmod.json says changed in that
// commit's build and that the sitemap lists. A build that never went live
// pings nothing: the next build that does dates those changes as its own.
// The key is the file public/<key>.txt, so the engines can check that the
// ping comes from the site's owner. It is public by design and needs no secret.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const LIMIT = 10_000;

/** The IndexNow key: the name of the one public/<key>.txt file. */
export function findKey(dir = fileURLToPath(new URL('../public/', import.meta.url))) {
  const keys = readdirSync(dir).filter((name) => /^[a-f0-9]{32}\.txt$/.test(name));
  if (keys.length !== 1) throw new Error(`Expected one IndexNow key file in public/, found ${keys.length}.`);
  return keys[0].slice(0, -4);
}

/** @param {string} text */
const unescape = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);

/** The <loc> addresses in a sitemap or sitemap index. @param {string} xml */
export function locations(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => unescape(m[1].trim()));
}

/**
 * The full addresses of the sitemap's pages that changed in the given build.
 * @param {Record<string, { sha: string }>} state  the live /lastmod.json
 * @param {string} sha
 * @param {string[]} listed  the addresses the live sitemaps list
 */
export function changedUrls(state, sha, listed) {
  return [...new Set(listed)].filter((url) => state[decodeURI(new URL(url).pathname)]?.sha === sha).sort();
}

/** @param {string[]} urls */
export function batches(urls, size = LIMIT) {
  const out = [];
  for (let i = 0; i < urls.length; i += size) out.push(urls.slice(i, i + size));
  return out;
}

/** @param {string} url */
async function text(url) {
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

/** Whether commit `older` is `newer` or one of its ancestors, fetching main if needed. */
function contains(newer, older) {
  const git = (...args) => execFileSync('git', args, { stdio: 'ignore' });
  try {
    git('cat-file', '-e', `${newer}^{commit}`);
  } catch {
    git('fetch', '--quiet', 'origin', 'main');
  }
  try {
    git('merge-base', '--is-ancestor', older, newer);
    return true;
  } catch {
    return false;
  }
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      site: { type: 'string', default: 'https://naghva.com' },
      wait: { type: 'string', default: '0' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const site = new URL(values.site);
  const wait = Number(values.wait);
  const dryRun = values['dry-run'];
  const [sha] = positionals;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !(wait >= 0)) {
    throw new Error('Usage: node scripts/indexnow.mjs <full commit SHA> [--site URL] [--wait seconds] [--dry-run]');
  }

  const deadline = Date.now() + wait * 1000;
  let live, ready = false;
  for (;;) {
    try {
      live = JSON.parse(await text(new URL('/build.json', site).href)).sha;
      ready = live === sha || contains(live, sha);
    } catch (error) {
      // A deploy in progress can answer with an error for a moment; keep waiting.
      console.log(`Could not read the live build yet: ${error.message}`);
    }
    if (ready || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  if (!ready) {
    // The deploy failed or hasn't finished. The next build that goes live dates
    // these changes as its own, so its ping covers them.
    console.log(`${site.host} serves ${live ?? 'nothing readable'}, which doesn't contain ${sha}; nothing to ping.`);
    return;
  }

  const state = JSON.parse(await text(new URL('/lastmod.json', site).href));
  const listed = [];
  for (const sitemap of locations(await text(new URL('/sitemap-index.xml', site).href))) {
    listed.push(...locations(await text(new URL(new URL(sitemap).pathname, site).href)));
  }
  const urls = changedUrls(state, sha, listed);
  if (!urls.length) {
    console.log('No page changed in this build; nothing to ping.');
    return;
  }
  const key = findKey();
  const keyLocation = new URL(`/${key}.txt`, site).href;
  if ((await text(keyLocation)).trim() !== key) throw new Error(`${keyLocation} does not hold the key.`);
  for (const urlList of batches(urls)) {
    console.log(`${dryRun ? 'Would ping' : 'Pinging'} IndexNow with ${urlList.length} pages:\n  ${urlList.join('\n  ')}`);
    if (dryRun) continue;
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: site.host, key, keyLocation, urlList }),
    });
    // 200 and 202 both mean received; 202 while the key is still being checked.
    if (response.status !== 200 && response.status !== 202) {
      throw new Error(`IndexNow answered HTTP ${response.status}: ${await response.text()}`);
    }
    console.log(`IndexNow answered HTTP ${response.status}.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
