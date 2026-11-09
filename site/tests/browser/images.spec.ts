import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const sanam = 'https://www.salam-music.at/wp-content/uploads/Sanam-Maroufkhani_.jpg';
const media = JSON.parse(readFileSync('media.json', 'utf8'));
const own = (url: string) => `/media/${media[url].sha256.slice(0, 16)}-`;
// Builds without the R2 read key, such as pull requests from forks, have no
// copies of their own and show every image from its publisher.
const hasCopies = existsSync(`dist${own(sanam)}240.webp`);
const imageBytes = sharp({ create: { width: 240, height: 240, channels: 3, background: '#7a5c3a' } }).webp().toBuffer();

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
});

for (const lang of ['en', 'fa']) {
  test(`${lang}: portraits are Naghva's own copies, credited, and enlarge to the largest copy`, async ({ page }) => {
    test.skip(!hasCopies, 'built without its own image copies');
    let publisher = 0;
    await page.route(sanam, route => { publisher++; return route.abort(); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
    const photo = page.locator('.infobox-photo img');
    await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await photo.evaluate(image => new URL((image as HTMLImageElement).currentSrc).pathname)).toContain(own(sanam));
    await expect(page.locator('a[data-photo]')).toHaveAttribute('href', new RegExp(`^${own(sanam)}\\d+\\.webp$`));
    await expect(page.locator('.infobox-photo .image-credit')).not.toBeEmpty();
    await page.locator('a[data-photo]').click();
    await expect(page.locator('#photo-dialog')).toBeVisible();
    expect(await page.locator('#photo-dialog img').evaluate(image => new URL((image as HTMLImageElement).src).pathname)).toContain(own(sanam));
    await page.keyboard.press('Escape');
    await expect(page.locator('#photo-dialog')).not.toBeVisible();
    expect(publisher).toBe(0);
  });

  test(`${lang}: a failed own copy retries the publisher once, then keeps the name card`, async ({ page }) => {
    test.skip(!hasCopies, 'built without its own image copies');
    let publisher = 0;
    await page.route(`**${own(sanam)}*`, route => route.abort());
    await page.route(sanam, route => { publisher++; return route.abort(); });
    await page.goto(`/${lang}/`);
    const artist = page.locator(`.explore-artist[href="/${lang}/sanam-maroufkhani-a84/"]`);
    await artist.scrollIntoViewIfNeeded();
    await expect(artist.locator('img')).toBeHidden();
    await expect(artist.locator('.explore-name')).toBeVisible();
    await expect(artist.locator('img')).toHaveAttribute('src', sanam);
    await expect(artist.locator('img')).not.toHaveAttribute('data-original-src', /./);
    expect(publisher).toBe(1);
  });

  test(`${lang}: a release dialog cloned after startup retries a failed own cover`, async ({ page }) => {
    test.skip(!hasCopies, 'built without its own image copies');
    let publisher = 0;
    const body = await imageBytes;
    await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
    // Any release whose cover has its own copy; the card names the publisher's URL.
    const card = page.locator('a[data-release]').filter({ has: page.locator('img[data-original-src]') }).first();
    const cover = (await card.locator('img').getAttribute('data-original-src'))!;
    await page.route(cover, route => { publisher++; return route.fulfill({ contentType: 'image/webp', body }); });
    await card.click();
    const shown = page.locator('#release-dialog img');
    await expect.poll(() => shown.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await shown.getAttribute('src')).toContain(own(cover));
    // Make only the new dialog copy fail. cloneNode does not copy per-element
    // listeners installed before the dialog opened.
    await shown.evaluate((image, source) => {
      image.removeAttribute('srcset');
      image.setAttribute('data-original-src', source);
      image.setAttribute('src', '/media/missing-for-dialog.webp');
    }, cover);
    await expect(shown).toHaveAttribute('src', cover);
    await expect.poll(() => shown.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(shown).not.toHaveAttribute('data-original-src', /./);
    expect(publisher).toBe(1);
  });

  test(`${lang}: without its own copies, a portrait shows from its publisher`, async ({ page }) => {
    test.skip(hasCopies, 'built with its own image copies');
    const body = await imageBytes;
    await page.route(sanam, route => route.fulfill({ contentType: 'image/webp', body }));
    await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
    const photo = page.locator('.infobox-photo img');
    await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(photo).toHaveAttribute('src', sanam);
    await expect(photo).not.toHaveAttribute('data-original-src', /./);
  });
}
