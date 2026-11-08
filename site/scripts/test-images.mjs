import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import media from '../media.json' with { type: 'json' };
import { addressOf, imageOf, ownCopy, sizeOf } from '../src/lib/images.ts';

const source = 'https://www.salam-music.at/wp-content/uploads/Sanam-Maroufkhani_.jpg';
const entry = media[source];

test('every listed image has a hash, a size and widths', () => {
  for (const [url, e] of Object.entries(media)) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/, url);
    assert.ok(e.width > 0 && e.height > 0 && e.widths.length, url);
  }
});

test("Naghva's own copies are used once the build has made them, never enlarged", () => {
  const dir = mkdtempSync(join(tmpdir(), 'naghva-media-'));
  const widths = [...new Set(entry.widths.map((w) => Math.min(w, entry.width)))];
  for (const w of widths) writeFileSync(join(dir, `${entry.sha256.slice(0, 16)}-${w}.webp`), '');
  const own = ownCopy(source, pathToFileURL(`${dir}/`));
  assert.ok(own.src.startsWith('/media/') && own.src.endsWith(`-${widths.at(-1)}.webp`));
  assert.equal(own.srcset.split(', ').length, widths.length);
  assert.ok(widths.every((w) => w <= entry.width));
});

test('without its own copies, an image shows from its publisher, with its provenance', () => {
  const empty = pathToFileURL(`${mkdtempSync(join(tmpdir(), 'naghva-media-'))}/`);
  assert.equal(ownCopy(source, empty), null);
  assert.equal(ownCopy('https://example.org/unlisted.jpg'), null);
  const references = [{ source: 'publisher', quote: 'Photograph credit' }];
  const image = imageOf({ statements: { image: [{ value: source, rank: 'normal', references }] } }, 'image', [320, 640, 1200]);
  assert.equal(image.url, source);
  assert.deepEqual(image.references, references);
  if (!image.fallback) assert.equal(addressOf(image, new URL('https://naghva.com')), source);
});

test('listed images take their size from media.json, without asking the publisher', async () => {
  assert.deepEqual(await sizeOf(source), { width: entry.width, height: entry.height });
});
