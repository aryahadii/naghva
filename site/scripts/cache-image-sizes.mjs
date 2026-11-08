// Keep measured portrait dimensions from a successfully checked build, so a
// later build does not depend on repeated remote dimension lookups.
// Run `npm run build` with source access, then `npm run cache:image-sizes`.
// This copies metadata only; images stay whole on their original hosts.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const record = JSON.parse(readFileSync('generated/record.json', 'utf8'));
if (record.examples) throw new Error('Cache dimensions from the production record, not fictional examples');
const sizes = {};
const measuredPages = new Set();
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
function scan(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { scan(path); continue; }
    if (!name.endsWith('.html')) continue;
    const html = readFileSync(path, 'utf8');
    for (const match of html.matchAll(/<figure\b[^>]*class="infobox-photo"[^>]*>([\s\S]*?)<\/figure>/g)) {
      const image = match[1].match(/<img\b[^>]*>/)?.[0] ?? '';
      const src = attr(image, 'src')?.replace(/&amp;/g, '&');
      const dimensions = { width: Number(attr(image, 'width')), height: Number(attr(image, 'height')) };
      if (!src || !dimensions.width || !dimensions.height) throw new Error(`Unmeasured photo: ${path}`);
      if (sizes[src] && JSON.stringify(sizes[src]) !== JSON.stringify(dimensions)) throw new Error(`Inconsistent dimensions: ${src}`);
      sizes[src] = dimensions;
      measuredPages.add(path);
    }
  }
}
scan('dist');
const expected = record.artists.filter((id) => (record.items[id].statements.image ?? []).some((s) => s.rank !== 'deprecated'))
  .flatMap((id) => record.languages.map((lang) => join('dist', lang, record.items[id].page, 'index.html')));
if (measuredPages.size !== expected.length || expected.some((path) => !measuredPages.has(path)))
  throw new Error('Photograph coverage differs from the record; check the build before caching');
writeFileSync('image-sizes.json', JSON.stringify(Object.fromEntries(Object.entries(sizes).sort()), null, 2) + '\n');
console.log(`Cached dimensions for ${Object.keys(sizes).length} source photographs`);
