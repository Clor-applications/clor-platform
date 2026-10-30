/**
 * CLOR end-to-end tests (Playwright Test). How to run: e2e/README.md.
 *
 * Two device projects, each with its own world (its own Asha Textiles,
 * seeded by its own setup project), so the same scenario can run at both
 * widths without the two runs touching each other's people:
 *   desktop  Chromium 1440×900
 *   phone    Chromium 390×844, touch, a phone's user agent
 *
 * Target: local (default) boots the API (E2E_API_PORT, 4016) and the web app
 * (E2E_WEB_PORT, 5196) against a fresh database; E2E_TARGET=staging points at
 * E2E_BASE_URL / E2E_API_URL and boots nothing.
 */
import { defineConfig, devices } from '@playwright/test';

import { apiPort, baseURL, isCI, target, webPort } from './scripts/env.mjs';

const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  /* Each file runs its tests in order; files run side by side. A file owns the people and weeks it changes (support/dates.ts). */
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS || 3),
  /* CI retries once and reports what needed it as flaky; locally a failure is a failure. */
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  timeout: 120_000,
  /* The Mac runs other coders and CI beside this: give a busy screen time before calling it wrong. */
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: './report/html', open: 'never' }],
    ['junit', { outputFile: './report/junit.xml' }],
    ['json', { outputFile: './report/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'setup-desktop', testMatch: /setup\/world\.setup\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'setup-phone', testMatch: /setup\/world\.setup\.ts/, use: { ...devices['Desktop Chrome'], ...phone } },
    {
      name: 'desktop',
      testMatch: /tests\/.*\.spec\.ts/,
      dependencies: ['setup-desktop'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      testMatch: /tests\/.*\.spec\.ts/,
      dependencies: ['setup-phone'],
      use: { ...devices['Desktop Chrome'], ...phone },
    },
  ],
  webServer:
    target === 'local'
      ? [
          {
            command: 'node e2e/scripts/start-api.mjs',
            cwd: '..',
            url: `http://127.0.0.1:${apiPort}/health`,
            timeout: 240_000,
            reuseExistingServer: process.env.E2E_REUSE === '1',
            stdout: 'ignore',
            stderr: 'pipe',
            gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
          },
          {
            command: 'node e2e/scripts/start-web.mjs',
            cwd: '..',
            url: `http://127.0.0.1:${webPort}/`,
            timeout: 240_000,
            reuseExistingServer: process.env.E2E_REUSE === '1',
            stdout: 'ignore',
            stderr: 'pipe',
            gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
          },
        ]
      : undefined,
});
