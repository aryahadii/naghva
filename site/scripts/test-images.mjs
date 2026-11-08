import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageOf, thumbnailOf } from '../src/lib/images.ts';

test('cached display images preserve the linked original and source provenance', () => {
  const source = 'https://www.salam-music.at/wp-content/uploads/Sanam-Maroufkhani_.jpg';
  const references = [{ source: 'publisher', quote: 'Photograph credit' }];
  const image = imageOf({ statements: { image: [{ value: source, rank: 'normal', references }] } }, 'image', [320, 640, 1200]);
  const shown = thumbnailOf(image);
  assert.ok(shown.src.startsWith('/thumbnails/'));
  assert.ok(shown.srcset.includes('360w'));
  assert.equal(image.src, source);
  assert.equal(image.url, source);
  assert.deepEqual(image.references, references);
});

test('unlisted and changed publisher URLs retain their original delivery and fallback', () => {
  for (const src of ['https://example.org/photo.jpg', 'https://www.salam-music.at/wp-content/uploads/Sanam-Maroufkhani_.jpg?v=2']) {
    const image = { src };
    assert.equal(thumbnailOf(image), image);
  }
});
