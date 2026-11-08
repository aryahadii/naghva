import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const sanam = 'https://www.salam-music.at/wp-content/uploads/Sanam-Maroufkhani_.jpg';
const cover = 'https://f4.bcbits.com/img/a0845783135_5.jpg';
const thumbnails = JSON.parse(readFileSync('image-thumbnails.json', 'utf8'));
const imageBytes = readFileSync(`public${thumbnails[sanam].variants[0].src}`);

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
});

for (const lang of ['en', 'fa']) {
  test(`${lang}: responsive portraits preserve source credit and full-size enlargement`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(sanam, route => route.fulfill({ contentType: 'image/webp', body: imageBytes }));
    await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
    const photo = page.locator('.infobox-photo img');
    await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await photo.evaluate(image => (image as HTMLImageElement).currentSrc)).toContain('/thumbnails/');
    await expect(page.locator('a[data-photo]')).toHaveAttribute('href', sanam);
    await expect(page.locator('.infobox-photo .image-credit')).not.toBeEmpty();
    await page.locator('a[data-photo]').click();
    await expect(page.locator('#photo-dialog')).toBeVisible();
    await expect(page.locator('#photo-dialog img')).toHaveAttribute('src', sanam);
    await page.keyboard.press('Escape');
    await expect(page.locator('#photo-dialog')).not.toBeVisible();
  });

  test(`${lang}: failed portrait thumbnail retries the publisher once, then keeps the name card`, async ({ page }) => {
    let originals = 0;
    await page.route('**/thumbnails/sanam-*.webp', route => route.abort());
    await page.route(sanam, route => { originals++; return route.abort(); });
    await page.goto(`/${lang}/`);
    const artist = page.locator(`.explore-artist[href="/${lang}/sanam-maroufkhani-a84/"]`);
    await artist.scrollIntoViewIfNeeded();
    await expect(artist.locator('img')).toBeHidden();
    await expect(artist.locator('.explore-name')).toBeVisible();
    await expect(artist.locator('img')).toHaveAttribute('src', sanam);
    await expect(artist.locator('img')).not.toHaveAttribute('data-original-src', /./);
    expect(originals).toBe(1);
  });

  test(`${lang}: a release dialog cloned after startup retries a failed cached cover`, async ({ page }) => {
    let originals = 0;
    await page.route(cover, route => { originals++; return route.fulfill({ contentType: 'image/webp', body: imageBytes }); });
    await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
    await page.locator('a[data-release][href="#beneath-the-wooden-roof-live-recorded-at-sargfabrik-vienna-bmp"]').click();
    const shown = page.locator('#release-dialog img');
    // Make only the new dialog copy fail. cloneNode does not copy per-element
    // listeners installed before the dialog opened.
    await expect.poll(() => shown.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await shown.evaluate((image, source) => {
      image.removeAttribute('srcset');
      image.setAttribute('data-original-src', source);
      image.setAttribute('src', '/thumbnails/missing-for-dialog.webp');
    }, cover);
    await expect(shown).toHaveAttribute('src', cover);
    await expect.poll(() => shown.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(shown).not.toHaveAttribute('data-original-src', /./);
    expect(originals).toBe(1);
  });
}
