import { useEffect, useRef } from 'preact/hooks';
import type { Strings } from '../lib/i18n';
import type { Lang } from '../lib/record';
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
const GOLD = ['#fad398', '#e8b575', '#ffdeae', '#f5c891'];
const JADE = ['#a2d6d3', '#82b7bf', '#b4dcd6', '#92bacc'];
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
    const slack = 0.08 * (1 - 1 / scale);
    const reach = 0.5 / scale - slack;
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
  function fit() {
    centre = { x: 0.5, y: 0.5 };
    scale = 1;
    hovered = -1;
    schedule();
  }
  function select(id: string | null) {
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

  // A single small sprite supplies the soft bloom around featured and active stars.
  const bloom = document.createElement('canvas');
  bloom.width = bloom.height = 36;
  const glow = bloom.getContext('2d');
  if (glow) {
    const gradient = glow.createRadialGradient(18, 18, 0, 18, 18, 18);
    gradient.addColorStop(0, 'rgba(255,227,187,.8)');
    gradient.addColorStop(0.23, 'rgba(249,203,147,.28)');
    gradient.addColorStop(1, 'rgba(249,203,147,0)');
    glow.fillStyle = gradient;
    glow.fillRect(0, 0, 36, 36);
  }
  const canvasFont = getComputedStyle(canvas).fontFamily;
  const standardFont = '12px ' + canvasFont;
  const activeFont = '600 14px ' + canvasFont;
  function draw() {
    frame = 0;
    if (!ctx || !w || !h) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    points = stars.map(project);
    labels = [];
    const active = selected < 0 ? new Set<number>() : new Set(neighbours[selected]);
    function edge(i: number, j: number) {
      if (!ctx) return;
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[j].x, points[j].y);
    }
    ctx.beginPath();
    ctx.strokeStyle = selected >= 0 ? 'rgba(213,185,147,.1)' : 'rgba(221,198,166,.3)';
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
      ctx.strokeStyle = 'rgba(241,208,159,.78)';
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
      if (artist || highlighted) {
        if (highlighted || (stars[i].href && artist)) {
          const halo = r * 2.3;
          ctx.drawImage(bloom, x - halo, y - halo, 2 * halo, 2 * halo);
        }
        sparkle(ctx, points[i], r);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (highlighted) {
        ctx.strokeStyle = i === selected ? '#fff0cf' : accent;
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
      moved = false;
    } else moved = true;
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
    let from = last,
      to = p;
    if (other) {
      from = middle(last, other);
      to = middle(p, other);
      zoom(distance(p, other) / Math.max(1, distance(last, other)), from);
    }
    centre.x -= (to.x - from.x) / (spanX() * scale);
    centre.y -= (to.y - from.y) / (spanY() * scale);
    constrain();
    schedule();
  }
  function pointerEnd(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
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
  function wheel(e: WheelEvent) {
    const pixels =
      e.deltaY * (e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? h : 1);
    if (!pixels || (scale === 1 && pixels > 0) || (scale === MAX_ZOOM && pixels < 0)) return;
    e.preventDefault();
    zoom(Math.exp(-clamp(pixels, -240, 240) * 0.004), local(e));
  }
  function keyboard(e: KeyboardEvent) {
    if (e.key === '+' || e.key === '=' || e.key === '-') zoom(e.key === '-' ? 1 / 1.5 : 1.5);
    else if (e.key === 'Home') fit();
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
    zoom,
    fit,
    select,
    dispose() {
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
        <button type="button" onClick={() => sky.current?.fit()} aria-label={words.fit} title={words.fit}>
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
