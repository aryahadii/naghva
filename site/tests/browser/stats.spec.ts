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

  test(`${lang}: a name under the network picks that person and Escape lets go`, async ({ page }) => {
    await page.goto(`/${lang}/stats/`);
    const chip = page.locator('.net-chips [data-pick]').first();
    const name = (await chip.textContent())!.trim();
    await chip.click();
    const card = page.locator('.net-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.net-name')).toHaveText(name);
    await expect(card.locator('.net-hop').first()).toBeVisible();
    await expect(page.locator('circle.is-sel')).toHaveCount(1);
    await expect(card.locator('.net-open')).toHaveAttribute('href', new RegExp(`^/${lang}/`));
    // A name in the card moves the selection to that person.
    const next = (await card.locator('.net-hop').first().textContent())!.trim();
    await card.locator('.net-hop').first().click();
    await expect(card.locator('.net-name')).toHaveText(next);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page.locator('circle.is-sel')).toHaveCount(0);
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the network opens full screen and Back closes it', async ({ page }) => {
    await page.goto('/en/stats/');
    await page.locator('.net-expand').click();
    const full = page.locator('.net-full');
    await expect(full).toBeVisible();
    await expect(page.locator('.nf-stage svg.net-svg')).toHaveCount(1);
    await page.locator('.nf-sheet [data-pick]').first().click();
    await expect(page.locator('.nf-sheet .net-card')).toBeVisible();
    await page.goBack();
    await expect(full).toBeHidden();
    await expect(page.locator('.net-wrap svg.net-svg')).toHaveCount(1);
  });
});
