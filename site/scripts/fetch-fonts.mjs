// Puts the three Persian font files in src/assets/fonts before a build.
//
// The live site uses Farhang2 and IRANSansX from Fontiran, licensed to the
// owner, so the files are not in this repository. They live in the private
// R2 bucket under fonts/<name> (see scripts/media.mjs for the keys). In order:
//
//   1. With an R2 key, each file is downloaded from the bucket, replacing
//      whatever is in place (a stand-in uses the same file name).
//   2. With NAGHVA_FONTS_URL (a private folder holding the licensed copies,
//      with NAGHVA_FONTS_TOKEN if it needs one), from there.
//   3. Otherwise the free Vazirmatn stands in under the same file names, so
//      anyone can build the site. Files already in place are kept.
//
// NAGHVA_MEDIA_REQUIRED=1 fails unless the licensed fonts came from 1 or 2,
// so a deploy never ships Vazirmatn.
//
//   node scripts/fetch-fonts.mjs                 fetch, as above
//   node scripts/fetch-fonts.mjs upload <folder> put the three files from
//                                                <folder> in the bucket (write key)
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bucket } from './media.mjs';

const dir = fileURLToPath(new URL('../src/assets/fonts/', import.meta.url));
const vazirmatn = join(dirname(fileURLToPath(import.meta.resolve('@fontsource/vazirmatn/400.css'))), 'files');
const files = {
  'Farhang2-Bold.woff2': 700,
  'IRANSansXNoEn-Regular.woff2': 400,
  'IRANSansXNoEn-Bold.woff2': 700,
};
const key = (name) => `fonts/${name}`;
const required = process.env.NAGHVA_MEDIA_REQUIRED === '1';
const exists = (path) => access(path).then(() => true, () => false);

async function upload(folder) {
  if (!folder) throw new Error('usage: npm run fonts:upload <folder with the three .woff2 files>');
  const r2 = await bucket();
  if (!r2) throw new Error('fonts: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (the write key)');
  const bodies = await Promise.all(Object.keys(files).map((name) => readFile(join(folder, name))));
  for (const [i, name] of Object.keys(files).entries()) {
    await r2.put(key(name), bodies[i], 'font/woff2');
    console.log(`fonts: uploaded ${key(name)}`);
  }
}

/** The licensed files from the bucket, or null when it has no key or not all of them. */
async function fromBucket() {
  const r2 = await bucket();
  if (!r2) return null;
  const missing = [];
  for (const name of Object.keys(files)) if (!(await r2.has(key(name)))) missing.push(key(name));
  if (missing.length) {
    const message = `fonts: not in the bucket yet: ${missing.join(', ')}; run npm run fonts:upload <folder>`;
    if (required) throw new Error(message);
    console.warn(message);
    return null;
  }
  return Object.fromEntries(await Promise.all(Object.keys(files).map(async (name) => [name, await r2.get(key(name))])));
}

async function fromUrl() {
  const base = process.env.NAGHVA_FONTS_URL;
  if (!base) return null;
  const token = process.env.NAGHVA_FONTS_TOKEN;
  const out = {};
  for (const name of Object.keys(files)) {
    const url = new URL(name, base.endsWith('/') ? base : `${base}/`);
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error(`fonts: ${name}: HTTP ${response.status} from NAGHVA_FONTS_URL`);
    out[name] = Buffer.from(await response.arrayBuffer());
  }
  return out;
}

async function fetchFonts() {
  await mkdir(dir, { recursive: true });
  const licensed = (await fromBucket()) ?? (await fromUrl());
  if (licensed) {
    for (const [name, bytes] of Object.entries(licensed)) await writeFile(join(dir, name), bytes);
    return;
  }
  if (required) throw new Error('fonts: this build needs the licensed fonts; set the R2 read key or NAGHVA_FONTS_URL');
  for (const [name, weight] of Object.entries(files)) {
    const target = join(dir, name);
    if (await exists(target)) continue;
    await copyFile(join(vazirmatn, `vazirmatn-arabic-${weight}-normal.woff2`), target);
    console.log(`fonts: ${name} is Vazirmatn (no R2 key or NAGHVA_FONTS_URL for the licensed font)`);
  }
}

if (process.argv[2] === 'upload') await upload(process.argv[3]);
else await fetchFonts();
