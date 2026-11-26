import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
});

for (const lang of ['en', 'fa']) {
  test(`${lang}: a year bar shows its count on click and on keyboard focus`, async ({ page }) => {
    await page.goto(`/${lang}/stats/`);
    const bars = page.locator('#releases .col[data-tip]');
    const bar = bars.last();
    await bar.click();
    await expect(bar).toHaveClass(/is-on/);
    await page.locator('h1').click();
    await expect(page.locator('.col.is-on')).toHaveCount(0);
    await bar.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(bars.nth((await bars.count()) - 2)).toHaveClass(/is-on/);
  });

  test(`${lang}: a name beside the network puts that person in the middle, and Escape lets go`, async ({ page }) => {
    await page.goto(`/${lang}/stats/`);
    const rows = page.locator('.net-rows [data-pick]');
    const top = await rows.count();
    const name = (await rows.first().locator('.nr-name').textContent())!.trim();
    await rows.first().click();
    const who = page.locator('.net-who');
    await expect(who).toBeVisible();
    await expect(who.locator('.net-name')).toHaveText(name);
    await expect(page.locator('circle.is-sel')).toHaveCount(1);
    await expect(who.locator('.net-open')).toHaveAttribute('href', new RegExp(`^/${lang}/`));
    // The rows now list the people they worked with, one for each lit dot; a row moves on to that person.
    await expect(rows).toHaveCount(await page.locator('circle.is-near').count());
    const next = (await rows.first().locator('.nr-name').textContent())!.trim();
    await rows.first().click();
    await expect(who.locator('.net-name')).toHaveText(next);
    await page.keyboard.press('Escape');
    await expect(who).toBeHidden();
    await expect(page.locator('circle.is-sel')).toHaveCount(0);
    await expect(rows).toHaveCount(top);
  });

  test(`${lang}: the search finds a person by name in either script`, async ({ page }) => {
    await page.goto(`/${lang}/stats/`);
    const dot = page.locator('.net-svg circle[data-id]').first();
    const name = (await dot.getAttribute('data-name'))!, alt = (await dot.getAttribute('data-alt'))!;
    for (const typed of [name, alt]) {
      await page.locator('.net-q').fill(typed);
      await expect(page.locator('.net-found [data-pick]').first()).toHaveText(name);
      await page.keyboard.press('Enter');
      await expect(page.locator('.net-who .net-name')).toHaveText(name);
      await expect(page.locator('.net-found')).toBeHidden();
      await page.keyboard.press('Escape');
    }
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the network opens full screen, a tap zooms into an island, and Back retraces the steps', async ({ page }) => {
    await page.goto('/en/stats/');
    await page.locator('.net-expand').click();
    const full = page.locator('.net-full');
    await expect(full).toBeVisible();
    await expect(full.locator('svg.net-svg')).toHaveCount(1);
    // A tap on the whole map only zooms in; the next tap, on a dot, chooses its person.
    const stage = (await full.locator('.net-wrap').boundingBox())!;
    await page.touchscreen.tap(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await expect(full.locator('.net-out')).toBeVisible();
    await expect(full.locator('.net-who')).toBeHidden();
    // The zoom is a step of its own: Back undoes it without closing the view, and Forward takes it again.
    await page.goBack();
    await expect(full).toBeVisible();
    await expect(full.locator('.net-out')).toBeHidden();
    await page.goForward();
    await expect(full.locator('.net-out')).toBeVisible();
    await full.locator('.net-out').click();
    await expect(full.locator('.net-out')).toBeHidden();
    await full.locator('.net-rows [data-pick]').first().click();
    await expect(full.locator('.net-who')).toBeVisible();
    // Back retraces the steps: from the person to the map, then out of the full-screen view.
    await page.goBack();
    await expect(full.locator('.net-who')).toBeHidden();
    await expect(full).toBeVisible();
    await page.goBack();
    await expect(full).toBeHidden();
    await expect(page.locator('#network .net-wrap svg.net-svg')).toHaveCount(1);
    await expect(page.locator('circle.is-sel')).toHaveCount(0);
  });

  test('a space finds a name written with a half-space', async ({ page }) => {
    await page.goto('/fa/stats/');
    await page.locator('.net-expand').click();
    const names = await page.locator('.net-svg circle[data-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.name ?? ''));
    const name = names.find((n) => n.includes('\u200c'));
    test.skip(!name, 'no name with a half-space in the network');
    await page.locator('.net-q').fill(name!.replaceAll('\u200c', ' '));
    await expect(page.locator('.net-found [data-pick]').filter({ hasText: name! }).first()).toBeVisible();
  });
});
