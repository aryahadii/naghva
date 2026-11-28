import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { localOrigin } from './server';

const record = JSON.parse(readFileSync(new URL('../../generated/record.json', import.meta.url), 'utf8'));
const id = 'Q6vpjsn';
const fragment = 'entry-e6a64ad2183b98a2dc46';
const panelAnchor = 'phaidras-liebe-6vp';
const premiere = record.timeline.filter((entry: { kind: string; item: string; text?: { text: string } }) =>
  entry.kind === 'life' && entry.item === 'Qk45pkn' && entry.text?.text === 'PREMIERE AM 22. APRIL 2022');

for (const lang of ['en', 'fa']) {
  for (const javaScriptEnabled of [true, false]) {
    test(`${lang}: Phaidras premiere retains historical panels and timeline links, JS ${javaScriptEnabled}`, async ({ browser }) => {
      test.setTimeout(90_000);
      expect(premiere).toHaveLength(1);
      expect(premiere[0].date.date).toBe('2022-04-22');
      expect(premiere[0].text.language).toBe('de');
      expect(record.timeline.some((entry: { item: string }) => entry.item === id)).toBe(false);
      expect(record.timelineBookmarks[fragment]).toBe(id);
      expect(record.items[id].statements['release date']).toEqual([
        expect.objectContaining({ rank: 'deprecated', value: expect.objectContaining({ date: '2022-04-22' }) }),
      ]);
      const context = await browser.newContext({ baseURL: localOrigin, javaScriptEnabled, reducedMotion: 'reduce' });
      await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue() : route.abort());
      try {
        const page = await context.newPage();
        const destination = `/${lang}/nazanin-noori-k45/#${panelAnchor}`;
        const panel = () => javaScriptEnabled ? page.locator('#release-dialog[open]') : page.locator(`#${panelAnchor}`);
        // The canonical panel works without scripts; stable-ID aliases use the existing script redirect.
        for (const hash of javaScriptEnabled ? [panelAnchor, id] : [panelAnchor]) {
          await page.goto(`/${lang}/nazanin-noori-k45/#${hash}`);
          await expect(panel()).toBeVisible();
          await expect(panel().locator('.release-title')).toHaveText('Phaidras Liebe');
          await expect(panel().locator('.release-meta')).toHaveCount(0);
          await expect(panel()).toContainText(/Nazanin Noori|نازنین نوری/);
          await expect(panel()).toContainText('Robert Borgmann');
        }
        await page.goto(`/${lang}/timeline/?artist=nazanin-noori-k45&kind=release#${fragment}`,
          { waitUntil: 'domcontentloaded' });
        if (!javaScriptEnabled) {
          const bookmark = page.locator(`#${fragment}`);
          await expect(bookmark).toHaveAttribute('data-timeline-bookmark', '');
          await expect(bookmark).toHaveAttribute('href', destination);
          expect(await bookmark.evaluate((el) => el.closest('.entry'))).toBeNull();
          await bookmark.click();
        }
        await expect(page).toHaveURL(`${localOrigin}${destination}`);
        await expect(panel().locator('.release-title')).toHaveText('Phaidras Liebe');
        await expect(panel().locator('.release-meta')).toHaveCount(0);
        await page.goto(`/${lang}/timeline/?artist=nazanin-noori-k45&kind=life#${premiere[0].anchor}`);
        const moment = page.locator(`#${premiere[0].anchor}`);
        await expect(moment).toBeVisible();
        await expect(moment).toHaveAttribute('data-kind', 'life');
        await expect(moment.locator('q')).toHaveText('PREMIERE AM 22. APRIL 2022');
      } finally { await context.close(); }
    });
  }
}
