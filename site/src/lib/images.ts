import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inferRemoteSize } from 'astro/assets/utils';
import media from '../../media.json';
import { best, isText, type Item, type Reference, type Text } from './record';

/**
 * Naghva shows its own copies of photographs and covers. media.json lists each
 * source address with its original's hash, size and widths; the build makes
 * the copies in public/media/ from originals kept in private storage
 * (scripts/media.mjs). Where a build has no copies, as in a pull request from
 * a fork, an image shows from its publisher instead.
 */

export interface Picture { src: string; srcset?: string; fallback?: string }

interface MediaEntry { sha256: string; width: number; height: number; widths: number[] }
const listed = media as Record<string, MediaEntry>;
// Builds run in site/; the bundled module's own address is not a guide here.
const MEDIA_DIR = pathToFileURL(`${resolve('public/media')}/`);

/** The file name scripts/media.mjs gives a copy; the two must agree. */
const copyName = (entry: MediaEntry, width: number) => `${entry.sha256.slice(0, 16)}-${width}.webp`;

/** Naghva's own copies of the image at `url`, if this build made them. */
export function ownCopy(url: string, dir: URL = MEDIA_DIR): Picture | null {
  const entry = listed[url];
  if (!entry) return null;
  const widths = [...new Set(entry.widths.map((w) => Math.min(w, entry.width)))];
  if (!widths.every((w) => existsSync(new URL(copyName(entry, w), dir)))) return null;
  const at = (w: number) => `/media/${copyName(entry, w)}`;
  return { src: at(widths[widths.length - 1]), srcset: widths.map((w) => `${at(w)} ${w}w`).join(', ') };
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

/**
 * The image an item's `property` shows: the preferred one, otherwise the
 * first. It is Naghva's own copy when there is one, with the publisher's as
 * the fallback a page tries if that copy fails.
 */
export function imageOf(item: Item, property: string, widths: number[]): LinkedImage | null {
  const statement = best(item.statements[property]).find((s) => typeof s.value === 'string' && /^https?:\/\//.test(s.value));
  if (!statement) return null;
  const url = statement.value as string;
  const credit = statement.qualifiers?.credit?.find(isText) ?? null;
  const license = statement.qualifiers?.license?.find((v): v is string => typeof v === 'string') ?? null;
  const publisher = picture(url, widths);
  const own = ownCopy(url);
  const shown = own ? { ...own, fallback: publisher.src } : publisher;
  return { url, ...shown, credit, license, references: statement.references };
}

/** The full address to give other sites for an image: Naghva's largest copy, or else the source. */
export const addressOf = (image: LinkedImage, site: URL) => image.fallback ? new URL(image.src, site).href : image.url;

const sizes = new Map<string, Promise<{ width: number; height: number } | null>>();

/**
 * The width and height of the image at `url`, so the page keeps its place
 * while it loads: from media.json, or else asked of the publisher. The output
 * check rejects an artist page whose photo was left out for want of a size.
 */
export function sizeOf(url: string) {
  const entry = listed[url];
  if (entry) return Promise.resolve({ width: entry.width, height: entry.height });
  if (!sizes.has(url)) {
    sizes.set(url, inferRemoteSize(url).then(
      ({ width, height }) => ({ width, height }),
      (error) => {
        console.warn(`[naghva] no size for ${url}, so it is left out: ${error.message ?? error}`);
        return null;
      },
    ));
  }
  return sizes.get(url)!;
}
