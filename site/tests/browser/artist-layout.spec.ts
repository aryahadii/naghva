import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
const fitsWidth = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const lang of ['en','fa']) for (const width of [390,1280]) {
  test(`${lang} ${width}: compact accessible biography contents`, async ({ page }) => {
    await page.setViewportSize({width,height:844});
    await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
    const nav=page.locator('.contents'),details=nav.locator('.contents-subsections');
    const summary=details.locator('summary'),link=details.locator('a').first();
    if(width<1100) {
      // A duplicate summary row once inflated this bar to 110px.
      const bar=(await nav.boundingBox())!,trigger=(await summary.boundingBox())!;
      expect(bar.height).toBeLessThanOrEqual(64);
      await expect(summary).toHaveText(''); await expect(summary).toHaveAttribute('aria-label',/.+/);
      expect(trigger.y).toBeGreaterThanOrEqual(bar.y);
      expect(trigger.y+trigger.height).toBeLessThanOrEqual(bar.y+bar.height);
      await summary.focus(); await page.keyboard.press('Enter'); await expect(link).toBeVisible();
      expect((await nav.boundingBox())!.height).toBe(bar.height);
      expect((await details.locator('ol').boundingBox())!.y).toBeGreaterThanOrEqual(bar.y+bar.height-1);
      await page.keyboard.press('Escape'); await expect(summary).toBeFocused(); await expect(link).not.toBeVisible();
      await summary.click(); const hash=await link.getAttribute('href'); await link.click();
      await expect.poll(()=>decodeURIComponent(new URL(page.url()).hash)).toBe(hash);
      await expect(details).not.toHaveAttribute('open','');
      await expect(page.locator(`[id="${hash!.slice(1)}"]`)).toBeInViewport();
      await summary.click(); await nav.locator(':scope > ol > li > a').first().click(); await expect(details).not.toHaveAttribute('open','');
    } else {
      await expect(summary).not.toBeVisible(); await expect(link).toBeVisible(); await link.click();
      await expect.poll(()=>new URL(page.url()).hash).not.toBe('');
    }
    await page.goto(`/${lang}/sanam-maroufkhani-a84/`);
    expect(await fitsWidth(page)).toBe(true);
  });
}
for(const lang of ['en','fa']) for(const width of [320,1280]) {
  test(`${lang} ${width}: compact multi-column directory and clear control`,async({page})=>{
    await page.setViewportSize({width,height:844}); await page.goto(`/${lang}/artists/`);
    const input=page.locator('#directory-query'),clear=page.locator('#directory-clear'),cards=page.locator('#directory-list > li');
    const visible=page.locator('#directory-list > li:visible');
    const total=await cards.count(),grid=(await page.locator('#directory-list').boundingBox())!,field=(await input.boundingBox())!;
    await expect(input).toHaveAttribute('placeholder',/.+/); expect(Math.abs(field.width-grid.width)).toBeLessThanOrEqual(1);
    const first=(await cards.nth(0).boundingBox())!,second=(await cards.nth(1).boundingBox())!;
    expect(first.y).toBe(second.y);
    if(width<640) {
      expect(first.width).toBeLessThan(grid.width/2);
      await expect(cards.nth(0).locator('.explore-name')).toBeInViewport(); await expect(cards.nth(1).locator('.explore-name')).toBeInViewport();
      expect((await cards.nth(0).locator('.explore-photo').boundingBox())!.height).toBeLessThan(140);
    }
    await expect(page.locator('.header-end [role=combobox]')).toHaveCount(0);
    await expect(page.locator('.directory-global-search')).toHaveAttribute('href',`/${lang}/search/`);
    await input.fill('no-artist-987'); await expect(page.locator('#directory-empty')).toBeVisible(); await expect(visible).toHaveCount(0);
    await clear.click(); await expect(input).toBeFocused(); await expect(input).toHaveValue(''); await expect(clear).not.toBeVisible();
    await expect(visible).toHaveCount(total);
    expect(await fitsWidth(page)).toBe(true);
  });
}
