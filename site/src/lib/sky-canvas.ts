import { COMET_LIMIT, connectionBend, connectionPoint, skyComet } from './sky-comet';
import type { SkyStar } from './sky-data';
import { coastStep, gestureVelocity } from './sky-motion';

/**
 * The sky the homepage shows: a small preview in the page, and the same sky
 * opened to fill the screen. The preview only shows itself off: it lights one
 * artist after another, follows the mouse, and leaves every scroll and swipe
 * to the page. The full view pans, zooms and flies to the star that is chosen.
 */

type Point = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };
type Label = Box & { index: number };
type View = { centre: Point; scale: number; spot: Point };

export type SkyMode = 'preview' | 'full';

export interface SkyOptions {
  lang: 'en' | 'fa';
  /** The full view's name for a screen reader, and the ID of its keyboard instructions. */
  label: string;
  describedBy: string;
  /** A star was chosen in the full view; -1 when the choice was cleared. */
  onSelect(index: number): void;
  /** The preview was clicked, on the star at `index` if the mouse pointed at one. */
  onOpen(index: number): void;
}

export interface SkyView {
  /** The sky's own element, to put wherever it should show. */
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  /** How the sky behaves: a preview in the page, or the full view. */
  setMode(mode: SkyMode): void;
  /** Fit the sky to where its element now is. `room` is what the full view's bars cover. */
  layout(room?: { top: number; bottom: number }): void;
  /** Choose a star, or none with -1. `fly` brings it into view; `centre` brings it to the middle even if it already is. */
  select(index: number, fly?: boolean, centre?: boolean): void;
  zoom(factor: number): void;
  fit(): void;
  /** The star the preview is showing, which is where the full view starts. */
  featured(): number;
  /** Another artist with a page, in no order. */
  next(): number;
  /** The card to keep beside the chosen star. */
  setCard(card: HTMLElement | null): void;
  dispose(): void;
}

const GOLD = ['#ffd08a', '#ffac63', '#fff0b2', '#ffc276'];
const JADE = ['#75f6df', '#4cd9e8', '#acfff2', '#72caff'];
const MAX_ZOOM = 20;
/** The preview lights one artist at a time: its links grow out, stay a while, and fade. */
const BEACON = { first: 900, draw: 1000, hold: 3300, fade: 500, rest: 700, links: 18 };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const overlap = (a: Box, b: Box, gap: number) =>
  a.left < b.left + b.width + gap && a.left + a.width + gap > b.left &&
  a.top < b.top + b.height + gap && a.top + a.height + gap > b.top;

function sparkle(ctx: CanvasRenderingContext2D, point: Point, r: number) {
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - r);
  ctx.quadraticCurveTo(point.x + r * 0.12, point.y - r * 0.12, point.x + r * 0.82, point.y);
  ctx.quadraticCurveTo(point.x + r * 0.12, point.y + r * 0.12, point.x, point.y + r);
  ctx.quadraticCurveTo(point.x - r * 0.12, point.y + r * 0.12, point.x - r * 0.82, point.y);
  ctx.quadraticCurveTo(point.x - r * 0.12, point.y - r * 0.12, point.x, point.y - r);
  ctx.fill();
}

/** An open band of light with a dark centre. Feather one side so it reads
 * as atmospheric haze rather than a boundary around a set of records. */
function hollowHalo(colour: string) {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 192;
  const paint = sprite.getContext('2d')!;
  const radius = sprite.width / 2;
  const band = paint.createRadialGradient(radius, radius, 0, radius, radius, radius);
  for (const [stop, alpha] of [[0, 0], [.42, 0], [.61, .12], [.72, .24], [.83, .1], [1, 0]]) {
    band.addColorStop(stop, `rgba(${colour},${alpha})`);
  }
  paint.fillStyle = band;
  paint.fillRect(0, 0, sprite.width, sprite.height);
  const fade = paint.createLinearGradient(0, sprite.height, sprite.width, 0);
  fade.addColorStop(0, 'transparent');
  fade.addColorStop(.36, 'rgba(0,0,0,.13)');
  fade.addColorStop(.9, 'black');
  paint.globalCompositeOperation = 'destination-in';
  paint.fillStyle = fade;
  paint.fillRect(0, 0, sprite.width, sprite.height);
  return sprite;
}

// Cache the light falloff once per colour so a moving sky needs no per-star blur.
function haloSprite(rgb: string) {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 48;
  const glow = sprite.getContext('2d')!;
  const gradient = glow.createRadialGradient(24, 24, 0, 24, 24, 24);
  gradient.addColorStop(0, 'rgba(255,255,248,.96)');
  gradient.addColorStop(.1, 'rgba(255,248,227,.87)');
  gradient.addColorStop(.23, `rgba(${rgb},.36)`);
  gradient.addColorStop(.48, `rgba(${rgb},.09)`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  glow.fillStyle = gradient;
  glow.fillRect(0, 0, 48, 48);
  return sprite;
}

/** The camera lives in map coordinates, so resizing never changes which region is in view. */
export function makeSky(stars: SkyStar[], options: SkyOptions): SkyView | null {
  const stage = document.createElement('div');
  stage.className = 'sky-stage';
  const add = <K extends 'canvas' | 'span' | 'i'>(tag: K, name: string, parent: HTMLElement = stage) => {
    const element = document.createElement(tag);
    if (name) element.className = name;
    parent.append(element);
    return element;
  };
  const field = add('canvas', 'sky-field');
  const glints = add('span', 'sky-glints');
  const trail = add('span', 'sky-trail');
  const canvas = add('canvas', 'sky-canvas');
  const glintSlots = Array.from({ length: 16 }, (_, i) => {
    const glint = add('i', '', glints);
    glint.hidden = true;
    glint.style.animationDuration = `${4.7 + ((i * 13) % 37) / 10}s`;
    glint.style.animationDelay = `${-(i * 1.73)}s`;
    return glint;
  });
  for (let i = 0; i < COMET_LIMIT; i++) add('span', 'sky-comet', trail);
  for (const layer of [field, glints, trail]) layer.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const fieldContext = field.getContext('2d');
  if (!ctx || !fieldContext) return null;

  const neighbours = stars.map((star) => star.links);
  // In the overview, show a few short, real links in each artist's neighbourhood.
  // The complete set of edges for a star is drawn when that star is selected.
  const links: [number, number][] = [];
  const seen = new Set<string>();
  for (const [i, star] of stars.entries()) {
    if (star.kind !== 'artist' || (!star.page && i % 9 !== 0)) continue;
    const nearby = [...neighbours[i]].sort((a, b) => distance(stars[a], star) - distance(stars[b], star));
    for (const j of nearby.slice(0, star.page ? 3 : 1)) {
      const key = [Math.min(i, j), Math.max(i, j)].join('/');
      if (seen.has(key) || distance(star, stars[j]) > 0.14) continue;
      links.push([i, j]);
      seen.add(key);
    }
  }
  let mode: SkyMode = 'preview';
  let pads = { top: 0, bottom: 0 };
  let w = 0,
    h = 0,
    ratio = 1,
    frame = 0;
  let centre: Point = { x: 0.5, y: 0.5 },
    scale = 1;
  let selected = -1,
    hovered = -1;
  let points: Point[] = [],
    labels: Label[] = [];
  // Name an artist near each of these separated areas first, so the opening
  // labels describe the breadth of the sky regardless of catalogue sort order.
  const artistPages = stars.flatMap((star, i) => (star.page ? [i] : []));
  const anchors = [
    [0.48, 0.48],
    [0.74, 0.35],
    [0.25, 0.42],
    [0.69, 0.69],
    [0.34, 0.7],
    [0.48, 0.21],
    [0.83, 0.5],
    [0.13, 0.59],
  ];
  const landmarks = new Set<number>();
  for (const [x, y] of anchors) {
    let best = Infinity,
      nearest = -1;
    for (const i of artistPages) {
      if (landmarks.has(i)) continue;
      const d = distance(stars[i], { x, y });
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    if (nearest >= 0) landmarks.add(nearest);
  }
  const pointers = new Map<number, Point>();
  let moved = false;
  let down: Point = { x: 0, y: 0 };
  // The full view keeps its sky clear of the bars above and below it.
  const margin = () => Math.min(38, Math.min(w, h) * 0.085);
  const padTop = () => Math.max(margin(), pads.top);
  const padBottom = () => Math.max(margin(), pads.bottom);
  const spanX = () => Math.max(1, w - margin() * 2);
  const spanY = () => Math.max(1, h - padTop() - padBottom());
  const midY = () => padTop() + spanY() / 2;
  const heart = (): Point => ({ x: w / 2, y: midY() });
  const project = (p: Point): Point => ({
    x: w / 2 + (p.x - centre.x) * scale * spanX(),
    y: midY() + (p.y - centre.y) * scale * spanY(),
  });
  // The edge of the atlas can always be moved away from the screen edge.
  const within = (p: Point, zoom: number): Point => {
    const reach = 0.25 / zoom;
    return { x: clamp(p.x, reach, 1 - reach), y: clamp(p.y, reach, 1 - reach) };
  };
  function constrain() {
    centre = within(centre, scale);
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function zoom(factor: number, at: Point = heart()) {
    comet.interrupt();
    const next = clamp(scale * factor, 1, MAX_ZOOM);
    centre.x += ((at.x - w / 2) / spanX()) * (1 / scale - 1 / next);
    centre.y += ((at.y - midY()) / spanY()) * (1 / scale - 1 / next);
    scale = next;
    constrain();
    schedule();
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const velocity = gestureVelocity();
  type Motion = { kind: 'glide'; x: number; y: number; z: number; anchor: Point }
    | { kind: 'zoom'; target: number; anchor: Point; home: boolean }
    | { kind: 'fly'; star: number; direct: boolean; from: View; to: View; dip: number; start: number; duration: number };
  let motion: Motion | null = null;
  let lastFrame = 0;
  let gestureAnchor: Point = { x: 0, y: 0 };

  function pan(dx: number, dy: number) {
    comet.interrupt();
    centre.x -= dx / (spanX() * scale);
    centre.y -= dy / (spanY() * scale);
    constrain();
  }
  function begin(next: Motion) {
    motion = next;
    lastFrame = performance.now();
    schedule();
  }
  function easeZoom(factor: number, anchor = heart(), home = false) {
    const base = motion?.kind === 'zoom' ? motion.target : scale;
    const target = home ? 1 : clamp(base * factor, 1, MAX_ZOOM);
    if (reducedMotion.matches) {
      motion = null;
      zoom(target / scale, anchor);
      if (home) centre = { x: 0.5, y: 0.5 };
    } else if (motion?.kind === 'zoom') {
      // New wheel ticks retarget the running animation without resetting its frame clock.
      motion = { kind: 'zoom', target, anchor, home };
    } else begin({ kind: 'zoom', target, anchor, home });
  }
  function advance(now: number) {
    if (!motion) return;
    const elapsed = Math.max(0, now - lastFrame);
    lastFrame = now;
    if (motion.kind === 'fly') {
      comet.interrupt();
      const { from, to } = motion;
      const t = clamp((now - motion.start) / motion.duration, 0, 1);
      // A star already in view answers at once; a far one eases out of where the reader was looking.
      const eased = motion.direct ? 1 - (1 - t) ** 3 : t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      scale = clamp(Math.exp(mix(Math.log(from.scale), Math.log(to.scale), eased) - motion.dip * Math.sin(Math.PI * t)), 1, MAX_ZOOM);
      if (motion.direct) {
        // The star itself moves in a straight line across the screen while the sky grows around it.
        const star = stars[motion.star];
        centre = {
          x: star.x - (mix(from.spot.x, to.spot.x, eased) - w / 2) / (scale * spanX()),
          y: star.y - (mix(from.spot.y, to.spot.y, eased) - midY()) / (scale * spanY()),
        };
      } else {
        centre = { x: mix(from.centre.x, to.centre.x, eased), y: mix(from.centre.y, to.centre.y, eased) };
      }
      constrain();
      if (t === 1) motion = null;
      else schedule();
      return;
    }
    if (motion.kind === 'zoom') {
      const fraction = reducedMotion.matches ? 1 : -Math.expm1(-elapsed / 65);
      const remaining = Math.log(motion.target / scale);
      const close = Math.abs(remaining) < .001 && (!motion.home || distance(centre, { x: .5, y: .5 }) < .0005);
      zoom(Math.exp(remaining * (close ? 1 : fraction)), motion.anchor);
      if (motion.home) {
        centre.x += (.5 - centre.x) * (close ? 1 : fraction);
        centre.y += (.5 - centre.y) * (close ? 1 : fraction);
      }
      if (close || fraction === 1) motion = null;
      return;
    }
    if (reducedMotion.matches || elapsed > 150) { motion = null; return; }
    const lateral = coastStep(elapsed, 240), pinch = coastStep(elapsed, 110);
    const beforeScale = scale;
    zoom(Math.exp(motion.z * pinch.travel), motion.anchor);
    if (scale === beforeScale && elapsed > 0) motion.z = 0;
    const { x: oldX, y: oldY } = centre;
    pan(motion.x * lateral.travel, motion.y * lateral.travel);
    motion.x = centre.x === oldX && elapsed > 0 ? 0 : motion.x * lateral.decay;
    motion.y = centre.y === oldY && elapsed > 0 ? 0 : motion.y * lateral.decay;
    motion.z *= pinch.decay;
    if (Math.hypot(motion.x, motion.y) < .012 && Math.abs(motion.z) < .00003) motion = null;
  }
  function fit(animated = false) {
    comet.interrupt();
    hovered = -1;
    if (animated) { easeZoom(1, undefined, true); return; }
    motion = null;
    centre = { x: .5, y: .5 };
    scale = 1;
    schedule();
  }
  /** Whether most of a star's links run upward, so its card hides fewer of them from below. */
  const linksRise = (index: number) =>
    neighbours[index].filter((other) => stars[other].y < stars[index].y).length * 2 > neighbours[index].length;
  /** Bring a star to where its card has room, close enough to tell its own links apart. */
  function flyTo(index: number, always: boolean) {
    const star = stars[index];
    const room = spanY();
    const focus = { x: w / 2, y: padTop() + room * (linksRise(index) ? .44 : .56) };
    const reach = neighbours[index]
      .map((other) => Math.hypot((stars[other].x - star.x) * spanX(), (stars[other].y - star.y) * spanY()))
      .sort((a, b) => a - b);
    const typical = reach[Math.floor(reach.length * .6)];
    const wanted = typical ? clamp((.3 * Math.min(w, room)) / typical, 1, 8) : 2.5;
    const spot = project(star);
    const inView = spot.x > 24 && spot.x < w - 24 && spot.y > pads.top + 24 && spot.y < h - pads.bottom - 24;
    // A reader who has zoomed in further keeps their zoom; a star they tapped in a comfortable place stays there.
    const tall = (cardSize.height || 170) + 36;
    const roomy = spot.y - tall >= pads.top && spot.y + tall <= h - pads.bottom;
    if (!always && inView && roomy && scale >= wanted * .8) return;
    const target = inView ? Math.max(scale, wanted) : wanted;
    const to = within({
      x: star.x - (focus.x - w / 2) / (target * spanX()),
      y: star.y - (focus.y - midY()) / (target * spanY()),
    }, target);
    const landing = {
      x: w / 2 + (star.x - to.x) * target * spanX(),
      y: midY() + (star.y - to.y) * target * spanY(),
    };
    if (reducedMotion.matches) {
      centre = to;
      scale = target;
      return;
    }
    // A long way off, the sky draws back first, so the trip shows where it is going.
    const low = Math.min(scale, target);
    const far = Math.hypot((to.x - centre.x) * spanX(), (to.y - centre.y) * spanY()) * low / Math.max(w, h);
    const dip = inView || far < .9 ? 0 : Math.min(Math.log(low), Math.log(far / .9));
    begin({
      kind: 'fly', star: index, direct: inView, dip,
      from: { centre: { ...centre }, scale, spot },
      to: { centre: to, scale: target, spot: landing },
      start: performance.now(),
      duration: clamp(380 + 300 * far + 240 * Math.abs(Math.log(target / scale)), 380, 1200),
    });
  }
  function select(index: number, fly = false, centre = false) {
    comet.interrupt();
    motion = null;
    selected = index;
    hovered = -1;
    if (fly && selected >= 0 && mode === 'full' && w) flyTo(selected, centre);
    schedule();
  }
  /** A choice the reader made on the sky itself. */
  function pick(index: number) {
    if (index < 0 && selected < 0) return;
    select(index, true);
    options.onSelect(index);
  }

  const amberHalo = haloSprite('248,183,125');
  const cyanHalo = haloSprite('98,199,237');
  // Stable exposure gives the same stars their character in both languages.
  const radiance = stars.map(star => {
    let hash = 2166136261;
    for (const char of star.key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return ((hash >>> 0) / 4294967296) ** 2;
  });
  const glintStars = stars.flatMap((_, i) => radiance[i] > .98 || landmarks.has(i) ? [i] : []);
  function placeGlints(active: Set<number>) {
    const candidates = selected >= 0 ? [selected, ...active] : glintStars;
    const visible = candidates.filter(i => {
      const { x, y } = points[i];
      return x >= -12 && x <= w + 12 && y >= -12 && y <= h + 12;
    });
    const count = Math.min(visible.length, glintSlots.length, w < 600 ? 8 : 16);
    glintSlots.forEach((slot, k) => {
      slot.hidden = k >= count;
      if (slot.hidden) return;
      const i = visible[Math.floor(k * visible.length / count)];
      const { x, y } = points[i];
      slot.style.left = x + overscan + 'px';
      slot.style.top = y + overscan + 'px';
      slot.style.color = stars[i].kind === 'artist' ? '#ffd598' : '#a6efff';
    });
  }
  const landmarkIds = [...landmarks];
  const hollows = [
    { anchor: landmarkIds[0], image: hollowHalo('126,121,248'), radius: .21, angle: -.4 },
    { anchor: landmarkIds[1], image: hollowHalo('51,210,217'), radius: .14, angle: -.72 },
    { anchor: landmarkIds[2], image: hollowHalo('236,150,108'), radius: .12, angle: .28 },
  ];
  let standardFont = '',
    activeFont = '';
  // Keep an overscanned raster of the field. While the camera stays inside it,
  // pan/zoom costs one image composite; label placement and hit testing stay live.
  const overscan = 80;
  let cache: { centre: Point; scale: number; selected: number; hovered: number } | null = null;

  // The preview's own show: a shuffled round of the artists with pages, so nobody comes first.
  const withLinks = (list: number[]) => list.filter((i) => neighbours[i].length);
  const cast = withLinks(artistPages).length ? withLinks(artistPages)
    : withLinks(stars.flatMap((star, i) => (star.kind === 'artist' ? [i] : [])));
  const round: number[] = [];
  function nextArtist(not: number) {
    for (let tries = 0; tries < 2; tries++) {
      if (!round.length) {
        round.push(...cast);
        for (let i = round.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [round[i], round[j]] = [round[j], round[i]];
        }
      }
      const star = round.pop() ?? -1;
      if (star !== not || cast.length < 2) return star;
    }
    return -1;
  }
  let beacon: { star: number; leaves: number[]; start: number; end: number } | null = null;
  let shown = -1;
  let beaconTimer = 0;
  // The show runs only while the preview is on screen and the mouse is elsewhere.
  let onScreen = false,
    pointed = false;
  function light() {
    beaconTimer = 0;
    if (mode !== 'preview' || !onScreen || pointed || document.hidden || !w) return;
    const star = nextArtist(shown);
    if (star < 0) return;
    // An artist with many links shows an even spread of them, near and far.
    const all = [...neighbours[star]].sort((a, b) => distance(stars[a], stars[star]) - distance(stars[b], stars[star]));
    const count = Math.min(BEACON.links, all.length);
    const leaves = Array.from({ length: count }, (_, k) => all[Math.floor((k * all.length) / count)]);
    shown = star;
    beacon = { star, leaves, start: reducedMotion.matches ? -Infinity : performance.now(), end: 0 };
    if (!reducedMotion.matches) beaconTimer = window.setTimeout(dim, BEACON.draw + BEACON.hold);
    schedule();
  }
  function dim() {
    if (beacon && !beacon.end) beacon.end = performance.now();
    beaconTimer = window.setTimeout(light, BEACON.fade + BEACON.rest);
    schedule();
  }
  function hush(atOnce = false) {
    clearTimeout(beaconTimer);
    beaconTimer = 0;
    if (!beacon) return;
    if (atOnce || reducedMotion.matches) beacon = null;
    else if (!beacon.end) beacon.end = performance.now();
    schedule();
  }
  function wake(delay = BEACON.fade + BEACON.rest) {
    if (beaconTimer || mode !== 'preview' || !onScreen || pointed || (beacon && !beacon.end)) return;
    beaconTimer = window.setTimeout(light, delay);
  }
  const beaconEdges = (now: number): [number, number][] => {
    // A trail takes a while to cross, so the last ones leave well before the links fade.
    if (!beacon || beacon.end || now - beacon.start < BEACON.draw || now - beacon.start > BEACON.draw + BEACON.hold - 1500) return [];
    return beacon.leaves.map((leaf): [number, number] => [beacon!.star, leaf]);
  };

  // Choose only from edges actually painted at this zoom. Pick at launch time,
  // so a resting view has no animation loop and camera movement cannot leave a stale trail.
  const paintedEdges: [number, number][] = [];
  let previousEdge = '';
  const comet = skyComet(trail, occupied => {
    if (motion || pointers.size || frame || !points.length) return null;
    const lit = mode === 'preview' ? beaconEdges(performance.now()) : [];
    const focus = lit.length ? lit[0][0] : selected;
    const inside = (p: Point) => p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
    const key = ([i,j]: [number, number]) => i < j ? i + '/' + j : j + '/' + i;
    const visible = [...paintedEdges, ...lit].filter(edge => !occupied.has(key(edge))).filter(([i, j]) =>
      inside(points[i]) && inside(points[j]) && distance(points[i], points[j]) >= 12);
    const highlighted = visible.filter(([i, j]) => i === focus || j === focus);
    const pool = highlighted.length && Math.random() < .75 ? highlighted : visible;
    const other = pool.filter(edge => key(edge) !== previousEdge);
    const choices = other.length ? other : pool;
    if (!choices.length) return null;
    const edge = choices[Math.floor(Math.random() * choices.length)];
    previousEdge = key(edge);
    const strong = edge.includes(focus);
    const forward = strong ? edge[0] === focus : Math.random() < .5;
    const [i, j] = forward ? edge : [edge[1], edge[0]];
    const bend = strong ? connectionBend(i, j) : 0;
    const warm = strong ? stars[focus].kind === 'artist' : stars[j].kind === 'artist';
    return {
      key: previousEdge, bend, from: points[i], to: points[j], highlighted: strong, colour: warm ? '#ffe1a6' : '#abfff3',
      duration: lit.length && strong ? 1000 + Math.random() * 400 : undefined,
    };
  });

  const tint = (index: number) => stars[index].kind === 'artist' ? '255,201,133' : '112,230,223';
  /** The curved link from a star to one it is linked with, or its first part while it grows. */
  function strokeLink(ctx: CanvasRenderingContext2D, source: number, leaf: number, part = 1, alpha = 1) {
    const from = points[source], to = points[leaf];
    const dx = to.x - from.x, dy = to.y - from.y;
    const bend = connectionBend(source, leaf);
    const control = { x: from.x + dx / 2 - dy * bend, y: from.y + dy / 2 + dx * bend };
    const end = part < 1 ? connectionPoint(from, to, bend, part) : to;
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, `rgba(${tint(source)},${.26 * alpha})`);
    gradient.addColorStop(.28, `rgba(${tint(source)},${.49 * alpha})`);
    gradient.addColorStop(1, `rgba(${tint(leaf)},${.32 * alpha})`);
    ctx.strokeStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(mix(from.x, control.x, part), mix(from.y, control.y, part), end.x, end.y);
    ctx.stroke();
  }
  // A phone fits the same sky into far fewer pixels. Resolve its fainter stars
  // as points of light and gradually spread their rays as the reader zooms.
  let markScale = 1;
  // Records form the fine dust. Artist stars stay readable above them at every zoom.
  // `level` 1 is a star lit by its link to the chosen one; 2 is the chosen or pointed-at star.
  function mark(ctx: CanvasRenderingContext2D, i: number, level: 0 | 1 | 2, alpha = 1) {
    const { x, y } = points[i];
    if (x < -30 - overscan || x > w + 30 + overscan || y < -30 - overscan || y > h + 30 + overscan) return;
    const star = stars[i];
    const artist = star.kind === 'artist';
    const palette = artist ? GOLD : JADE;
    const accent = palette[i % palette.length];
    const light = radiance[i];
    const baseRadius = artist ? (star.page ? 4.5 : 2.25) : 1.25;
    const r = level === 2 ? 7 : level === 1 ? 3.8 : baseRadius * markScale * (.74 + light * 1.05);
    // With a star chosen, the stars it is not linked to step well back.
    const quiet = !level && selected >= 0;
    ctx.globalAlpha = level ? alpha : (.44 + .56 * Math.sqrt(light)) * (quiet ? .2 : 1);
    ctx.fillStyle = accent;
    if (level || (!quiet && (light > .64 || star.page))) {
      const halo = r * (level === 2 ? 4 : 2.6 + light);
      ctx.drawImage(artist ? amberHalo : cyanHalo, x - halo, y - halo, 2 * halo, 2 * halo);
    }
    if (artist || level === 2) {
      sparkle(ctx, points[i], r);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (level || light > .58 || star.page) {
      ctx.fillStyle = artist ? '#fff3d7' : '#e8fffc';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(.55, r * (artist ? .39 : .54)), 0, 2 * Math.PI);
      ctx.fill();
    }
    if (level === 2) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 11.5, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function paintField(ctx: CanvasRenderingContext2D, active: Set<number>) {
    if (scale < 2.5) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (2.5 - scale) / 1.5) * (selected < 0 ? .85 : .25);
      for (const hollow of hollows) {
        const anchor = points[hollow.anchor];
        if (!anchor) continue;
        const r = Math.min(w, h) * hollow.radius * scale;
        ctx.save();
        ctx.translate(anchor.x, anchor.y);
        ctx.rotate(hollow.angle);
        ctx.drawImage(hollow.image, -r, -r * .64, 2 * r, 1.28 * r);
        ctx.restore();
      }
      ctx.restore();
    }
    // Diffuse light accumulates around dense parts of the catalogue, tracing its arms.
    if (scale < 4) {
      ctx.save();
      ctx.globalAlpha = (1 - scale / 4) * (selected < 0 ? .13 : .02);
      const mist = Math.min(w, h) * .059 * Math.sqrt(scale);
      for (let i = 0; i < stars.length; i += 5) {
        const { x, y } = points[i];
        if (x + mist < -overscan || x - mist > w + overscan || y + mist < -overscan || y - mist > h + overscan) continue;
        ctx.drawImage(stars[i].kind === 'artist' ? amberHalo : cyanHalo, x - mist, y - mist, mist * 2, mist * 2);
      }
      ctx.restore();
    }
    paintedEdges.length = 0;
    function edge(i: number, j: number) {
      if (i === selected || j === selected) return;
      paintedEdges.push([i, j]);
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[j].x, points[j].y);
    }
    ctx.beginPath();
    ctx.strokeStyle = selected >= 0 ? 'rgba(137,199,208,.045)' : 'rgba(143,210,217,.33)';
    ctx.lineWidth = 0.72;
    if (scale < 3.5) {
      for (const [i, j] of links) edge(i, j);
    } else {
      // Zoom reveals the rest of the short local credit paths, at a fixed screen length.
      const reach = Math.min(w, h) * 0.43;
      for (let i = 0; i < points.length; i++) {
        const { x, y } = points[i];
        if (x < -reach - overscan || x > w + reach + overscan || y < -reach - overscan || y > h + reach + overscan) continue;
        for (const j of neighbours[i]) if (j > i && distance(points[i], points[j]) < reach) edge(i, j);
      }
    }
    ctx.stroke();
    if (selected >= 0) {
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (const leaf of active) {
        strokeLink(ctx, selected, leaf, 1, 1.5);
        paintedEdges.push([selected, leaf]);
      }
      ctx.restore();
    }
    const level = (i: number) => (i === selected || i === hovered ? 2 : active.has(i) ? 1 : 0);
    for (const [i, star] of stars.entries()) if (star.kind === 'recording') mark(ctx, i, level(i));
    for (const [i, star] of stars.entries()) if (star.kind === 'artist') mark(ctx, i, level(i));
    if (hovered >= 0) mark(ctx, hovered, 2);
    if (selected >= 0) mark(ctx, selected, 2);
  }

  /** The artist the preview has lit, over the resting sky. Says how visible it is, and whether it is still changing. */
  function paintBeacon(now: number): { alpha: number; live: boolean } {
    if (!beacon || !ctx) return { alpha: 0, live: false };
    const { star, leaves, start, end } = beacon;
    const age = now - start;
    const alpha = end ? 1 - clamp((now - end) / BEACON.fade, 0, 1) : 1;
    if (alpha <= 0) {
      beacon = null;
      return { alpha: 0, live: false };
    }
    // The links leave the star one after another and light the star each one reaches.
    const pace = Math.min(34, 320 / Math.max(1, leaves.length));
    const reach = (k: number) => clamp((age - 140 - k * pace) / 520, 0, 1);
    ctx.save();
    ctx.lineWidth = 1.35;
    ctx.lineCap = 'round';
    leaves.forEach((leaf, k) => {
      const t = reach(k);
      if (t > 0) strokeLink(ctx, star, leaf, 1 - (1 - t) ** 3, alpha);
    });
    ctx.restore();
    leaves.forEach((leaf, k) => {
      const t = clamp((reach(k) - .8) / .2, 0, 1);
      if (t > 0) mark(ctx, leaf, 1, t * alpha);
    });
    const arrival = clamp(age / 220, 0, 1);
    mark(ctx, star, 2, arrival * alpha);
    // A ring opens from the star, as a ripple does under a fingertip.
    const ripple = clamp(age / BEACON.draw, 0, 1);
    if (ripple < 1) {
      const palette = stars[star].kind === 'artist' ? GOLD : JADE;
      ctx.globalAlpha = .6 * (1 - ripple) * alpha;
      ctx.strokeStyle = palette[star % palette.length];
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(points[star].x, points[star].y, 11.5 + 34 * (1 - (1 - ripple) ** 3), 0, 2 * Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    return { alpha: arrival * alpha, live: age < BEACON.draw || end > 0 };
  }

  // The card stands by the chosen star: above or below it, or beside it in a window too short for either.
  let card: HTMLElement | null = null;
  let cardSize = { width: 0, height: 0 };
  let cardFor = -2;
  let stand = '';
  const measureCard = () => {
    if (card) cardSize = { width: card.offsetWidth, height: card.offsetHeight };
  };
  const cardWatch = new ResizeObserver(() => {
    measureCard();
    schedule();
  });
  function placeCard(): Box | null {
    if (!card) return null;
    if (cardFor !== selected) {
      cardFor = selected;
      stand = '';
      measureCard();
    }
    const spot = mode === 'full' && selected >= 0 && cardSize.width ? points[selected] : null;
    const floor = pads.top + 6, ceiling = h - pads.bottom - 6;
    // The card waits for a flight to land, and comes up where the star has come to rest.
    if (!spot || motion?.kind === 'fly' || spot.x < 0 || spot.x > w || spot.y < floor - 12 || spot.y > ceiling + 12) {
      delete card.dataset.shown;
      return null;
    }
    const { width, height } = cardSize;
    const gap = 22;
    // The card keeps the same distance from the window's edge as the bars do.
    const edge = 16;
    type Stand = { name: string; side: 'above' | 'below' | 'beside'; left: number; top: number };
    const stands: Stand[] = [];
    for (const side of ['above', 'below'] as const) {
      const top = side === 'above' ? spot.y - gap - height : spot.y + gap;
      if (top < floor || top + height > ceiling) continue;
      // Over the star, or reaching to one side of it, with its tip still on the star.
      for (const [name, wanted] of [['', spot.x - width / 2], ['-left', spot.x - width + 40], ['-right', spot.x - 40]] as const) {
        const left = clamp(wanted, edge, Math.max(edge, w - width - edge));
        if (spot.x - left >= 26 && spot.x - left <= width - 26) stands.push({ name: side + name, side, left, top });
      }
    }
    const level = clamp(spot.y - height / 2, floor, Math.max(floor, ceiling - height));
    if (spot.x + gap + width <= w - edge) stands.push({ name: 'right', side: 'beside', left: spot.x + gap, top: level });
    if (spot.x - gap - width >= edge) stands.push({ name: 'left', side: 'beside', left: spot.x - gap - width, top: level });
    if (!stands.length) stands.push({ name: 'beside', side: 'beside', left: Math.max(edge, spot.x - gap - width), top: level });
    // It stands where it hides the fewest of the star's links and of the stars they lead to,
    // and stays where it is unless another place hides clearly fewer.
    const leaves = neighbours[selected];
    const hides = ({ name, left, top }: Stand, order: number) => {
      const inside = (p: Point) => p.x > left - 8 && p.x < left + width + 8 && p.y > top - 8 && p.y < top + height + 8;
      let hidden = name === stand ? -2.5 : order * .05;
      for (const leaf of leaves) {
        if (inside(points[leaf])) hidden += 3;
        const bend = connectionBend(selected, leaf);
        for (const part of [.25, .5, .75]) if (inside(connectionPoint(spot, points[leaf], bend, part))) hidden += 1;
      }
      return hidden;
    };
    let best = stands[0], least = Infinity;
    stands.forEach((place, order) => {
      const hidden = hides(place, order);
      if (hidden < least) {
        least = hidden;
        best = place;
      }
    });
    stand = best.name;
    card.style.transform = `translate3d(${Math.round(best.left)}px,${Math.round(best.top)}px,0)`;
    card.style.setProperty('--tail', `${Math.round(clamp(spot.x - best.left, 26, width - 26))}px`);
    card.dataset.side = best.side;
    card.dataset.shown = '';
    return { left: best.left, top: best.top, width, height };
  }

  function draw(now: number) {
    frame = 0;
    advance(now);
    if (!ctx || !fieldContext || !w || !h) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    points = stars.map(project);
    labels = [];
    const active = new Set(selected >= 0 ? neighbours[selected] : []);
    let magnification = cache ? scale / cache.scale : 1;
    const origin = cache ? project(cache.centre) : heart();
    let left = origin.x - (w / 2 + overscan) * magnification;
    let top = origin.y - (midY() + overscan) * magnification;
    const fieldWidth = field.width / ratio, fieldHeight = field.height / ratio;
    if (!cache || hovered !== cache.hovered || selected !== cache.selected ||
        magnification < .88 || magnification > 1.14 || (scale === 1 && cache.scale !== 1) ||
        left > 0 || top > 0 || left + fieldWidth * magnification < w || top + fieldHeight * magnification < h) {
      const densityScale = clamp(Math.sqrt((w * h) / Math.max(1, stars.length * 205)), 0.48, 1);
      markScale = clamp(densityScale * Math.pow(scale, 0.34), 0.48, 1.4);
      fieldContext.setTransform(ratio, 0, 0, ratio, overscan * ratio, overscan * ratio);
      fieldContext.clearRect(-overscan, -overscan, fieldWidth, fieldHeight);
      paintField(fieldContext, active);
      placeGlints(active);
      cache = { centre: { ...centre }, scale, selected, hovered };
      left = top = -overscan;
      magnification = 1;
    }
    field.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${magnification})`;
    // The controls can show which of them have nothing left to do.
    const zoomed = scale <= 1.001 ? 'out' : scale >= MAX_ZOOM - .001 ? 'in' : '';
    if (stage.dataset.zoom !== zoomed) stage.dataset.zoom = zoomed;
    stage.toggleAttribute('data-fitted', scale <= 1.001 && distance(centre, { x: .5, y: .5 }) < .002);

    glints.style.transform = field.style.transform;

    const lit = mode === 'preview' ? paintBeacon(now) : { alpha: 0, live: false };
    // The rest of the sky steps back while one artist is lit.
    field.style.opacity = lit.alpha ? String(1 - .34 * lit.alpha) : '';
    const covered = placeCard();
    // The card names the chosen star, so no other name stands right by it, where it would read as its own.
    const held = covered ? { left: points[selected].x - 70, top: points[selected].y - 42, width: 140, height: 84 } : null;

    ctx.direction = options.lang === 'fa' ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Names keep clear of the full view's bars and of the card.
    const floor = mode === 'full' ? pads.top : 0, ceiling = mode === 'full' ? h - pads.bottom : h;
    // First reserve space for the active star's label. Spread the remaining names
    // across the sky; increasing zoom allows more labels in the visible area.
    const maxLabels = Math.max(3, Math.floor((w * h) / 65000)) + Math.floor(2 * Math.log2(scale));
    const label = (i: number, priority = false, alpha = 1) => {
      if (!ctx || i < 0 || labels.some((b) => b.index === i)) return;
      const { x, y } = points[i];
      if (x < 5 || x > w - 5 || y < 5 || y > h - 5) return;
      ctx.font = priority ? activeFont : standardFont;
      const width = Math.min(ctx.measureText(stars[i].name).width + 12, w * 0.78);
      const height = priority ? 23 : 19;
      const left = clamp(x - width / 2, 4, w - width - 4);
      const candidates = [y + (priority ? 15 : 5), y - height - (priority ? 15 : 6)];
      for (const top of candidates) {
        if (top < floor + 3 || top + height > ceiling - 3) continue;
        const box = { left, top, width, height };
        const spacing = priority ? 4 : Math.max(10, 34 / scale);
        if (labels.some((b) => overlap(box, b, spacing))) continue;
        if (covered && (overlap(box, covered, 6) || overlap(box, held!, 0))) continue;
        const cx = left + width / 2,
          cy = top + height / 2;
        ctx.globalAlpha = alpha;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#162031';
        ctx.lineWidth = 3.5;
        ctx.strokeText(stars[i].name, cx, cy, width - 8);
        ctx.fillStyle = priority ? '#fff2d9' : '#e9e1d2';
        ctx.fillText(stars[i].name, cx, cy, width - 8);
        ctx.globalAlpha = 1;
        labels.push({ ...box, index: i });
        return;
      }
    };
    label(hovered, true);
    if (mode === 'preview') {
      // The preview names only what it is showing: the star under the mouse, or the artist it has lit.
      if (beacon) label(beacon.star, true, lit.alpha);
    } else {
      if (!covered) label(selected, true);
      // With a star chosen, the sky names the stars it is linked to and no others.
      for (const i of active) if (labels.length < maxLabels + 6) label(i);
      if (selected >= 0) return;
      for (const i of landmarks) if (labels.length < maxLabels) label(i);
      for (let i = 0; i < stars.length && labels.length < maxLabels; i++) {
        if (i !== selected && (stars[i].page || scale >= 4)) label(i);
      }
    }
    if (lit.live) schedule();
  }

  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    comet.interrupt();
    w = width;
    h = height;
    ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    field.width = Math.ceil((w + overscan * 2) * ratio);
    field.height = Math.ceil((h + overscan * 2) * ratio);
    field.style.width = `${field.width / ratio}px`;
    field.style.height = `${field.height / ratio}px`;
    cache = null;
    if (!standardFont) {
      const family = getComputedStyle(canvas).fontFamily;
      standardFont = '12px ' + family;
      activeFont = '600 14px ' + family;
    }
    if (motion?.kind === 'fly') {
      centre = { ...motion.to.centre };
      scale = motion.to.scale;
      motion = null;
    }
    constrain();
    // Resizing a canvas clears it, so paint before the browser shows the empty one.
    cancelAnimationFrame(frame);
    draw(performance.now());
  }
  const local = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** The star at a point. A bigger star reaches further, so the dust beside an artist does not take its taps. */
  function hit(p: Point, radius: number, pagesOnly = false) {
    const label = labels.find(
      (b) => p.x >= b.left && p.x <= b.left + b.width && p.y >= b.top && p.y <= b.top + b.height,
    );
    if (label) return label.index;
    let nearest = -1,
      best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const star = stars[i];
      if (pagesOnly && !star.page) continue;
      const d = distance(p, points[i]);
      if (d >= radius) continue;
      const weighed = d / (star.page ? 2.4 : star.kind === 'artist' ? 1.5 : 1);
      if (weighed < best) {
        nearest = i;
        best = weighed;
      }
    }
    return nearest;
  }
  let lastTap = { time: -Infinity, at: { x: 0, y: 0 } };
  function pointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = local(e);
    // A touch that stops a moving sky, or leaves the search box, chooses nothing.
    const typing = document.activeElement instanceof HTMLInputElement;
    if (!pointers.size) {
      down = p;
      moved = motion !== null || typing;
    } else moved = true;
    motion = null;
    velocity.start(e.timeStamp);
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent) {
    const p = local(e);
    const last = pointers.get(e.pointerId);
    if (!last) {
      if (e.pointerType !== 'mouse') return;
      if (mode === 'preview' && !pointed) {
        // The mouse takes over from the show.
        pointed = true;
        hush();
      }
      const next = hit(p, 10);
      if (hovered !== next) {
        hovered = next;
        if (mode === 'full') canvas.style.cursor = next < 0 ? 'grab' : 'pointer';
        schedule();
      }
      return;
    }
    const other = [...pointers.entries()].find(([id]) => e.pointerId !== id)?.[1];
    if (!moved && distance(down, p) < 4) return;
    pointers.set(e.pointerId, p);
    moved = true;
    hovered = -1;
    canvas.style.cursor = 'grabbing';
    let logScale = 0;
    let from = last,
      to = p;
    if (other) {
      from = middle(last, other);
      to = middle(p, other);
      const previousScale = scale;
      zoom(Math.max(1, distance(p, other)) / Math.max(1, distance(last, other)), from);
      logScale = Math.log(scale / previousScale);
    }
    pan(to.x - from.x, to.y - from.y);
    gestureAnchor = to;
    velocity.move(e.timeStamp, to.x - from.x, to.y - from.y, logScale);
    schedule();
  }
  function pointerEnd(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    if (e.type !== 'pointerup') velocity.start(e.timeStamp);
    if (moved && !pointers.size && e.type === 'pointerup' && !reducedMotion.matches) {
      const speed = velocity.release(e.timeStamp);
      if (Math.hypot(speed.x, speed.y) > .04 || Math.abs(speed.z) > .00015) {
        begin({ kind: 'glide', x: clamp(speed.x, -3, 3), y: clamp(speed.y, -3, 3),
          z: clamp(speed.z, -.004, .004), anchor: gestureAnchor });
      }
    }
    // A tap on a star chooses it; a tap on the empty sky lets the chosen one go, and a second one comes closer.
    if (!moved && e.type === 'pointerup') {
      const at = local(e);
      const star = hit(at, e.pointerType === 'mouse' ? 12 : 19);
      if (star < 0 && e.timeStamp - lastTap.time < 320 && distance(at, lastTap.at) < 28) {
        lastTap.time = -Infinity;
        easeZoom(1.8, at);
      } else {
        lastTap = { time: star < 0 ? e.timeStamp : -Infinity, at };
        pick(star);
      }
    }
    if (!pointers.size) canvas.style.cursor = 'grab';
  }
  function leave() {
    hovered = -1;
    if (pointed) {
      pointed = false;
      wake();
    }
    schedule();
  }
  function click(e: MouseEvent) {
    // A finger has no hover: a tap on a bright artist opens on that artist.
    if (mode === 'preview') options.onOpen(hovered >= 0 ? hovered : hit(local(e), 22, true));
  }
  // Safari on macOS reports trackpad pinches through gesture events.
  // Direct touch has its own pointer stream and must only be applied once.
  type WebKitGesture = MouseEvent & { scale: number };
  let gestureScale = 0;
  function safariPinch(event: Event) {
    const e = event as WebKitGesture;
    if (pointers.size || !Number.isFinite(e.scale)) return;
    e.preventDefault();
    if (e.type === 'gesturestart') {
      motion = null;
      gestureScale = e.scale;
    } else if (e.type === 'gestureend') gestureScale = 0;
    else if (gestureScale && e.scale > 0) {
      zoom(e.scale / gestureScale, local(e));
      gestureScale = e.scale;
    }
  }
  let lastWheelTime = -Infinity;
  let steppedWheel = false;
  function wheel(e: WheelEvent) {
    if (gestureScale) { e.preventDefault(); return; }
    hovered = -1;
    const at = local(e);
    // Chrome can send mouse detents as 100/120-pixel steps. Classify the
    // burst once so a fast trackpad swipe never changes mode halfway through.
    if (e.timeStamp - lastWheelTime > 160) {
      const magnitude = Math.abs(e.deltaY);
      steppedWheel = !e.deltaX && (magnitude === 100 || magnitude === 120);
    }
    lastWheelTime = e.timeStamp;
    if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || steppedWheel) {
      e.preventDefault();
      easeZoom(Math.exp(-Math.sign(e.deltaY) * .18), at);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      motion = null;
      zoom(Math.exp(-clamp(e.deltaY, -120, 120) * .01), at);
    } else {
      // The OS already sends the inertial tail for two-finger trackpad scrolling.
      e.preventDefault();
      motion = null;
      pan(-e.deltaX, -e.deltaY);
      schedule();
    }
  }
  function keyboard(e: KeyboardEvent) {
    if (e.key === '+' || e.key === '=' || e.key === '-') easeZoom(e.key === '-' ? 1 / 1.5 : 1.5);
    else if (e.key === 'Home') fit(true);
    else if (e.key === 'Enter' || e.key === ' ') {
      const i = hovered >= 0 ? hovered : selected >= 0 ? selected : hit(heart(), Infinity);
      if (i >= 0) pick(i);
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const origin = points[hovered] || points[selected] || heart();
      const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      const sign = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      let best = Infinity,
        next = -1;
      for (let i = 0; i < points.length; i++) {
        const dx = points[i].x - origin.x,
          dy = points[i].y - origin.y;
        const advance = sign * (horizontal ? dx : dy),
          lateral = Math.abs(horizontal ? dy : dx);
        if (advance <= 1) continue;
        const score = advance + 3 * lateral;
        if (score < best) {
          best = score;
          next = i;
        }
      }
      if (next >= 0) pick(next);
    } else return;
    e.preventDefault();
  }

  // A drag, a pinch or the wheel that starts on the card moves the sky all the same; only a still tap is the card's.
  let cardPress: { id: number; at: Point } | null = null;
  let cardDragged = false;
  function cardDown(e: PointerEvent) {
    if (mode !== 'full' || e.button !== 0) return;
    cardDragged = pointers.size > 0;
    if (cardDragged) pointerDown(e);
    else cardPress = { id: e.pointerId, at: local(e) };
  }
  function cardMove(e: PointerEvent) {
    if (cardPress?.id !== e.pointerId || distance(cardPress.at, local(e)) < 6) return;
    down = cardPress.at;
    moved = cardDragged = true;
    motion = null;
    velocity.start(e.timeStamp);
    pointers.set(e.pointerId, cardPress.at);
    canvas.setPointerCapture(e.pointerId);
    cardPress = null;
    pointerMove(e);
  }
  function cardClick(e: Event) {
    cardPress = null;
    if (!cardDragged) return;
    cardDragged = false;
    e.preventDefault();
    e.stopPropagation();
  }
  const cardEvents: [string, (event: never) => void, AddEventListenerOptions?][] = [
    ['pointerdown', cardDown],
    ['pointermove', cardMove],
    ['click', cardClick, { capture: true }],
    ['wheel', (e: WheelEvent) => { if (mode === 'full') wheel(e); }, { passive: false }],
  ];
  // The sky frames itself for a reader who reaches it with Tab or moves through it with
  // keys, and not for one who typed in the search box or uses a mouse or a finger.
  function inputKind(e: Event) {
    if (e.type !== 'keydown') delete canvas.dataset.keys;
    else if ((e as KeyboardEvent).key === 'Tab' || e.target === canvas) canvas.dataset.keys = '';
  }
  // Only the full view listens for drags, pinches and the wheel, so the preview never holds a scroll.
  const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'];
  const fullOnly: [string, (event: never) => void, AddEventListenerOptions?][] = [
    ...gestureEvents.map((name): [string, (event: never) => void, AddEventListenerOptions] => [name, safariPinch, { passive: false }]),
    ['pointerdown', pointerDown],
    ['pointerup', pointerEnd],
    ['pointercancel', pointerEnd],
    ['lostpointercapture', pointerEnd],
    ['wheel', wheel, { passive: false }],
    ['keydown', keyboard],
  ];
  let bound = false;
  function bind(on: boolean) {
    if (on === bound) return;
    bound = on;
    for (const [name, listener, how] of fullOnly) {
      if (on) canvas.addEventListener(name, listener as EventListener, how);
      else canvas.removeEventListener(name, listener as EventListener);
    }
    for (const name of ['keydown', 'pointerdown']) {
      if (on) addEventListener(name, inputKind, true);
      else removeEventListener(name, inputKind, true);
    }
    if (!on) delete canvas.dataset.keys;
  }
  function setMode(next: SkyMode) {
    mode = next;
    stage.dataset.mode = next;
    motion = null;
    pointers.clear();
    hovered = -1;
    pointed = false;
    canvas.style.cursor = '';
    hush(true);
    bind(next === 'full');
    if (next === 'full') {
      stage.removeAttribute('aria-hidden');
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'application');
      canvas.setAttribute('aria-label', options.label);
      canvas.setAttribute('aria-describedby', options.describedBy);
    } else {
      stage.setAttribute('aria-hidden', 'true');
      for (const name of ['tabindex', 'role', 'aria-label', 'aria-describedby']) canvas.removeAttribute(name);
      pads = { top: 0, bottom: 0 };
      selected = -1;
      centre = { x: .5, y: .5 };
      scale = 1;
      wake(BEACON.first);
    }
    resize();
  }
  function layout(room = { top: 0, bottom: 0 }) {
    pads = room;
    resize();
  }

  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('click', click);
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.intersectionRatio >= .35;
    if (onScreen) wake(BEACON.first);
    else hush(true);
  }, { threshold: [0, .35] });
  watcher.observe(stage);
  const visibility = () => {
    if (document.hidden) hush(true);
    else wake();
  };
  document.addEventListener('visibilitychange', visibility);
  document.fonts.addEventListener('loadingdone', schedule);
  setMode('preview');
  return {
    element: stage,
    canvas,
    setMode,
    layout,
    select,
    zoom(factor) {
      // The chosen star stays where it is while the sky grows or shrinks around it.
      const spot = selected >= 0 ? points[selected] : null;
      const held = spot && spot.x > 0 && spot.x < w && spot.y > pads.top && spot.y < h - pads.bottom;
      easeZoom(factor, held ? spot : heart());
    },
    fit: () => fit(true),
    featured() {
      if (hovered >= 0) return hovered;
      if (shown < 0) shown = nextArtist(-1);
      return shown;
    },
    next: () => nextArtist(selected),
    setCard(next) {
      cardWatch.disconnect();
      for (const [name, listener, how] of cardEvents) card?.removeEventListener(name, listener as EventListener, how);
      card = next;
      cardFor = -2;
      if (card) cardWatch.observe(card);
      for (const [name, listener, how] of cardEvents) card?.addEventListener(name, listener as EventListener, how);
      schedule();
    },
    dispose() {
      bind(false);
      clearTimeout(beaconTimer);
      comet.dispose();
      observer.disconnect();
      watcher.disconnect();
      cardWatch.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      document.fonts.removeEventListener('loadingdone', schedule);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('click', click);
      stage.remove();
    },
  };
}
