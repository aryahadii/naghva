import { useEffect, useRef } from 'preact/hooks';
import type { Strings } from '../lib/i18n';
import type { Lang } from '../lib/record';
import { coastStep, gestureVelocity } from '../lib/sky-motion';
import type { SkyStar } from '../lib/star-map';

interface Props {
  stars: SkyStar[];
  selected: string | null;
  onSelect: (id: string) => void;
  lang: Lang;
  words: Strings['starMap'];
  resetKey: number;
}

type Point = { x: number; y: number };
type Label = {
  left: number;
  top: number;
  width: number;
  height: number;
  index: number;
};
const GOLD = ['#ffd08a', '#ffac63', '#fff0b2', '#ffc276'];
const JADE = ['#75f6df', '#4cd9e8', '#acfff2', '#72caff'];
const MAX_ZOOM = 20;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const middle = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

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

/** The camera lives in map coordinates, so resizing never changes which region is in view. */
function makeSky(canvas: HTMLCanvasElement, stars: SkyStar[], lang: Lang, choose: (id: string) => void) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const lookup = new Map(stars.map((s, i) => [s.id, i]));
  const neighbours = stars.map((star) =>
    star.connections.flatMap((id) => {
      const i = lookup.get(id);
      return i === undefined ? [] : [i];
    }),
  );
  // In the overview, show a few short, real links in each artist's neighbourhood.
  // The complete set of edges for a star is drawn when that star is selected.
  const links: [number, number][] = [];
  const seen = new Set<string>();
  for (const [i, star] of stars.entries()) {
    if (star.kind !== 'artist' || (!star.href && i % 9 !== 0)) continue;
    const nearby = [...neighbours[i]].sort((a, b) => distance(stars[a], star) - distance(stars[b], star));
    for (const j of nearby.slice(0, star.href ? 3 : 1)) {
      const key = [Math.min(i, j), Math.max(i, j)].join('/');
      if (seen.has(key) || distance(star, stars[j]) > 0.14) continue;
      links.push([i, j]);
      seen.add(key);
    }
  }
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
  const artistPages = stars.flatMap((star, i) => (star.kind === 'artist' && star.href ? [i] : []));
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
  const margin = () => Math.min(38, Math.min(w, h) * 0.085);
  const spanX = () => Math.max(1, w - margin() * 2);
  const spanY = () => Math.max(1, h - margin() * 2);
  const project = (p: Point): Point => ({
    x: w / 2 + (p.x - centre.x) * scale * spanX(),
    y: h / 2 + (p.y - centre.y) * scale * spanY(),
  });
  function constrain() {
    // The edge of the atlas can always be moved away from the screen edge.
    const reach = 0.25 / scale;
    centre = {
      x: clamp(centre.x, reach, 1 - reach),
      y: clamp(centre.y, reach, 1 - reach),
    };
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function zoom(factor: number, at: Point = { x: w / 2, y: h / 2 }) {
    const next = clamp(scale * factor, 1, MAX_ZOOM);
    centre.x += ((at.x - w / 2) / spanX()) * (1 / scale - 1 / next);
    centre.y += ((at.y - h / 2) / spanY()) * (1 / scale - 1 / next);
    scale = next;
    constrain();
    schedule();
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const velocity = gestureVelocity();
  type Motion = { kind: 'glide'; x: number; y: number; z: number; anchor: Point }
    | { kind: 'zoom'; target: number; anchor: Point; home: boolean };
  let motion: Motion | null = null;
  let lastFrame = 0;
  let gestureAnchor: Point = { x: 0, y: 0 };

  function pan(dx: number, dy: number) {
    centre.x -= dx / (spanX() * scale);
    centre.y -= dy / (spanY() * scale);
    constrain();
  }
  function begin(next: Motion) {
    motion = next;
    lastFrame = performance.now();
    schedule();
  }
  function easeZoom(factor: number, anchor = { x: w / 2, y: h / 2 }, home = false) {
    const base = motion?.kind === 'zoom' ? motion.target : scale;
    const target = home ? 1 : clamp(base * factor, 1, MAX_ZOOM);
    if (reducedMotion.matches) {
      motion = null;
      zoom(target / scale, anchor);
      if (home) centre = { x: 0.5, y: 0.5 };
    } else begin({ kind: 'zoom', target, anchor, home });
  }
  function advance(now: number) {
    if (!motion) return;
    const elapsed = Math.max(0, now - lastFrame);
    lastFrame = now;
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
    hovered = -1;
    if (animated) { easeZoom(1, undefined, true); return; }
    motion = null;
    centre = { x: .5, y: .5 };
    scale = 1;
    schedule();
  }
  function select(id: string | null) {
    motion = null;
    selected = id === null ? -1 : (lookup.get(id) ?? -1);
    hovered = -1;
    if (selected >= 0) {
      const p = project(stars[selected]);
      const edge = margin();
      if (p.x < edge || p.y < edge || p.x > w - edge || p.y > h - edge) {
        centre = { x: stars[selected].x, y: stars[selected].y };
        constrain();
      }
    }
    schedule();
  }

  // Cache the light falloff once per colour so a moving sky needs no per-star blur.
  function haloSprite(rgb: string) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 48;
    const glow = sprite.getContext('2d')!;
    const gradient = glow.createRadialGradient(24, 24, 0, 24, 24, 24);
    gradient.addColorStop(0, 'rgba(255,255,248,.96)');
    gradient.addColorStop(.16, `rgba(${rgb},.68)`);
    gradient.addColorStop(.48, `rgba(${rgb},.20)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    glow.fillStyle = gradient;
    glow.fillRect(0, 0, 48, 48);
    return sprite;
  }
  const amberHalo = haloSprite('255,155,65');
  const cyanHalo = haloSprite('50,227,245');
  const landmarkIds = [...landmarks];
  const hollows = [
    { anchor: landmarkIds[0], image: hollowHalo('126,121,248'), radius: .21, angle: -.4 },
    { anchor: landmarkIds[1], image: hollowHalo('51,210,217'), radius: .14, angle: -.72 },
    { anchor: landmarkIds[2], image: hollowHalo('236,150,108'), radius: .12, angle: .28 },
  ];
  const canvasFont = getComputedStyle(canvas).fontFamily;
  const standardFont = '12px ' + canvasFont;
  const activeFont = '600 14px ' + canvasFont;
  function draw(now: number) {
    frame = 0;
    advance(now);
    if (!ctx || !w || !h) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    points = stars.map(project);
    if (scale < 2.5) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (2.5 - scale) / 1.5) * (selected < 0 ? .85 : .45);
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
    labels = [];
    const active = selected < 0 ? new Set<number>() : new Set(neighbours[selected]);
    function edge(i: number, j: number) {
      if (!ctx) return;
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[j].x, points[j].y);
    }
    ctx.beginPath();
    ctx.strokeStyle = selected >= 0 ? 'rgba(137,199,208,.1)' : 'rgba(143,210,217,.33)';
    ctx.lineWidth = 0.72;
    if (scale < 3.5) {
      for (const [i, j] of links) edge(i, j);
    } else {
      // Zoom reveals the rest of the short local credit paths, at a fixed screen length.
      const reach = Math.min(w, h) * 0.43;
      for (let i = 0; i < points.length; i++) {
        const { x, y } = points[i];
        if (x < -reach || x > w + reach || y < -reach || y > h + reach) continue;
        for (const j of neighbours[i]) if (j > i && distance(points[i], points[j]) < reach) edge(i, j);
      }
    }
    ctx.stroke();
    if (selected >= 0) {
      ctx.beginPath();
      for (const j of active) edge(selected, j);
      ctx.strokeStyle = stars[selected].kind === 'recording' ? 'rgba(101,241,236,.82)' : 'rgba(255,202,128,.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // A phone fits the same sky into far fewer pixels. Resolve its fainter stars
    // as points of light and gradually spread their rays as the reader zooms.
    const densityScale = clamp(Math.sqrt((w * h) / Math.max(1, stars.length * 205)), 0.48, 1);
    const markScale = clamp(densityScale * Math.pow(scale, 0.34), 0.48, 1.4);
    // Records form the fine dust. Artist stars stay readable above them at every zoom.
    function mark(i: number) {
      if (!ctx) return;
      const { x, y } = points[i];
      if (x < -12 || x > w + 12 || y < -12 || y > h + 12) return;
      const artist = stars[i].kind === 'artist';
      const highlighted = i === selected || i === hovered;
      const palette = artist ? GOLD : JADE;
      const accent = palette[i % palette.length];
      const lit = highlighted || active.has(i);
      const variation = 0.86 + ((i * 7) % 11) / 28;
      const baseRadius = artist ? (stars[i].href ? 4.5 : 2.25) : 1.25;
      const r = highlighted ? 7 : lit ? 3.3 : baseRadius * markScale * variation;
      ctx.globalAlpha = selected < 0 || lit ? 1 : artist ? 0.4 : 0.34;
      ctx.fillStyle = accent;
      if (lit || (artist ? stars[i].href : i % 7 === 0)) {
        const halo = r * (highlighted ? 3.4 : 2.7);
        ctx.drawImage(artist ? amberHalo : cyanHalo, x - halo, y - halo, 2 * halo, 2 * halo);
      }
      if (artist || highlighted) {
        sparkle(ctx, points[i], r);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (highlighted) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 11.5, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    for (const [i, star] of stars.entries()) if (star.kind === 'recording') mark(i);
    for (const [i, star] of stars.entries()) if (star.kind === 'artist') mark(i);
    if (hovered >= 0) mark(hovered);
    if (selected >= 0) mark(selected);

    ctx.direction = lang === 'fa' ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // First reserve space for the active star's label. Spread the remaining names
    // across the sky; increasing zoom allows more labels in the visible area.
    const maxLabels = Math.max(3, Math.floor((w * h) / 65000)) + Math.floor(2 * Math.log2(scale));
    const label = (i: number, priority = false) => {
      if (!ctx || i < 0 || labels.some((b) => b.index === i)) return;
      const { x, y } = points[i];
      if (x < 5 || x > w - 5 || y < 5 || y > h - 5) return;
      ctx.font = priority ? activeFont : standardFont;
      const width = Math.min(ctx.measureText(stars[i].name).width + 12, w * 0.78);
      const height = priority ? 23 : 19;
      const left = clamp(x - width / 2, 4, w - width - 4);
      const candidates = [y + (priority ? 15 : 5), y - height - (priority ? 15 : 6)];
      for (const top of candidates) {
        if (top < 3 || top + height > h - 3) continue;
        const spacing = priority ? 4 : Math.max(10, 34 / scale);
        if (
          labels.some(
            (b) =>
              left < b.left + b.width + spacing &&
              left + width + spacing > b.left &&
              top < b.top + b.height + spacing &&
              top + height + spacing > b.top,
          )
        )
          continue;
        const midX = left + width / 2,
          midY = top + height / 2;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#162031';
        ctx.lineWidth = 3.5;
        ctx.strokeText(stars[i].name, midX, midY, width - 8);
        ctx.fillStyle = priority ? '#fff2d9' : '#e9e1d2';
        ctx.fillText(stars[i].name, midX, midY, width - 8);
        labels.push({ left, top, width, height, index: i });
        return;
      }
    };
    label(selected, true);
    label(hovered, true);
    for (const i of active) if (labels.length < maxLabels) label(i);
    for (const i of landmarks) if (labels.length < maxLabels) label(i);
    for (let i = 0; i < stars.length && labels.length < maxLabels; i++) {
      if ((stars[i].href && stars[i].kind === 'artist') || scale >= 4) label(i);
    }
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    w = box.width;
    h = box.height;
    ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    schedule();
  }
  const local = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function hit(p: Point, radius: number) {
    const label = labels.find(
      (b) => p.x >= b.left && p.x <= b.left + b.width && p.y >= b.top && p.y <= b.top + b.height,
    );
    if (label) return label.index;
    let nearest = -1,
      best = radius;
    for (let i = 0; i < points.length; i++) {
      const d = distance(p, points[i]);
      if (d < best) {
        nearest = i;
        best = d;
      }
    }
    return nearest;
  }
  function pointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = local(e);
    if (!pointers.size) {
      down = p;
      moved = motion !== null;
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
      const next = e.pointerType === 'mouse' ? hit(p, 10) : -1;
      if (hovered !== next) {
        hovered = next;
        canvas.style.cursor = next < 0 ? 'grab' : 'pointer';
        schedule();
      }
      return;
    }
    const other = [...pointers.entries()].find(([id]) => e.pointerId !== id)?.[1];
    pointers.set(e.pointerId, p);
    if (!moved && distance(down, p) < 4) return;
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
    if (!moved && e.type === 'pointerup') {
      const i = hit(local(e), e.pointerType === 'mouse' ? 12 : 19);
      if (i >= 0) choose(stars[i].id);
    }
    if (!pointers.size) canvas.style.cursor = 'grab';
  }
  function leave() {
    hovered = -1;
    schedule();
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
  function wheel(e: WheelEvent) {
    if (gestureScale) { e.preventDefault(); return; }
    const at = local(e);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      motion = null;
      zoom(Math.exp(-clamp(e.deltaY, -120, 120) * .01), at);
    } else if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
      e.preventDefault();
      easeZoom(Math.exp(-Math.sign(e.deltaY) * .18), at);
    } else if (scale > 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
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
      const nearest = hit({ x: w / 2, y: h / 2 }, Infinity);
      const i = hovered >= 0 ? hovered : selected >= 0 ? selected : nearest;
      if (i >= 0) choose(stars[i].id);
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const origin = points[hovered] || points[selected] || { x: w / 2, y: h / 2 };
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
      if (next >= 0) choose(stars[next].id);
    } else return;
    e.preventDefault();
  }

  const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'];
  for (const event of gestureEvents) canvas.addEventListener(event, safariPinch, { passive: false });
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('lostpointercapture', pointerEnd);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', keyboard);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.fonts.addEventListener('loadingdone', schedule);
  resize();
  return {
    zoom: easeZoom,
    fit,
    select,
    dispose() {
      for (const event of gestureEvents) canvas.removeEventListener(event, safariPinch);
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener('loadingdone', schedule);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerEnd);
      canvas.removeEventListener('pointercancel', pointerEnd);
      canvas.removeEventListener('lostpointercapture', pointerEnd);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', keyboard);
    },
  };
}

export default function SkyCanvas({ stars, selected, onSelect, lang, words, resetKey }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sky = useRef<ReturnType<typeof makeSky>>(undefined);
  const choose = useRef(onSelect);
  choose.current = onSelect;
  useEffect(() => {
    if (!canvas.current) return;
    sky.current = makeSky(canvas.current, stars, lang, (id) => choose.current(id));
    return () => {
      sky.current?.dispose();
      sky.current = undefined;
    };
  }, [stars, lang]);
  useEffect(() => {
    sky.current?.fit();
  }, [resetKey]);
  useEffect(() => {
    sky.current?.select(selected);
  }, [selected, stars, lang]);

  return (
    <div class="sky-viewport">
      <canvas
        ref={canvas}
        class="sky-canvas"
        tabIndex={0}
        aria-label={words.mapLabel}
        aria-describedby="sky-keyboard-help"
        data-star-count={stars.length}
      />
      <span id="sky-keyboard-help" class="visually-hidden">
        {words.keyboardHelp}
      </span>
      <div class="sky-zoom" role="group" aria-label={words.mapLabel}>
        <button type="button" onClick={() => sky.current?.zoom(1.6)} aria-label={words.zoomIn} title={words.zoomIn}>
          +
        </button>
        <button
          type="button"
          onClick={() => sky.current?.zoom(1 / 1.6)}
          aria-label={words.zoomOut}
          title={words.zoomOut}
        >
          −
        </button>
        <button type="button" onClick={() => sky.current?.fit(true)} aria-label={words.fit} title={words.fit}>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M3 8V3h5m4 0h5v5m0 4v5h-5m-4 0H3v-5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
