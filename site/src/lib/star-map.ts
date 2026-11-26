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

/** A fixed number from 0 to 1 for a star and a purpose: the same on every build. */
function roll(id: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 13), 16777619);
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}
/** A slow wave around a centre, from a few fixed turns of it. It gives an outline its lobes. */
const wave = (angle: number, turns: [number, number, number][]) =>
  turns.reduce((sum, [times, size, phase]) => sum + size * Math.sin(times * angle + 2 * Math.PI * phase), 0);

/** Split the sky by population so large catalogues have space and small ones remain visible. */
function placeGroups(groups: Node[][], bounds: Bounds): void {
  if (!groups.length) return;
  const { x, y, width, height } = bounds;
  if (groups.length === 1) {
    const stars = groups[0];
    const seed = stars[0].id;
    const rotation = 2 * Math.PI * roll(seed, 1);
    // No two clusters have the same outline.
    const lobes: [number, number, number][] = [[2, .2, roll(seed, 2)], [3, .13, roll(seed, 3)], [5, .07, roll(seed, 4)]];
    stars.forEach((star, index) => {
      // The seed artist sits at the centre and its nearest links nearest to it. The golden
      // angle spreads the stars evenly; each strays from its turn of the spiral, so no pattern
      // shows. The cluster is thick at its heart and thins out past the edge of its own ground,
      // into its neighbours'.
      const turn = index && (index + roll(star.id, 5) - .5) / stars.length;
      const angle = rotation + index * GOLDEN_ANGLE + (roll(star.id, 6) - .5) * 1.1;
      const stray = roll(star.id, 7);
      const radius = (.52 * turn ** .6 + (stray > .8 ? .3 * ((stray - .8) / .2) ** 2 * turn : 0)) * (1 + wave(angle, lobes));
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

/** The lobes of the whole sky's outline. The first sets its heart off centre. Together they stay
 * under a third, so the outline never folds back over itself. */
const RIM: [number, number, number][] = [[1, .12, .2], [2, .06, .13], [3, .08, .61], [5, .04, .37]];

/** Bend the packed catalogue into two sweeping arms. The concentric square-to-disc
 * projection keeps the corners separated; the angular warp is strictly increasing
 * at every radius, so the same neighbourhoods stay together without folding over.
 * The disc has no edge: towards the rim its outline wanders and its stars scatter. */
function projectGalaxy(star: Node): void {
  const x = 2 * star.x - 1;
  const y = 2 * star.y - 1;
  let radius = Math.max(Math.abs(x), Math.abs(y));
  if (!radius) return;
  let angle: number;
  if (Math.abs(x) >= Math.abs(y)) {
    angle = (Math.PI / 4) * (y / x) + (x < 0 ? Math.PI : 0);
  } else {
    angle = Math.PI / 2 - (Math.PI / 4) * (x / y) + (y < 0 ? Math.PI : 0);
  }

  // A cluster at the edge of the square reaches past it; those stars go only a little past the rim.
  if (radius > 1) radius = 1 + .25 * Math.tanh(2 * (radius - 1));
  // Narrow two regions of angle, then wind them outwards from the core.
  angle += 2.8 * (1 - radius ** 1.35) - 0.36 * Math.sin(2 * angle);
  const rim = Math.min(radius, 1);
  radius *= 1 + rim ** 2 * wave(angle, RIM) - .2 * (1 + .8 * Math.sin(angle + 1)) * rim ** 5 * Math.max(-2.5, Math.log(1 - roll(star.id, 8))) * roll(star.id, 9);
  const u = radius * Math.cos(angle);
  const v = 0.95 * radius * Math.sin(angle);
  const tilt = -0.33;
  // The furthest strays slow down before the edge of the sky, so none lie on it.
  const place = (n: number) => {
    const out = Math.abs(n - .5);
    return Number((out > .42 ? .5 + Math.sign(n - .5) * (.42 + .07 * Math.tanh((out - .42) / .07)) : n).toFixed(5));
  };
  star.x = place(0.5 + 0.375 * (u * Math.cos(tilt) - v * Math.sin(tilt)));
  star.y = place(0.5 + 0.375 * (u * Math.sin(tilt) + v * Math.cos(tilt)));
}

/** The least distance between two stars, so that a reader who zooms in can tell any two apart. */
const GAP = .0006;
/** Move stars that lie too close a little apart. A few passes settle all but the thickest knots. */
function spread(stars: Node[]): void {
  const cell = (n: number) => Math.floor(n / GAP);
  for (let pass = 0; pass < 6; pass++) {
    const grid = new Map<string, Node[]>();
    for (const star of stars) {
      const key = `${cell(star.x)},${cell(star.y)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(star);
    }
    for (const star of stars) {
      const cx = cell(star.x), cy = cell(star.y);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
        for (const other of grid.get(`${i},${j}`) ?? []) {
          if (other.id <= star.id) continue;
          let dx = other.x - star.x, dy = other.y - star.y;
          let apart = Math.hypot(dx, dy);
          if (apart >= GAP) continue;
          if (!apart) {
            const angle = 2 * Math.PI * roll(star.id, 10);
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            apart = 1;
          }
          const push = (GAP - apart) / 2 / apart;
          star.x -= dx * push;
          star.y -= dy * push;
          other.x += dx * push;
          other.y += dy * push;
        }
      }
    }
  }
  for (const star of stars) {
    star.x = Number(star.x.toFixed(5));
    star.y = Number(star.y.toFixed(5));
  }
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
  spread(stars);
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
