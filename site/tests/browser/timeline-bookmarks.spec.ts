import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { SiteRecord } from '../../src/lib/record';

const record = JSON.parse(readFileSync(new URL('../../generated/record.json', import.meta.url), 'utf8')) as SiteRecord;
// Routes recorded before the unsupported date claims were withdrawn.
const routes: { [id: string]: string | null } = {
  Qwbzhbx: '/cyminology-syr/#echoes-stereo-bounce-wbz',
  Qh38w63: '/blurred-vision-qrz/#amistad-de-fuego-h38',
  Qd7wfzq: '/nazanin-noori-k45/#apology-d7w',
  Qcqk4rm: '/blurred-vision-qrz/#float-cqk',
  Qtfhf3g: '/blurred-vision-qrz/#silent-rain-tfh',
  Qdpnkd4: '/blurred-vision-qrz/#silent-rain-dpn',
  Q28sz4c: '/blurred-vision-qrz/#into-the-night-28s',
  Qgjsffz: null,
};
const withdrawn = Object.keys(routes);
const oldFragments: { [id: string]: string } = {
  "Qwbzhbx": "entry-242f30448984f82c454a",
  "Qh38w63": "entry-3b3d3e06bea69a88e0b6",
  "Qd7wfzq": "entry-4aa99c3cadc0e20b54c3",
  "Qcqk4rm": "entry-4d6d14d596f259d4cddb",
  "Qtfhf3g": "entry-9be6fafa712eac5ceb96",
  "Qdpnkd4": "entry-9d5ce289895cb1823c61",
  "Q28sz4c": "entry-aa81e1fb8743d61a4156",
  "Qgjsffz": "entry-bcf667506df11cd66d1f"
};
const bookmarks = withdrawn.map((id) => [oldFragments[id], id] as const);
const destination = (id: string, lang: string) => {
  const host = record.items[record.panelHosts?.[id] ?? ''];
  if (id === 'Qgjsffz') {
    expect(host).toBeUndefined();
    return null;
  }
  expect(host?.page).toBeTruthy();
  const path = `/${lang}/${host.page}/#${record.items[id].anchor}`;
  expect(path).toBe(`/${lang}${routes[id]}`);
  return path;
};

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const lang of ['en', 'fa'] as const) {
  for (const [fragment, id] of bookmarks) {
    test(`${lang}: old ${id} bookmark retains its undated destination`, async ({ page }) => {
      expect(record.timelineBookmarks?.[fragment]).toBe(id);
      expect(record.timeline.some((entry) => entry.item === id)).toBe(false);
      expect(record.items[id].statements['release date']).toBeUndefined();
      await page.goto(`/${lang}/timeline/#${fragment}`);
      const path = destination(id, lang);
      if (path) {
        await expect(page).toHaveURL(new URL(path, page.url()).href);
        await expect(page.locator('#release-dialog')).toBeVisible();
        await expect(page.locator('#release-dialog')).toHaveAttribute('aria-labelledby', `dialog-${record.items[id].anchor}-title`);
      } else {
        // Paul und Paula never had a recording panel: preserve its undated name.
        await expect(page.locator(`#${fragment}`)).toBeVisible();
        await expect(page.locator(`#${fragment}`)).toBeInViewport();
        await expect(page.locator(`#${fragment}`)).toHaveText(record.items[id].names[lang]!.text);
        await expect(page.locator(`#${fragment}`)).not.toHaveClass(/\bentry\b/);
      }
    });
  }
  test(`${lang}: same-document and direct bookmark hops preserve Back navigation`, async ({ page }) => {
    test.setTimeout(60_000);
    const id = 'Qcqk4rm', fragment = oldFragments[id];
    await page.goto(`/${lang}/timeline/`);
    await page.evaluate((fragment) => { location.hash = fragment; }, fragment);
    await expect(page).toHaveURL(new URL(destination(id, lang)!, page.url()).href);
    await expect(page.locator('#release-dialog')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new URL(`/${lang}/timeline/`, page.url()).href);
    await page.goto(`/${lang}/stats/`);
    await page.goto(`/${lang}/timeline/#${fragment}`);
    await expect(page).toHaveURL(new URL(destination(id, lang)!, page.url()).href);
    await page.goBack();
    await expect(page).toHaveURL(new URL(`/${lang}/stats/`, page.url()).href);
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  for (const lang of ['en', 'fa'] as const) {
    for (const [fragment, id] of bookmarks) {
      test(`${lang}: old ${id} bookmark exposes its native destination`, async ({ page }) => {
        expect(record.timelineBookmarks?.[fragment]).toBe(id);
        await page.goto(`/${lang}/timeline/#${fragment}`);
        const bookmark = page.locator(`#${fragment}`);
        await expect(bookmark).toBeVisible();
        await expect(bookmark).toBeInViewport();
        await expect(bookmark).toHaveText(record.items[id].names[lang]!.text);
        await expect(bookmark).not.toHaveClass(/\bentry\b/);
        const path = destination(id, lang);
        if (path) {
          await expect(bookmark).toHaveAttribute('href', path);
          await bookmark.click();
          await expect(page).toHaveURL(new URL(path, page.url()).href);
        }
      });
    }
  }
});
