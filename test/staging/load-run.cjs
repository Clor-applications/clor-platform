/**
 * Staging load: N virtual users, each a seeded company owner, doing what a
 * person at a desk does — sign in, open lists, open a record, now and then
 * save an invoice — with a think time between steps. Optional real browsers
 * alongside (BROWSERS=n) measure page loads under that load.
 *
 *   STAGING_PASSWORD=... SEED=seed.json USERS=50 SECONDS=180 BROWSERS=3 node test/staging/load-run.cjs
 *
 * Also probes production (read-only: its health and front page) during the
 * run, since staging shares the database server; ABORT_PROD_MS stops the run
 * if production slows past it. Prints a JSON summary. Staging only.
 */
const fs = require('node:fs');
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ connect: { family: 4 }, connections: 256 }));
} catch { /* default dispatcher */ }

const API = process.env.API_URL || 'https://api.staging.clor.in/api';
const APP = process.env.APP_URL || 'https://app.staging.clor.in';
const PASSWORD = process.env.STAGING_PASSWORD;
const SEED = JSON.parse(fs.readFileSync(process.env.SEED || 'seed.json', 'utf8'));
const USERS = Number(process.env.USERS || 10);
const SECONDS = Number(process.env.SECONDS || 120);
const BROWSERS = Number(process.env.BROWSERS || 0);
const THINK_MS = Number(process.env.THINK_MS || 1500);
const ABORT_PROD_MS = Number(process.env.ABORT_PROD_MS || 1500);
if (!PASSWORD) throw new Error('STAGING_PASSWORD not set');
if (!/staging/.test(API)) throw new Error('Load: staging only.');

const stats = new Map();
const note = (name, ms, status) => {
  const s = stats.get(name) || { ms: [], errors: 0, statuses: {} };
  s.ms.push(ms);
  s.statuses[status] = (s.statuses[status] || 0) + 1;
  if (status >= 500 || status === 0 || status === 429) s.errors += 1;
  stats.set(name, s);
};
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return Math.round(a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => THINK_MS * (0.5 + Math.random());

async function call(name, method, path, { token, org, branch, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (org) h['x-org-id'] = org;
  if (branch) h['x-branch-id'] = branch;
  const t = performance.now();
  try {
    const r = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    note(name, performance.now() - t, r.status);
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json };
  } catch {
    note(name, performance.now() - t, 0);
    return { status: 0, json: null };
  }
}

let stop = false;
async function virtualUser(seed, i) {
  const login = await call('login', 'POST', '/auth/login', { body: { emailOrUsername: seed.email, password: PASSWORD } });
  if (!login.json?.token) return;
  const ctx = { token: login.json.token, org: seed.org, branch: seed.branch };
  let n = 0;
  while (!stop) {
    n += 1;
    await call('me', 'GET', '/auth/me', ctx);
    await sleep(jitter());
    const inv = await call('invoices.list', 'GET', `/orgs/${seed.org}/invoices`, ctx);
    await sleep(jitter());
    const list = inv.json?.invoices || inv.json?.rows || [];
    if (list.length) {
      await call('invoices.open', 'GET', `/orgs/${seed.org}/invoices/${list[(n + i) % list.length].id}`, ctx);
      await sleep(jitter());
    }
    await call('customers.list', 'GET', `/orgs/${seed.org}/customers`, ctx);
    await sleep(jitter());
    await call('items.list', 'GET', `/orgs/${seed.org}/items`, ctx);
    await sleep(jitter());
    if (n % 3 === 0) await call('employees.list', 'GET', `/orgs/${seed.org}/people/employees`, ctx);
    if (n % 4 === 0) {
      const sub = 1000 + n;
      const gst = Math.round(sub * 0.18 * 100) / 100;
      await call('invoices.create', 'POST', `/orgs/${seed.org}/invoices`, { ...ctx, body: {
        date: '2026-10-20', customerName: 'Load walk-in', subtotal: sub, cgstTotal: gst / 2, sgstTotal: gst / 2, igstTotal: 0, gstTotal: gst, total: sub + gst,
        items: [{ description: 'Load line', quantity: 1, rate: sub, gstRate: 18 }],
      } });
    }
    if (n % 5 === 0) await call('account.overview', 'GET', '/account/overview', ctx);
    await sleep(jitter());
  }
}

/** Real page loads while the API is under load: sign in, land in the app, open invoices. */
async function browserUser(seed, i) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    while (!stop) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page = await ctx.newPage();
      let t = performance.now();
      try {
        await page.goto(`${APP}/signin`);
        await page.getByLabel('Email or username').fill(seed.email);
        await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
        await page.getByRole('button', { name: /sign in/i }).click();
        await page.waitForURL(/\/o\/[0-9]{10}\//, { timeout: 30000 });
        note('browser.signin-to-app', performance.now() - t, 200);
        t = performance.now();
        await page.goto(`https://accounting.staging.clor.in/o/${page.url().match(/\/o\/([0-9]{10})\//)[1]}/#/invoices`);
        await page.getByRole('heading').first().waitFor({ timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        note('browser.open-invoices', performance.now() - t, 200);
      } catch {
        note('browser.failed', performance.now() - t, 0);
      }
      await ctx.close();
      await sleep(3000 + i * 500);
    }
  } finally {
    await browser.close();
  }
}

/** Production, read-only, every 5 s: is it slowing because staging shares its database server? */
const prod = [];
async function probeProduction() {
  while (!stop) {
    const t = performance.now();
    let status = 0;
    try { status = (await fetch('https://api.clor.in/health')).status; } catch { /* down */ }
    const ms = performance.now() - t;
    prod.push(ms);
    if (ms > ABORT_PROD_MS && prod.filter((x) => x > ABORT_PROD_MS).length >= 3) {
      console.log(`ABORT: production health ${Math.round(ms)}ms (status ${status}) three times over ${ABORT_PROD_MS}ms`);
      stop = true;
    }
    await sleep(5000);
  }
}

(async () => {
  const seeds = SEED.slice(0, USERS);
  if (seeds.length < USERS) console.log(`only ${seeds.length} seeded companies; ${USERS} users share them`);
  const users = Array.from({ length: USERS }, (_, i) => seeds[i % seeds.length]);
  console.log(`load: ${USERS} users, ${BROWSERS} browsers, ${SECONDS}s, think ~${THINK_MS}ms`);
  const t0 = Date.now();
  const runs = [
    probeProduction(),
    ...users.map((s, i) => sleep((i * 1000) / Math.max(1, USERS / 10)).then(() => virtualUser(s, i))),
    ...Array.from({ length: BROWSERS }, (_, i) => browserUser(seeds[i % seeds.length], i)),
  ];
  setTimeout(() => { stop = true; }, SECONDS * 1000);
  await Promise.all(runs);
  const out = {};
  let total = 0;
  let errors = 0;
  for (const [name, s] of [...stats.entries()].sort()) {
    total += s.ms.length;
    errors += s.errors;
    out[name] = { n: s.ms.length, p50: pct(s.ms, 50), p95: pct(s.ms, 95), p99: pct(s.ms, 99), max: pct(s.ms, 100), errors: s.errors, statuses: s.statuses };
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ users: USERS, browsers: BROWSERS, seconds: Math.round(secs), requests: total, rps: Math.round(total / secs), errorRate: total ? +(errors / total * 100).toFixed(2) : 0, production: { p50: pct(prod, 50), p95: pct(prod, 95), max: pct(prod, 100) }, endpoints: out }, null, 1));
})();
