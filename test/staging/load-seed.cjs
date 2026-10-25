/**
 * Staging: seed N companies with realistic data, through the API.
 *
 *   STAGING_PASSWORD=... COMPANIES=10 OUT=seed.json node test/staging/load-seed.cjs
 *
 * Each company: its own owner account, customers, items, invoices (balanced,
 * GST on every line) and employees. Appends to OUT so steps can grow
 * 10 -> 50 -> 100 without redoing the first ones. Needs DISABLE_RATE_LIMIT on
 * staging (it signs up many accounts from one address). Staging only.
 */
const fs = require('node:fs');
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ connect: { family: 4 }, connections: 64 }));
} catch { /* default dispatcher */ }

const API = process.env.API_URL || 'https://api.staging.clor.in/api';
const PASSWORD = process.env.STAGING_PASSWORD;
const TARGET = Number(process.env.COMPANIES || 10);
const OUT = process.env.OUT || 'seed.json';
const PARALLEL = Number(process.env.PARALLEL || 4);
const PER = {
  customers: Number(process.env.CUSTOMERS || 25),
  items: Number(process.env.ITEMS || 40),
  invoices: Number(process.env.INVOICES || 100),
  employees: Number(process.env.EMPLOYEES || 25),
};
if (!PASSWORD) throw new Error('STAGING_PASSWORD not set');
if (!/staging/.test(API)) throw new Error('Seeding writes data: staging only.');

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const STATES = ['Karnataka', 'Kerala', 'Tamil Nadu', 'Maharashtra', 'Delhi', 'Gujarat', 'Telangana'];

async function call(method, path, { token, org, branch, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (org) h['x-org-id'] = org;
  if (branch) h['x-branch-id'] = branch;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if (r.status >= 500 && attempt < 2) continue;
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json, text };
  }
}
const must = (r, what) => {
  if (!r || r.status >= 300) throw new Error(`${what}: ${r?.status} ${(r?.text || '').slice(0, 160)}`);
  return r.json;
};

async function pool(n, items, fn) {
  let i = 0;
  const out = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function seedCompany(n) {
  const t0 = Date.now();
  const email = `load.${tag()}@example.com`;
  const s = must(await call('POST', '/auth/signup', { body: { email, password: PASSWORD, name: `Load Owner ${n}` } }), 'signup');
  const c = must(await call('POST', '/auth/setup-company', { token: s.token, body: { companyName: `Load Co ${n} ${tag()}`, state: STATES[n % STATES.length] } }), 'setup');
  const ctx = { token: s.token, org: c.company.orgId, branch: c.branch.id };

  const customers = await pool(4, Array.from({ length: PER.customers }), async (_, i) =>
    must(await call('POST', `/orgs/${ctx.org}/customers`, { ...ctx, body: { name: `Customer ${n}-${i} ${tag()}`, paymentTermDays: 30 } }), 'customer').party);
  await pool(4, Array.from({ length: PER.items }), async (_, i) =>
    must(await call('POST', `/orgs/${ctx.org}/items`, { ...ctx, body: { name: `Item ${n}-${i}`, itemType: 'SERVICE', salePrice: 100 + i, gstRate: 18 } }), 'item'));

  const errors = [];
  await pool(4, Array.from({ length: PER.invoices }), async (_, i) => {
    const qty = 1 + (i % 5);
    const rate = 250 + ((i * 37) % 1000);
    const sub = qty * rate;
    const gst = Math.round(sub * 0.18 * 100) / 100;
    const cust = customers[i % customers.length];
    const day = String(1 + (i % 28)).padStart(2, '0');
    const r = await call('POST', `/orgs/${ctx.org}/invoices`, {
      ...ctx,
      body: {
        date: `2026-09-${day}`,
        customerId: cust?.id,
        customerName: cust?.name || 'Walk-in',
        subtotal: sub, cgstTotal: gst / 2, sgstTotal: gst / 2, igstTotal: 0, gstTotal: gst, total: sub + gst,
        items: [{ description: `Service line ${i}`, quantity: qty, rate, gstRate: 18 }],
      },
    });
    if (r.status >= 300) errors.push(`invoice ${r.status} ${(r.text || '').slice(0, 100)}`);
  });

  await pool(4, Array.from({ length: PER.employees }), async (_, i) => {
    const r = await call('POST', `/orgs/${ctx.org}/people/employees`, { ...ctx, body: { name: `Employee ${n}-${i}`, code: `E${String(i + 1).padStart(3, '0')}`, dateOfJoining: '2026-01-01' } });
    if (r.status >= 300) errors.push(`employee ${r.status} ${(r.text || '').slice(0, 100)}`);
  });

  return { n, email, org: ctx.org, branch: ctx.branch, seconds: Math.round((Date.now() - t0) / 1000), errors: [...new Set(errors)].slice(0, 3), errorCount: errors.length };
}

(async () => {
  const have = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const todo = Array.from({ length: Math.max(0, TARGET - have.length) }, (_, i) => have.length + i + 1);
  console.log(`have ${have.length}, seeding ${todo.length} more (${PARALLEL} at a time), each: ${JSON.stringify(PER)}`);
  const t0 = Date.now();
  await pool(PARALLEL, todo, async (n) => {
    try {
      const done = await seedCompany(n);
      have.push(done);
      fs.writeFileSync(OUT, JSON.stringify(have, null, 1));
      console.log(`company ${n}: ${done.seconds}s${done.errorCount ? `, ${done.errorCount} errors e.g. ${done.errors[0]}` : ''}`);
    } catch (e) {
      console.log(`company ${n}: FAILED ${String(e.message || e).slice(0, 200)}`);
    }
  });
  console.log(JSON.stringify({ companies: have.length, seconds: Math.round((Date.now() - t0) / 1000), withErrors: have.filter((h) => h.errorCount).length }));
})();
