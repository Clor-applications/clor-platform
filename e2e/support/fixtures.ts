/**
 * The test API every spec imports instead of @playwright/test:
 *
 *   import { test, expect } from '../support/fixtures';
 *
 *   w            this device's world (support/world.ts)
 *   asOwner      Suresh, signed in on the web (PeopleWeb)
 *   asHR         Kavya
 *   asManager    Rahul
 *   asEmployee   Priya in the employee app (EmployeeApp)
 *   persona(k)   anyone else: 'owner' | 'hr' | 'manager' (web) or an app user key ('arjun', 'meena', 'imran', …)
 *   guest        a browser nobody is signed in on
 *
 * Every page any of these opens is watched (support/checks.ts): a console
 * error, an uncaught error or a 5xx fails the test, and the page a test ends
 * on gets the screen checks. Expected noise is allowed per test with
 * allowNoise(testInfo, /pattern/).
 */
import { rmSync } from 'node:fs';

import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

import { EmployeeApp } from '../pages/employeeApp';
import { PeopleWeb } from '../pages/people';
import { auditScreen, watchPage, type Watch } from './checks';
import { authFile, deviceOf, readWorld, type World } from './world';

const watches = new WeakMap<TestInfo, Watch>();

/** Lets a test say what console noise or server answer it expects (a refused page, say). */
export function allowNoise(testInfo: TestInfo, ...patterns: RegExp[]) {
  watches.get(testInfo)?.allowed.push(...patterns);
}

type Persona = 'owner' | 'hr' | 'manager';

type Fixtures = {
  w: World;
  watch: Watch;
  newContext: (storage?: string) => Promise<{ ctx: BrowserContext; page: Page }>;
  asOwner: PeopleWeb;
  asHR: PeopleWeb;
  asManager: PeopleWeb;
  asEmployee: EmployeeApp;
  persona: (who: string) => Promise<PeopleWeb | EmployeeApp>;
  web: (who: Persona) => Promise<PeopleWeb>;
  app: (who: string) => Promise<EmployeeApp>;
  guest: Page;
};

async function openContext(browser: Browser, testInfo: TestInfo, watch: Watch, contexts: BrowserContext[], storage?: string) {
  const u = testInfo.project.use;
  const ctx = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    userAgent: u.userAgent,
    locale: u.locale,
    timezoneId: u.timezoneId,
    reducedMotion: 'reduce',
    /* Recorded every time, kept only for a failure (the fixture deletes it on a pass). */
    recordVideo: { dir: testInfo.outputPath('videos'), size: u.viewport || undefined },
    ...(storage ? { storageState: storage } : {}),
  });
  ctx.setDefaultTimeout(u.actionTimeout || 15_000);
  ctx.setDefaultNavigationTimeout(u.navigationTimeout || 30_000);
  contexts.push(ctx);
  ctx.on('page', (p) => watchPage(p, watch));
  const page = await ctx.newPage();
  return { ctx, page };
}

export const test = base.extend<Fixtures>({
  w: async ({}, use, testInfo) => {
    await use(readWorld(deviceOf(testInfo.project.name)));
  },

  watch: async ({}, use, testInfo) => {
    const watch: Watch = { problems: [], allowed: [] };
    watches.set(testInfo, watch);
    await use(watch);
  },

  newContext: async ({ browser, watch }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use((storage) => openContext(browser, testInfo, watch, contexts, storage));
    /* The screen checks on whatever each page ended on, then the watch's verdict. */
    if (testInfo.status === testInfo.expectedStatus && testInfo.status === 'passed') {
      for (const ctx of contexts) for (const p of ctx.pages()) await auditScreen(p, testInfo, { title: false }).catch(() => null);
    }
    for (const ctx of contexts) await ctx.close().catch(() => null);
    if (testInfo.status === testInfo.expectedStatus) rmSync(testInfo.outputPath('videos'), { recursive: true, force: true });
    if (watch.problems.length) await testInfo.attach('console, errors and 5xx', { body: watch.problems.join('\n'), contentType: 'text/plain' });
    expect.soft(watch.problems, 'no console errors, uncaught errors or 5xx while the test ran').toEqual([]);
  },

  web: async ({ newContext, w }, use, testInfo) => {
    await use(async (who) => {
      const { page } = await newContext(authFile(w.device, who));
      return new PeopleWeb(page, w.asha, testInfo);
    });
  },

  app: async ({ newContext, w }, use, testInfo) => {
    await use(async (who) => {
      const { page } = await newContext(authFile(w.device, `app-${who}`));
      return new EmployeeApp(page, testInfo);
    });
  },

  persona: async ({ web, app }, use) => {
    await use((who) => (['owner', 'hr', 'manager'].includes(who) ? web(who as Persona) : app(who)));
  },

  asOwner: async ({ web }, use) => use(await web('owner')),
  asHR: async ({ web }, use) => use(await web('hr')),
  asManager: async ({ web }, use) => use(await web('manager')),
  asEmployee: async ({ app }, use) => use(await app('priya')),

  guest: async ({ newContext }, use) => {
    const { page } = await newContext();
    await use(page);
  },
});

export { expect };
