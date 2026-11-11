import { expect, test, type Page } from '@playwright/test';
import { observe, site, ingestion } from './analytics-fixture';

test.use({ channel: 'chromium' });

for (const [lang, origin] of [['en', site], ['fa', 'https://naqva.com']] as const) {
  test(`${lang}: page, artist, search, listening and language events contain no private URL/input data`, async ({ page, context }) => {
    const { events, analyticsRequests } = await observe(page);
    await page.goto(`${origin}/${lang}/sanam-maroufkhani-a84/?utm_source=Instagram&utm_medium=social&utm_campaign=artist-launch&email=private-url#private-fragment`, {
      referer: 'https://www.google.com/search?q=private-referrer',
    });
    await expect.poll(() => events.filter((e) => e.event === 'artist_viewed').length).toBe(1);
    const pageview = events.find((e) => e.event === '$pageview')!;
    expect(pageview.properties).toMatchObject({
      $current_url: `${origin}/${lang}/sanam-maroufkhani-a84/`, $pathname: `/${lang}/sanam-maroufkhani-a84/`,
      language: lang, artist_id: 'Qa84h2k', $referring_domain: 'www.google.com',
      utm_source: 'Instagram', utm_medium: 'social', utm_campaign: 'artist-launch', distinct_id: '$posthog_cookieless',
      $process_person_profile: false,
    });
    await page.locator('astro-island:not([ssr])').waitFor();
    await page.getByRole('combobox').fill('private-search');
    await expect.poll(() => events.filter((e) => e.event === 'search_used').length).toBe(1);
    await page.getByRole('combobox').fill('sanam maroufkhani');
    await page.getByRole('combobox').press('Escape');
    await page.locator('[data-release]').first().click();
    const listen = page.locator('#release-dialog [data-listen-platform]').first();
    const release = await listen.getAttribute('data-release-id');
    const platform = await listen.getAttribute('data-listen-platform');
    await listen.click();
    await expect.poll(() => events.filter((e) => e.event === 'listen_clicked').length).toBe(1);
    expect(events.find((e) => e.event === 'listen_clicked')?.properties).toMatchObject({ release_id: release, platform });
    await page.keyboard.press('Escape');
    await page.locator('a.language').click();
    const other = lang === 'en' ? 'fa' : 'en';
    await expect.poll(() => events.filter((e) => e.event === 'artist_viewed').length).toBe(2);
    expect(events.filter((e) => e.event === 'language_switched')).toHaveLength(1);
    expect(events.find((e) => e.event === 'language_switched')?.properties.to_language).toBe(other);
    expect(events.filter((e) => e.event === '$pageview')).toHaveLength(2);
    expect(events.filter((e) => e.event === 'search_used')).toHaveLength(1);
    // These are required hash inputs, not optional analytics dimensions.
    const userAgent = await page.evaluate(() => navigator.userAgent);
    for (const event of events) {
      expect(event.properties.$raw_user_agent).toBe(userAgent);
      expect(event.properties.$host).toBe(new URL(origin).host);
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    }
    expect(JSON.stringify(events)).not.toContain('private');
    expect([...new Set(analyticsRequests)]).toEqual(['/e/']);
    expect(await context.cookies()).toEqual([]);
    await expect(page.locator('#privacy-dialog, [data-privacy-settings]')).toHaveCount(0);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
      .toEqual({ local: ['naghva-lang'], session: [] });
  });
}

test('the root redirect preserves referral origin and UTM values; results-page queries stay private', async ({ page }) => {
  const { events } = await observe(page);
  await page.goto(`${site}/?utm_source=telegram&utm_medium=social&token=private-root`, { referer: 'https://t.me/private-chat' });
  await expect(page).toHaveURL(`${site}/en/?utm_source=telegram&utm_medium=social`);
  await expect.poll(() => events.length).toBe(1);
  expect(events[0].properties).toMatchObject({ $referring_domain: 't.me', utm_source: 'telegram' });
  await page.goto(`${site}/fa/search/?q=private-query&page=1`);
  await expect.poll(() => events.filter((e) => e.event === 'search_used').length).toBe(1);
  expect(events.find((e) => e.event === 'search_used')?.properties.surface).toBe('results');
  expect(JSON.stringify(events)).not.toContain('private');
});

for (const lang of ['en', 'fa']) {
  for (const referer of ['https://github.com/aryahadii/naghva', undefined]) {
    test(`${lang}: README attribution survives the root redirect ${referer ? 'with' : 'without'} a referrer`, async ({ page, context }) => {
      const { events } = await observe(page);
      await page.addInitScript((lang) => localStorage.setItem('naghva-lang', lang), lang);
      await page.goto(`${site}/?utm_source=github&utm_medium=referral&utm_content=readme&token=private-token`, { referer });
      await expect(page).toHaveURL(`${site}/${lang}/?utm_source=github&utm_medium=referral&utm_content=readme`);
      await expect.poll(() => events.length).toBe(1);
      expect(events[0].event).toBe('$pageview');
      expect(events[0].properties).toMatchObject({
        $current_url: `${site}/${lang}/`, $pathname: `/${lang}/`, language: lang,
        utm_source: 'github', utm_medium: 'referral', utm_content: 'readme', distinct_id: '$posthog_cookieless',
        $process_person_profile: false,
      });
      if (referer) expect(events[0].properties.$referring_domain).toBe('github.com');
      expect(JSON.stringify(events)).not.toContain('private');
      expect(await context.cookies()).toEqual([]);
      expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
        .toEqual({ local: ['naghva-lang'], session: [] });
    });
  }

  test(`${lang}: all five UTM values reach PostHog unchanged after the root redirect`, async ({ page }) => {
    const { events } = await observe(page);
    const campaign = {
      utm_source: 'New Partner / Music', utm_medium: 'Shared Link',
      utm_campaign: 'Fall 2026 + نغوا', utm_content: 'README:hero&footer',
      utm_term: 'independent music? #1',
    };
    const search = new URLSearchParams(campaign).toString();
    await page.addInitScript((lang) => localStorage.setItem('naghva-lang', lang), lang);
    await page.goto(`${site}/?${search}&email=private-email&gclid=private-click&utm_extra=private-extra#private-fragment`);
    await expect.poll(() => events.length).toBe(1);
    const landed = new URL(page.url());
    expect(landed.pathname).toBe(`/${lang}/`);
    expect(Object.fromEntries(landed.searchParams)).toEqual(campaign);
    expect(events[0].properties).toMatchObject({ ...campaign, $current_url: `${site}/${lang}/` });
    expect(JSON.stringify(events)).not.toContain('private');
  });
}

for (const [origin, lang, choice] of [[site, 'en', '1'], ['https://naqva.com', 'fa', '0']] as const) {
  test(`${origin}: retired replay state is removed and cannot enable recording`, async ({ page, context }) => {
    const { events, analyticsRequests } = await observe(page);
    const recorderRequests: string[] = [];
    page.on('request', (request) => { if (/recorder|session.?recording/i.test(request.url())) recorderRequests.push(request.url()); });
    await page.addInitScript((choice) => {
      localStorage.setItem('naghva-replay-consent-v1', choice);
      localStorage.setItem('naghva-replay-consent-v1-probe', '1');
      localStorage.setItem('ph_naghva-replay', 'retired-identity');
      sessionStorage.setItem('ph_naghva-replay', 'retired-identity');
      sessionStorage.setItem('ph_naghva-replay_window_id', 'retired-window');
      sessionStorage.setItem('unrelated-preference', 'keep');
    }, choice);
    await page.goto(`${origin}/${lang}/search/?q=private-retired#private-fragment`);
    await page.locator('astro-island:not([ssr])').waitFor();
    await expect.poll(() => events.length).toBeGreaterThan(0);
    await page.locator('#results-query').fill('private-input');
    await page.locator('#results-query').press('Enter');
    await page.mouse.move(100, 100);
    await page.waitForTimeout(1000);
    await expect(page.locator('#privacy-dialog, [data-privacy-settings]')).toHaveCount(0);
    expect(await page.evaluate(() => Boolean((window as any).__PosthogExtensions__?.rrweb?.record?.isRecording?.()))).toBe(false);
    expect(recorderRequests).toEqual([]);
    expect([...new Set(analyticsRequests)]).toEqual(['/e/']);
    expect(events.every((event) => event.properties.distinct_id === '$posthog_cookieless')).toBe(true);
    expect(events.some((event) => event.event === '$snapshot')).toBe(false);
    expect(JSON.stringify(events)).not.toMatch(/private-|retired-|\$session_id|\$window_id/);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
      .toEqual({ local: ['naghva-lang'], session: ['unrelated-preference'] });
    expect(await context.cookies()).toEqual([]);
  });
}

for (const signal of ['DNT', 'GPC']) {
  test(`${signal} still clears retired replay data without capturing anything`, async ({ page }) => {
    const { analyticsRequests } = await observe(page);
    await page.addInitScript((signal) => {
      localStorage.setItem('naghva-replay-consent-v1', '1');
      sessionStorage.setItem('ph_naghva-replay', 'retired-identity');
      Object.defineProperty(navigator, signal === 'DNT' ? 'doNotTrack' : 'globalPrivacyControl', { value: signal === 'DNT' ? '1' : true });
    }, signal);
    await page.goto(`${site}/en/`);
    await page.waitForTimeout(500);
    expect(analyticsRequests).toEqual([]);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
      .toEqual({ local: ['naghva-lang'], session: [] });
    await expect(page.locator('#privacy-dialog, [data-privacy-settings]')).toHaveCount(0);
  });
}

test('unavailable browser storage does not prevent minimal cookieless capture', async ({ page, context }) => {
  const { events, analyticsRequests } = await observe(page);
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('storage blocked'); }; });
  await page.goto(`${site}/en/`);
  await expect.poll(() => events.length).toBeGreaterThan(0);
  expect(events.every((event) => event.properties.distinct_id === '$posthog_cookieless')).toBe(true);
  expect([...new Set(analyticsRequests)]).toEqual(['/e/']);
  expect(await context.cookies()).toEqual([]);
  await expect(page.locator('#privacy-dialog, [data-privacy-settings]')).toHaveCount(0);
});

for (const scenario of ['missing configuration', 'preview', 'preview canonical', 'localhost', 'DNT', 'GPC'] as const) {
  test(`${scenario} makes no analytics requests and search still works`, async ({ page }) => {
    const { analyticsRequests } = await observe(page, scenario !== 'missing configuration', true, scenario === 'preview canonical' ? 'https://preview.example' : site);
    if (scenario === 'DNT') await page.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { value: '1' }));
    if (scenario === 'GPC') await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }));
    const origin = scenario === 'preview' ? 'https://preview.example' : scenario === 'localhost' ? 'http://127.0.0.1:4322' : site;
    await page.goto(`${origin}/en/`);
    await page.locator('astro-island:not([ssr])').waitFor();
    await page.getByRole('combobox').fill('sanam maroufkhani');
    await expect(page.locator('.search-panel a').first()).toBeVisible();
    await page.waitForTimeout(1000);
    expect(analyticsRequests).toEqual([]);
  });
}

test('blocked ingestion does not interrupt searching or navigation', async ({ page }) => {
  await observe(page);
  let blocked = 0;
  await page.route(`${ingestion}/**`, (route) => { blocked++; return route.abort(); });
  await page.goto(`${site}/en/`);
  await expect.poll(() => blocked).toBeGreaterThan(0);
  await page.locator('astro-island:not([ssr])').waitFor();
  await page.getByRole('combobox').fill('sanam maroufkhani');
  await page.locator('.search-panel a').first().click();
  await expect(page).toHaveURL(`${site}/en/sanam-maroufkhani-a84/`);
  await expect(page.locator('h1')).toContainText('Sanam');
});

// Playwright cannot observe beacons from a document that has already been
// replaced, so leave the page the way the browser signals it, then navigate.
async function leave(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
}

test('leaving a page sends its time, scroll depth and web vitals, and nothing private', async ({ page }) => {
  const { events, analyticsRequests } = await observe(page);
  await page.goto(`${site}/en/sanam-maroufkhani-a84/?email=private-url#private-fragment`);
  await expect.poll(() => events.filter((e) => e.event === '$pageview').length).toBe(1);
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(500);
  await leave(page);
  await expect.poll(() => events.filter((e) => e.event === '$pageleave').length).toBe(1);
  await page.goto(`${site}/en/about/`);
  await expect.poll(() => events.filter((e) => e.event === '$pageview').length).toBe(2);
  const left = events.find((e) => e.event === '$pageleave')!;
  expect(left.properties).toMatchObject({ $pathname: '/en/sanam-maroufkhani-a84/', distinct_id: '$posthog_cookieless' });
  expect(left.properties.$prev_pageview_duration).toEqual(expect.any(Number));
  expect(left.properties.$prev_pageview_max_scroll_percentage).toBeGreaterThan(0);
  await expect.poll(() => events.filter((e) => e.event === '$web_vitals').length).toBeGreaterThan(0);
  const vitals = events.find((e) => e.event === '$web_vitals')!;
  const metrics = Object.keys(vitals.properties).filter((key) => key.startsWith('$web_vitals_'));
  expect(metrics.length).toBeGreaterThan(0);
  for (const key of metrics) {
    expect(key).toMatch(/^\$web_vitals_(LCP|CLS|FCP|INP)_value$/);
    expect(vitals.properties[key]).toEqual(expect.any(Number));
  }
  expect(vitals.properties.$pathname).toBe('/en/sanam-maroufkhani-a84/');
  expect(JSON.stringify(events)).not.toContain('private');
  expect([...new Set(analyticsRequests)]).toEqual(['/e/']);
});
