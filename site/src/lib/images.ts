import { inferRemoteSize } from 'astro/assets/utils';
import measuredSizes from '../../image-sizes.json';
import thumbnails from '../../image-thumbnails.json';
import { best, isText, type Item, type Reference, type Text } from './record';

/**
 * Original images and provenance stay linked to their publishers. Hosts that
 * offer resized copies supply them directly; explicitly cached display
 * thumbnails are selected separately, preserving the linked original.
 */

export interface Picture { src: string; srcset?: string }

/** Cached derivatives only for explicitly measured sources; all others stay remote. */
export function thumbnailOf(picture: Picture): Picture {
  const cached = (thumbnails as Record<string, { variants: { src: string; width: number }[] }>)[picture.src];
  if (!cached) return picture;
  return {
    src: cached.variants[cached.variants.length - 1].src,
    srcset: cached.variants.map(v => `${v.src} ${v.width}w`).join(', '),
  };
}
export interface LinkedImage extends Picture {
  url: string;
  credit: Text | null;
  license: string | null;
  references: Reference[];
}

// Apple Music artwork takes any size in its last path segment.
const APPLE = /^(https:\/\/[a-z0-9-]+\.mzstatic\.com\/.+)\/\d+x\d+[a-z]*(?:-\d+)?\.(?:jpe?g|png|webp)$/;
// Spotify keeps an album cover at 640px and 300px under the same hash.
const SPOTIFY = /^https:\/\/i\.scdn\.co\/image\/ab67616d(?:0000b273|00001e02)([0-9a-f]+)$/;
// YouTube makes a 320px and a 1280px copy of a video's thumbnail without bars.
const YOUTUBE = /^https:\/\/i\.ytimg\.com\/vi\/([\w-]+)\/(?:mq|maxres)default\.jpg$/;

/** The image at `url`, with the copies its host offers up to about `widths`' largest. */
export function picture(url: string, widths: number[]): Picture {
  const apple = url.match(APPLE);
  if (apple) {
    const at = (w: number) => `${apple[1]}/${w}x${w}bb.webp`;
    return { src: at(widths[widths.length - 1]), srcset: widths.map((w) => `${at(w)} ${w}w`).join(', ') };
  }
  const spotify = url.match(SPOTIFY);
  if (spotify) {
    const at = (size: string) => `https://i.scdn.co/image/ab67616d${size}${spotify[1]}`;
    return { src: at('0000b273'), srcset: `${at('00001e02')} 300w, ${at('0000b273')} 640w` };
  }
  const youtube = url.match(YOUTUBE);
  if (youtube) {
    const at = (name: string) => `https://i.ytimg.com/vi/${youtube[1]}/${name}default.jpg`;
    return { src: at('maxres'), srcset: `${at('mq')} 320w, ${at('maxres')} 1280w` };
  }
  return { src: url };
}

export const COVER_WIDTHS = [180, 360, 720];
export const PHOTO_WIDTHS = [320, 640, 1200];

/** The image an item's `property` shows: the preferred one, otherwise the first. */
export function imageOf(item: Item, property: string, widths: number[]): LinkedImage | null {
  const statement = best(item.statements[property]).find((s) => typeof s.value === 'string' && /^https?:\/\//.test(s.value));
  if (!statement) return null;
  const url = statement.value as string;
  const credit = statement.qualifiers?.credit?.find(isText) ?? null;
  const license = statement.qualifiers?.license?.find((v): v is string => typeof v === 'string') ?? null;
  return { url, ...picture(url, widths), credit, license, references: statement.references };
}

const sizes = new Map<string, Promise<{ width: number; height: number } | null>>();

/**
 * An image's measured width and height, so the page keeps its place while it loads.
 * Saved measurements make builds independent of repeated remote lookups.
 * Unknown sources are probed; the output check rejects an omitted photograph.
 */
export function sizeOf(src: string) {
  const measured = (measuredSizes as Record<string, { width: number; height: number }>)[src];
  if (measured) return Promise.resolve(measured);
  if (!sizes.has(src)) {
    sizes.set(src, inferRemoteSize(src).then(
      ({ width, height }) => ({ width, height }),
      (error) => {
        console.warn(`[naghva] no size for ${src}, so it is left out: ${error.message ?? error}`);
        return null;
      },
    ));
  }
  return sizes.get(src)!;
}
