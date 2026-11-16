// Tells Bing, Yandex, Naver, Seznam and Yep which pages a deploy changed, in
// one IndexNow ping (https://www.indexnow.org). Google doesn't take part; it
// reads the sitemap's <lastmod> instead.
//
//   node scripts/indexnow.mjs <commit> [--site https://naghva.com] [--wait <seconds>] [--dry-run]
//
// Waits until the live /build.json names the commit, then pings the pages
// that /lastmod.json says changed in that build and that the sitemap lists.
// The key is the file public/<key>.txt, so the engines can check that the
// ping comes from the site's owner. It is public by design and needs no secret.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const LIMIT = 10_000;

/** The IndexNow key: the name of the one public/<key>.txt file. */
export function findKey(dir = fileURLToPath(new URL('../public/', import.meta.url))) {
  const keys = readdirSync(dir).filter((name) => /^[a-f0-9]{32}\.txt$/.test(name));
  if (keys.length !== 1) throw new Error(`Expected one IndexNow key file in public/, found ${keys.length}.`);
  return keys[0].slice(0, -4);
}

/**
 * The full addresses of the sitemap's pages that changed in the given build.
 * @param {Record<string, { sha: string }>} state  the live /lastmod.json
 * @param {string} sha
 * @param {string} sitemap  the live sitemap-0.xml
 */
export function changedUrls(state, sha, sitemap) {
  const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  return [...listed].filter((url) => state[new URL(url).pathname]?.sha === sha).sort();
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

async function main(argv) {
  const args = [...argv];
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    const [, value] = args.splice(i, 2);
    return value;
  };
  const dryRun = args.includes('--dry-run');
  if (dryRun) args.splice(args.indexOf('--dry-run'), 1);
  const site = new URL(flag('--site', 'https://naghva.com'));
  const wait = Number(flag('--wait', '0'));
  const [sha] = args;
  if (!sha) throw new Error('Usage: node scripts/indexnow.mjs <commit> [--site URL] [--wait seconds] [--dry-run]');

  const deadline = Date.now() + wait * 1000;
  let live;
  for (;;) {
    live = JSON.parse(await text(new URL('/build.json', site).href)).sha;
    if (live === sha || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  if (live !== sha) {
    // A newer build replaced this one before it went live, or the deploy failed.
    // A later build's ping covers its changes, since they are dated with it.
    console.log(`${site.host} serves ${live}, not ${sha}; nothing to ping.`);
    return;
  }

  const state = JSON.parse(await text(new URL('/lastmod.json', site).href));
  const urls = changedUrls(state, sha, await text(new URL('/sitemap-0.xml', site).href));
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
