/**
 * Staging, in a real browser: mark a staff member as left from Workspace →
 * Users, then archive a second company from Workspace → Companies and open it
 * to see the read-only banner. Sets up its own owner, staff member and second
 * company through the API. Screenshots to PW_ARTIFACT_DIR.
 *
 *   STAGING_PASSWORD=... node <playwright-skill>/run.js test/staging/leavers-archive.cjs
 */
const path = require('node:path');
const { chromium } = require('playwright');

const API = 'https://api.staging.clor.in/api';
const APP = 'https://app.staging.clor.in';
const PASSWORD = process.env.STAGING_PASSWORD;
const ART = process.env.PW_ARTIFACT_DIR || require('node:os').tmpdir();
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function call(method, p, { token, org, branch, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (org) h['x-org-id'] = org;
  if (branch) h['x-branch-id'] = branch;
  const r = await fetch(`${API}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${method} ${p}: ${r.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

(async () => {
  const checks = [];
  const ok = (name, pass, detail = '') => {
    checks.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  /* Setup through the API. */
  const email = `la.${tag()}@example.com`;
  const s = await call('POST', '/auth/signup', { body: { email, password: PASSWORD, name: 'Archive Owner' } });
  const c1 = await call('POST', '/auth/setup-company', { token: s.token, body: { companyName: `Live Traders ${tag()}`, state: 'Karnataka' } });
  const ctx = { token: s.token, org: c1.company.orgId, branch: c1.branch.id };
  const c2 = await call('POST', '/auth/setup-company', { token: s.token, body: { companyName: `Old Traders ${tag()}`, state: 'Kerala' } });
  const staffName = `Ravi Leaver ${tag()}`;
  await call('POST', '/users', { ...ctx, body: { email: `ravi.${tag()}@example.com`, fullName: staffName, password: PASSWORD, orgIds: [ctx.org], branchIdsByOrg: { [ctx.org]: [ctx.branch] } } });

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    await page.goto(`${APP}/signin`);
    await page.getByLabel('Email or username').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/o\/[0-9]{10}\//, { timeout: 30000 });
    const code = c1.company.code || page.url().match(/\/o\/([0-9]{10})\//)[1];

    /* Users → Mark as left. */
    await page.goto(`${APP}/o/${code}/?app=admin&open=users`);
    await page.getByRole('button', { name: `Actions for ${staffName}` }).click();
    await page.getByRole('button', { name: 'Mark as left' }).click();
    await page.getByText('has left').first().waitFor();
    await page.getByLabel('Why they left').selectOption('RESIGNED');
    await page.getByText(/Nothing is waiting on them|Waiting on them/).waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(ART, 'leave-01-form.png') });
    await page.getByRole('button', { name: 'Mark as left' }).last().click();
    const row = page.getByRole('row', { name: new RegExp(staffName) });
    await row.getByText('Left', { exact: true }).waitFor({ timeout: 15000 });
    ok('Users: marked as left, row shows "Left"', true);
    await page.screenshot({ path: path.join(ART, 'leave-02-list.png') });

    /* Companies → Archive the second company. */
    await page.goto(`${APP}/o/${code}/?app=admin&open=companies`);
    await page.getByRole('button', { name: c2.company.name || /Old Traders/ }).first().click();
    await page.getByRole('button', { name: 'Archive company' }).click();
    await page.getByLabel('Why').selectOption('STOPPED_TRADING');
    await page.getByLabel(/Note/).fill('Shop closed in September');
    await page.screenshot({ path: path.join(ART, 'archive-01-form.png') });
    await page.getByRole('button', { name: 'Archive company' }).last().click();
    await page.getByText(/^Archived \d/).waitFor({ timeout: 15000 });
    ok('Companies: archived with reason', true);
    await page.keyboard.press('Escape');
    await page.getByText('Archived', { exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(ART, 'archive-02-list.png') });

    /* Open the archived company: banner, and a save is refused by the server. */
    const code2 = (await call('GET', '/auth/me', { token: s.token })).orgs.find((o) => o.orgId === c2.company.orgId).org.code;
    await page.goto(`https://accounting.staging.clor.in/o/${code2}/#/items`);
    await page.getByText('This company is archived.').first().waitFor({ timeout: 20000 });
    ok('Archived company opens with the read-only banner', true);
    await page.screenshot({ path: path.join(ART, 'archive-03-banner.png') });

    const tryWrite = await fetch(`${API}/orgs/${c2.company.orgId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}`, 'x-org-id': c2.company.orgId, 'x-branch-id': c2.branch.id }, body: JSON.stringify({ name: 'x' }) });
    ok('Archived company refuses a save (COMPANY_ARCHIVED)', tryWrite.status === 403 && (await tryWrite.text()).includes('COMPANY_ARCHIVED'), `${tryWrite.status}`);
  } catch (e) {
    ok('browser flow', false, String(e.message || e).split('\n')[0]);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ passed: checks.filter((c) => c.pass).length, total: checks.length, pageErrors: errors }));
  process.exitCode = checks.every((c) => c.pass) ? 0 : 1;
})();
