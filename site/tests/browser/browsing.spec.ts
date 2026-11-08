import { expect, test, type Route } from '@playwright/test';

// Interactions exercise the built site; external artwork availability must not
// hold page load open or make a local navigation check depend on a third party.
const localOnly = (route: Route) => new URL(route.request().url()).hostname === '127.0.0.1'
  ? route.continue() : route.abort();
test.beforeEach(async ({ context }) => { await context.route('**/*', localOnly); });

for (const lang of ['en', 'fa']) {
  for (const width of [320, 390, 1280]) {
    test(`${lang} ${width}px: keyboard panels, history, catalogue and biography contents`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
      const card = page.locator('[data-release]').first();
      const dialog = page.locator('#release-dialog');
      await card.focus(); await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible(); await expect(card).toBeFocused();
      await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
      await dialog.locator('[data-close]').click();
      await expect(dialog).not.toBeVisible(); await expect(card).toBeFocused();
      await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
      await page.goBack(); await expect(dialog).not.toBeVisible(); await expect(card).toBeFocused();
      await page.goForward(); await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
      const expand = page.locator('#catalog-expand');
      for (let i = 0; i < 2; i++) {
        await expand.click(); await expect(page.locator('#catalog-query')).toBeFocused();
        await page.locator('#catalog-query').fill('no-match-ever-999');
        await expect(page.locator('#catalog-empty')).toBeVisible();
        await page.locator('#catalog-reset').click();
        await expect(page.locator('#catalog > li:visible')).toHaveCount(await page.locator('#catalog > li').count());
        await page.locator('#catalog-sort').selectOption('oldest');
        await page.locator('#catalog-query').fill('کویر');
        await expect(page.locator('#catalog > li:visible')).toHaveCount(1);
        await expand.click(); await expect(expand).toBeFocused();
        await expect(page.locator('#catalog-sort')).toHaveValue('newest');
        await expect(page.locator('#catalog-query')).toHaveValue('');
      }
      if (width < 1100) {
        const contents = page.locator('.contents-subsections');
        await contents.locator('summary').click();
        const link = contents.locator('a').first();
        const hash = await link.getAttribute('href');
        await link.click(); await expect.poll(() => decodeURIComponent(new URL(page.url()).hash)).toBe(hash);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/naghva-${lang}-${width}.png` });
    });
  }
  test(`${lang}: directory filters both scripts and remains complete without JS`, async ({ browser, page }) => {
    await page.goto(`/${lang}/artists/`);
    const count = await page.locator('#directory-list > li').count();
    expect(count).toBeGreaterThan(1);
    await page.locator('#directory-query').fill('معروف');
    await expect(page.locator('#directory-list > li:visible')).toHaveCount(1);
    await page.locator('#directory-query').fill('Sânam');
    await expect(page.locator('#directory-list > li:visible')).toHaveCount(1);
    await page.locator('#directory-query').fill('nonexistent999');
    await expect(page.locator('#directory-empty')).toBeVisible();
    await page.locator('#directory-reset').click();
    await expect(page.locator('#directory-list > li:visible')).toHaveCount(count);
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', localOnly);
    const plain = await context.newPage();
    await plain.goto(`http://127.0.0.1:4322/${lang}/artists/`);
    await expect(plain.locator('#directory-list > li:visible')).toHaveCount(count);
    await plain.locator('#directory-list a').filter({ hasText: /Sanam|صنم/ }).first().click();
    await expect(plain).toHaveURL(new RegExp(`/${lang}/sanam-maroufkhani-a84/`));
    await context.close();
  });
  test(`${lang}: paginated search preserves query, Back, Forward and language`, async ({ page }) => {
    // 36 results: a full first page of 24 and a second of 12.
    await page.goto(`/${lang}/search/?q=a&page=1`);
    await expect(page.locator('#results-list > li')).toHaveCount(24);
    await page.locator('#results-pages a').last().click();
    await expect(page).toHaveURL(/q=a&page=2/);
    await expect(page.locator('#results-list > li')).toHaveCount(12);
    await page.goBack(); await expect(page).toHaveURL(/q=a&page=1/);
    await expect(page.locator('#results-list > li')).toHaveCount(24);
    await page.goForward(); await expect(page).toHaveURL(/q=a&page=2/);
    await page.locator('a.language').click();
    await expect(page).toHaveURL(new RegExp(`/${lang === 'en' ? 'fa' : 'en'}/search/\\?q=a&page=2`));
    await expect(page.locator('#results-list > li')).toHaveCount(12);
    await page.locator('#results-query').fill('sanam');
    await page.locator('#results-query').press('Enter');
    await expect(page).toHaveURL(/q=sanam&page=1/);
    await expect(page.locator('#results-list > li').first()).toContainText(/Sanam|صنم/);
    await page.locator('#results-query').fill('missing999'); await page.locator('#results-query').press('Enter');
    await expect(page.locator('#results-list > li')).toHaveCount(0);
    await expect(page.locator('#results-status')).not.toBeEmpty();
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex,follow');
  });
}

test('quick search shows eight suggestions with accurate total and a working all-results link', async ({ page }) => {
  await page.goto('/en/'); await page.locator('astro-island:not([ssr])').waitFor();
  await page.getByRole('combobox').fill('a');
  await expect(page.locator('.search-panel [role=option]')).toHaveCount(8);
  await expect(page.locator('.search-all')).not.toContainText('8 results');
  await page.locator('.search-all').click();
  await expect(page).toHaveURL(/\/en\/search\/\?q=a&page=1/);
  await expect(page.locator('#results-list > li')).toHaveCount(24);
});

test('search loading and retry survive interrupted requests', async ({ page }) => {
  let fail = true;
  await page.route('**/search.json', async (route) => {
    if (fail) { await route.fulfill({ status: 503, body: '{}' }); return; }
    await route.continue();
  });
  await page.goto('/en/search/?q=sanam&page=1');
  await expect(page.locator('#results-retry')).toBeVisible();
  fail = false; await page.locator('#results-retry').click();
  await expect(page.locator('#results-list > li').first()).toContainText('Sanam');
});

for (const lang of ['en', 'fa']) test(`${lang}: the Sources list shows a few until the reader asks for the rest`, async ({ page }) => {
  await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
  const all = page.locator('#source-list > li');
  const more = page.locator('#source-more');
  expect(await all.count()).toBeGreaterThan(6);
  await expect(page.locator('#source-list > li:visible')).toHaveCount(5);
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.focus(); await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#source-list > li:visible')).toHaveCount(await all.count());
  await more.click();
  await expect(page.locator('#source-list > li:visible')).toHaveCount(5);
  const hidden = page.locator('#source-list > li.source-extra').last();
  const id = await hidden.getAttribute('id');
  await page.goto(`/${lang}/sanam-maroufkhani-a84/#${id}`);
  await expect(page.locator(`#${id}`)).toBeInViewport();
});

test('listening citations remain independent from platform links and preserve source navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/en/sanam-maroufkhani-a84/');
  const card = page.locator('[data-release]').first();
  const hash = await card.getAttribute('href');
  await page.goto('/en/sanam-maroufkhani-a84/' + hash);
  const dialog = page.locator('#release-dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(card).toBeFocused();
  await card.click(); await expect(dialog).toBeVisible();
  const links = dialog.locator('.listen-links');
  expect(await links.locator('.listen-destination').count()).toBeGreaterThan(0);
  expect(await links.locator('a.cite').count()).toBeGreaterThan(0);
  expect(await links.evaluate((el) => el.compareDocumentPosition(el.parentElement!.querySelector('.release-facts')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await links.locator('.cite').first().click();
  await expect(page.locator('#cite-pop')).toBeVisible();
  const source = page.locator('#cite-pop a').last(); const destination = await source.getAttribute('href');
  await source.click(); await expect(dialog).not.toBeVisible();
  await expect(page.locator(destination!)).toBeInViewport();
  expect(await card.evaluate((el) => el === document.activeElement)).toBe(false);
});

for (const lang of ['en', 'fa']) test(`${lang}: long title and multiple listening destinations at 200% zoom`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/${lang}/golsa-h74/#rameshgar-feat-hamed-hamidzadeh-mehrdad-mcy-farid-farzianpour-92e`);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const dialog = page.locator('#release-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.listen-destination')).toHaveCount(4);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `/tmp/naghva-${lang}-zoom200.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('formation text contrast is at least 4.5 to one', async ({ page }) => {
  await page.goto('/en/timeline/');
  const color = await page.locator('.entry[data-kind=formation] .entry-kind').first().evaluate((el) => getComputedStyle(el).color);
  const luminance = (rgb: number[]) => rgb.map((v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [.2126,.7152,.0722][i], 0);
  const values = color.match(/\d+/g)!.slice(0,3).map(Number);
  expect((luminance(values) + .05) / (luminance([21,23,28]) + .05)).toBeGreaterThanOrEqual(4.5);
});

for (const lang of ['en', 'fa']) test(`${lang}: Back restores opener even when the previous URL had a section anchor`, async ({ page }) => {
  await page.goto(`/${lang}/sanam-maroufkhani-a84/#life`);
  const card = page.locator('[data-release]').first();
  await card.click(); await expect(page.locator('#release-dialog')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#release-dialog')).not.toBeVisible();
  await expect(card).toBeFocused();
});

test('a query submitted during loading supersedes the pending results', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/search.json', async (route) => { await gate; await route.continue(); });
  await page.goto('/en/search/?q=sanam&page=2');
  await expect(page.locator('#results-status')).toHaveText('Loading…');
  await page.locator('#results-query').fill('golsa'); await page.locator('#results-query').press('Enter');
  release();
  await expect(page).toHaveURL(/q=golsa&page=1/);
  await expect(page.locator('#results-list > li').first()).toContainText('Golsa');
});

for (const lang of ['en', 'fa']) for (const width of [320,390]) {
  test(`${lang} ${width}px: long title, compact whole artwork and independent listening citations`, async ({ page }) => {
    await page.setViewportSize({width,height:900});
    await page.goto(`/${lang}/golsa-h74/#rameshgar-feat-hamed-hamidzadeh-mehrdad-mcy-farid-farzianpour-92e`);
    const dialog = page.locator('#release-dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const cover = dialog.locator('.cover-art');
    expect((await cover.boundingBox())!.width).toBeLessThanOrEqual(160);
    expect(await cover.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
    const citations = dialog.locator('.listen-destination .cite');
    await expect(dialog.locator('.listen-destination')).toHaveCount(4);
    for (const citation of await citations.all()) {
      await citation.click(); await expect(page.locator('#cite-pop')).toBeVisible();
      await citation.click(); await expect(page.locator('#cite-pop')).not.toBeVisible();
      await expect(dialog).toBeVisible();
    }
    await page.screenshot({path:`/tmp/naghva-panel-${lang}-${width}.png`});
  });
}
