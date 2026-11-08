// Checks the built site: every page has its title, description, canonical
// address and twin in the other language, no id is used twice, and no
// internal link is broken.
//
//   node scripts/check-output.mjs [dist]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';
import { buildIdentity } from './deployment.mjs';
import { performs } from '../src/lib/roles.ts';

const dist = process.argv[2] ?? 'dist';
const problems = [];
const pages = new Map();
const record = JSON.parse(readFileSync('generated/record.json', 'utf8'));
const search = JSON.parse(readFileSync(join(dist, 'search.json'), 'utf8'));
const identity = join(dist, 'build.json');
if (!existsSync(identity) || JSON.parse(readFileSync(identity, 'utf8')).sha !== buildIdentity()) {
  problems.push('build.json: artifact commit SHA is missing or incorrect');
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.html')) pages.set('/' + relative(dist, path).replace(/index\.html$/, ''), readFileSync(path, 'utf8'));
  }
}
walk(dist);

// Search results can composite icons on white even in dark mode.
const favicon = sharp(join(dist, 'favicon.png'));
const { data: pixels, info } = await favicon.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let dark = 0, light = 0, transparent = 0;
for (let i = 0; i < pixels.length; i += info.channels) {
  if (pixels[i + 3] !== 255) transparent++;
  if (Math.max(...pixels.subarray(i, i + 3)) < 64) dark++;
  if (Math.min(...pixels.subarray(i, i + 3)) > 200) light++;
}
const pixelCount = info.width * info.height;
if (info.width !== 96 || info.height !== 96 || transparent
  || dark < pixelCount * 0.4 || light < pixelCount * 0.05)
  problems.push('favicon.png: expected an opaque 96px square with contrasting artwork and background');

const sitemapText = readdirSync(dist).filter((name) => /^sitemap.*\.xml$/.test(name))
  .map((name) => readFileSync(join(dist, name), 'utf8')).join('');
for (const lang of ['en', 'fa']) {
  if (!sitemapText.includes(`/${lang}/artists/`)) problems.push(`${lang}: artist directory missing from sitemap`);
  if (!sitemapText.includes(`/${lang}/about/`)) problems.push(`${lang}: About page missing from sitemap`);
  if (sitemapText.includes(`/${lang}/search/`)) problems.push(`${lang}: query results must stay out of the sitemap`);
  if (!pages.get(`/${lang}/search/`)?.includes('name="robots" content="noindex,follow"'))
    problems.push(`${lang}: query results must be noindex`);
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => m[0]);
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const rootCanonical = tags(pages.get('/') ?? '', 'link').find((l) => attr(l, 'rel') === 'canonical');
const site = process.env.SITE_URL ?? 'http://localhost:4321';
const address = (path) => new URL(path, site).href;
if (attr(rootCanonical ?? '', 'href') !== address('/')) problems.push('/: canonical does not name the site root');
const sitemapUrls = new Set([...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => decode(m[1])).filter((url) => !url.endsWith('.xml')));

// Google reads site names at the domain root, including when that root sends
// visitors to a language. Keep one identity across all three homepages.
for (const path of ['/', '/en/', '/fa/']) {
  const html = pages.get(path) ?? '';
  const meta = tags(html, 'meta');
  const description = decode(attr(meta.find((m) => attr(m, 'name') === 'description') ?? '', 'content') ?? '');
  const sites = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((m) => {
      const data = JSON.parse(m[1]);
      return data['@graph'] ?? [data];
    }).filter((node) => node['@type'] === 'WebSite');
  if (attr(meta.find((m) => attr(m, 'property') === 'og:site_name') ?? '', 'content') !== 'Naghva')
    problems.push(`${path}: preferred Open Graph site name must be Naghva`);
  const identity = sites[0];
  if (sites.length !== 1 || identity.name !== 'Naghva' || identity.url !== address('/')
    || JSON.stringify(identity.alternateName) !== JSON.stringify(['نغوا', 'نقوا'])
    || JSON.stringify(identity.inLanguage) !== JSON.stringify(['en', 'fa'])
    || identity.description !== description)
    problems.push(`${path}: homepage WebSite identity is missing or inconsistent`);
  if (!['Naghva', 'نغوا', 'نقوا'].every((name) => description.includes(name)))
    problems.push(`${path}: homepage description must identify the brand and its alternate spelling`);
  if (meta.some((m) => attr(m, 'name') === 'robots' && /\bnoindex\b/.test(attr(m, 'content') ?? '')))
    problems.push(`${path}: homepage must be indexable`);
  const body = (html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, '');
  if (decode(body).includes('نقوا')) problems.push(`${path}: the alternate spelling must stay metadata-only`);
}

function resolve(path) {
  const clean = decodeURIComponent(path);
  if (pages.has(clean)) return pages.get(clean);
  if (existsSync(join(dist, clean)) && statSync(join(dist, clean)).isFile()) return '';
  return null;
}

for (const [path, html] of pages) {
  const icons = tags(html, 'link').filter((l) => attr(l, 'rel') === 'icon');
  if (!icons.some((l) => attr(l, 'href') === '/favicon.png' && attr(l, 'type') === 'image/png' && attr(l, 'sizes') === '96x96'))
    problems.push(`${path}: missing search-compatible PNG favicon`);
  if (!icons.some((l) => attr(l, 'href') === '/favicon.svg' && attr(l, 'sizes') === 'any'))
    problems.push(`${path}: missing scalable favicon`);
  if (path === '/404.html') continue;
  const where = path;
  if (/&(?:#[0-9]*|#x[0-9a-f]*|[a-z][a-z0-9]*)<\/span>;/i.test(html))
    problems.push(`${where}: language isolation splits an escaped HTML entity`);
  const isLanguagePage = /^\/(en|fa)\//.test(path);
  if (isLanguagePage) {
    const lang = path.slice(1, 3);
    if (attr(tags(html, 'html')[0] ?? '', 'lang') !== lang) problems.push(`${where}: <html lang> is not ${lang}`);
    if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${where}: no title`);
    const meta = tags(html, 'meta');
    if (!meta.some((m) => attr(m, 'name') === 'description' && attr(m, 'content'))) problems.push(`${where}: no description`);
    const links = tags(html, 'link');
    const canonical = links.find((l) => attr(l, 'rel') === 'canonical');
    if (attr(canonical ?? '', 'href') !== address(path)) problems.push(`${where}: canonical does not name this page on the configured site`);
    for (const twin of ['en', 'fa']) {
      const alt = links.find((l) => attr(l, 'rel') === 'alternate' && attr(l, 'hreflang') === twin);
      const target = alt && decodeURIComponent(new URL(decode(attr(alt, 'href'))).pathname);
      if (!target || !pages.has(target)) problems.push(`${where}: no ${twin} twin`);
      if (attr(alt ?? '', 'href') !== address(`/${twin}/${path.slice(4)}`))
        problems.push(`${where}: ${twin} alternate must name the same page on the configured site`);
    }
    // Homepages use the root selector. Other clusters fall back to their own
    // English version, preserving the page rather than sending readers home.
    const fallback = links.find((l) => attr(l, 'hreflang') === 'x-default');
    const fallbackPath = path === `/${lang}/` ? '/' : `/en/${path.slice(4)}`;
    if (attr(fallback ?? '', 'href') !== address(fallbackPath))
      problems.push(`${where}: x-default does not name this language cluster's fallback`);
    const noindex = meta.some((m) => attr(m, 'name') === 'robots' && /\bnoindex\b/.test(attr(m, 'content') ?? ''));
    if (sitemapUrls.has(address(path)) === noindex)
      problems.push(`${where}: sitemap must include exactly the indexable language pages`);
  }
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const twice = [...new Set(all.filter((id, i) => all.indexOf(id) !== i))];
  if (twice.length) problems.push(`${where}: ids used more than once: ${twice.join(', ')}`);
  const pageArtist = Object.values(record.items).find((item) => item.page && path === `/${path.slice(1, 3)}/${item.page}/`);
  if (pageArtist) {
    const expectedPhoto = (pageArtist.statements.image ?? []).some((s) => s.rank !== 'deprecated');
    const shownPhoto = tags(html, 'figure').some((tag) => attr(tag, 'class')?.split(' ').includes('infobox-photo'));
    if (expectedPhoto !== shownPhoto) problems.push(`${where}: artist photograph disagrees with the record; check remote image dimensions`);
  }
  // Search metadata keeps recording artists and uncertainty from the record.
  // Writing-only and producer-only credits stay in the panel, not byArtist.
  const structuredAlbums = new Set();
  for (const match of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const graph = JSON.parse(match[1])['@graph'] ?? [];
    if (pageArtist?.type === 'act') {
      const dates = (pageArtist.statements['formation date'] ?? []).filter((s) => s.rank !== 'deprecated').map((s) => s.value);
      const disputed = dates.some((a) => dates.some((b) => a.range[1] < b.range[0] || b.range[1] < a.range[0]));
      if (disputed && graph.some((node) => node['@type'] === 'MusicGroup' && node.foundingDate))
        problems.push(`${where}: structured founding date hides a disagreement`);
    }
    const albums = graph.flatMap((node) => node['@type'] === 'MusicAlbum' ? [node] : node.album ?? []);
    for (const album of albums) {
      const anchor = decodeURIComponent(new URL(album.url).hash.slice(1));
      structuredAlbums.add(anchor);
      const release = record.items[record.panels[anchor]];
      if (!release) { problems.push(`${where}: structured album has no source record: ${anchor}`); continue; }
      const credits = release.statements.performer ?? [];
      const preferred = credits.filter((s) => s.rank === 'preferred');
      const activeCredits = preferred.length ? preferred : credits.filter((s) => s.rank === 'normal');
      const expectedIds = [...new Set(activeCredits.map((s) => s.value))].filter((id) => {
        const own = activeCredits.filter((s) => s.value === id);
        if (own.some((s) => !s.qualifiers?.role?.length)) return true;
        const roles = own.flatMap((s) => s.qualifiers?.role ?? []);
        return roles.some(performs);
      });
      const expected = expectedIds.map((id) => record.items[id].names[path.slice(1, 3)].text).sort();
      const actual = (Array.isArray(album.byArtist) ? album.byArtist : [album.byArtist])
        .map((p) => p?.name ?? graph.find((node) => node['@id'] === p?.['@id'])?.name).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${where}: structured performers disagree for ${anchor}`);
      const dates = (release.statements['release date'] ?? []).filter((s) => s.rank !== 'deprecated').map((s) => s.value);
      const disputed = dates.some((a) => dates.some((b) => a.range[1] < b.range[0] || b.range[1] < a.range[0]));
      if (disputed && album.datePublished) problems.push(`${where}: structured date hides a disagreement for ${anchor}`);
    }
  }
  const panelTags = tags(html, 'section').filter((tag) => attr(tag, 'class')?.split(' ').includes('release-panel'));
  const historicalPanels = panelTags.filter((tag) => attr(tag, 'data-historical-panel') !== undefined);
  for (const tag of historicalPanels) {
    const anchor = attr(tag, 'id');
    if (record.panelHosts?.[record.panels[anchor]] !== pageArtist?.id || structuredAlbums.has(anchor))
      problems.push(`${where}: historical panel ${anchor} must retain its route without artist attribution`);
    if (search.entries.find((entry) => entry.i === record.panels[anchor])?.a)
      problems.push(`${where}: historical panel ${anchor} must not gain an artist credit in search`);
  }
  const panels = panelTags.filter((tag) => !historicalPanels.includes(tag)).map((tag) => attr(tag, 'id'));
  if (panels.some((anchor) => !structuredAlbums.has(anchor)) || structuredAlbums.size !== panels.length)
    problems.push(`${where}: structured recording list disagrees with the visible panels`);
  // Internal links and the anchors they point at.
  for (const tag of [...tags(html, 'a'), ...tags(html, 'link'), ...tags(html, 'img'), ...tags(html, 'script'), ...tags(html, 'source')]) {
    for (const name of ['href', 'src']) {
      const value = attr(tag, name);
      if (!value || /^(https?:|mailto:|data:|\/\/)/.test(value)) continue;
      const url = new URL(decode(value), `http://site${path}`);
      const target = resolve(url.pathname);
      if (target === null) {
        problems.push(`${where}: ${name}="${value}" leads nowhere`);
      } else if (url.hash && target && !ids(target).has(decodeURIComponent(url.hash.slice(1)))) {
        problems.push(`${where}: ${name}="${value}" has no such anchor`);
      }
    }
  }
}

for (const entry of sitemapUrls) {
  const url = new URL(entry);
  if (entry !== address(url.pathname) || !pages.has(decodeURIComponent(url.pathname)))
    problems.push(`sitemap: ${entry} is not a built page on the configured site`);
}

const redirects = join(dist, '_redirects');
if (existsSync(redirects)) {
  for (const line of readFileSync(redirects, 'utf8').split('\n').filter(Boolean)) {
    const [, to] = line.split(' ');
    if (resolve(new URL(to, 'http://site').pathname) === null) problems.push(`_redirects: ${line} leads nowhere`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in ${pages.size} pages`);
  process.exit(1);
}
console.log(`check-output: ${pages.size} pages, titles, descriptions, twins, links and recording metadata in order`);
