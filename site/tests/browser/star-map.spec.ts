import { expect, test } from '@playwright/test';
import type { SkyStar } from '../../src/lib/star-map';

test('the whole sky is drawn at once, stays mounted while exploring, and fits again after zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/star-map/');
  const chart = page.locator('canvas.sky-canvas');
  const stars: SkyStar[] = JSON.parse((await page.locator('#sky-catalogue').textContent())!);
  await expect(chart).toHaveAttribute('data-star-count', String(stars.length));
  // Sample the painted field through its compositor transform.
  // Every data coordinate, including isolated artists and recordings, must have ink at full extent.
  const visible = () => chart.evaluate((canvas: HTMLCanvasElement, data) => {
    const box = canvas.getBoundingClientRect();
    const pad = Math.min(38, Math.min(box.width, box.height) * .085);
    const field = canvas.parentElement!.querySelector<HTMLCanvasElement>('.sky-field')!;
    const bounds = field.getBoundingClientRect();
    const pixels = field.getContext('2d')!.getImageData(0, 0, field.width, field.height).data;
    return data.filter(({x, y}) => {
      const col = Math.floor((box.left - bounds.left + pad + x * (box.width - 2 * pad)) * field.width / bounds.width);
      const row = Math.floor((box.top - bounds.top + pad + y * (box.height - 2 * pad)) * field.height / bounds.height);
      return pixels[(row * field.width + col) * 4 + 3] > 0;
    }).length;
  }, stars);
  await expect.poll(visible).toBe(stars.length);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(visible).toBeLessThan(stars.length);
  await page.getByRole('button', { name: 'Fit all stars' }).click();
  await expect.poll(visible).toBe(stars.length);

  await chart.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.inspector-heading h2')).toBeVisible();
  await expect(chart).toHaveAttribute('data-star-count', String(stars.length));
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect.poll(visible).toBe(stars.length);
});

test('a recording can be found by name, traced to an artist and revisited in Persian', async ({ page }) => {
  await page.goto('/en/star-map/');
  const stars: SkyStar[] = JSON.parse((await page.locator('#sky-catalogue').textContent())!);
  const work = stars.find(s => s.kind === 'recording' && s.href && s.connections.length && stars.filter(other => other.name === s.name).length === 1)!;
  await page.getByRole('button', { name: 'Find a star' }).click();
  const finder = page.getByRole('dialog');
  await finder.getByRole('button', { name: 'Recordings', exact: true }).click();
  await finder.getByRole('searchbox').fill(work.name);
  await finder.getByRole('searchbox').press('Enter');
  await expect(page.locator('.inspector-heading h2')).toHaveText(work.name);
  await expect(page.getByRole('link', { name: 'Open recording' })).toHaveAttribute('href', work.href!);
  await page.locator('.sky-links li button').first().click();
  await expect(page.locator('.star-kind')).toHaveText('Artist');
  await page.goBack();
  await expect(page.locator('.inspector-heading h2')).toHaveText(work.name);
  await page.locator('a.language').click();
  await expect(page).toHaveURL(new RegExp('/fa/star-map/\\?star=' + work.id));
  await expect(page.locator('.star-kind')).toHaveText('اثر');
});

test('a released drag coasts, can be caught, and respects reduced motion', async ({ page }) => {
  await page.clock.install();
  await page.goto('/en/star-map/');
  const chart = page.locator('canvas.sky-canvas');
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const image = () => chart.evaluate((el: HTMLCanvasElement) => el.toDataURL());

  async function drag() {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.clock.runFor(16);
      await page.mouse.move(x + i * 6, y);
    }
    await page.mouse.up();
    await page.clock.runFor(20);
  }

  await drag();
  const released = await image();
  await page.clock.runFor(80);
  expect(await image() === released).toBe(false);
  await page.mouse.down();
  await page.clock.runFor(32);
  const caught = await image();
  await page.clock.runFor(200);
  expect(await image() === caught).toBe(true);
  await page.mouse.up();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await drag();
  const resting = await image();
  await page.clock.runFor(160);
  expect(await image() === resting).toBe(true);
});

test('a desktop trackpad pan stays on the sky as its direction changes at full extent', async ({ page }) => {
  await page.goto('/en/star-map/');
  const chart = page.locator('canvas.sky-canvas');
  await chart.scrollIntoViewIfNeeded();
  await chart.hover({position:{x:160,y:150}});
  const pageTop = await page.evaluate(() => scrollY);
  const prior = await chart.evaluate((el: HTMLCanvasElement) => el.toDataURL());
  // Start mostly vertical, turn horizontally, then finish with a vertical inertial tail.
  for (const [dx, dy] of [[1, 9], [3, 8], [6, 4], [8, 2], [1, 5], [0, 3]]) {
    await page.mouse.wheel(dx, dy);
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => scrollY)).toBe(pageTop);
  expect(await chart.evaluate((el: HTMLCanvasElement, initial) => el.toDataURL() !== initial, prior)).toBe(true);
});

test('a single intermittent comet travels on credits without repainting the star field', async ({ page }) => {
  // Fix the random branch to exercise the selected-star emphasis repeatably.
  await page.addInitScript(() => { Math.random = () => .25; });
  await page.goto('/en/star-map/?star=Qn8jqk8');
  const trail = page.locator('.sky-comet');
  await trail.waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('.sky-comet')?.getAnimations().length === 1);
  const flight = await trail.evaluate(async el => {
    const [animation] = el.getAnimations();
    const frames = (animation.effect as KeyframeEffect).getKeyframes();
    const contexts = Array.from(el.parentElement!.querySelectorAll('canvas'), canvas => canvas.getContext('2d')!);
    let repaints = 0;
    const originals = contexts.map(ctx => ctx.clearRect);
    contexts.forEach((ctx, i) => {
      ctx.clearRect = (...args) => { repaints++; originals[i].apply(ctx, args); };
    });
    try { await animation.finished; }
    finally { contexts.forEach((ctx, i) => { ctx.clearRect = originals[i]; }); }
    return {
      repaints,
      start: frames[0].transform,
      peak: Math.max(...frames.map(frame => Number(frame.opacity))),
      travels: frames[0].transform !== frames.at(-1)!.transform,
      quiet: !el.getAnimations().length,
    };
  });
  expect(flight).toMatchObject({ travels: true, quiet: true, repaints: 0 });
  expect(flight.peak).toBeGreaterThan(.5);
  await page.waitForFunction(() => document.querySelector('.sky-comet')?.getAnimations().length === 1);
  const nextStart = await trail.evaluate(el =>
    (el.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform);
  expect(nextStart).not.toBe(flight.start);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => trail.evaluate(el => el.getAnimations().length)).toBe(0);
  await page.clock.install();
  await page.clock.runFor(10000);
  expect(await trail.evaluate(el => el.getAnimations().length)).toBe(0);
});
