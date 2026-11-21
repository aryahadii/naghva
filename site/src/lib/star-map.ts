import { best, contributors, href, nameOf, otherName, performers, type Lang, type SiteRecord } from './record';

export interface SkyStar {
  id: string;
  name: string;
  alternate: string;
  href: string | null;
  kind: 'artist' | 'recording';
  x: number;
  y: number;
  connections: string[];
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
type Bounds = { x: number; y: number; width: number; height: number };

/** Split the sky by population so large catalogues have space and small ones remain visible. */
function placeGroups(groups: SkyStar[][], bounds: Bounds): void {
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
function projectGalaxy(star: SkyStar): void {
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
function layout(stars: SkyStar[]): void {
  const byId = new Map(stars.map(star => [star.id, star]));
  const queue: { star: SkyStar; group: SkyStar[] }[] = [];
  const assigned = new Set<string>();
  const groups: SkyStar[][] = [];
  function seed(star: SkyStar) {
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
    if (star.kind === 'artist' && star.href) seed(star);
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

/** The graph records person/act membership and individual recording credits, even without a page. */
export function buildStarMap(record: SiteRecord, lang: Lang): SkyStar[] {
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
  const stars: SkyStar[] = items.map(item => ({
    id: item.id, name: nameOf(item, lang).text, alternate: otherName(item, lang)?.text ?? '',
    href: href(record, lang, item), kind: item.type === 'release' ? 'recording' : 'artist',
    connections: [...neighbours.get(item.id)!].sort(), x: 0, y: 0,
  }));
  layout(stars);
  return stars;
}
