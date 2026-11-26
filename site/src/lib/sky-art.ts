/**
 * The painted pieces the star map is drawn with, in the manner of a miniature:
 * a lapis night for the ground, gold leaf and cream paint for the stars, cloud
 * bands and a moon for landmarks. The files are in `src/assets/art/sky/`.
 */

export interface SkyArtFiles {
  ground: string;
  marks: string;
  clouds: string[];
  moon: string;
}

/** The pigments a star can be painted in. */
export const HUES = ['gold', 'rose', 'coral', 'turquoise', 'cream', 'lapis'] as const;
export type Hue = (typeof HUES)[number];

/** Gold is the leaf as it was painted; the others are the same leaf under a wash. */
const WASH: Record<Hue, string | null> = {
  gold: null, rose: '#f6b98c', coral: '#f08a70', turquoise: '#57cfc2', cream: '#f8ecd4', lapis: '#9fb4ff',
};
/** The light each pigment gives off, as the three parts of an `rgb()`. */
export const LIGHT: Record<Hue, string> = {
  gold: '255,203,118', rose: '255,186,140', coral: '255,146,118',
  turquoise: '104,232,214', cream: '255,241,212', lapis: '152,178,255',
};

/**
 * `marks.webp` is a grid of square cells, six of each kind to a row: eight-pointed
 * stars, four-pointed stars, gold dots, cream dots.
 */
export const MARK = { cell: 96, variants: 6, star: 0, spark: 1, dot: 2, pearl: 3 } as const;

/** Where the landmarks stand, in the sky's own units (0 to 1 across it), so they move with the map. */
export const CLOUDS = [
  { image: 0, x: .13, y: .17, wide: .26, flip: false },
  { image: 1, x: .9, y: .27, wide: .13, flip: true },
  { image: 2, x: .07, y: .76, wide: .13, flip: false },
  { image: 3, x: .93, y: .74, wide: .12, flip: true },
  { image: 4, x: .6, y: .95, wide: .28, flip: false },
  { image: 3, x: .47, y: .045, wide: .1, flip: false },
];
export const MOON = { x: .8, y: .09, wide: .075 };

/** A fixed number from 0 to 1 for a star: the same in both languages and on every visit. */
export function chance(key: string, salt = 0) {
  let hash = 2166136261 ^ salt;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 13), 16777619);
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}

const SHARES: Record<'page' | 'artist' | 'recording', [number, Hue][]> = {
  page: [[.52, 'gold'], [.68, 'rose'], [.84, 'coral'], [1, 'turquoise']],
  artist: [[.5, 'gold'], [.68, 'cream'], [.84, 'turquoise'], [1, 'coral']],
  recording: [[.36, 'cream'], [.62, 'gold'], [.76, 'coral'], [.9, 'turquoise'], [1, 'lapis']],
};
/** A star's pigment. Gold leads among the artists and cream among the recordings. */
export function hueOf(star: { key: string; kind: 'artist' | 'recording'; page: boolean }): Hue {
  const shares = SHARES[star.kind === 'recording' ? 'recording' : star.page ? 'page' : 'artist'];
  const roll = chance(star.key, 3);
  return (shares.find(([limit]) => roll < limit) ?? shares[shares.length - 1])[1];
}

export interface SkyArt {
  ground: string;
  /** The marks in each pigment, from full size down by halves, so a small star is cut from a small sheet. */
  sheets: Record<Hue, CanvasImageSource[]>;
  /** The soft light around a star, in each pigment. */
  halos: Record<Hue, HTMLCanvasElement>;
  clouds: HTMLImageElement[];
  moon: HTMLImageElement;
}

const picture = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(src));
  image.src = src;
});
function sheetOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, paint: canvas.getContext('2d')! };
}
/** The sheet under a wash of one pigment, keeping the grain of the leaf. */
function washed(sheet: HTMLImageElement, colour: string) {
  const { naturalWidth: width, naturalHeight: height } = sheet;
  const wash = sheetOf(width, height), result = sheetOf(width, height);
  wash.paint.fillStyle = colour;
  wash.paint.fillRect(0, 0, width, height);
  wash.paint.globalCompositeOperation = 'destination-in';
  wash.paint.drawImage(sheet, 0, 0);
  result.paint.drawImage(sheet, 0, 0);
  result.paint.globalCompositeOperation = 'color';
  result.paint.drawImage(wash.canvas, 0, 0);
  result.paint.globalCompositeOperation = 'source-atop';
  result.paint.globalAlpha = .38;
  result.paint.drawImage(wash.canvas, 0, 0);
  return result.canvas;
}
function halves(sheet: HTMLImageElement | HTMLCanvasElement, width: number, height: number) {
  const sizes: CanvasImageSource[] = [sheet];
  let last: CanvasImageSource = sheet;
  for (let step = 2; step <= 8; step *= 2) {
    const { canvas, paint } = sheetOf(width / step, height / step);
    paint.imageSmoothingQuality = 'high';
    paint.drawImage(last, 0, 0, canvas.width, canvas.height);
    sizes.push(canvas);
    last = canvas;
  }
  return sizes;
}
function halo(rgb: string) {
  const { canvas, paint } = sheetOf(96, 96);
  const light = paint.createRadialGradient(48, 48, 0, 48, 48, 48);
  for (const [stop, alpha] of [[0, .72], [.2, .3], [.5, .075], [1, 0]]) light.addColorStop(stop, `rgba(${rgb},${alpha})`);
  paint.fillStyle = light;
  paint.fillRect(0, 0, 96, 96);
  return canvas;
}

/** Fetch the pieces and prepare them for painting. Fails if any of them cannot be had. */
export async function loadSkyArt(files: SkyArtFiles): Promise<SkyArt> {
  const [marks, moon, , ...clouds] = await Promise.all(
    [files.marks, files.moon, files.ground, ...files.clouds].map(picture),
  );
  const each = <T>(make: (hue: Hue) => T) => Object.fromEntries(HUES.map((hue) => [hue, make(hue)])) as Record<Hue, T>;
  const { naturalWidth: width, naturalHeight: height } = marks;
  return {
    ground: files.ground,
    sheets: each((hue) => halves(WASH[hue] ? washed(marks, WASH[hue]) : marks, width, height)),
    halos: each((hue) => halo(LIGHT[hue])),
    clouds,
    moon,
  };
}
