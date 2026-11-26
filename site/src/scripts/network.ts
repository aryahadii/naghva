/**
 * The Statistics page's collaboration network (src/pages/[lang]/stats.astro).
 *
 * The picture has two states. With nobody chosen it is a map of islands, each a circle of people who work mostly
 * with each other. Choosing a person (a dot, a row beside the map, or a name found by search) redraws the picture
 * around them: they stand in the middle, the people they worked with ring them, closest first, and the rows list
 * the same people with the number of releases they share. Choosing one of those moves on to that person.
 *
 * On a phone the page holds a still preview; a tap opens it full screen, where a tap on an island zooms into it,
 * a pinch zooms, a drag moves and Back closes.
 */
type View = [number, number, number, number];
type Point = { x: number; y: number };
type Gesture = { v: View; moved: boolean; a?: Point; d?: number; m?: Point; pinch?: boolean };
type Dot = {
  id: string; el: SVGCircleElement; name: string; alt: string; key: string; href?: string; page: boolean; g: number;
  hx: number; hy: number; hr: number; // home, as the layout placed it
  x: number; y: number; r: number; // now
  near: [Dot, number][]; links: Link[]; width?: number;
};
type Link = { el: SVGLineElement; a: Dot; b: Dot; w: number };
type Isle = { el: SVGCircleElement; lead?: Dot; hx: number; hy: number; x: number; y: number; r: number };

/** A name as typed or stored, reduced for matching: lower case, no accents, one spelling of Persian letters. */
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ًͯ-ٰٟ‌‍]/g, '')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ةۀ]/g, 'ه').replace(/[أإآ]/g, 'ا').toLowerCase().replace(/\s+/g, ' ').trim();

function network(): void {
  const section = document.querySelector<HTMLElement>('#network');
  const ui = section?.querySelector<HTMLElement>('.net-ui');
  const wrap = ui?.querySelector<HTMLElement>('.net-wrap');
  const svg = wrap?.querySelector<SVGSVGElement>('svg.net-svg');
  const full = section?.querySelector<HTMLElement>('.net-full');
  if (!section || !ui || !wrap || !svg || !full) return;
  const $ = <T extends Element>(q: string) => ui.querySelector<T>(q)!;
  const bar = $<HTMLElement>('.net-bar'), input = $<HTMLInputElement>('.net-q'), found = $<HTMLElement>('.net-found');
  const names = $<HTMLElement>('.net-names'), expand = $<HTMLButtonElement>('.net-expand'), out = $<HTMLButtonElement>('.net-out');
  const panel = $<HTMLElement>('.net-panel'), who = $<HTMLElement>('.net-who'), nameEl = $<HTMLElement>('.net-name');
  const link = $<HTMLAnchorElement>('.net-open'), cap = $<HTMLElement>('.net-cap'), rows = $<HTMLElement>('.net-rows'), scroller = $<HTMLElement>('.net-scroll');
  const words = { with: section.dataset.with ?? '', releases: section.dataset.releases ?? '', none: section.dataset.none ?? '' };
  const fmt = new Intl.NumberFormat(section.dataset.digits === 'fa' ? 'fa-IR' : 'en');
  const phone = matchMedia('(max-width: 640px)'), still = matchMedia('(prefers-reduced-motion: reduce)');
  const num = (el: Element, a: string) => +el.getAttribute(a)!;

  const dots: Dot[] = [...svg.querySelectorAll<SVGCircleElement>('circle[data-id]')].map((el) => {
    const x = num(el, 'cx'), y = num(el, 'cy'), r = num(el, 'r'), name = el.dataset.name ?? '', alt = el.dataset.alt ?? '';
    return { id: el.dataset.id!, el, name, alt, key: `${fold(name)}\n${fold(alt)}`, href: el.dataset.href, page: el.classList.contains('has-page'), g: +(el.dataset.g ?? 0), hx: x, hy: y, hr: r, x, y, r, near: [], links: [] };
  });
  const byId = new Map(dots.map((d) => [d.id, d]));
  const links: Link[] = [];
  for (const el of svg.querySelectorAll<SVGLineElement>('line[data-s]')) {
    const a = byId.get(el.dataset.s!), b = byId.get(el.dataset.t!), w = +(el.dataset.w ?? 1);
    if (!a || !b) continue;
    const l = { el, a, b, w };
    links.push(l); a.links.push(l); b.links.push(l); a.near.push([b, w]); b.near.push([a, w]);
  }
  for (const d of dots) d.near.sort((p, q) => q[1] - p[1] || q[0].near.length - p[0].near.length);
  const isles: Isle[] = [...svg.querySelectorAll<SVGCircleElement>('.isles circle')].map((el) => {
    const x = num(el, 'cx'), y = num(el, 'cy');
    return { el, lead: byId.get(el.dataset.lead ?? ''), hx: x, hy: y, x, y, r: num(el, 'r') };
  });
  const bySize = [...dots].sort((a, b) => b.hr - a.hr);
  const [, , W0, H0] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  let W = W0, H = H0, isOpen = false, upright = false;

  // What is chosen (`sel`), and what a mouse is only resting on (`peek`).
  let sel: Dot | null = null, peek: Dot | null = null, hot: Dot | null = null, ring = new Set<Dot>();
  let view: View = [0, 0, W, H], base: View = view, anim = 0, tween = 0;

  // ---- The picture -------------------------------------------------------------------------------------------
  const put = (d: Dot) => { d.el.setAttribute('cx', d.x.toFixed(1)); d.el.setAttribute('cy', d.y.toFixed(1)); };
  const lay = (l: Link) => {
    l.el.setAttribute('x1', l.a.x.toFixed(1)); l.el.setAttribute('y1', l.a.y.toFixed(1));
    l.el.setAttribute('x2', l.b.x.toFixed(1)); l.el.setAttribute('y2', l.b.y.toFixed(1));
  };
  // Dots grow more slowly than the picture, so zooming in spreads them apart instead of blowing them up.
  const zoom = () => base[2] / view[2];
  const grow = () => (isOpen && !sel ? 1.4 : 1) * zoom() ** -.62;
  const sizeAll = () => { const k = grow(); for (const d of dots) d.el.setAttribute('r', (d.r * k).toFixed(2)); };
  // How many of the picture's units one screen pixel is, at the whole view and right now.
  const stageBox = () => wrap.getBoundingClientRect();
  const unit0 = () => base[2] / (stageBox().width || 1);

  // Home is where the layout put a dot; on an upright screen the whole map is turned on its side.
  const home = (o: { hx: number; hy: number }): Point => (upright ? { x: o.hy, y: o.hx } : { x: o.hx, y: o.hy });
  const snapHome = () => {
    for (const d of dots) { const h = home(d); d.x = h.x; d.y = h.y; d.r = d.hr; put(d); }
    for (const i of isles) { const h = home(i); i.x = h.x; i.y = h.y; i.el.setAttribute('cx', `${h.x}`); i.el.setAttribute('cy', `${h.y}`); }
    links.forEach(lay);
  };

  // Where everyone goes when `c` is chosen: `c` in the middle, the people they worked with on rings around them,
  // the closest collaborators on the inner ring, and people from one island side by side.
  const around = (c: Dot): Map<Dot, [number, number, number]> => {
    const box = stageBox(), u = unit0(), cx = base[0] + base[2] / 2, cy = base[1] + base[3] / 2;
    const rx = Math.max(60, box.width / 2 - 44) * u, ry = Math.max(60, box.height / 2 - 40) * u;
    const to = new Map<Dot, [number, number, number]>([[c, [cx, cy, 12 * u]]]);
    const n = c.near.length, top = c.near[0]?.[1] ?? 1;
    const girth = (f: number) => { const a = rx * f, b = ry * f; return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); };
    // One, two or three rings with room for a name under each dot; whoever is left over shares the outer ring.
    const gap = 46 * u;
    let at: number[] = [], room: number[] = [];
    for (const fs of [[.62], [.56, 1], [.4, .7, 1]]) {
      at = fs;
      room = at.map((f) => Math.max(3, Math.floor(girth(f) / gap)));
      if (room.reduce((a, b) => a + b, 0) >= n) break;
    }
    const spare = n > room.reduce((a, b) => a + b, 0);
    let i = 0;
    at.forEach((f, k) => {
      const last = k === at.length - 1;
      const members = c.near.slice(i, last ? n : i + room[k]).sort((p, q) => p[0].g - q[0].g || q[1] - p[1]);
      i += members.length;
      members.forEach(([d, w], j) => {
        const t = -Math.PI / 2 + ((j + (k % 2) / 2) / members.length) * 2 * Math.PI;
        to.set(d, [cx + Math.cos(t) * rx * f, cy + Math.sin(t) * ry * f, (last && spare ? 3.5 : 4.5 + 4.5 * Math.sqrt(w / top)) * u]);
      });
    });
    return to;
  };
  // Move dots to new places, taking their lines along.
  const move = (to: Map<Dot, [number, number, number]>) => {
    cancelAnimationFrame(tween);
    const going: [Dot, number, number, number, number, number, number][] = [];
    for (const d of dots) {
      const h = home(d), [x, y, r] = to.get(d) ?? [h.x, h.y, d.hr];
      if (Math.abs(d.x - x) > .05 || Math.abs(d.y - y) > .05 || Math.abs(d.r - r) > .01) going.push([d, d.x, d.y, d.r, x, y, r]);
    }
    const lines = new Set(going.flatMap(([d]) => d.links));
    const t0 = performance.now(), ms = still.matches ? 0 : 420;
    const step = (t: number) => {
      const k = ms ? Math.min(1, Math.max(0, (t - t0) / ms)) : 1, e = 1 - (1 - k) ** 3;
      for (const [d, x0, y0, r0, x, y, r] of going) { d.x = x0 + (x - x0) * e; d.y = y0 + (y - y0) * e; d.r = r0 + (r - r0) * e; put(d); }
      lines.forEach(lay);
      sizeAll();
      placeNames();
      if (k < 1) tween = requestAnimationFrame(step);
    };
    step(t0);
  };

  // ---- Names on the picture ----------------------------------------------------------------------------------
  // The chosen person and their circle, or the island leads and then as many of the biggest dots as fit without
  // overlapping. Zooming in makes room for more.
  const ruler = document.createElement('canvas').getContext('2d');
  const widthOf = (d: Dot) => {
    if (d.width === undefined && ruler) { ruler.font = getComputedStyle(names).font || '12px sans-serif'; d.width = ruler.measureText(d.name).width + 8; }
    return d.width ?? d.name.length * 6.6 + 8;
  };
  let queued = false;
  const placeNames = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const box = stageBox(), m = svg.getScreenCTM();
      if (!m || !box.width) return;
      const lit = sel ?? peek;
      const leads = isles.map((i) => i.lead).filter((d): d is Dot => !!d);
      const order = lit ? [lit, ...(hot ? [hot] : []), ...lit.near.map(([d]) => d)] : [...leads, ...(zoom() > 1.5 ? bySize : [])];
      const limit = sel ? 60 : peek ? 7 : leads.length + (zoom() > 1.5 ? Math.round(10 * Math.min(5, zoom())) : 0);
      const k = grow(), spans: HTMLSpanElement[] = [], seen = new Set<Dot>();
      // A name may not sit on another name, nor on a dot that is lit.
      const boxes: [number, number, number, number][] = (lit ? [lit, ...lit.near.map(([d]) => d)] : zoom() > 1.5 ? dots : []).map((d) => {
        const p = new DOMPoint(d.x, d.y).matrixTransform(m), r = d.r * k * m.a;
        return [p.x - box.left - r, p.y - box.top - r, r * 2, r * 2];
      });
      const hit = (x: number, y: number, w: number, h: number) => boxes.some((b) => x < b[0] + b[2] && b[0] < x + w && y < b[1] + b[3] && b[1] < y + h);
      const write = (d: Dot, x: number, y: number, w: number, strong: boolean) => {
        boxes.push([x, y, w, 16]);
        const span = document.createElement('span');
        span.textContent = d.name;
        span.style.left = `${x + w / 2}px`;
        span.style.top = `${y}px`;
        if (strong) span.className = 'is-sel';
        spans.push(span);
      };
      // On the whole map each island's lead is written under the island, clear of its dots.
      if (!lit && zoom() <= 1.5) {
        for (const i of isles) {
          if (!i.lead) continue;
          const p = new DOMPoint(i.x, i.y + i.r * .86).matrixTransform(m), w = widthOf(i.lead);
          const x = Math.min(Math.max(p.x - box.left - w / 2, 2), box.width - w - 2), y = Math.min(p.y - box.top, box.height - 18);
          if (!hit(x, y, w, 16)) write(i.lead, x, y, w, false);
        }
        names.replaceChildren(...spans);
        return;
      }
      for (const d of order) {
        if (spans.length >= limit) break;
        if (seen.has(d)) continue;
        seen.add(d);
        const p = new DOMPoint(d.x, d.y).matrixTransform(m);
        const sx = p.x - box.left, sy = p.y - box.top, w = widthOf(d), h = 16, rr = d.r * k * m.a + 3;
        if (sx < 0 || sx > box.width || sy < 0 || sy > box.height) continue;
        // Under the dot; when that is taken over it, then beside it. Kept inside the picture.
        const fits = (x: number, y: number) => x >= 2 && x + w <= box.width - 2 && y >= 2 && y + h <= box.height - 2;
        const mid = Math.min(Math.max(sx - w / 2, 2), box.width - w - 2);
        const sides: [number, number][] = [[mid, sy + rr], [mid, sy - rr - h], [sx + rr + 2, sy - h / 2], [sx - rr - 2 - w, sy - h / 2]];
        const forced = d === lit || d === hot;
        const side = sides.find(([x, y]) => fits(x, y) && !hit(x, y, w, h)) ?? (forced ? sides.find(([x, y]) => fits(x, y)) ?? sides[0] : null);
        if (!side) continue;
        write(d, side[0], side[1], w, forced);
      }
      names.replaceChildren(...spans);
    });
  };

  // ---- Choosing ----------------------------------------------------------------------------------------------
  const row = (d: Dot, share: number, value: number) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.dataset.pick = d.id; if (d.page) b.className = 'has-page';
    const n = document.createElement('span'), bar = document.createElement('span'), v = document.createElement('span');
    n.className = 'nr-name'; n.textContent = d.name;
    bar.className = 'nr-bar'; bar.style.setProperty('--w', `${Math.max(4, share * 100)}%`);
    v.className = 'nr-val'; v.textContent = fmt.format(value);
    b.append(n, bar, v); li.append(b);
    return li;
  };
  const rows0 = [...rows.children], cap0 = [...cap.children].map((c) => c.textContent ?? '');
  const caption = (a: string, b: string) => { cap.children[0].textContent = a; cap.children[1].textContent = b; };
  const paint = (lit: Dot | null) => {
    svg.classList.toggle('has-sel', !!lit);
    svg.classList.toggle('is-ego', !!sel);
    for (const d of dots) d.el.classList.remove('is-sel', 'is-near');
    for (const l of links) l.el.classList.remove('is-on', 'is-in');
    if (!lit) return;
    lit.el.classList.add('is-sel');
    const circle = new Set(lit.near.map(([d]) => d));
    for (const d of circle) d.el.classList.add('is-near');
    for (const l of lit.links) l.el.classList.add('is-on');
  };
  const choose = (d: Dot | null, from?: Dot | null): void => {
    const was = sel, held = rows.contains(document.activeElement) || who.contains(document.activeElement);
    warm(null);
    sel = d; peek = null;
    ring = new Set(d ? d.near.map(([n]) => n) : []);
    ui.classList.toggle('has-sel', !!d);
    who.hidden = !d;
    if (d) {
      nameEl.textContent = d.name;
      link.classList.toggle('is-off', !d.href);
      if (d.href) link.href = d.href; else link.removeAttribute('href');
      caption(words.with.replace('{n}', fmt.format(d.near.length)), words.releases);
      // A full bar is the most releases they share with anyone, and never fewer than a dozen.
      const top = Math.max(12, d.near[0]?.[1] ?? 1);
      rows.replaceChildren(...d.near.map(([o, w]) => row(o, w / top, w)));
    } else {
      caption(cap0[0], cap0[1]);
      rows.replaceChildren(...rows0);
    }
    scroller.scrollTop = 0;
    if (held) (d ? nameEl : rows.querySelector<HTMLElement>('[data-pick]'))?.focus({ preventScroll: true });
    paint(d);
    cancelAnimationFrame(anim);
    if (isOpen) base = fit();
    if (d) {
      setView(base);
      move(around(d));
    } else {
      // Back on the map, at the island the reader was just looking at.
      const isle = isOpen && (from ?? was) ? isles[(from ?? was)!.g] : null;
      move(new Map());
      if (isle) glide(isleView(isle)); else setView(base);
    }
    out.hidden = !isOpen || !!sel || zoom() < 1.03;
  };
  // One of the chosen person's circle singled out, by a first tap, a resting pointer or its row: its name shows,
  // its row is marked, and its own ties within the circle are drawn.
  const warm = (d: Dot | null, bring = false) => {
    if (hot === d) return;
    hot?.el.classList.remove('is-hot');
    for (const l of links) l.el.classList.remove('is-in');
    hot = d;
    d?.el.classList.add('is-hot');
    if (d) for (const l of d.links) if (ring.has(l.a) && ring.has(l.b)) l.el.classList.add('is-in');
    for (const b of rows.querySelectorAll<HTMLElement>('[data-pick]')) {
      const on = b.dataset.pick === d?.id;
      b.classList.toggle('is-hot', on);
      if (on && bring) b.scrollIntoView({ block: 'nearest', behavior: still.matches ? 'auto' : 'smooth' });
    }
    placeNames();
  };
  const hover = (d: Dot | null) => {
    if (sel || peek === d) return;
    peek = d;
    paint(d);
    placeNames();
  };

  // ---- The view ----------------------------------------------------------------------------------------------
  // Full screen: the visible part of the picture always has the stage's shape, so nothing is letterboxed.
  const MAX = 8;
  const fit = (): View => {
    const r = stageBox(), a = r.width / (r.height || 1);
    let w = W * 1.04, h = H * 1.04;
    if (w / h > a) h = w / a; else w = h * a;
    return [(W - w) / 2, (H - h) / 2, w, h];
  };
  const clamp = ([x, y, w]: [number, number, number]): View => {
    w = Math.min(Math.max(w, base[2] / MAX), base[2]);
    const h = w * (base[3] / base[2]);
    x = w >= W ? (W - w) / 2 : Math.min(Math.max(x, -w * .1), W - w * .9);
    y = h >= H ? (H - h) / 2 : Math.min(Math.max(y, -h * .1), H - h * .9);
    return [x, y, w, h];
  };
  const setView = (v: View) => {
    view = v;
    svg.setAttribute('viewBox', v.map((x) => x.toFixed(2)).join(' '));
    sizeAll();
    out.hidden = !isOpen || !!sel || zoom() < 1.03;
    placeNames();
  };
  const glide = (to: View) => {
    cancelAnimationFrame(anim);
    if (still.matches) { setView(to); return; }
    const from = view, t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / 320)), e = 1 - (1 - k) ** 3;
      setView(from.map((a, i) => a + (to[i] - a) * e) as View);
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  // An island with a little air around it.
  const isleView = (i: Isle): View => {
    const a = base[2] / base[3], side = i.r * 2.3, w = Math.max(side, side * a);
    return clamp([i.x - w / 2, i.y - w / a / 2, w]);
  };
  // Where a pointer is, in the picture's own units.
  const at = (e: MouseEvent) => {
    const m = svg.getScreenCTM();
    return m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : null;
  };
  // The nearest dot within `px` screen pixels of its edge, among those that can be chosen right now.
  const nearest = (e: MouseEvent, px: number): Dot | null => {
    const p = at(e), m = svg.getScreenCTM();
    if (!p || !m) return null;
    const k = grow();
    let best: Dot | null = null, bestD = Infinity;
    for (const d of sel ? [sel, ...ring] : dots) {
      const far = Math.hypot(d.x - p.x, d.y - p.y) - d.r * k;
      if (far < bestD) { bestD = far; best = d; }
    }
    return bestD * m.a <= px ? best : null;
  };

  // When the stage changes shape (the rows below grow as a person is chosen, or the window turns), fit the
  // picture to it again.
  let lastBox = '';
  const refit = () => {
    const r = stageBox(), key = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (key === lastBox) return;
    lastBox = key;
    if (!isOpen) { if (sel) move(around(sel)); else placeNames(); return; }
    const cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2, k = view[2] / base[2];
    base = fit();
    if (sel) { setView(base); move(around(sel)); return; }
    const w = base[2] * k;
    setView(clamp([cx - w / 2, cy - (w * base[3] / base[2]) / 2, w]));
  };
  new ResizeObserver(refit).observe(wrap);

  // ---- Full screen -------------------------------------------------------------------------------------------
  // The dialog sits directly in <body>, so everything else can be made inert while it is open.
  document.body.append(full);
  const spot = document.createComment('network');
  let opener: HTMLElement | null = null, stilled: HTMLElement[] = [], depth = 0;
  // Choose, and in the full-screen view remember the step, so Back retraces it before it closes the view.
  const go = (d: Dot | null) => {
    if (d === sel) return;
    choose(d);
    if (isOpen) { depth++; history.pushState({ netFull: true, id: d?.id }, ''); }
  };
  const open = (d: Dot | null) => {
    if (isOpen) return;
    isOpen = true;
    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : expand;
    cancelAnimationFrame(tween);
    sel = peek = null;
    ui.before(spot);
    full.append(ui);
    full.hidden = false;
    ui.classList.add('is-full');
    document.documentElement.classList.add('nf-lock');
    stilled = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== full && !el.inert);
    stilled.forEach((el) => { el.inert = true; });
    const r = stageBox();
    upright = r.height > r.width;
    if (upright) [W, H] = [H0, W0];
    snapHome();
    base = fit();
    lastBox = '';
    setView(base);
    choose(d);
    depth = 1;
    history.pushState({ netFull: true, id: d?.id }, '');
    $<HTMLButtonElement>('.net-close').focus({ preventScroll: true });
  };
  const close = () => {
    if (!isOpen) return;
    cancelAnimationFrame(anim); cancelAnimationFrame(tween);
    ask('');
    sel = peek = null;
    choose(null);
    cancelAnimationFrame(anim); cancelAnimationFrame(tween);
    isOpen = false;
    upright = false;
    [W, H] = [W0, H0];
    ui.classList.remove('is-full');
    spot.replaceWith(ui);
    full.hidden = true;
    document.documentElement.classList.remove('nf-lock');
    stilled.forEach((el) => { el.inert = false; });
    stilled = [];
    snapHome();
    base = [0, 0, W, H];
    lastBox = '';
    setView(base);
    // Back to where the reader was; the preview's expand button stands in for a tap on the picture.
    (opener?.isConnected && opener.offsetParent !== null ? opener : expand).focus({ preventScroll: true });
  };
  // Back closes the full-screen view, so the close button goes back too.
  const shut = () => { if (history.state?.netFull && depth) history.go(-depth); else close(); };
  $<HTMLButtonElement>('.net-close').addEventListener('click', shut);
  addEventListener('popstate', () => {
    if (!isOpen) return;
    depth--;
    const state = history.state;
    if (!state?.netFull || depth < 1) { close(); return; }
    choose(byId.get(state.id ?? '') ?? null);
  });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (sel) go(null);
    else if (isOpen) shut();
  });
  $<HTMLButtonElement>('.net-shut').addEventListener('click', () => go(null));
  out.addEventListener('click', () => glide(base));
  expand.addEventListener('click', () => open(null));

  // A row or a found name picks its person. On a phone that opens the full-screen view around them.
  const pick = (d: Dot | null | undefined) => {
    if (!d) return;
    if (phone.matches && !isOpen) open(d); else go(d);
  };
  ui.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-pick]') : null;
    if (!b) return;
    const d = byId.get(b.dataset.pick ?? '');
    if (found.contains(b)) { ask(''); input.blur(); }
    pick(d);
  });

  // ---- Search ------------------------------------------------------------------------------------------------
  let hits: Dot[] = [], active = 0;
  const mark = () => {
    [...found.children].forEach((li, i) => li.firstElementChild?.setAttribute('aria-selected', `${i === active && hits.length > 0}`));
    if (hits.length) input.setAttribute('aria-activedescendant', `net-hit-${active}`); else input.removeAttribute('aria-activedescendant');
  };
  const ask = (text: string) => {
    if (input.value !== text) input.value = text;
    const q = fold(text);
    hits = [];
    if (q) {
      // A name that starts with what was typed first, then one with a word that does, then any that holds it.
      const rank = (d: Dot) => Math.min(...d.key.split('\n').map((k) => (k.startsWith(q) ? 0 : k.includes(` ${q}`) ? 1 : k.includes(q) ? 2 : 9)));
      hits = dots.map((d) => [d, rank(d)] as const).filter(([, r]) => r < 9)
        .sort((a, b) => a[1] - b[1] || b[0].near.length - a[0].near.length).slice(0, 6).map(([d]) => d);
    }
    active = 0;
    found.replaceChildren(...(hits.length ? hits.map((d, i) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.id = `net-hit-${i}`; b.setAttribute('role', 'option'); b.dataset.pick = d.id; b.tabIndex = -1;
      if (d.page) b.className = 'has-page';
      b.textContent = d.name;
      li.append(b);
      return li;
    }) : q ? [Object.assign(document.createElement('li'), { className: 'net-none', role: 'presentation', textContent: words.none })] : []));
    found.hidden = !q;
    input.setAttribute('aria-expanded', `${hits.length > 0}`);
    mark();
  };
  input.addEventListener('input', () => ask(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const d = hits[active];
      if (!d) return;
      ask(''); input.blur();
      pick(d);
    } else if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      ask('');
    }
  });
  // On a phone the search belongs to the full-screen view: reaching for it opens that first.
  bar.addEventListener('click', (e) => {
    if (!phone.matches || isOpen || !(e.target instanceof Element) || !e.target.closest('.net-find')) return;
    open(null);
    input.focus();
  });
  document.addEventListener('click', (e) => {
    if (found.hidden || !(e.target instanceof Element) || bar.contains(e.target) || !e.target.isConnected) return;
    ask('');
  });
  bar.hidden = false;

  // ---- Fingers and the mouse ---------------------------------------------------------------------------------
  // Full screen: one finger drags, two pinch, a press that barely moves is a tap.
  const pts = new Map<number, Point>();
  let gest: Gesture | null = null;
  const begin = (moved: boolean) => {
    const p = [...pts.values()];
    if (p.length === 1) gest = { v: view, a: p[0], moved };
    else if (p.length >= 2) gest = { v: view, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, m: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, moved: true, pinch: true };
  };
  wrap.addEventListener('pointerdown', (e) => {
    if (!isOpen || (e.target instanceof Element && e.target.closest('button'))) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    wrap.setPointerCapture(e.pointerId);
    cancelAnimationFrame(anim);
    begin(pts.size > 1);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !gest) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stageBox(), u = gest.v[2] / r.width, p = [...pts.values()];
    if (gest.pinch && gest.m && gest.d && p.length >= 2) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), m = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      // The point under the fingers stays under the fingers.
      const fx = gest.v[0] + (gest.m.x - r.left) * u, fy = gest.v[1] + (gest.m.y - r.top) * u;
      const w = Math.min(Math.max(gest.v[2] * (gest.d / d), base[2] / MAX), base[2]), u2 = w / r.width;
      setView(clamp([fx - (m.x - r.left) * u2, fy - (m.y - r.top) * u2, w]));
    } else if (!gest.pinch && gest.a) {
      const dx = e.clientX - gest.a.x, dy = e.clientY - gest.a.y;
      if (!gest.moved && Math.hypot(dx, dy) > 8) gest.moved = true;
      if (gest.moved) setView(clamp([gest.v[0] - dx * u, gest.v[1] - dy * u, gest.v[2]]));
    }
  });
  // A tap on the whole map zooms into the island under the finger: its dots are too close to tell apart from
  // there. Closer in, or around a chosen person, a tap chooses the nearest dot.
  const tap = (e: PointerEvent) => {
    // Around a chosen person, a first tap names a dot and finds its row; a second moves on to that person.
    if (sel) { const d = nearest(e, 26); if (!d || d === sel) warm(null); else if (d === hot) go(d); else warm(d, true); return; }
    if (zoom() >= 1.6) { const d = nearest(e, 26); if (d) go(d); return; }
    const p = at(e);
    if (!p) return;
    let best: Isle | null = null, bestD = Infinity;
    for (const i of isles) { const far = Math.hypot(i.x - p.x, i.y - p.y) - i.r; if (far < bestD) { bestD = far; best = i; } }
    if (best) glide(isleView(best));
  };
  const lift = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const tapped = gest && !gest.moved && e.type === 'pointerup';
    if (pts.size) { begin(true); return; }
    gest = null;
    if (tapped) tap(e);
  };
  wrap.addEventListener('pointerup', lift);
  wrap.addEventListener('pointercancel', lift);
  wrap.addEventListener('wheel', (e) => {
    if (!isOpen) return;
    e.preventDefault();
    const r = stageBox(), u = view[2] / r.width;
    const fx = view[0] + (e.clientX - r.left) * u, fy = view[1] + (e.clientY - r.top) * u;
    const w = Math.min(Math.max(view[2] * Math.exp(e.deltaY * .002), base[2] / MAX), base[2]), u2 = w / r.width;
    setView(clamp([fx - (e.clientX - r.left) * u2, fy - (e.clientY - r.top) * u2, w]));
  }, { passive: false });

  // In the page: on a phone any tap opens the full-screen view; elsewhere a click chooses a dot, and a click on
  // empty space lets go of the one chosen.
  svg.addEventListener('click', (e) => {
    if (isOpen) return;
    if (phone.matches) { open(null); return; }
    const d = nearest(e, 14);
    if (d !== sel) go(d);
  });
  if (matchMedia('(hover: hover)').matches) {
    svg.addEventListener('mousemove', (e) => {
      if (isOpen || phone.matches) return;
      const d = nearest(e, sel ? 14 : 10);
      svg.classList.toggle('can-pick', !!d && d !== sel);
      if (sel) warm(d === sel ? null : d); else hover(d);
    });
    svg.addEventListener('mouseleave', () => { hover(null); warm(null); });
    // A row under the pointer names its dot on the picture.
    rows.addEventListener('mouseover', (e) => { if (sel && e.target instanceof Element) warm(byId.get(e.target.closest<HTMLElement>('[data-pick]')?.dataset.pick ?? '') ?? null); });
    rows.addEventListener('mouseleave', () => warm(null));
  }
  ui.classList.add('is-live');
  placeNames();
}

network();
