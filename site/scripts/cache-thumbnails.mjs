// Explicit refresh only: ordinary builds use these committed, bounded derivatives.
// Full originals stay on their publishers' hosts, with provenance in the record.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import sharp from 'sharp';

const manifestPath = 'image-thumbnails.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const refresh = process.argv.includes('--refresh');
if (refresh) {
  mkdirSync('public/thumbnails', { recursive: true });
  for (const [url, entry] of Object.entries(manifest)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const original = Buffer.from(await response.arrayBuffer());
    const image = sharp(original, { limitInputPixels: 40000000 }).rotate();
    const { width, height } = (await image.metadata()).autoOrient;
    const variants = [];
    for (const w of [...new Set(entry.widths.map(w => Math.min(w, width)))]) {
      // No cropping or upscaling; retain the complete source photograph/cover.
      const { data, info } = await image.clone().resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 90, effort: 6 }).toBuffer({ resolveWithObject: true });
      const sha256 = digest(data);
      const src = `/thumbnails/${entry.name}-${sha256.slice(0, 16)}.webp`;
      writeFileSync(`public${src}`, data);
      variants.push({ src, width: info.width, height: info.height, bytes: data.length, sha256 });
    }
    for (const old of entry.variants ?? []) {
      if (!variants.some(v => v.src === old.src)) unlinkSync(`public${old.src}`);
    }
    Object.assign(entry, { width, height, bytes: original.length, sha256: digest(original), variants });
    console.log(`${entry.name}: ${original.length} bytes → ${variants.map(v => `${v.width}px ${v.bytes}B`).join(', ')}`);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // GardenFrieze uses only these three motifs, not the rest of the source canvas.
  await sharp('src/assets/art/garden-frieze.png').extract({ left: 0, top: 0, width: 388, height: 292 })
    .webp({ lossless: true, effort: 6 }).toFile('src/assets/art/garden-motifs.webp');
}

for (const [url, entry] of Object.entries(manifest)) {
  if (!entry.variants?.length) throw new Error(`No thumbnails for ${url}; run npm run cache:thumbnails`);
  for (const variant of entry.variants) {
    if (!/^\/thumbnails\/[a-z0-9-]+\.webp$/.test(variant.src)) throw new Error('Unexpected thumbnail path');
    const bytes = readFileSync(`public${variant.src}`);
    const { width, height } = await sharp(bytes).metadata();
    if (digest(bytes) !== variant.sha256 || bytes.length !== variant.bytes || width !== variant.width || height !== variant.height
      || width > entry.width || Math.abs(height - width * entry.height / entry.width) > 1)
      throw new Error(`Invalid thumbnail: ${variant.src}`);
  }
}
console.log(`Checked ${Object.keys(manifest).length} thumbnail sources offline`);
