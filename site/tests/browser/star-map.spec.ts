import { expect, test } from '@playwright/test';
import type { SkyStar } from '../../src/lib/star-map';

test('the whole sky is drawn at once, stays mounted while exploring, and fits again after zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/star-map/');
  const chart = page.locator('canvas.sky-canvas');
  const stars: SkyStar[] = JSON.parse((await page.locator('#sky-catalogue').textContent())!);
  await expect(chart).toHaveAttribute('data-star-count', String(stars.length));
  // Sample the canvas itself (its painted garden background is a separate layer).
  // Every data coordinate, including isolated artists and recordings, must have ink at full extent.
  const visible = () => chart.evaluate((canvas: HTMLCanvasElement, data) => {
    const box = canvas.getBoundingClientRect();
    const pad = Math.min(38, Math.min(box.width, box.height) * .085);
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return data.filter(({x, y}) => {
      const col = Math.floor((pad + x * (box.width - 2 * pad)) * canvas.width / box.width);
      const row = Math.floor((pad + y * (box.height - 2 * pad)) * canvas.height / box.height);
      return pixels[(row * canvas.width + col) * 4 + 3] > 0;
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
