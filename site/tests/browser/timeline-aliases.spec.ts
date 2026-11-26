import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { localOrigin } from './server';

const record = JSON.parse(readFileSync(new URL('../../generated/record.json', import.meta.url), 'utf8')) as {
  timeline: { anchor: string; aliases?: string[]; kind: string; date: { date: string } }[];
};
const allCases = record.timeline.flatMap((entry) =>
  (entry.aliases ?? []).map((alias) => ({
    alias, anchor: entry.anchor, kind: entry.kind,
    precision: entry.date.date.split('-').length,
  })));
// Every alias is checked in the built HTML by check-output. Exercise each
// kind and date precision in the browser without thousands of navigations.
const samples = new Map<string, (typeof allCases)[number]>();
for (const item of allCases) {
  const key = `${item.kind}:${item.precision}`;
  if (!samples.has(key)) samples.set(key, item);
}
const cases = [...samples.values()];

for (const lang of ['en', 'fa']) {
  for (const javaScriptEnabled of [true, false]) {
    test(`${lang}: published timeline alias samples work with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}`, async ({ browser }) => {
      test.setTimeout(90_000);
      expect(cases.length).toBeGreaterThan(0);
      const context = await browser.newContext({
        javaScriptEnabled, reducedMotion: 'reduce',
        viewport: { width: lang === 'fa' ? 390 : 1280, height: 900 },
      });
      await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue() : route.abort());
      try {
        const page = await context.newPage();
        for (const item of cases) {
          await page.goto(`${localOrigin}/${lang}/timeline/?kind=release#${item.alias}`, { waitUntil: 'domcontentloaded' });
          const entry = page.locator(`#${item.anchor}`);
          await expect(page.locator(`#${item.alias}`)).toHaveCount(1);
          await expect(entry).toBeInViewport({ timeout: 15_000 });
          await expect(entry).toHaveAttribute('data-kind', item.kind);
          expect(await page.locator(`#${item.alias}`).evaluate((element) => element.closest('.entry')?.id)).toBe(item.anchor);
          await expect(page).toHaveURL(new RegExp(`#${item.alias}$`));
        }
      } finally {
        await context.close();
      }
    });
  }
}
