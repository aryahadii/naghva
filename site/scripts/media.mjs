// Naghva's own copies of the record's photographs and covers.
//
// The image files are not in this repository. Each original lives in a
// private Cloudflare R2 bucket under originals/<sha256>.<ext>; media.json
// (committed) lists every source address with its hash, size and the widths
// the site shows it at. Nobody reads the bucket but the deploy build, and the
// site's visitors only ever get the resized copies, served as static assets.
//
//   add     Download each image the record uses that media.json lacks, keep
//           the original in media-cache/, add it to media.json, and drop
//           entries the record no longer uses. No key needed.
//   upload  Put originals missing from the bucket, and delete bucket objects
//           media.json no longer lists. Needs the write key.
//   fetch   Download originals missing from media-cache/. Needs the read key;
//           without one it does nothing, unless the build requires media.
//   build   Make the WebP copies in public/media/ from media-cache/.
//
// Keys come from the environment (or site/.env): R2_ACCOUNT_ID,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET (default naghva-media).
// NAGHVA_MEDIA_REQUIRED=1 makes fetch and build fail unless every image the
// record uses has its own copy, so a deploy never falls back to a publisher.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const MANIFEST = 'media.json';
const CACHE = 'media-cache/originals';
const OUT = 'public/media';
const WIDTHS = { photo: [240, 360, 640, 960, 1200], cover: [180, 360, 720] };
const KIND = { image: 'photo', poster: 'photo', logo: 'photo', 'cover art': 'cover' };
const TYPES = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', gif: 'gif' };
const MAX_BYTES = 25 * 1024 * 1024;

const required = process.env.NAGHVA_MEDIA_REQUIRED === '1';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readManifest = () => existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const writeManifest = (manifest) => writeFileSync(MANIFEST, `${JSON.stringify(
  Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
const objectKey = (entry) => `originals/${entry.sha256}.${entry.ext}`;
const cached = (entry) => `${CACHE}/${entry.sha256}.${entry.ext}`;

/** The cached original of `entry`, if it is there and intact. */
function original(entry) {
  const path = cached(entry);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  if (digest(bytes) !== entry.sha256) throw new Error(`${path} does not match media.json; delete it and fetch again`);
  return bytes;
}

/** Every image address the derived record shows, with how it is shown. */
function recordImages() {
  const record = JSON.parse(readFileSync('generated/record.json', 'utf8'));
  if (record.examples) throw new Error('media: run npm run derive first; this is the examples record');
  const images = new Map();
  for (const item of Object.values(record.items)) {
    for (const [property, kind] of Object.entries(KIND)) {
      for (const s of item.statements[property] ?? []) {
        if (typeof s.value === 'string' && /^https?:\/\//.test(s.value)) {
          // A cover shown as a photo somewhere gets the larger set of widths.
          if (images.get(s.value) !== 'photo') images.set(s.value, kind);
        }
      }
    }
  }
  return images;
}

// Hosts that keep larger copies of the same image under a related address.
const LARGER = [
  // Apple Music artwork takes any size in its last path segment.
  [/^(https:\/\/[a-z0-9-]+\.mzstatic\.com\/.+)\/\d+x\d+[a-z]*(?:-\d+)?\.(?:jpe?g|png|webp)$/, (m) => `${m[1]}/1200x1200bb.jpg`],
  // Spotify keeps an album cover at 640px under the same hash.
  [/^https:\/\/i\.scdn\.co\/image\/ab67616d00001e02([0-9a-f]+)$/, (m) => `https://i.scdn.co/image/ab67616d0000b273${m[1]}`],
  // SoundCloud artwork at its largest size.
  [/^(https:\/\/i\d\.sndcdn\.com\/artworks-[\w-]+?)-(?:large|t\d+x\d+)\.(jpg|png)$/, (m) => `${m[1]}-t500x500.${m[2]}`],
  // Bandcamp's _10 is the image as uploaded.
  [/^(https:\/\/f\d\.bcbits\.com\/img\/\w+?)_\d+\.jpg$/, (m) => `${m[1]}_10.jpg`],
  // YouTube's largest thumbnail, which not every video has.
  [/^https:\/\/i\.ytimg\.com\/vi\/([\w-]+)\/\w*default\.jpg$/, (m) => `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`],
];

/** The image at `url`, as large as its host offers it, and where it came from. */
async function downloadLargest(url) {
  for (const [pattern, larger] of LARGER) {
    const match = url.match(pattern);
    if (!match || larger(match) === url) continue;
    try {
      return { bytes: await download(larger(match)), from: larger(match) };
    } catch (error) {
      console.warn(`media: no larger copy of ${url} (${error.message}); keeping the recorded one`);
    }
  }
  return { bytes: await download(url), from: url };
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Naghva archive (+https://naghva.com)' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`${url}: larger than 25 MB`);
  return bytes;
}

async function describe(bytes, url) {
  const meta = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
  const ext = TYPES[meta.format];
  if (!ext) throw new Error(`${url}: not a photograph format (${meta.format})`);
  const { width, height } = meta.autoOrient;
  return { sha256: digest(bytes), ext, bytes: bytes.length, width, height };
}

async function add() {
  const manifest = readManifest();
  const images = recordImages();
  mkdirSync(CACHE, { recursive: true });
  let added = 0;
  for (const [url, kind] of images) {
    const widths = WIDTHS[kind];
    if (manifest[url]) {
      manifest[url].widths = widths;
      continue;
    }
    const { bytes, from } = await downloadLargest(url);
    const entry = { ...(await describe(bytes, url)), ...(from !== url ? { from } : {}), widths };
    writeFileSync(cached(entry), bytes);
    manifest[url] = entry;
    added++;
    console.log(`media: added ${url} (${entry.width}×${entry.height}, ${entry.bytes} bytes)`);
  }
  let dropped = 0;
  for (const url of Object.keys(manifest)) {
    if (!images.has(url)) { delete manifest[url]; dropped++; console.log(`media: dropped ${url}`); }
  }
  writeManifest(manifest);
  console.log(`media: ${added} added, ${dropped} dropped, ${Object.keys(manifest).length} listed. Run npm run media:upload next.`);
}

async function bucket() {
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: id, R2_SECRET_ACCESS_KEY: secret } = process.env;
  if (!account || !id || !secret) return null;
  const { AwsClient } = await import('aws4fetch');
  const client = new AwsClient({ accessKeyId: id, secretAccessKey: secret, service: 's3', region: 'auto' });
  const base = `https://${account}.r2.cloudflarestorage.com/${process.env.R2_BUCKET || 'naghva-media'}`;
  const call = async (method, key = '', init = {}) => {
    const response = await client.fetch(`${base}/${key}`, { method, ...init });
    if (!response.ok && !(method === 'HEAD' && response.status === 404)) {
      throw new Error(`R2 ${method} ${key || '/'}: HTTP ${response.status} ${await response.text()}`);
    }
    return response;
  };
  return {
    has: async (key) => (await call('HEAD', key)).ok,
    get: async (key) => Buffer.from(await (await call('GET', key)).arrayBuffer()),
    put: (key, body, type) => call('PUT', key, { body, headers: { 'Content-Type': type } }),
    remove: (key) => call('DELETE', key),
    async list(prefix) {
      const keys = [];
      let token = '';
      do {
        const query = `?list-type=2&prefix=${encodeURIComponent(prefix)}${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
        const xml = await (await call('GET', query)).text();
        keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]));
        token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? '';
      } while (token);
      return keys;
    },
  };
}

async function upload() {
  const r2 = await bucket();
  if (!r2) throw new Error('media: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (the write key)');
  const manifest = readManifest();
  mkdirSync(CACHE, { recursive: true });
  const wanted = new Set();
  let put = 0;
  for (const [url, entry] of Object.entries(manifest)) {
    const key = objectKey(entry);
    wanted.add(key);
    if (await r2.has(key)) continue;
    let bytes = original(entry);
    if (!bytes) {
      // Not on this computer yet: take it from the publisher, if unchanged.
      bytes = await download(entry.from ?? url);
      if (digest(bytes) !== entry.sha256) throw new Error(`${entry.from ?? url} changed since it was added; remove its media.json entry and run npm run media:add`);
      writeFileSync(cached(entry), bytes);
    }
    await r2.put(key, bytes, `image/${entry.ext === 'jpg' ? 'jpeg' : entry.ext}`);
    put++;
    console.log(`media: uploaded ${key}`);
  }
  let removed = 0;
  for (const key of await r2.list('originals/')) {
    if (!wanted.has(key)) { await r2.remove(key); removed++; console.log(`media: deleted ${key}`); }
  }
  console.log(`media: ${put} uploaded, ${removed} deleted, ${wanted.size} in the bucket`);
}

async function fetchOriginals() {
  const manifest = readManifest();
  const missing = Object.values(manifest).filter((entry) => !original(entry));
  if (!missing.length) return console.log(`media: all ${Object.keys(manifest).length} originals are cached`);
  const r2 = await bucket();
  if (!r2) {
    if (required) throw new Error('media: this build needs its own images; set the R2 read key');
    return console.log(`media: no R2 key, so ${missing.length} images show from their publishers`);
  }
  mkdirSync(CACHE, { recursive: true });
  for (const entry of missing) {
    const bytes = await r2.get(objectKey(entry));
    if (digest(bytes) !== entry.sha256) throw new Error(`R2 ${objectKey(entry)} does not match media.json`);
    writeFileSync(cached(entry), bytes);
  }
  console.log(`media: fetched ${missing.length} originals from R2`);
}

/** The file name of `entry`'s copy at `width`, as images.ts expects it. */
export const copyName = (entry, width) => `${entry.sha256.slice(0, 16)}-${width}.webp`;

async function build() {
  const manifest = readManifest();
  // Without a derived record (npm run derive), there is nothing to check against.
  const record = existsSync('generated/record.json') || required ? recordImages() : new Map();
  const unlisted = [...record.keys()].filter((url) => !manifest[url]);
  if (unlisted.length) {
    const message = `media: not in media.json yet, so shown from the publisher; run npm run media:add and media:upload:\n${unlisted.join('\n')}`;
    if (required) throw new Error(message);
    console.warn(message);
  }
  mkdirSync(OUT, { recursive: true });
  const keep = new Set();
  let made = 0;
  let missing = 0;
  for (const [url, entry] of Object.entries(manifest)) {
    const names = entry.widths.map((w) => [Math.min(w, entry.width), copyName(entry, Math.min(w, entry.width))]);
    names.forEach(([, name]) => keep.add(name));
    if (names.every(([, name]) => existsSync(`${OUT}/${name}`))) continue;
    const bytes = original(entry);
    if (!bytes) {
      if (required) throw new Error(`media: no original for ${url}; run npm run media:fetch`);
      missing++;
      continue;
    }
    const image = sharp(bytes, { limitInputPixels: 40000000 }).rotate();
    for (const [width, name] of names) {
      // The whole image, never cropped or enlarged.
      await image.clone().resize({ width, withoutEnlargement: true }).webp({ quality: 86, effort: 4 }).toFile(`${OUT}/${name}`);
      made++;
    }
  }
  for (const name of readdirSync(OUT)) if (!keep.has(name)) rmSync(`${OUT}/${name}`);
  console.log(`media: made ${made} copies${missing ? `; ${missing} images without an original show from their publishers` : ''}`);
}

const commands = { add, upload, fetch: fetchOriginals, build };
const command = commands[process.argv[2]];
if (process.argv[1]?.endsWith('media.mjs')) {
  if (!command) {
    console.error(`usage: node scripts/media.mjs ${Object.keys(commands).join('|')}`);
    process.exit(2);
  }
  await command();
}
