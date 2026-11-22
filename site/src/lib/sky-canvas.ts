import { CLOUDS, LIGHT, MARK, MOON, chance, hueOf, type Hue, type SkyArt } from './sky-art';
import { COMET_LIMIT, connectionBend, connectionPoint, skyComet } from './sky-comet';
import type { SkyStar } from './sky-data';
import { coastStep, gestureVelocity } from './sky-motion';

/**
 * The sky the homepage shows: a small preview in the page, and the same sky
 * opened to fill the screen. The preview only shows itself off: it lights one
 * artist after another, follows the mouse, and leaves every scroll and swipe
 * to the page. The full view pans, zooms and flies to the star that is chosen.
 *
 * It is painted as a miniature, from the pieces in sky-art.ts. Nothing here
 * repaints to keep the sky alive: the stars' light is in layers that the
 * browser fades in and out by itself, each at its own pace.
 */

type Point = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };
type Label = Box & { index: number };
type View = { centre: Point; scale: number; spot: Point };

export type SkyMode = 'preview' | 'full';

export interface SkyOptions {
  lang: 'en' | 'fa';
  art: SkyArt;
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

/** Seconds each layer of starlight takes to come and go. No two stay in step for long. */
const TWINKLE = [3.7, 5.3, 7.1, 8.9];
/** The light is soft, so its layers hold a quarter of the pixels the stars do. */
const SOFT = .5;
const INK = '#0c1330';
const LEAF = '#eccb86';

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
  const { art } = options;
  // The painted night stays put while the sky moves over it.
  add('span', 'sky-ground').style.backgroundImage = `url("${art.ground}")`;
  const field = add('canvas', 'sky-field');
  // The light of the stars and of the chosen star's links, over the field and moving with it.
  const shine = add('span', 'sky-shine');
  const twinkleLayers = TWINKLE.map((seconds, k) => {
    const layer = add('canvas', 'sky-twinkle', shine);
    layer.style.animationDuration = `${seconds}s`;
    layer.style.animationDelay = `${-seconds * ((k * .37) % 1)}s`;
    // Where each rests for a reader who asked for stillness: at a different stage of its glow.
    layer.style.opacity = String(.3 + .18 * k);
    return layer;
  });
  const glowLayer = add('canvas', 'sky-glow', shine);
  const trail = add('span', 'sky-trail');
  const canvas = add('canvas', 'sky-canvas');
  for (let i = 0; i < COMET_LIMIT; i++) add('span', 'sky-comet', trail);
  for (const layer of [field, shine, trail]) layer.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const fieldContext = field.getContext('2d');
  const twinkles = twinkleLayers.flatMap((layer) => layer.getContext('2d') ?? []);
  const glow = glowLayer.getContext('2d');
  if (!ctx || !fieldContext || !glow || twinkles.length < TWINKLE.length) return null;
  const lights = [...twinkles, glow];

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

  // Stable exposure gives the same stars their character in both languages.
  const radiance = stars.map(star => {
    let hash = 2166136261;
    for (const char of star.key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return ((hash >>> 0) / 4294967296) ** 2;
  });
  // So does each star's pigment, its cut of leaf, and whether and when its light comes and goes.
  const hues = stars.map(hueOf);
  const cuts = stars.map((star) => Math.floor(chance(star.key, 5) * MARK.variants));
  const shines = stars.map((star) => star.page || chance(star.key, 9) < (star.kind === 'artist' ? .45 : .2));
  const pulse = stars.map((star) => twinkles[Math.floor(chance(star.key, 11) * twinkles.length)]);
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
    return {
      key: previousEdge, bend, from: points[i], to: points[j], highlighted: strong, colour: `rgb(${LIGHT[hues[j]]})`,
      duration: lit.length && strong ? 1000 + Math.random() * 400 : undefined,
    };
  });

  /** The curved link from a star to one it is linked with, or its first part while it grows. */
  function traceLink(ctx: CanvasRenderingContext2D, source: number, leaf: number, part: number) {
    const from = points[source], to = points[leaf];
    const dx = to.x - from.x, dy = to.y - from.y;
    const bend = connectionBend(source, leaf);
    const control = { x: from.x + dx / 2 - dy * bend, y: from.y + dy / 2 + dx * bend };
    const end = part < 1 ? connectionPoint(from, to, bend, part) : to;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(mix(from.x, control.x, part), mix(from.y, control.y, part), end.x, end.y);
  }
  /** A pen line in gold that takes on the pigment of the star it reaches. */
  function strokeLink(ctx: CanvasRenderingContext2D, source: number, leaf: number, part = 1, alpha = 1) {
    const from = points[source], to = points[leaf];
    const ink = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    ink.addColorStop(0, `rgba(${LIGHT.gold},${.75 * alpha})`);
    ink.addColorStop(1, `rgba(${LIGHT[hues[leaf]]},${.85 * alpha})`);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.1;
    traceLink(ctx, source, leaf, part);
    ctx.stroke();
  }
  /** The light a link sheds around itself. */
  function glowLink(ctx: CanvasRenderingContext2D, source: number, leaf: number, part = 1, alpha = 1) {
    const from = points[source], to = points[leaf];
    const rgb = LIGHT[hues[leaf]];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [width, strength] of [[10, .05], [5.5, .09], [2.6, .13]]) {
      // Many links meet at their star, where their light together would drown it.
      const rise = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      rise.addColorStop(.04, `rgba(${rgb},0)`);
      rise.addColorStop(.45, `rgba(${rgb},${strength * alpha})`);
      ctx.lineWidth = width;
      ctx.strokeStyle = rise;
      traceLink(ctx, source, leaf, part);
      ctx.stroke();
    }
    ctx.restore();
  }
  // A phone fits the same sky into far fewer pixels. Its fainter stars are
  // painted smaller, and grow as the reader zooms.
  let markScale = 1;
  /** One mark cut from the sheet of its pigment, from the smallest sheet that still holds it sharp. */
  function stamp(ctx: CanvasRenderingContext2D, hue: Hue, cut: number, row: number, x: number, y: number, size: number) {
    const sheets = art.sheets[hue];
    let step = 0;
    while (step < sheets.length - 1 && MARK.cell / 2 ** (step + 1) >= size * ratio) step++;
    const cell = MARK.cell / 2 ** step;
    ctx.drawImage(sheets[step], cut * cell, row * cell, cell, cell, x - size / 2, y - size / 2, size, size);
  }
  function shed(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, reach: number, alpha: number) {
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(art.halos[hues[i]], x - reach, y - reach, 2 * reach, 2 * reach);
  }
  // Recordings are the fine dots. Artists stay readable above them at every zoom: an
  // eight-pointed star for one with a page, a four-pointed one for the others.
  // `level` 1 is a star lit by its link to the chosen one; 2 is the chosen star, or the one pointed at.
  function mark(ctx: CanvasRenderingContext2D, i: number, level: 0 | 1 | 2, alpha = 1, pointed = false) {
    const { x, y } = points[i];
    if (x < -40 - overscan || x > w + 40 + overscan || y < -40 - overscan || y > h + 40 + overscan) return;
    const star = stars[i];
    const artist = star.kind === 'artist';
    const bright = radiance[i];
    const r = (artist ? (star.page ? 4.5 : 2.25) : 1.25) * markScale * (.74 + bright * 1.05);
    const big = artist && (star.page || level === 2);
    // The chosen star and its ring are a little smaller where the whole sky is.
    const grand = w < 600 ? .8 : 1;
    const size = big ? (level === 2 ? (pointed ? 24 : 38 * grand) : level ? 15 : Math.max(5, r * 3.5))
      : artist ? (level ? 12 : Math.max(4, r * 3.6))
      : level === 2 ? (pointed ? 11 : 17) : level ? 7.5 : Math.max(2.1, r * 2.35);
    // With a star chosen, the stars it is not linked to step well back.
    const quiet = !level && selected >= 0;
    const strength = level ? alpha : (.6 + .4 * Math.sqrt(bright)) * (quiet ? .2 : 1);
    const reach = size * (big ? 1 : artist ? 1.2 : 1.7) * (level === 2 ? 1.2 : 1);
    if (level === 2) {
      ctx.strokeStyle = LEAF;
      for (const [radius, width, part] of pointed ? [[15, 1.1, .55]] : [[24 * grand, 1.4, .8], [30 * grand, 1, .3]]) {
        ctx.globalAlpha = strength * part;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    if (level) {
      ctx.globalCompositeOperation = 'lighter';
      shed(ctx, i, x, y, reach * 1.5, .34 * strength);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = strength;
    // A cream dot is cut from the painted cream ones. Chosen, it is gold, so that it stands out.
    const cream = !artist && hues[i] === 'cream';
    const row = big ? MARK.star : artist ? MARK.spark : cream && level < 2 ? MARK.pearl : MARK.dot;
    stamp(ctx, cream ? 'gold' : hues[i], cuts[i], row, x, y, size);
    ctx.globalAlpha = 1;
    // The part of its light that comes and goes is in a layer of its own.
    if (ctx !== fieldContext || quiet || !(level || shines[i])) return;
    const layer = pulse[i];
    shed(layer, i, x, y, reach * (big ? 2.15 : artist ? 2.1 : 2.25), (level === 2 ? .3 : level ? .42 : .6) * strength);
    if (level < 2) shed(layer, i, x, y, size * .8, .5 * strength);
  }

  function paintField(ctx: CanvasRenderingContext2D, active: Set<number>) {
    // The cloud bands and the moon are the sky's landmarks. Close up they would only blur, so they withdraw.
    const far = clamp((5 - scale) / 3, 0, 1);
    if (far > 0) {
      const unit = scale * spanX();
      ctx.globalAlpha = far * (selected < 0 ? .92 : .5);
      for (const cloud of CLOUDS) {
        const image = art.clouds[cloud.image];
        const wide = cloud.wide * unit, tall = wide * image.naturalHeight / image.naturalWidth;
        const { x, y } = project(cloud);
        if (x + wide < -overscan || x - wide > w + overscan || y + tall < -overscan || y - tall > h + overscan) continue;
        ctx.save();
        ctx.translate(x, y);
        if (cloud.flip) ctx.scale(-1, 1);
        ctx.drawImage(image, -wide / 2, -tall / 2, wide, tall);
        ctx.restore();
      }
      const moon = project(MOON), across = MOON.wide * unit;
      ctx.globalAlpha = far * (selected < 0 ? .95 : .55);
      ctx.drawImage(art.moon, moon.x - across / 2, moon.y - across / 2, across, across * art.moon.naturalHeight / art.moon.naturalWidth);
      ctx.globalAlpha = 1;
    }
    paintedEdges.length = 0;
    function edge(i: number, j: number) {
      if (i === selected || j === selected) return;
      paintedEdges.push([i, j]);
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[j].x, points[j].y);
    }
    ctx.beginPath();
    ctx.strokeStyle = `rgba(226,190,120,${selected >= 0 ? .04 : .17})`;
    ctx.lineWidth = 0.6;
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
      ctx.lineCap = glow!.lineCap = 'round';
      for (const other of active) {
        glowLink(glow!, selected, other);
        strokeLink(ctx, selected, other);
        paintedEdges.push([selected, other]);
      }
      ctx.restore();
    }
    const level = (i: number) => (i === selected || i === hovered ? 2 : active.has(i) ? 1 : 0);
    for (const [i, star] of stars.entries()) if (star.kind === 'recording' && !level(i)) mark(ctx, i, 0);
    for (const [i, star] of stars.entries()) if (star.kind === 'artist' && !level(i)) mark(ctx, i, 0);
    for (const i of active) if (i !== selected && i !== hovered) mark(ctx, i, 1);
    if (hovered >= 0 && hovered !== selected) mark(ctx, hovered, 2, 1, true);
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
    ctx.lineCap = 'round';
    leaves.forEach((other, k) => {
      const t = reach(k);
      if (t <= 0) return;
      glowLink(ctx, star, other, 1 - (1 - t) ** 3, alpha);
      strokeLink(ctx, star, other, 1 - (1 - t) ** 3, alpha);
    });
    ctx.restore();
    leaves.forEach((other, k) => {
      const t = clamp((reach(k) - .8) / .2, 0, 1);
      if (t > 0) mark(ctx, other, 1, t * alpha);
    });
    const arrival = clamp(age / 220, 0, 1);
    mark(ctx, star, 2, arrival * alpha);
    // A ring opens from the star, as a ripple does under a fingertip.
    const ripple = clamp(age / BEACON.draw, 0, 1);
    if (ripple < 1) {
      ctx.globalAlpha = .6 * (1 - ripple) * alpha;
      ctx.strokeStyle = LEAF;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(points[star].x, points[star].y, (w < 600 ? 24 : 30) + 34 * (1 - (1 - ripple) ** 3), 0, 2 * Math.PI);
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
      for (const layer of lights) {
        const soft = layer.canvas.width / fieldWidth;
        layer.setTransform(soft, 0, 0, soft, overscan * soft, overscan * soft);
        layer.clearRect(-overscan, -overscan, fieldWidth, fieldHeight);
      }
      paintField(fieldContext, active);
      glowLayer.hidden = selected < 0;
      cache = { centre: { ...centre }, scale, selected, hovered };
      left = top = -overscan;
      magnification = 1;
    }
    field.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${magnification})`;
    // The controls can show which of them have nothing left to do.
    const zoomed = scale <= 1.001 ? 'out' : scale >= MAX_ZOOM - .001 ? 'in' : '';
    if (stage.dataset.zoom !== zoomed) stage.dataset.zoom = zoomed;
    stage.toggleAttribute('data-fitted', scale <= 1.001 && distance(centre, { x: .5, y: .5 }) < .002);

    shine.style.transform = field.style.transform;

    const lit = mode === 'preview' ? paintBeacon(now) : { alpha: 0, live: false };
    // The rest of the sky steps back while one artist is lit.
    field.style.opacity = shine.style.opacity = lit.alpha ? String(1 - .4 * lit.alpha) : '';
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
      // A name stands clear of the ring around its star.
      const clear = !priority ? 5 : i === hovered && i !== selected ? 20 : w < 600 ? 30 : 36;
      const candidates = [y + clear, y - height - clear - (priority ? 0 : 1)];
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
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3.5;
        ctx.strokeText(stars[i].name, cx, cy, width - 8);
        ctx.fillStyle = priority ? '#fbf1dc' : '#ece2cd';
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
    for (const { canvas: layer } of lights) {
      layer.width = Math.ceil(field.width * SOFT);
      layer.height = Math.ceil(field.height * SOFT);
      layer.style.width = field.style.width;
      layer.style.height = field.style.height;
    }
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
    // Out of sight, the light holds still.
    stage.toggleAttribute('data-unseen', !entry.isIntersecting);
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
