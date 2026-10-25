/**
 * Staging journey: clor.in -> a product page -> Start -> sign up -> set up a
 * company -> land in the app. Run with the playwright skill:
 *
 *   STAGING_PASSWORD=... node <skill>/run.js test/staging/journey-signup.js
 *
 * Staging only (staging.clor.in, app.staging.clor.in): it creates an account.
 * Writes screenshots to PW_ARTIFACT_DIR and prints one JSON line of timings.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const SITE = process.env.SITE_URL || 'https://staging.clor.in';
const ART = process.env.PW_ARTIFACT_DIR || require('node:os').tmpdir();
const PASSWORD = process.env.STAGING_PASSWORD;
const HEADLESS = process.env.PW_HEADLESS !== 'false';
if (!PASSWORD) throw new Error('STAGING_PASSWORD not set');
if (!/staging/.test(SITE)) throw new Error('This journey creates accounts: staging only.');

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const email = process.env.JOURNEY_EMAIL || `e2e.${tag}@example.com`;
const company = process.env.JOURNEY_COMPANY || `E2E Traders ${tag}`;

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const t = {};
  const mark = (k, since) => (t[k] = Date.now() - since);
  const errors = [];
  const slow = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
    /* API calls slower than a second, with how long they took. */
    page.on('requestfinished', (req) => {
      if (!req.url().includes('/api/')) return;
      const tm = req.timing();
      const ms = Math.round(tm.responseEnd);
      if (ms > 1000) slow.push(`${ms}ms ${req.method()} ${req.url().replace(/^https:\/\/[^/]+/, '').replace(/c[a-z0-9]{24}/g, ':id')}`);
    });

    let s = Date.now();
    await page.goto(SITE);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    mark('site', s);
    await page.screenshot({ path: path.join(ART, '01-site.png') });

    /* A product page, then its own Start button — the visitor's chosen app should follow them. */
    s = Date.now();
    await page.goto(`${SITE}/products/books`);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    mark('product', s);
    /* The product's own button, which carries ?app= so setup preselects that app. */
    const start = page.locator('a[href*="signup?app="]').first();
    const href = await start.getAttribute('href');
    s = Date.now();
    await start.click();
    await page.waitForURL(/app\.staging\.clor\.in/);
    await page.getByLabel('Your name').waitFor();
    mark('toSignup', s);
    await page.screenshot({ path: path.join(ART, '02-signup.png') });

    await page.getByLabel('Your name').fill('E2E Owner');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    s = Date.now();
    await page.getByRole('button', { name: /create account/i }).click();
    await page.getByLabel('Company name').waitFor({ timeout: 30000 });
    mark('signup', s);

    await page.getByLabel('Company name').fill(company);
    await page.getByLabel('State').selectOption('Karnataka');
    await page.screenshot({ path: path.join(ART, '03-setup-company.png') });
    await page.getByRole('button', { name: /continue/i }).click();
    await page.screenshot({ path: path.join(ART, '04-setup-apps.png') });
    s = Date.now();
    await page.getByRole('button', { name: /finish|open|start|create/i }).last().click();
    await page.waitForURL(/\/o\/[1-9][0-9]{9}\//, { timeout: 60000 });
    mark('setupToApp', s);
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: path.join(ART, '05-app.png') });

    const code = (page.url().match(/\/o\/([0-9]{10})\//) || [])[1];
    console.log(JSON.stringify({ ok: errors.length === 0, email, company, startHref: href, landedAt: page.url(), companyCode: code, timingsMs: t, slow, errors }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, email, step: Object.keys(t).pop() || 'start', error: String(e.message || e).split('\n')[0], timingsMs: t, errors }));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
