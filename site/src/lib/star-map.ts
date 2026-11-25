import { yearOf } from './dates';
import {
  best, contributors, href, LANGS, performers, recordingArtists, recordingDate, recordingDates, releaseDates, releasesOf,
  type Item, type SiteRecord,
} from './record';

/** A name in each of the site's languages, English first. */
export type Names = [en: string | null, fa: string | null];

/** One star of the sky the build writes to `/sky.json`. */
export interface SkyEntry {
  /** `p` is a person, `g` a group and `r` a recording. */
  k: 'p' | 'g' | 'r';
  /** Its address without the language: `/slug/`, or `/slug/#panel` for a recording. */
  h?: string;
  /** Its ID, when it has no address to be known by. */
  i?: string;
  n: Names;
  /** Its place in the sky, from 0 to 100,000 across and down. */
  x: number;
  y: number;
  /** The later stars it is linked to, by their place in the list; each link is written once. */
  l: number[];
  /** A small copy of its photo or cover. */
  m?: string;
  /** Where an artist with a page is based, by its place in `places`. */
  p?: number;
  /** Years on record, Gregorian then Jalali: first and last for an artist, one for a recording. */
  d?: number[];
  /** The recording uses a platform posting date rather than a release date. */
  u?: true;
  /** A recording's billed artists, by their place in the list. */
  b?: number[];
}

export interface Sky {
  places: Names[];
  stars: SkyEntry[];
}

interface Node {
  id: string;
  page: boolean;
  x: number;
  y: number;
  connections: string[];
}

/** Places are whole numbers out of this, which keeps the file small. */
export const SCALE = 100_000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
type Bounds = { x: number; y: number; width: number; height: number };

/** Split the sky by population so large catalogues have space and small ones remain visible. */
function placeGroups(groups: Node[][], bounds: Bounds): void {
  if (!groups.length) return;
  const { x, y, width, height } = bounds;
  if (groups.length === 1) {
    const stars = groups[0];
    const rotation = [...stars[0].id].reduce((seed, char) => (seed * 31 + char.charCodeAt(0)) >>> 0, 0);
    stars.forEach((star, index) => {
      // The seed artist sits at the centre. A golden-angle spiral gives every neighbour its own place.
      const radius = 0.47 * Math.sqrt(index / stars.length);
      const angle = rotation + index * GOLDEN_ANGLE;
      star.x = x + width * (0.5 + radius * Math.cos(angle));
      star.y = y + height * (0.5 + radius * Math.sin(angle));
    });
    return;
  }

  const total = groups.reduce((sum, group) => sum + group.length, 0);
  let count = groups[0].length;
  let split = 1;
  while (split < groups.length - 1 && count + groups[split].length / 2 < total / 2) {
    count += groups[split++].length;
  }
  const fraction = count / total;
  const first = groups.slice(0, split);
  const second = groups.slice(split);
  if (width >= height) {
    const cut = width * fraction;
    placeGroups(first, { x, y, width: cut, height });
    placeGroups(second, { x: x + cut, y, width: width - cut, height });
  } else {
    const cut = height * fraction;
    placeGroups(first, { x, y, width, height: cut });
    placeGroups(second, { x, y: y + cut, width, height: height - cut });
  }
}

/** Bend the packed catalogue into two sweeping arms. The concentric square-to-disc
 * projection keeps the corners separated; the angular warp is strictly increasing
 * at every radius, so the same neighbourhoods stay together without folding over. */
function projectGalaxy(star: Node): void {
  const x = 2 * star.x - 1;
  const y = 2 * star.y - 1;
  const radius = Math.max(Math.abs(x), Math.abs(y));
  if (!radius) return;
  let angle: number;
  if (Math.abs(x) >= Math.abs(y)) {
    angle = (Math.PI / 4) * (y / x) + (x < 0 ? Math.PI : 0);
  } else {
    angle = Math.PI / 2 - (Math.PI / 4) * (x / y) + (y < 0 ? Math.PI : 0);
  }

  // Narrow two regions of angle, then wind them outwards from the core.
  angle += 2.8 * (1 - radius ** 1.35) - 0.36 * Math.sin(2 * angle);
  const u = radius * Math.cos(angle);
  const v = 0.76 * radius * Math.sin(angle);
  const tilt = -0.33;
  star.x = Number((0.5 + 0.48 * (u * Math.cos(tilt) - v * Math.sin(tilt))).toFixed(5));
  star.y = Number((0.5 + 0.48 * (u * Math.sin(tilt) + v * Math.cos(tilt))).toFixed(5));
}

/** Multi-source breadth-first traversal assigns each star to its nearest published artist.
 * Components without an artist page form their own constellations. IDs break distance ties. */
function layout(stars: Node[]): void {
  const byId = new Map(stars.map(star => [star.id, star]));
  const queue: { star: Node; group: Node[] }[] = [];
  const assigned = new Set<string>();
  const groups: Node[][] = [];
  function seed(star: Node) {
    const group = [star];
    assigned.add(star.id);
    groups.push(group);
    queue.push({ star, group });
  }
  function expand() {
    for (let i = 0; i < queue.length; i++) {
      const { star, group } = queue[i];
      for (const id of star.connections) {
        if (assigned.has(id)) continue;
        const neighbour = byId.get(id)!;
        assigned.add(id);
        group.push(neighbour);
        queue.push({ star: neighbour, group });
      }
    }
    queue.length = 0;
  }
  for (const star of stars) {
    if (star.page) seed(star);
  }
  expand();
  for (const star of stars) {
    if (assigned.has(star.id)) continue;
    seed(star);
    expand();
  }
  placeGroups(groups, { x: 0, y: 0, width: 1, height: 1 });
  stars.forEach(projectGalaxy);
}

/**
 * Every person, act and recording as a star, linked by group membership and by
 * individual recording credits, even without a page. `thumb` gives an item's
 * small image; a star's few facts come from the same statements its page shows.
 */
export function buildSky(record: SiteRecord, thumb: (item: Item) => string | undefined = () => undefined): Sky {
  const items = Object.values(record.items)
    .filter(item => item.type === 'person' || item.type === 'act' || item.type === 'release')
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const neighbours = new Map(items.map(item => [item.id, new Set<string>()]));
  function connect(a: string, b: string) {
    if (a === b || !neighbours.has(b)) return;
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }
  for (const item of items) {
    if (item.type === 'release') {
      for (const credit of [...performers(record, item), ...contributors(record, item)]) {
        if (credit.type === 'person' || credit.type === 'act') connect(item.id, credit.id);
      }
    } else if (item.type === 'person') {
      for (const statement of best(item.statements['member of'])) {
        if (typeof statement.value === 'string' && record.items[statement.value]?.type === 'act') {
          connect(item.id, statement.value);
        }
      }
    }
  }
  const nodes: Node[] = items.map(item => ({
    id: item.id, page: item.type !== 'release' && Boolean(item.page),
    connections: [...neighbours.get(item.id)!].sort(), x: 0, y: 0,
  }));
  layout(nodes);

  const at = new Map(items.map((item, index) => [item.id, index]));
  const places: Names[] = [];
  const placed = new Map<string, number>();
  const names = (item: Item): Names => [item.names.en?.text ?? null, item.names.fa?.text ?? null];
  const years = (dates: ReturnType<typeof releaseDates>) => LANGS.flatMap((lang) => {
    const all = dates.map((date) => yearOf(date, lang));
    return [Math.min(...all), Math.max(...all)];
  });

  const stars = items.map((item, index): SkyEntry => {
    const { x, y, connections } = nodes[index];
    const address = href(record, LANGS[0], item)?.slice(`/${LANGS[0]}`.length);
    const star: SkyEntry = {
      k: item.type === 'release' ? 'r' : item.type === 'act' ? 'g' : 'p',
      ...(address ? { h: address } : { i: item.id }),
      n: names(item), x: Math.round(x * SCALE), y: Math.round(y * SCALE),
      l: connections.map((id) => at.get(id)!).filter((other) => other > index),
    };
    const image = thumb(item);
    if (image) star.m = image;
    if (item.type === 'release') {
      const date = recordingDate(item);
      if (date) {
        star.d = LANGS.map((lang) => yearOf(date, lang));
        if (recordingDates(item).isPosting) star.u = true;
      }
      const billed = recordingArtists(record, item).flatMap((artist) => at.get(artist.id) ?? []);
      if (billed.length) star.b = billed;
    } else if (item.page) {
      const place = record.items[best(item.statements['based in'])[0]?.value as string];
      if (place) {
        if (!placed.has(place.id)) placed.set(place.id, places.push(names(place)) - 1);
        star.p = placed.get(place.id);
      }
      const dates = releasesOf(record, item).flatMap(releaseDates);
      if (dates.length) star.d = years(dates);
    }
    return star;
  });
  return { places, stars };
}
