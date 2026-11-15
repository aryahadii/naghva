/**
 * The Statistics page's collaboration network (src/pages/[lang]/stats.astro).
 * With a mouse, hover or click picks the nearest dot. On a phone the page holds
 * a still preview; a tap opens it full screen, where a pinch zooms, a drag
 * moves, a tap picks a dot and Back closes it.
 */
type View = [number, number, number, number];
type Point = { x: number; y: number };
type Gesture = { v: View; moved: boolean; a?: Point; d?: number; m?: Point; pinch?: boolean };

function network(): void {
  const section = document.querySelector<HTMLElement>('#network');
  const fig = document.querySelector<HTMLElement>('.net');
  const svg = fig?.querySelector<SVGSVGElement>('svg.net-svg');
  const wrap = fig?.querySelector<HTMLElement>('.net-wrap');
  const card = document.querySelector<HTMLElement>('.net-card');
  const top = document.querySelector<HTMLElement>('.net-top');
  const full = document.querySelector<HTMLElement>('.net-full');
  if (!section || !fig || !svg || !wrap || !card || !top || !full) return;
  // The page's words, from the section's data attributes.
  const words = { with: section.dataset.with ?? '', more: section.dataset.more ?? '', sep: section.dataset.sep ?? ', ', digits: section.dataset.digits ?? 'en' };
  const stage = full.querySelector<HTMLElement>('.nf-stage')!, sheet = full.querySelector<HTMLElement>('.nf-sheet')!, names = full.querySelector<HTMLElement>('.nf-names')!;
  const out = full.querySelector<HTMLButtonElement>('.net-out')!, shut = full.querySelector<HTMLButtonElement>('.nf-close')!, expand = fig.querySelector<HTMLButtonElement>('.net-expand');
  const dots = [...svg.querySelectorAll<SVGCircleElement>('circle[data-id]')];
  const lines = [...svg.querySelectorAll<SVGLineElement>('line[data-s]')];
  const byId = new Map(dots.map((c) => [c.dataset.id!, c]));
  const fmt = new Intl.NumberFormat(words.digits === 'fa' ? 'fa-IR' : 'en');
  const nameEl = card.querySelector<HTMLElement>('.net-name')!, withEl = card.querySelector<HTMLElement>('.net-with')!, link = card.querySelector<HTMLAnchorElement>('.net-open')!;
  const phone = matchMedia('(max-width: 640px)');
  const [, , W0, H0] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  let W = W0, H = H0, upright = false, isOpen = false;
  const X = (c: SVGCircleElement) => +c.getAttribute('cx')!, Y = (c: SVGCircleElement) => +c.getAttribute('cy')!, R = (c: SVGCircleElement) => +c.getAttribute('r')!;
  // Biggest dots first: they get their names first.
  const bySize = [...dots].sort((a, b) => R(b) - R(a));

  // Turn the picture upright (or back): swap every x with its y.
  const turn = () => {
    const swap = (el: Element, a: string, b: string) => { const v = el.getAttribute(a)!; el.setAttribute(a, el.getAttribute(b)!); el.setAttribute(b, v); };
    dots.forEach((c) => swap(c, 'cx', 'cy'));
    lines.forEach((l) => { swap(l, 'x1', 'y1'); swap(l, 'x2', 'y2'); });
    const glow = svg.querySelector('ellipse');
    if (glow) { swap(glow, 'cx', 'cy'); swap(glow, 'rx', 'ry'); }
    [W, H] = [H, W];
    upright = !upright;
  };

  // `picked` is a dot chosen by click or tap; a dot only hovered is shown (`cur`) but not picked.
  let picked: SVGCircleElement | null = null, cur: SVGCircleElement | null = null, near: [string, number][] = [];
  const show = (dot: SVGCircleElement | null | undefined, peek = false): void => {
    dot = dot ?? null;
    picked = peek ? null : dot;
    cur = dot;
    near = [];
    svg.classList.toggle('has-sel', !!dot);
    fig.classList.toggle('has-sel', !!dot);
    full.classList.toggle('has-sel', !!dot);
    dots.forEach((c) => c.classList.remove('is-sel', 'is-near'));
    lines.forEach((l) => l.classList.remove('is-on'));
    document.querySelectorAll<HTMLElement>('[data-pick]').forEach((x) => x.classList.toggle('is-on', !!dot && x.dataset.pick === dot.dataset.id));
    card.hidden = !dot;
    card.classList.toggle('is-peek', !!dot && peek);
    if (!dot) { placeNames(); return; }
    const id = dot.dataset.id;
    for (const l of lines) {
      const other = l.dataset.s === id ? l.dataset.t : l.dataset.t === id ? l.dataset.s : null;
      if (!other) continue;
      l.classList.add('is-on');
      byId.get(other)?.classList.add('is-near');
      near.push([other, +(l.dataset.w ?? 0)]);
    }
    dot.classList.add('is-sel');
    near.sort((a, b) => b[1] - a[1]);
    nameEl.textContent = dot.dataset.name ?? '';
    // Who they worked with, as names to tap: each one moves the selection to that person.
    withEl.replaceChildren();
    if (near.length) {
      withEl.append(`${words.with}: `);
      near.slice(0, 8).forEach(([other], i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'net-hop'; b.textContent = byId.get(other)?.dataset.name ?? '';
        b.addEventListener('click', () => { const d = byId.get(other); show(d); if (d && isOpen) focusOn(d); });
        if (i) withEl.append(words.sep);
        withEl.append(b);
      });
      if (near.length > 8) withEl.append(`${words.sep}+${fmt.format(near.length - 8)} ${words.more}`);
    }
    link.hidden = !dot.dataset.href;
    if (dot.dataset.href) link.href = dot.dataset.href;
    placeNames();
    place();
  };

  // In the page, the card stands beside its dot: on the side with room that hides the fewest of the dot's
  // neighbours, inside the picture, and inside the window too when the dot is on screen and the card fits there.
  const place = () => {
    if (!cur || isOpen || card.hidden || card.parentElement !== wrap) return;
    const w = wrap.getBoundingClientRect(), m = svg.getScreenCTM();
    if (!m) return;
    const spot = (c: SVGCircleElement): [number, number] => { const q = new DOMPoint(X(c), Y(c)).matrixTransform(m); return [q.x - w.left, q.y - w.top]; };
    const [cx, cy] = spot(cur), gap = R(cur) * m.a + 12, edge = 8;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const left = edge, right = w.width - edge;
    let top = edge, bottom = w.height - edge;
    const vt = Math.max(top, edge - w.top), vb = Math.min(bottom, innerHeight - edge - w.top);
    if (cy > vt && cy < vb && vb - vt >= ch) { top = vt; bottom = vb; }
    const cX = (x: number) => Math.min(Math.max(x, left), right - cw), cY = (y: number) => Math.min(Math.max(y, top), bottom - ch);
    // Beside it (level with it, or reaching up or down from it), then under or over it (centred, or to a side).
    const rtl = getComputedStyle(wrap).direction === 'rtl';
    const xs: number[] = rtl ? [cx - gap - cw, cx + gap] : [cx + gap, cx - gap - cw];
    const ys = [cy + gap, cy - gap - ch];
    const spots = [
      ...xs.flatMap((x): [number, number][] => [[x, cY(cy - ch / 2)], [x, cy - gap / 2], [x, cy + gap / 2 - ch]]),
      ...ys.flatMap((y): [number, number][] => [[cX(cx - cw / 2), y], [cX(cx - 24), y], [cX(cx + 24 - cw), y]]),
    ].filter(([x, y]) => x >= left && x + cw <= right && y >= top && y + ch <= bottom);
    const lit = near.map(([o]) => byId.get(o)).filter((c): c is SVGCircleElement => !!c).map(spot);
    const under = ([x, y]: [number, number], [a, b]: [number, number]) => a > x - 8 && a < x + cw + 8 && b > y - 8 && b < y + ch + 8;
    const covers = (s: [number, number]) => (under(s, [cx, cy]) ? 1e3 : 0) + lit.filter((q) => under(s, q)).length;
    let best: [number, number] = spots[0] ?? [cX(cx + gap), cY(cy + gap)];
    for (const s of spots) if (covers(s) < covers(best)) best = s;
    card.style.left = `${best[0]}px`;
    card.style.top = `${best[1]}px`;
  };
  new ResizeObserver(place).observe(wrap);
  // When a name below the picture picks a dot that is off screen, bring the dot and its card into view.
  const reveal = () => {
    if (!picked || card.hidden) return;
    const a = card.getBoundingClientRect(), d = picked.getBoundingClientRect();
    const t = Math.min(a.top, d.top) - 16, b = Math.max(a.bottom, d.bottom) + 16;
    if (t < 0) scrollBy({ top: t, behavior: 'smooth' });
    else if (b > innerHeight) scrollBy({ top: Math.min(b - innerHeight, t), behavior: 'smooth' });
  };

  // Where a pointer is, in the picture's own units, and how many units a screen pixel is right now.
  const at = (e: MouseEvent) => {
    const m = svg.getScreenCTM();
    return m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : null;
  };
  const unit = () => +svg.getAttribute('viewBox')!.split(' ')[2] / svg.getBoundingClientRect().width;
  // The nearest dot within `px` screen pixels of its edge.
  const nearest = (e: MouseEvent, px: number): SVGCircleElement | null => {
    const p = at(e);
    if (!p) return null;
    let best: SVGCircleElement | null = null, bestD = Infinity;
    for (const c of dots) {
      const d = Math.hypot(X(c) - p.x, Y(c) - p.y) - R(c);
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= px * unit() ? best : null;
  };

  // Full screen: the visible part of the picture always has the stage's shape, so nothing is letterboxed.
  const MAX = 7;
  let view: View = [0, 0, W, H], base = view, anim = 0;
  const fit = (): View => {
    const r = stage.getBoundingClientRect(), a = r.width / r.height;
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
  // Dots grow more slowly than the picture, so zooming in spreads them apart instead of blowing them up.
  const r0 = new Map(dots.map((c) => [c, R(c)]));
  let lastK = 1;
  const size = (k: number) => {
    if (Math.abs(k - lastK) < .002) return;
    lastK = k;
    for (const [c, r] of r0) c.setAttribute('r', (r * k).toFixed(2));
  };
  const setView = (v: View) => {
    view = v;
    svg.setAttribute('viewBox', v.map((x) => x.toFixed(2)).join(' '));
    size(1.5 * (base[2] / v[2]) ** -.4);
    out.hidden = v[2] > base[2] * .97;
    placeNames();
  };
  const glide = (to: View) => {
    cancelAnimationFrame(anim);
    const from = view, t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 260), e = 1 - (1 - k) ** 3;
      setView(from.map((a, i) => a + (to[i] - a) * e) as View);
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  // Bring a dot to the middle, zoomed in enough to tell its neighbours apart.
  const focusOn = (d: SVGCircleElement) => {
    const w = Math.min(view[2], base[2] / 2.6), h = w * (base[3] / base[2]);
    glide(clamp([X(d) - w / 2, Y(d) - h / 2, w]));
  };

  // Names on the full-screen picture: the chosen person and their circle, or as many of the biggest dots as fit
  // without overlapping. Zooming in makes room for more.
  let namesQueued = false;
  const placeNames = () => {
    if (!isOpen || namesQueued) return;
    namesQueued = true;
    requestAnimationFrame(() => {
      namesQueued = false;
      // Place by where the picture really is on screen, so a letterboxed or resizing stage cannot drift.
      const r = stage.getBoundingClientRect(), m = svg.getScreenCTM();
      if (!m) return;
      const s = m.a;
      const lit = picked ? [picked, ...near.map(([o]) => byId.get(o)).filter((c): c is SVGCircleElement => !!c)] : [];
      const order = picked ? lit : bySize;
      const cap = picked ? 24 : Math.round(8 * Math.min(4, base[2] / view[2]));
      const boxes: [number, number, number, number][] = [], spans: HTMLSpanElement[] = [];
      for (const c of order) {
        if (spans.length >= cap) break;
        const p = new DOMPoint(X(c), Y(c)).matrixTransform(m);
        const sx = p.x - r.left, sy = p.y - r.top, rr = R(c) * s;
        if (sx < 0 || sx > r.width || sy < 0 || sy > r.height) continue;
        const name = c.dataset.name ?? '';
        const w = name.length * 6.4 + 6, h = 15, x = sx - w / 2, y = sy + rr + 3;
        if (x < 2 || x + w > r.width - 2 || y + h > r.height - 2) continue;
        if (boxes.some((b) => x < b[0] + b[2] && b[0] < x + w && y < b[1] + b[3] && b[1] < y + h)) continue;
        boxes.push([x, y, w, h]);
        const span = document.createElement('span');
        span.textContent = name;
        span.style.left = `${sx}px`;
        span.style.top = `${y}px`;
        if (c === picked) span.className = 'is-sel';
        spans.push(span);
      }
      names.replaceChildren(...spans);
    });
  };

  // When the stage changes shape (the sheet below grows as a person is picked, or the window turns),
  // fit the picture to it again around the same middle and zoom.
  const refit = () => {
    const cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2, k = view[2] / base[2];
    base = fit();
    const w = base[2] * k, h = base[3] * k;
    setView(clamp([cx - w / 2, cy - h / 2, w]));
  };
  const watch = new ResizeObserver(() => { if (isOpen) refit(); });

  // The dialog sits directly in <body>, so everything else can be made inert while it is open.
  document.body.append(full);
  let opener: HTMLElement | null = null, stilled: HTMLElement[] = [];
  const open = (dot: SVGCircleElement | null) => {
    if (isOpen) return;
    isOpen = true;
    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : expand;
    full.hidden = false;
    document.documentElement.classList.add('nf-lock');
    stilled = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== full && !el.inert);
    stilled.forEach((el) => { el.inert = true; });
    stage.prepend(svg);
    sheet.append(top, card);
    card.style.left = card.style.top = '';
    const r = stage.getBoundingClientRect();
    if (r.height > r.width && W > H) turn();
    base = fit();
    setView(base);
    show(dot ?? null);
    if (dot) focusOn(dot);
    watch.observe(stage);
    shut.focus();
    history.pushState({ netFull: true }, '');
  };
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    watch.disconnect();
    cancelAnimationFrame(anim);
    show(null);
    size(1);
    if (upright) turn();
    wrap.prepend(svg);
    svg.setAttribute('viewBox', `0 0 ${W0} ${H0}`);
    fig.after(top);
    wrap.append(card);
    names.replaceChildren();
    full.hidden = true;
    document.documentElement.classList.remove('nf-lock');
    stilled.forEach((el) => { el.inert = false; });
    stilled = [];
    // Back to where the reader was; the preview's expand button stands in for a tap on the picture.
    (opener?.isConnected && opener.offsetParent !== null ? opener : expand)?.focus({ preventScroll: true });
  };
  // Back closes the full-screen view, so the close button goes back too.
  shut.addEventListener('click', () => { if (history.state?.netFull) history.back(); else close(); });
  addEventListener('popstate', () => { if (isOpen) close(); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isOpen) shut.click();
    else if (picked) show(null);
  });
  card.querySelector('.net-shut')?.addEventListener('click', () => show(null));
  // A click anywhere else on the page puts the card away. (A name in the card that was just replaced is no longer
  // in the page, so it counts as inside.)
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (isOpen || !picked || !(target instanceof Element) || !target.isConnected || target.closest('.net-wrap, [data-pick]')) return;
    show(null);
  });
  out.addEventListener('click', () => glide(base));

  // Fingers on the full-screen stage: one drags, two pinch, a press that barely moves is a tap.
  const pts = new Map<number, Point>();
  let gest: Gesture | null = null;
  const begin = (moved: boolean) => {
    const p = [...pts.values()];
    if (p.length === 1) gest = { v: view, a: p[0], moved };
    else if (p.length >= 2) gest = { v: view, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, m: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, moved: true, pinch: true };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    cancelAnimationFrame(anim);
    begin(pts.size > 1);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !gest) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stage.getBoundingClientRect(), u = gest.v[2] / r.width, p = [...pts.values()];
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
  const lift = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const tap = gest && !gest.moved && e.type === 'pointerup';
    if (pts.size) { begin(true); return; }
    gest = null;
    if (tap) show(nearest(e, 24));
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  // Wheel or trackpad zoom, for a narrow desktop window.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect(), u = view[2] / r.width;
    const fx = view[0] + (e.clientX - r.left) * u, fy = view[1] + (e.clientY - r.top) * u;
    const w = Math.min(Math.max(view[2] * Math.exp(e.deltaY * .002), base[2] / MAX), base[2]), u2 = w / r.width;
    setView(clamp([fx - (e.clientX - r.left) * u2, fy - (e.clientY - r.top) * u2, w]));
  }, { passive: false });

  // In the page: on a phone any tap opens the full-screen view; with a mouse it picks a dot.
  svg.addEventListener('click', (e) => {
    if (isOpen) return;
    if (phone.matches) { open(null); return; }
    show(nearest(e, 12));
  });
  expand?.addEventListener('click', () => open(null));
  for (const b of document.querySelectorAll<HTMLElement>('[data-pick]')) {
    b.addEventListener('click', () => {
      const dot = byId.get(b.dataset.pick ?? '') ?? null;
      if (phone.matches && !isOpen) { open(dot); return; }
      show(dot);
      if (isOpen && dot) focusOn(dot);
      else reveal();
    });
  }
  if (matchMedia('(hover: hover)').matches) {
    svg.addEventListener('mousemove', (e) => { if (!isOpen && !phone.matches && !picked) show(nearest(e, 8), true); });
    svg.addEventListener('mouseleave', () => { if (!isOpen && !picked) show(null); });
  }
}

network();
