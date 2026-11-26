import { localOrigin } from './server';
import { expect, test } from '@playwright/test';

const artist = '/en/sanam-maroufkhani-a84/';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
});

test('release panels follow Back/Forward and close with Escape or the close link', async ({ page }) => {
  await page.goto(artist);
  const card = page.locator('[data-release]').first();
  const hash = await card.getAttribute('href');
  const dialog = page.locator('#release-dialog');
  await card.click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new URL(hash!, localOrigin + artist).href);
  await page.goBack();
  await expect(dialog).not.toBeVisible();
  await page.goForward();
  await expect(dialog).toBeVisible();
  // Reproduce a previous close event arriving after the panel has reopened.
  await dialog.dispatchEvent('close');
  await expect(page).toHaveURL(new URL(hash!, localOrigin + artist).href);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${artist}$`));
  await card.click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-close]').click();
  await expect(dialog).not.toBeVisible();
});

test('a shared release link opens its panel and citations lead to an expanded source', async ({ page }) => {
  await page.goto(artist);
  const hash = await page.locator('[data-release]').first().getAttribute('href');
  await page.goto(artist + hash);
  const dialog = page.locator('#release-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.cite').first().click();
  const popover = page.locator('#cite-pop');
  await expect(popover).toBeVisible();
  const sourceLink = popover.locator('a').last();
  const source = await sourceLink.getAttribute('href');
  await sourceLink.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(source!)).toBeVisible();
  await expect(page.locator(source!).locator('xpath=ancestor::details')).toHaveAttribute('open', '');
});

test('Sahba’s tracks and programme segments link to their whole records in both languages', async ({ page }) => {
  const track = 'abouata-chaharmezrab-e-abouta-feat-pejman-hadadi-tse';
  const album = 'ancient-heritage-feat-pejman-hadadi-bfz';
  const segment = 'improvisation-in-mahur-freer-sackler-2017-s6v';
  for (const [lang, trackLabel, segmentLabel] of [
    ['en', 'Track of', 'Programme segment of'], ['fa', 'قطعه‌ای از', 'بخشی از برنامهٔ'],
  ]) {
    const path = `/${lang}/sahba-motallebi-yw4/`;
    await page.goto(`${path}#${track}`);
    const dialog = page.locator('#release-dialog');
    await expect(dialog.getByText(trackLabel, { exact: true })).toBeVisible();
    await dialog.locator(`a[href="${path}#${album}"]`).click();
    await expect(dialog.getByRole('heading', { name: 'Ancient Heritage (feat. Pejman Hadadi)' })).toBeVisible();
    await page.goto(`${path}#${segment}`);
    await expect(dialog.getByText(segmentLabel, { exact: true })).toBeVisible();
    await expect(dialog.locator(`a[href="${path}#persian-music-classical-and-new-sjw"]`)).toBeVisible();
  }
});

test('an old filtered release timeline link still opens its reclassified track', async ({ page }) => {
  const fragment = 'entry-07b62589c0b63df7cba3';
  await page.goto(`/en/timeline/?artist=sahba-motallebi-yw4&kind=release#${fragment}`);
  const track = page.locator(`#${fragment}`);
  await expect(track).toHaveAttribute('data-kind', 'component');
  await expect(track).toBeVisible();
  await expect(track).toContainText('Chaharmezrab-e Abouta');
});

test('timeline year landings preserve the same entry across both calendars and filters', async ({ page }) => {
  await page.goto('/en/timeline/?artist=sanam-maroufkhani-a84&kind=release#2021');
  const first = page.locator('.year[id="2021"] .entry:not([hidden])').first();
  await expect(first).toBeInViewport();
  const id = await first.getAttribute('id');
  await page.locator('a.language').click();
  await expect(page).toHaveURL(new RegExp(`/fa/timeline/\\?artist=sanam-maroufkhani-a84&kind=release#${id}$`));
  await expect(page.locator(`#${id}`)).toBeInViewport();
  await page.locator('a.language').click();
  await expect(page).toHaveURL(new RegExp(`/en/timeline/\\?artist=sanam-maroufkhani-a84&kind=release#${id}$`));
  await expect(page.locator(`#${id}`)).toBeInViewport();
});

test('timeline scrolling selects the entry being read rather than the old year hash', async ({ page }) => {
  await page.goto('/en/timeline/#2024');
  const entry = page.locator('.entry').nth(30);
  const id = await entry.getAttribute('id');
  await entry.evaluate((element) => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 145, behavior: 'instant' }));
  await page.locator('a.language').click();
  await expect(page).toHaveURL(new RegExp(`/fa/timeline/#${id}$`));
  await expect(page.locator(`#${id}`)).toBeInViewport();
});

test('timeline with no visible entries switches language without an anchor', async ({ page }) => {
  await page.goto('/en/timeline/?artist=sanam-maroufkhani-a84&kind=#2024');
  await expect(page.locator('.timeline-empty')).toBeVisible();
  await page.locator('a.language').click();
  await expect(page).toHaveURL('/fa/timeline/?artist=sanam-maroufkhani-a84&kind=');
  await expect(page.locator('.timeline-empty')).toBeVisible();
});

test.describe('mobile search', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('a touch on a search result opens the artist', async ({ page }) => {
    await page.goto('/en/');
    await page.locator('astro-island:not([ssr])').first().waitFor();
    await page.getByRole('combobox').fill('sanam maroufkhani');
    const result = page.locator('.search-panel a').first();
    await expect(result).toBeVisible();
    await result.tap();
    await expect(page).toHaveURL(artist);
  });
});

test('every page header links to the code on GitHub, in both languages', async ({ page }) => {
  for (const path of ['/en/', '/fa/', artist, '/fa/timeline/']) {
    await page.goto(path);
    const link = page.locator('.site-header a.github');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://github.com/aryahadii/naghva');
    await expect(link).toHaveAccessibleName(path.startsWith('/fa/') ? 'نغوا در گیت‌هاب' : 'Naghva on GitHub');
  }
});
