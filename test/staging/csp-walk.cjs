/**
 * Staging: sign in as a seeded owner and open every app's main screens,
 * collecting Content-Security-Policy violations (and other console errors).
 * Run with the CSP enforced on staging to learn whether production can stop
 * reporting and start blocking.
 *
 *   STAGING_PASSWORD=... SEED=seed.json node test/staging/csp-walk.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PASSWORD = process.env.STAGING_PASSWORD;
const seed = JSON.parse(fs.readFileSync(process.env.SEED || 'seed.json', 'utf8'))[0];
const ART = process.env.PW_ARTIFACT_DIR || require('node:os').tmpdir();
const BASE = 'staging.clor.in';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const violations = [];
  const errors = [];
  const visited = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/Content Security Policy|Refused to/i.test(t)) violations.push(`${new URL(page.url()).host}${new URL(page.url()).hash}: ${t.slice(0, 200)}`);
      else errors.push(`${new URL(page.url()).host}: ${t.slice(0, 160)}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror ${new URL(page.url()).host}: ${e.message.slice(0, 160)}`));

    await page.goto(`https://app.${BASE}/signin`);
    await page.getByLabel('Email or username').fill(seed.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/o\/[0-9]{10}\//, { timeout: 30000 });
    const code = page.url().match(/\/o\/([0-9]{10})\//)[1];

    const screens = [
      ['app', ''], ['accounting', '#/'], ['accounting', '#/invoices'], ['accounting', '#/customers'], ['accounting', '#/items'], ['accounting', '#/reports'],
      ['payroll', '#/'], ['people', '#/'], ['people', '#/employees'], ['attendance', '#/'], ['app', '?app=admin'],
    ];
    for (const [host, rest] of screens) {
      const url = `https://${host}.${BASE}/o/${code}/${rest}`;
      try {
        await page.goto(url, { timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1500);
        visited.push(url);
        await page.screenshot({ path: path.join(ART, `csp-${host}-${(rest || 'home').replace(/[^a-z]/gi, '') || 'home'}.png`) });
      } catch (e) {
        errors.push(`could not open ${url}: ${String(e.message).split('\n')[0]}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ visited: visited.length, violations: [...new Set(violations)], otherErrors: [...new Set(errors)].slice(0, 15) }, null, 1));
})();
