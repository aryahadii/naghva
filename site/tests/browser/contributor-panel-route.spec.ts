import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { localOrigin } from './server';

const record = JSON.parse(readFileSync(new URL('../../generated/record.json', import.meta.url), 'utf8'));
const cases = [
  {
    "id": "Q4g6gkc",
    "host": "Qfvnnnd",
    "canonical_routes": {
      "en": "/en/arshia-samsaminia-fvn/#swear-it-sign-it-bleed-on-it-conference-ensemble-2025-4g6",
      "fa": "/fa/arshia-samsaminia-fvn/#swear-it-sign-it-bleed-on-it-conference-ensemble-2025-4g6"
    },
    "aliases": [
      "Q4g6gkc",
      "swear-it-sign-it-bleed-on-it-conference-ensemble-2025-4g6"
    ]
  },
  {
    "id": "Q5hrkvz",
    "host": "Qa744p5",
    "canonical_routes": {
      "en": "/en/mohsen-sharifian-a74/#شمبهای-5hr",
      "fa": "/fa/mohsen-sharifian-a74/#شمبهای-5hr"
    },
    "aliases": [
      "Q5hrkvz",
      "شمبهای-5hr"
    ]
  },
  {
    "id": "Q75yd3g",
    "host": "Qhqb38j",
    "canonical_routes": {
      "en": "/en/sahba-aminikia-hqb/#one-day-tehran-75y",
      "fa": "/fa/sahba-aminikia-hqb/#one-day-tehran-75y"
    },
    "aliases": [
      "Q75yd3g",
      "one-day-tehran-75y"
    ]
  },
  {
    "id": "Qatvq7d",
    "host": "Qfvnnnd",
    "canonical_routes": {
      "en": "/en/arshia-samsaminia-fvn/#micro-moments-v-collettivo-21-ensemble-flute-piano-and-live-electronics-atv",
      "fa": "/fa/arshia-samsaminia-fvn/#micro-moments-v-collettivo-21-ensemble-flute-piano-and-live-electronics-atv"
    },
    "aliases": [
      "Qatvq7d",
      "micro-moments-v-collettivo-21-ensemble-flute-piano-and-live-electronics-atv"
    ]
  },
  {
    "id": "Qayhr4j",
    "host": "Qhqb38j",
    "canonical_routes": {
      "en": "/en/sahba-aminikia-hqb/#alef-2011-recital-ayh",
      "fa": "/fa/sahba-aminikia-hqb/#alef-2011-recital-ayh"
    },
    "aliases": [
      "Qayhr4j",
      "alef-2011-recital-ayh"
    ]
  },
  {
    "id": "Qch8sxp",
    "host": "Qa744p5",
    "canonical_routes": {
      "en": "/en/mohsen-sharifian-a74/#مقدمۀ-بیتخوانی-در-عزاداری-و-بیت-عزا-ch8",
      "fa": "/fa/mohsen-sharifian-a74/#مقدمۀ-بیتخوانی-در-عزاداری-و-بیت-عزا-ch8"
    },
    "aliases": [
      "Qch8sxp",
      "مقدمۀ-بیتخوانی-در-عزاداری-و-بیت-عزا-ch8"
    ]
  },
  {
    "id": "Qjsmsth",
    "host": "Qd5zat9",
    "canonical_routes": {
      "en": "/en/amen-feizabadi-d5z/#silence-of-homa-jsm",
      "fa": "/fa/amen-feizabadi-d5z/#silence-of-homa-jsm"
    },
    "aliases": [
      "Qjsmsth",
      "silence-of-homa-jsm"
    ]
  },
  {
    "id": "Qqht6vr",
    "host": "Qk45pkn",
    "canonical_routes": {
      "en": "/en/nazanin-noori-k45/#ambient-room-qht",
      "fa": "/fa/nazanin-noori-k45/#ambient-room-qht"
    },
    "aliases": [
      "Qqht6vr",
      "ambient-room-qht"
    ]
  }
];
const best = (statements: any[] = []) => {
  const preferred = statements.filter(s => s.rank === 'preferred');
  return preferred.length ? preferred : statements.filter(s => s.rank !== 'deprecated');
};
const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();

for (const lang of ['en', 'fa'] as const) for (const javaScriptEnabled of [true, false]) for (const route of cases) {
  test(`${lang}: frozen contributor destination ${route.id}, JS ${javaScriptEnabled}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const item = record.items[route.id];
    const anchor = item.anchor;
    const destination = route.canonical_routes[lang];
    expect(record.panelHosts[route.id]).toBe(route.host);
    expect(item.host).toBeUndefined();
    expect(record.items[route.host].releases).not.toContain(route.id);
    expect(best(item.statements.performer).map(s => s.value)).not.toContain(route.host);
    const context = await browser.newContext({ javaScriptEnabled, reducedMotion: 'reduce' });
    await context.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
    try {
      const page = await context.newPage();
      const canonical = new URL(destination, localOrigin).href;
      const pagePath = destination.split('#')[0];
      if (javaScriptEnabled) {
        await page.goto(`${localOrigin}${pagePath}#${route.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(canonical);
      } else {
        // Native canonical route is in scope. Raw #ID without JS remains a separate limitation.
        await page.goto(canonical, { waitUntil: 'domcontentloaded' });
      }
      const panel = () => javaScriptEnabled ? page.locator('#release-dialog[open]')
        : page.locator(`[id="${anchor}"]`);
      await expect(panel()).toBeVisible();
      await expect(panel().locator('.release-title')).toHaveText(item.names[lang].text);
      const publicRoutes = await (await page.request.get(`${localOrigin}/panels.json`)).json();
      for (const alias of route.aliases) expect(publicRoutes[alias]).toBe(destination.slice(3));
      if (javaScriptEnabled) {
        const search = await (await page.request.get(`${localOrigin}/search.json`)).json();
        const entry = search.entries.find((e: any) => e.i === route.id);
        expect(entry.h).toBe(destination.slice(3));
        expect(entry.a).toBeUndefined(); // A routing host is not a performer label.
      }
      const references = ['release date', 'platform posting date', 'performer', 'contributor']
        .flatMap(property => best(item.statements[property]).flatMap(s => s.references ?? []));
      const cites = panel().locator('.release-facts a.cite');
      let match: { index: number; quoteID: string; reference: any } | undefined;
      for (let i = 0; i < await cites.count() && !match; i++) {
        for (const quoteID of (await cites.nth(i).getAttribute('data-quote') ?? '').split(' ')) {
          const text = normalized(await page.locator(`[id="${quoteID}"]`).textContent() ?? '');
          const reference = references.find(ref => text.includes(normalized(ref.quote)));
          if (reference) { match = { index: i, quoteID, reference }; break; }
        }
      }
      expect(match).toBeTruthy();
      const cite = cites.nth(match!.index);
      const sourceID = await cite.getAttribute('href');
      const source = record.sources[match!.reference.source];
      await cite.click();
      const proof = javaScriptEnabled ? page.locator('#cite-pop') : page.locator(sourceID!);
      await expect(proof).toBeVisible();
      if (!javaScriptEnabled && !(await page.locator(`[id="${match!.quoteID}"]`).isVisible()))
        await proof.locator('details > summary').click();
      await expect(javaScriptEnabled ? proof.locator('blockquote').filter({ hasText: match!.reference.quote }).first() : page.locator(`[id="${match!.quoteID}"]`))
        .toContainText(match!.reference.quote);
      await expect(proof.locator(`a[href="${source.url}"]`).first()).toBeVisible();
      if (source.archive) await expect(proof.locator(`a[href="${source.archive}"]`).first()).toBeVisible();
      if (javaScriptEnabled) await page.keyboard.press('Escape');
      const dated = record.timeline.find((e: any) => e.item === route.id);
      if (dated) for (const fragment of [dated.anchor, ...(dated.aliases ?? []).slice(0, 1)]) {
        await page.goto(`${localOrigin}/${lang}/timeline/?kind=release#${fragment}`, { waitUntil: 'domcontentloaded' });
        const entry = page.locator(`[id="${dated.anchor}"]`);
        await expect(entry).toBeVisible();
        await expect(entry).toHaveAttribute('data-kind', dated.kind);
        const link = entry.locator('.entry-text a');
        await expect(link).toHaveAttribute('href', destination);
        await link.click();
        await expect(panel()).toBeVisible();
        await expect(panel().locator('.release-title')).toHaveText(item.names[lang].text);
      }
      await page.goto(canonical, { waitUntil: 'domcontentloaded' });
      const relation = ['track of', 'programme segment of'].flatMap(k => best(item.statements[k]))[0];
      if (relation) {
        const parent = record.items[relation.value];
        const links = panel().locator('.release-facts a[href]');
        let parentLink = -1;
        for (let i = 0; i < await links.count(); i++) {
          const href = await links.nth(i).getAttribute('href');
          if (href && decodeURIComponent(new URL(href, page.url()).hash.slice(1)) === parent.anchor) { parentLink = i; break; }
        }
        expect(parentLink).toBeGreaterThanOrEqual(0);
        await links.nth(parentLink).click();
        const parentPanel = javaScriptEnabled ? page.locator('#release-dialog[open]') : page.locator(`[id="${parent.anchor}"]`);
        await expect(parentPanel.locator('.release-title')).toHaveText(parent.names[lang].text);
        const children = parentPanel.locator('.part-list a[href]');
        let childLink = -1;
        for (let i = 0; i < await children.count(); i++) {
          const href = await children.nth(i).getAttribute('href');
          if (href && decodeURIComponent(new URL(href, page.url()).hash.slice(1)) === anchor) { childLink = i; break; }
        }
        expect(childLink).toBeGreaterThanOrEqual(0);
        await children.nth(childLink).click();
        await expect(panel().locator('.release-title')).toHaveText(item.names[lang].text);
      }
    } finally { await context.close(); }
  });
}
