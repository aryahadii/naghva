import { expect, test } from '@playwright/test';
import { observe, site, ingestion } from './analytics-fixture';

test.use({ channel: 'chromium' });

for (const [lang, origin] of [['en', site], ['fa', 'https://naqva.com']] as const) {
  test(`${lang}: page, artist, search, listening and language events contain no private URL/input data`, async ({ page, context }) => {
    const { events, analyticsRequests } = await observe(page);
    await page.goto(`${origin}/${lang}/sanam-maroufkhani-a84/?utm_source=instagram&utm_medium=social&utm_campaign=private-campaign&email=private-url#private-fragment`, {
      referer: 'https://www.google.com/search?q=private-referrer',
    });
    await expect.poll(() => events.filter((e) => e.event === 'artist_viewed').length).toBe(1);
    const pageview = events.find((e) => e.event === '$pageview')!;
    expect(pageview.properties).toMatchObject({
      $current_url: `${origin}/${lang}/sanam-maroufkhani-a84/`, $pathname: `/${lang}/sanam-maroufkhani-a84/`,
      language: lang, artist_id: 'Qa84h2k', $referring_domain: 'www.google.com',
      utm_source: 'instagram', utm_medium: 'social', distinct_id: '$posthog_cookieless',
      $process_person_profile: false,
    });
    await page.locator('astro-island:not([ssr])').waitFor();
    await page.getByRole('combobox').fill('private-search');
    await expect.poll(() => events.filter((e) => e.event === 'search_used').length).toBe(1);
    await page.getByRole('combobox').fill('sanam');
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

test('the root redirect preserves referral origin and campaign categories; results-page queries stay private', async ({ page }) => {
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
    await page.getByRole('combobox').fill('sanam');
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
  await page.getByRole('combobox').fill('sanam');
  await page.locator('.search-panel a').first().click();
  await expect(page).toHaveURL(`${site}/en/sanam-maroufkhani-a84/`);
  await expect(page.locator('h1')).toContainText('Sanam');
});
