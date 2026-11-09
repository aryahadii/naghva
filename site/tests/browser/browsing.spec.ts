import { expect, test, type Page, type Route } from '@playwright/test';

// Interactions exercise the built site; external artwork availability must not
// hold page load open or make a local navigation check depend on a third party.
// Tests check behaviour, not today's record: no counts, titles or release
// anchors that change when an artist is added or enriched.
const localOnly = (route: Route) => new URL(route.request().url()).hostname === '127.0.0.1'
  ? route.continue() : route.abort();
test.beforeEach(async ({ context }) => { await context.route('**/*', localOnly); });

const artist = (lang: string) => `/${lang}/sanam-maroufkhani-a84/`;
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const lang of ['en', 'fa']) {
  for (const width of [390, 1280]) {
    test(`${lang} ${width}px: release panels work from the keyboard and follow history`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(artist(lang));
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
      expect(await fitsWidth(page)).toBe(true);
    });

    test(`${lang} ${width}px: the catalogue filters, sorts and resets when collapsed`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(artist(lang));
      const expand = page.locator('#catalog-expand');
      const query = page.locator('#catalog-query');
      const items = page.locator('#catalog > li');
      const visible = page.locator('#catalog > li:visible');
      await expand.click(); await expect(query).toBeFocused();
      const total = await items.count();
      await query.fill('no-match-ever-999');
      await expect(page.locator('#catalog-empty')).toBeVisible();
      await page.locator('#catalog-reset').click();
      await expect(visible).toHaveCount(total);
      // Filtering by one release's own title keeps that release and drops others.
      const title = (await items.last().locator('.shelf-title').textContent())!.trim();
      await page.locator('#catalog-sort').selectOption('oldest');
      await query.fill(title);
      await expect(visible.filter({ hasText: title }).first()).toBeVisible();
      expect(await visible.count()).toBeLessThan(total);
      await expand.click(); await expect(expand).toBeFocused();
      await expect(page.locator('#catalog-sort')).toHaveValue('newest');
      await expect(query).toHaveValue('');
    });
  }

  test(`${lang}: directory filters both scripts and remains complete without JS`, async ({ browser, page }) => {
    await page.goto(`/${lang}/artists/`);
    const all = page.locator('#directory-list > li');
    const visible = page.locator('#directory-list > li:visible');
    const count = await all.count();
    expect(count).toBeGreaterThan(1);
    // Persian and Latin (with a diacritic) both find the same artist.
    for (const q of ['معروف', 'Sânam']) {
      await page.locator('#directory-query').fill(q);
      await expect(visible.locator(`a[href="${artist(lang)}"]`)).toBeVisible();
      expect(await visible.count()).toBeLessThan(count);
    }
    await page.locator('#directory-query').fill('nonexistent999');
    await expect(page.locator('#directory-empty')).toBeVisible();
    await page.locator('#directory-reset').click();
    await expect(visible).toHaveCount(count);
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', localOnly);
    const plain = await context.newPage();
    await plain.goto(`http://127.0.0.1:4322/${lang}/artists/`);
    await expect(plain.locator('#directory-list > li:visible')).toHaveCount(count);
    await plain.locator(`#directory-list a[href="${artist(lang)}"]`).click();
    await expect(plain).toHaveURL(new RegExp(artist(lang)));
    await context.close();
  });

  test(`${lang}: paginated search preserves query, Back, Forward and language`, async ({ page }) => {
    const results = page.locator('#results-list > li');
    await page.goto(`/${lang}/search/?q=a&page=1`);
    await expect(results).toHaveCount(24); // one full page
    const firstOnPage1 = await results.first().getAttribute('id') ?? await results.first().innerHTML();
    await page.locator('#results-pages a').last().click();
    await expect(page).toHaveURL(/q=a&page=2/);
    await expect(results.first()).toBeVisible();
    const onPage2 = await results.count();
    expect(onPage2).toBeLessThanOrEqual(24);
    expect(await results.first().getAttribute('id') ?? await results.first().innerHTML()).not.toBe(firstOnPage1);
    await page.goBack(); await expect(page).toHaveURL(/q=a&page=1/);
    await expect(results).toHaveCount(24);
    await page.goForward(); await expect(page).toHaveURL(/q=a&page=2/);
    await expect(results).toHaveCount(onPage2);
    await page.locator('a.language').click();
    await expect(page).toHaveURL(new RegExp(`/${lang === 'en' ? 'fa' : 'en'}/search/\\?q=a&page=2`));
    await expect(results).toHaveCount(onPage2);
    await page.locator('#results-query').fill('sanam');
    await page.locator('#results-query').press('Enter');
    await expect(page).toHaveURL(/q=sanam&page=1/);
    await expect(results.first()).toContainText(/Sanam|صنم/);
    await page.locator('#results-query').fill('missing999'); await page.locator('#results-query').press('Enter');
    await expect(results).toHaveCount(0);
    await expect(page.locator('#results-status')).not.toBeEmpty();
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex,follow');
  });

  test(`${lang}: the Sources list shows a few until the reader asks for the rest`, async ({ page }) => {
    await page.goto(artist(lang));
    const all = page.locator('#source-list > li');
    const shown = page.locator('#source-list > li:visible');
    const more = page.locator('#source-more');
    expect(await all.count()).toBeGreaterThan(await shown.count());
    const few = await shown.count();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.focus(); await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(shown).toHaveCount(await all.count());
    await more.click();
    await expect(shown).toHaveCount(few);
    const id = await page.locator('#source-list > li.source-extra').last().getAttribute('id');
    await page.goto(`${artist(lang)}#${id}`);
    await expect(page.locator(`#${id}`)).toBeInViewport();
  });

  test(`${lang}: Back restores opener even when the previous URL had a section anchor`, async ({ page }) => {
    await page.goto(`${artist(lang)}#life`);
    const card = page.locator('[data-release]').first();
    await card.click(); await expect(page.locator('#release-dialog')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#release-dialog')).not.toBeVisible();
    await expect(card).toBeFocused();
  });

  // The release with the longest title stresses the panel layout.
  test(`${lang}: the longest-titled release panel fits at 320px and at 200% zoom`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(artist(lang));
    const longest = await page.locator('[data-release]').evaluateAll((cards) =>
      cards.map((c) => [c.getAttribute('href')!, (c.querySelector('.shelf-title') ?? c).textContent!.trim().length] as const)
        .sort((a, b) => b[1] - a[1])[0][0]);
    await page.goto(artist(lang) + longest);
    const dialog = page.locator('#release-dialog');
    await expect(dialog).toBeVisible();
    const fits = () => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(await fits()).toBe(true);
    const cover = dialog.locator('.cover-art');
    if (await cover.count()) {
      expect((await cover.boundingBox())!.width).toBeLessThanOrEqual(160);
      expect(await cover.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
    }
    for (const citation of await dialog.locator('.listen-destination .cite').all()) {
      await citation.click(); await expect(page.locator('#cite-pop')).toBeVisible();
      await citation.click(); await expect(page.locator('#cite-pop')).not.toBeVisible();
      await expect(dialog).toBeVisible();
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    expect(await fits()).toBe(true);
  });
}

test('quick search shows a few suggestions and a working all-results link', async ({ page }) => {
  await page.goto('/en/'); await page.locator('astro-island:not([ssr])').waitFor();
  await page.getByRole('combobox').fill('a');
  const options = page.locator('.search-panel [role=option]');
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeLessThanOrEqual(8);
  await page.locator('.search-all').click();
  await expect(page).toHaveURL(/\/en\/search\/\?q=a&page=1/);
  expect(await page.locator('#results-list > li').count()).toBeGreaterThanOrEqual(await options.count());
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

test('listening citations remain independent from platform links and preserve source navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(artist('en'));
  const card = page.locator('[data-release]').first();
  await card.click();
  const dialog = page.locator('#release-dialog');
  await expect(dialog).toBeVisible();
  const links = dialog.locator('.listen-links');
  await expect(links.locator('.listen-destination').first()).toBeVisible();
  await expect(links.locator('a.cite').first()).toBeVisible();
  expect(await links.evaluate((el) => el.compareDocumentPosition(el.parentElement!.querySelector('.release-facts')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await links.locator('.cite').first().click();
  await expect(page.locator('#cite-pop')).toBeVisible();
  const source = page.locator('#cite-pop a').last(); const destination = await source.getAttribute('href');
  await source.click(); await expect(dialog).not.toBeVisible();
  await expect(page.locator(destination!)).toBeInViewport();
  expect(await card.evaluate((el) => el === document.activeElement)).toBe(false);
});
