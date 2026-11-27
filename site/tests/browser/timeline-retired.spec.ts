import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { localOrigin } from './server';

const record = JSON.parse(readFileSync(new URL('../../generated/record.json', import.meta.url), 'utf8'));
const expected = {"entry-e6879f702e1f68148ce1": "Q2vsxkx", "entry-727434edb44a9228c1f6": "Q388559", "entry-d283236df4fb912d28f9": "Q656qrq", "entry-6a4dd2b789a49847361e": "Qfdn32e", "entry-1a6a97a9ffe40f79beff": "Qsaqv4p", "entry-6f29d7f3a00208126408": "Qvpzabm"};
const originalRoutes = {"Q2vsxkx": "/mitra-sumara-j92/#gol-e-aftab-gardoon-live-on-wfmu-2vs", "Q388559": "/mitra-sumara-j92/#shareh-paiz-live-on-wfmu-388", "Q656qrq": "/mitra-sumara-j92/#shekar-e-ahoo-live-on-wfmu-656", "Qfdn32e": "/mitra-sumara-j92/#heleyos-live-on-wfmu-fdn", "Qsaqv4p": "/mitra-sumara-j92/#season-of-flowers-live-on-wfmu-saq", "Qvpzabm": "/mitra-sumara-j92/#bemoon-ta-bemoonam-live-on-wfmu-vpz"};
const retired = Object.entries(expected);

for (const lang of ['en', 'fa']) {
  for (const javaScriptEnabled of [true, false]) {
    test(`${lang}: retired date links retain their recordings, JS ${javaScriptEnabled}`, async ({ browser }) => {
      test.setTimeout(90_000);
      expect(retired).toHaveLength(6);
      for (const [fragment, id] of retired) expect(record.timelineBookmarks[fragment]).toBe(id);
      const context = await browser.newContext({ javaScriptEnabled, reducedMotion: 'reduce' });
      await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue() : route.abort());
      try {
        const page = await context.newPage();
        for (const [anchor, id] of retired) {
          const item = record.items[id];
          const host = record.items[record.panelHosts[id]];
          const destination = `/${lang}${originalRoutes[id as keyof typeof originalRoutes]}`;
          expect(`/${lang}/${host.page}/#${item.anchor}`).toBe(destination);
          await page.goto(`${localOrigin}/${lang}/timeline/?kind=release#${anchor}`, { waitUntil: 'domcontentloaded' });
          if (!javaScriptEnabled) {
            const fallback = page.locator(`#${anchor}`);
            await expect(fallback).toBeVisible();
            await expect(fallback).toHaveAttribute('data-timeline-bookmark', '');
            await expect(fallback).toHaveAttribute('href', destination);
            await expect(fallback).toHaveText(item.names[lang].text);
            expect(await fallback.evaluate((el) => el.closest('.entry'))).toBeNull();
            await fallback.click();
          }
          await expect(page).toHaveURL(`${localOrigin}${destination}`);
          const panel = javaScriptEnabled ? page.locator('#release-dialog[open]') : page.locator(`#${item.anchor}`);
          await expect(panel).toBeVisible();
          await expect(panel.locator('.release-title')).toHaveText(item.names[lang].text);
          await expect(panel.locator('.release-meta')).toHaveCount(0);
          if (javaScriptEnabled) {
            // Same-document hash navigation must use the same compatibility path.
            await page.goto(`${localOrigin}/${lang}/timeline/?kind=release`, { waitUntil: 'domcontentloaded' });
            await page.evaluate((hash) => { location.hash = hash; }, anchor);
            await expect(page).toHaveURL(`${localOrigin}${destination}`);
            await expect(page.locator('#release-dialog[open] .release-title')).toHaveText(item.names[lang].text);
          }
        }
      } finally { await context.close(); }
    });
  }
}
