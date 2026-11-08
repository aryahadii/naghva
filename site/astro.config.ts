import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import record from './integrations/record';

// The address the site is published at: canonical links, hreflang, the
// sitemap and robots.txt all name it. Only a build on your own machine may
// leave SITE_URL out and use the local server; on CI, Cloudflare's included,
// a missing SITE_URL stops the build.
const site = process.env.SITE_URL ?? (process.env.CI ? undefined : 'http://localhost:4321');
if (!site) throw new Error('SITE_URL is not set. Set it to the address the site is published at, such as https://example.org.');

export default defineConfig({
  site,
  trailingSlash: 'always',
  build: { format: 'directory' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  integrations: [
    preact(),
    sitemap({
      // The root only sends visitors on to a language, and the 404 page is no page at all.
      filter: (page) => new URL(page).pathname !== '/' && !page.endsWith('/404/') && !new URL(page).pathname.endsWith('/search/'),
      i18n: { defaultLocale: 'en', locales: { en: 'en', fa: 'fa' } },
    }),
    record(),
  ],
  vite: {
    // Logos come from ../assets/brand, outside the site's own folder.
    server: { fs: { allow: ['..'] } },
  },
});
