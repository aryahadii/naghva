import type { APIRoute } from 'astro';
import { COVER_WIDTHS, imageOf, PHOTO_WIDTHS } from '../lib/images';
import { loadRecord, type Item } from '../lib/record';
import { buildSky } from '../lib/star-map';

/**
 * The star map's sky: every person, act and recording with its place, its
 * links and the few facts its card shows. The homepage fetches it once, for
 * both languages.
 */

/** The smallest copy of an item's photo or cover, which is all a card needs. */
function thumb(item: Item): string | undefined {
  const image = item.type === 'release' ? imageOf(item, 'cover art', COVER_WIDTHS) : imageOf(item, 'image', PHOTO_WIDTHS);
  return image?.srcset?.split(',')[0].trim().split(' ')[0] ?? image?.src;
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildSky(loadRecord(), thumb)), { headers: { 'Content-Type': 'application/json' } });
