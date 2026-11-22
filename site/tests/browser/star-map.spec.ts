import { expect, test, type Page, type Route } from '@playwright/test';
import type { Sky } from '../../src/lib/star-map';

declare global {
  interface Window { creditCurves: number[][] }
}

// The sky is tested on the built site alone; a picture kept elsewhere must not hold a test.
// Stars are taken from the built sky, not from today's record.
const localOnly = (route: Route) => new URL(route.request().url()).hostname === '127.0.0.1'
  ? route.continue() : route.abort();
test.beforeEach(async ({ context }) => { await context.route('**/*', localOnly); });

type Entry = Sky['stars'][number];
const readSky = async (page: Page): Promise<Sky> => (await page.request.get('/sky.json')).json();
const places = (sky: Sky) => sky.stars.map(({ x, y }) => ({ x: x / 100_000, y: y / 100_000 }));
const keyOf = (star: Entry) => (star.h ? star.h.replace(/^.*#|\//g, '') : star.i!);
const chosen = (page: Page) => new URL(page.url()).searchParams.get('star');
const ready = (page: Page) => expect(page.locator('.sky-home')).toHaveAttribute('data-ready', '');
const full = (page: Page) => page.locator('dialog.sky-full');
const card = (page: Page) => page.locator('.star-card');
const picture = (page: Page) => page.locator('canvas.sky-canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL());

/** How many stars have ink where the sky at its full extent puts them. */
const inked = (page: Page, stars: { x: number; y: number }[]) => page.evaluate((data) => {
  const canvas = document.querySelector<HTMLCanvasElement>('.sky-canvas')!;
  const field = document.querySelector<HTMLCanvasElement>('.sky-field')!;
  const box = canvas.getBoundingClientRect(), bounds = field.getBoundingClientRect();
  const margin = Math.min(38, Math.min(box.width, box.height) * .085);
  // The full view keeps its sky clear of the bars above and below it.
  const bar = (name: string) => canvas.closest('dialog')?.querySelector<HTMLElement>(name)?.offsetHeight ?? 0;
  const top = Math.max(margin, bar('.sky-bar')), bottom = Math.max(margin, bar('.sky-tools'));
  const pixels = field.getContext('2d')!.getImageData(0, 0, field.width, field.height).data;
  return data.filter(({ x, y }) => {
    const col = Math.floor((box.left - bounds.left + margin + x * (box.width - 2 * margin)) * field.width / bounds.width);
    const row = Math.floor((box.top - bounds.top + top + y * (box.height - top - bottom)) * field.height / bounds.height);
    return pixels[(row * field.width + col) * 4 + 3] > 0;
  }).length;
}, stars);

test('the preview draws the whole sky and leaves the wheel to the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/');
  await ready(page);
  const stars = places(await readSky(page));
  // Every star, the isolated ones too, has ink in the preview.
  await expect.poll(() => inked(page, stars)).toBe(stars.length);
  // The stars' light comes and goes in layers, each at its own pace, and holds still when asked to.
  const twinkles = page.locator('canvas.sky-twinkle');
  await expect(twinkles).toHaveCount(4);
  await expect(twinkles.first()).toHaveCSS('animation-name', 'sky-twinkle');
  const paces = await twinkles.evaluateAll((layers) => layers.map((layer) => getComputedStyle(layer).animationDuration));
  expect(new Set(paces).size).toBe(4);
  expect(await twinkles.evaluateAll((layers: HTMLCanvasElement[]) => layers.every((layer) =>
    layer.getContext('2d')!.getImageData(0, 0, layer.width, layer.height).data.some((value, i) => i % 4 === 3 && value > 0)))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(twinkles.first()).toHaveCSS('animation-name', 'none');
  const rests = await twinkles.evaluateAll((layers) => layers.map((layer) => getComputedStyle(layer).opacity));
  expect(new Set(rests).size).toBe(4);

  await page.locator('.sky-slot').hover();
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(page.locator('canvas.sky-canvas')).toHaveCSS('touch-action', 'auto');
  await expect(full(page)).toBeHidden();
});

test('the preview lights an artist by itself, and rests when it is out of view', async ({ page }) => {
  await page.goto('/en/');
  await ready(page);
  const lit = () => page.locator('canvas.sky-canvas').evaluate((el: HTMLCanvasElement) =>
    el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data.some((value, i) => i % 4 === 3 && value > 0));
  await expect.poll(lit).toBe(true);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect.poll(lit).toBe(false);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test('a swipe over the preview scrolls the page, and the same swipe moves the open sky', async ({ page }) => {
    await page.goto('/en/');
    await ready(page);
    const box = (await page.locator('.sky-slot').boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const touch = await page.context().newCDPSession(page);
    const swipe = async () => {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 20 }] });
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(60);
    await expect(full(page)).toBeHidden();

    // Let the swipe's own momentum end, so the next touch is a tap and not a catch.
    const settled = async () => {
      const at = await page.evaluate(() => scrollY);
      await page.waitForTimeout(200);
      return at === await page.evaluate(() => scrollY);
    };
    await expect.poll(settled).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(settled).toBe(true);
    const held = await page.evaluate(() => scrollY);
    await page.touchscreen.tap(x, y);
    await expect(full(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute('data-shown', '');
    // The sky has flown to its star; a swipe moves it, even one that starts on the card.
    const place = () => card(page).evaluate((el) => el.style.transform);
    await expect.poll(async () => { const at = await place(); await page.waitForTimeout(150); return at === await place(); }).toBe(true);
    const spot = (await card(page).boundingBox())!;
    const [cx, cy] = [spot.x + spot.width / 2, spot.y + spot.height / 2];
    const before = await place();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let i = 1; i <= 6; i++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + i * 10, y: cy }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(place).not.toBe(before);
    await expect(full(page)).toBeVisible();
    await expect(page).toHaveURL(/\/en\/\?star=/);
    expect(await page.evaluate(() => scrollY)).toBe(held);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test('the sky opens over the whole window, and Escape, Back and the close button put it back', async ({ page }) => {
  await page.goto('/en/');
  await ready(page);
  const way = page.getByRole('button', { name: 'Open the star map' });
  const map = full(page);
  await page.locator('.sky-slot').click();
  await expect(map).toBeVisible();
  await expect(card(page)).toHaveAttribute('data-shown', '');
  expect(chosen(page)).toBeTruthy();
  // The page behind holds still while the sky has the wheel.
  const held = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 300);
  expect(await page.evaluate(() => scrollY)).toBe(held);

  // Escape closes a map in which nothing has been chosen yet.
  await page.keyboard.press('Escape');
  await expect(map).toBeHidden();
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(way).toBeFocused();
  await expect(page.locator('.sky-slot .sky-stage')).toHaveCount(1);

  await way.click();
  await expect(map).toBeVisible();
  await page.goBack();
  await expect(map).toBeHidden();
  await expect(page).toHaveURL(/\/en\/$/);
  await page.goForward();
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Close' }).click();
  await expect(map).toBeHidden();
  await expect(page).toHaveURL(/\/en\/$/);
});

test('a recording found by name shows its card and the way to its panel, in both languages', async ({ page }) => {
  const sky = await readSky(page);
  const count = new Map<string, number>();
  for (const star of sky.stars) {
    for (const name of new Set(star.n)) if (name) count.set(name.toLowerCase(), (count.get(name.toLowerCase()) ?? 0) + 1);
  }
  const work = sky.stars.find((star) => star.k === 'r' && star.h && star.n[0] && star.n[1] && star.n[0] !== star.n[1] &&
    star.n[0].length > 6 && count.get(star.n[0].toLowerCase()) === 1)!;
  const [english, persian] = work.n as [string, string];

  await page.goto('/en/');
  await ready(page);
  await page.getByRole('button', { name: 'Open the star map' }).click();
  const map = full(page);
  const box = map.getByRole('combobox');
  await box.fill(english);
  await expect(map.getByRole('option').first()).toContainText(english);
  await box.press('Enter');
  await expect(card(page).locator('.star-card-name')).toHaveText(english);
  await expect(card(page).locator('.star-card-alt')).toHaveText(persian);
  await expect(card(page).getByRole('link')).toHaveAttribute('href', `/en${work.h}`);
  expect(chosen(page)).toBe(keyOf(work));
  // The search is done with, and the keyboard is on the sky.
  await expect(box).toHaveValue('');
  await expect(map.locator('canvas.sky-canvas')).toBeFocused();
  // Escape lets go of a star the reader chose before it leaves the map.
  await page.keyboard.press('Escape');
  await expect(card(page)).not.toHaveAttribute('data-shown');
  await expect(page).toHaveURL(/\/en\/\?star$/);
  await expect(map).toBeVisible();

  // The same address opens the Persian sky on the same star.
  await page.goto(`/fa/?star=${encodeURIComponent(keyOf(work))}`);
  await expect(map).toBeVisible();
  await expect(card(page).locator('.star-card-name')).toHaveText(persian);
  await expect(card(page).getByRole('link')).toHaveAttribute('href', `/fa${work.h}`);
  await page.keyboard.press('Escape');
  await expect(map).toBeHidden();
  await expect(page).toHaveURL(/\/fa\/$/);

  // An address for a star the sky does not have still opens the sky.
  await page.goto('/en/?star=no-such-star');
  await expect(map).toBeVisible();
  await expect(card(page)).not.toHaveAttribute('data-shown');
});

test('an artist page leads to its own star, and closing the map returns to the page', async ({ page }) => {
  const sky = await readSky(page);
  const artist = sky.stars.find((star) => star.k !== 'r' && star.h && star.l.length)!;
  await page.goto(`/en${artist.h}`);
  await page.getByRole('link', { name: 'On the star map' }).click();
  await expect(full(page)).toBeVisible();
  expect(chosen(page)).toBe(keyOf(artist));
  await expect(card(page).getByRole('link')).toHaveAttribute('href', `/en${artist.h}`);
  await full(page).getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(new RegExp(`/en${artist.h}$`));
});

test('the open sky zooms, fits again, and moves from star to star by keyboard', async ({ page }) => {
  await page.goto('/en/?star');
  const map = full(page);
  await expect(map).toBeVisible();
  const stars = places(await readSky(page));
  await expect.poll(() => inked(page, stars)).toBe(stars.length);
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => inked(page, stars)).toBeLessThan(stars.length);
  await map.getByRole('button', { name: 'Fit all stars' }).click();
  await expect.poll(() => inked(page, stars)).toBe(stars.length);

  const chart = map.locator('canvas.sky-canvas');
  await chart.focus();
  await page.keyboard.press('Enter');
  await expect(card(page)).toHaveAttribute('data-shown', '');
  const first = chosen(page);
  expect(first).toBeTruthy();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => chosen(page)).not.toBe(first);
  // Only a reader who moves through the sky with keys sees its frame.
  await expect(chart).toHaveAttribute('data-keys', '');
  await chart.click({ position: { x: 20, y: 200 } });
  await expect(chart).not.toHaveAttribute('data-keys');
});

test('a released drag coasts, can be caught, and respects reduced motion', async ({ page }) => {
  await page.clock.install();
  // The sky times a gesture by its events. On a busy machine real time between the test's moves
  // grows past what reads as one throw, so the clock stands still between steps and the events keep it.
  await page.addInitScript(() => {
    Object.defineProperty(Event.prototype, 'timeStamp', { get: () => performance.now() });
  });
  await page.goto('/en/?star');
  const chart = page.locator('canvas.sky-canvas');
  await expect(full(page)).toBeVisible();
  await page.clock.pauseAt(Date.now() + 5000);
  const box = (await chart.boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);

  async function drag() {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.clock.runFor(16);
      // Far enough each step that a slow machine still releases it at speed.
      await page.mouse.move(x + i * 14, y);
    }
    await page.mouse.up();
    await page.clock.runFor(20);
  }

  await drag();
  const released = await picture(page);
  await page.clock.runFor(80);
  expect(await picture(page) === released).toBe(false);
  await page.mouse.down();
  await page.clock.runFor(32);
  const caught = await picture(page);
  await page.clock.runFor(200);
  expect(await picture(page) === caught).toBe(true);
  await page.mouse.up();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await drag();
  const resting = await picture(page);
  await page.clock.runFor(160);
  expect(await picture(page) === resting).toBe(true);
});

test('a desktop trackpad pan stays on the sky as its direction changes at full extent', async ({ page }) => {
  await page.goto('/en/?star');
  const chart = page.locator('canvas.sky-canvas');
  await expect(full(page)).toBeVisible();
  await chart.hover({ position: { x: 160, y: 250 } });
  const prior = await picture(page);
  // Start mostly vertical, turn horizontally, then finish with a vertical inertial tail.
  for (const [dx, dy] of [[1, 9], [3, 8], [6, 4], [8, 2], [1, 5], [0, 3]]) {
    await page.mouse.wheel(dx, dy);
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await picture(page) !== prior).toBe(true);
});

test('long comet tails overlap on distinct credits without repainting the sky', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => .6;
    // Capture the actual painted curves in logical map coordinates.
    const curves: number[][] = [];
    window.creditCurves = curves;
    const proto = CanvasRenderingContext2D.prototype;
    const move = proto.moveTo, quadratic = proto.quadraticCurveTo;
    const origins = new WeakMap<CanvasRenderingContext2D, number[]>();
    proto.moveTo = function(x, y) {
      origins.set(this, [x, y]);
      move.call(this, x, y);
    };
    proto.quadraticCurveTo = function(cx, cy, x, y) {
      const start = origins.get(this);
      if (start) curves.push([...start, cx, cy, x, y]);
      quadratic.call(this, cx, cy, x, y);
    };
  });
  // An artist with enough credits for several tails at once.
  const sky = await readSky(page);
  const linked = sky.stars.map(() => 0);
  sky.stars.forEach((star, i) => star.l.forEach((other) => { linked[i]++; linked[other]++; }));
  const artist = sky.stars.find((star, i) => star.k !== 'r' && star.h && linked[i] >= 12)!;
  await page.goto(`/en/?star=${encodeURIComponent(keyOf(artist))}`);
  const stage = page.locator('.sky-stage');
  const inFlight = () => Array.from(document.querySelectorAll('.sky-comet')).flatMap(el => el.getAnimations()).length;
  await page.waitForFunction(count => Array.from(document.querySelectorAll('.sky-comet'))
    .flatMap(el => el.getAnimations()).length >= count, 3);
  const result = await stage.evaluate(async el => {
    const animations = Array.from(el.querySelectorAll<HTMLElement>('.sky-comet'))
      .flatMap(trail => trail.getAnimations().map(animation => ({ trail, animation })));
    const starts = animations.map(({ animation }) => Number(animation.startTime));
    const paths = animations.map(({ trail, animation }) => {
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      const first = new DOMMatrix(String(frames[0].transform));
      const last = new DOMMatrix(String(frames.at(-1)!.transform));
      const distance = Math.hypot(last.e - first.e, last.f - first.f);
      const width = parseFloat(trail.style.width);
      const key = [first, last].map(m => [Math.round(m.e + width), Math.round(m.f)].join(',')).sort().join('/');
      const curves = window.creditCurves;
      const height = parseFloat(trail.style.height);
      const followsOutwardCurve = curves.some(([x, y, cx, cy, endX, endY]) => frames.every(frame => {
        const t = frame.computedOffset, u = 1 - t;
        const m = new DOMMatrix(String(frame.transform));
        return Math.hypot(m.e + width - (u*u*x + 2*u*t*cx + t*t*endX),
          m.f + height/2 - (u*u*y + 2*u*t*cy + t*t*endY)) < .05;
      }));
      return { key, distance, width, followsOutwardCurve, peak: Math.max(...frames.map(f => Number(f.opacity))) };
    });
    let repaints = 0;
    const contexts = Array.from(el.querySelectorAll('canvas'), c => c.getContext('2d')!);
    const originals = contexts.map(ctx => ctx.clearRect);
    contexts.forEach((ctx, i) => { ctx.clearRect = (...args) => { repaints++; originals[i].apply(ctx, args); }; });
    try { await Promise.all(animations.map(({ animation }) => animation.finished)); }
    finally { contexts.forEach((ctx, i) => { ctx.clearRect = originals[i]; }); }
    return { paths, repaints, starts };
  });
  expect(result.repaints).toBe(0);
  expect(new Set(result.paths.map(p => p.key)).size).toBe(result.paths.length);
  expect(new Set(result.starts).size).toBe(result.starts.length);
  expect(result.paths.some(p => p.peak > .5)).toBe(true);
  for (const path of result.paths) {
    if (path.peak > .5) expect(path.followsOutwardCurve).toBe(true);
    expect(path.width).toBeCloseTo(Math.min(path.peak > .5 ? 100 : 64, path.distance * .62), 1);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(inFlight)).toBe(0);
  await page.clock.install();
  await page.clock.runFor(10000);
  expect(await page.evaluate(inFlight)).toBe(0);
});
