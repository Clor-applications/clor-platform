/**
 * Live QA: drives the real, deployed CLOR sites (clor.in, app, Books, Ops, API).
 * Nothing is booted. How to run: e2e/live/README.md.
 *
 * Read-only by default. Write flows run only with QA_LIVE_WRITES=1 and only in
 * companies whose name is listed in QA_WRITE_COMPANIES (e2e/live/.env.live).
 */
import { defineConfig, devices } from '@playwright/test';
import { loadLiveEnv } from './lib/env';

loadLiveEnv();

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.live\.ts/,
  outputDir: './test-results',
  fullyParallel: false,
  workers: Number(process.env.QA_WORKERS || 2),
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: './report/html', open: 'never' }], ['json', { outputFile: './report/results.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
