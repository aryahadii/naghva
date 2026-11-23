import { defineConfig, devices } from '@playwright/test';

import { localOrigin, port } from './tests/browser/server';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: localOrigin,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory dist`,
    url: `${localOrigin}/en/`,
  },
});
