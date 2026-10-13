import 'dotenv/config';
/**
 * The UI-QA organisation: one command that makes every screen renderable.
 *
 * Geometry and layout defects hide in states, not in code — a select collides
 * with its chevron only when the value is long, dead space shows up only when
 * a column is empty, and Indian digit grouping only breaks past a lakh. None
 * of that can be inspected against an empty database, and standing the states
 * up by hand takes an afternoon and is never quite the same twice.
 *
 * So this seeds them, through the real HTTP API rather than through Prisma.
 * That is deliberate and it is what the server's own tests do: every record
 * here passes the same validation, numbering, and posting rules a person's
 * would, so the fixture cannot drift into states the product would refuse.
 * A direct database write would be faster and would happily create an invoice
 * the application considers impossible.
 *
 * The GSTINs are real numbers with correct check digits, not plausible-looking
 * strings: the parties API validates the checksum, so an invented one is
 * refused — which is the fixture proving it goes through the same door a
 * person does.
 *
 * Run:
 *   cd server && npx tsx src/scripts/seedUiQa.ts
 *
 * It is idempotent by identity: the QA owner's email is fixed, so a second run
 * signs in rather than creating "UI QA Organisation 2". Pass --reset to clear
 * what it made and build it again.
 */

import request from 'supertest';

import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/* ------------------------------------------------------------------ guard */

/**
 * Never against production.
 *
 * A comment saying "don't run this in production" is not a guard; it is a
 * wish. This refuses on any signal that the target is real: an explicit
 * NODE_ENV, a database that names production, or a host that is not this
 * machine.
 *
 * "Local" used to mean a `file:` URL, from when every database was SQLite.
 * A local Postgres is just as local, and a remote SQLite file is not — so the
 * test is the host, not the driver.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLocalDatabase = (url: string) => {
  if (!url) return true;
  if (/^file:/.test(url)) return true;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

const assertNotProduction = () => {
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  const url = String(process.env.DATABASE_URL || '');

  const reasons: string[] = [];
  if (env === 'production' || env === 'prod') reasons.push(`NODE_ENV=${env}`);
  if (!isLocalDatabase(url)) reasons.push(`DATABASE_URL is not on this machine (${url.slice(0, 24)}…)`);
  if (/prod/i.test(url)) reasons.push('DATABASE_URL names a production database');
  if (process.env.CLOR_ALLOW_SEED === 'never') reasons.push('CLOR_ALLOW_SEED=never');

  if (reasons.length) {
    console.error('\n  Refusing to seed. This looks like a real environment:');
    for (const r of reasons) console.error(`    · ${r}`);
    console.error('\n  The UI-QA fixture is for a local development database only.\n');
    process.exit(1);
  }
};

/* ------------------------------------------------------------------- data */

const OWNER = {
  email: 'ui-qa@clor.local',
  password: 'UiQaPassw0rd!23',
  name: 'UI QA Owner',
};

const COMPANY = 'UI QA Organisation';

/*
 * Names chosen to break layouts, not to look plausible.
 *
 * One short, one ordinary, one long enough to collide with a select's chevron
 * and to push a table's action column off the viewport. A fixture where every
 * record is long tests nothing: the defect is the DIFFERENCE between them.
 */
const CUSTOMERS = [
  { name: 'Acme Pvt Ltd', gstin: '29AABCU9603R1ZJ', phone: '9845012345', email: 'ap@acme.test', creditDays: 30 },
  { name: 'Bengaluru Industrial Supplies', gstin: '29AACCB1234M1ZO', phone: '9845067890', email: 'accounts@bis.test', creditDays: 45 },
  {
    name: 'International Business Solutions and Distribution Private Limited',
    gstin: '27AAECI5678Q1ZN',
    phone: '9820011223',
    email: 'finance@ibsd.test',
    creditDays: 60,
  },
];

const VENDORS = [
  { name: 'Metro Steel', gstin: '29AAFCM1234K1ZE', phone: '9845055555' },
  { name: 'Karnataka Packaging Works', gstin: '29AABCK4321L1ZG', phone: '9845066666' },
  {
    name: 'Southern Industrial Equipment and Components Distribution Private Limited',
    gstin: '33AAGCS8765N1ZM',
    phone: '9840077777',
  },
];

const ITEMS = [
  { name: 'Mouse', code: 'ACC-001', unit: 'Pcs', hsnSac: '84716060', gstRate: 18, salePrice: 450, purchasePrice: 310 },
  { name: 'Dell Latitude 7450 Laptop', code: 'LAP-7450', unit: 'Pcs', hsnSac: '84713010', gstRate: 18, salePrice: 124580, purchasePrice: 108000 },
  {
    name: 'Enterprise Network Security Appliance with Extended Support Subscription',
    code: 'NET-SEC-ENT-2026',
    unit: 'Nos',
    hsnSac: '85176290',
    gstRate: 18,
    salePrice: 1248230,
    purchasePrice: 1050000,
  },
  { name: 'Annual Maintenance Contract', code: 'SVC-AMC', unit: 'Nos', hsnSac: '998713', gstRate: 18, salePrice: 12450, purchasePrice: 0 },
];

/*
 * Figures that test width, not arithmetic.
 *
 * Indian grouping changes shape at a lakh and again at a crore, which is
 * exactly where a money column starts to push its neighbours — so the set runs
 * from nothing to eight figures.
 */
/*
 * No zero. An invoice for nothing cannot post — a journal entry needs two
 * lines and there is nothing to put on them — and the ledger is right to
 * refuse it. ₹1 stands in for the narrowest case a real document can reach.
 */
const INVOICE_TOTALS = [1, 125, 12450, 124580, 1248230, 12458230];

const STATUSES = ['Unpaid', 'Partially Paid', 'Paid', 'Overdue'] as const;

/* ------------------------------------------------------------------- seed */

type Ctx = { token: string; orgId: string; branchId: string };

const log = (msg: string) => console.log(`  ${msg}`);

const run = async () => {
  assertNotProduction();

  const app = buildApp().listen(0);
  const auth = (c: Ctx, extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${c.token}`,
    'x-org-id': c.orgId,
    'x-branch-id': c.branchId,
    ...extra,
  });

  try {
    /* --- identity: sign in if the fixture already exists ---------------- */
    let token = '';
    const login = await request(app).post('/api/auth/login').send({ email: OWNER.email, password: OWNER.password });
    if (login.status === 200 && login.body?.token) {
      token = login.body.token;
      log('signed in as the existing UI QA owner');
    } else {
      const signup = await request(app).post('/api/auth/signup').send(OWNER);
      if (signup.status !== 200) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
      token = signup.body.token;
      log('created the UI QA owner');
    }

    /* --- the company ---------------------------------------------------- */
    /* A membership carries `orgId`, not `id` — `id` belongs to the nested org
       object. Reading the wrong one made the fixture think it had no company
       and try to create a second one, which the unique name rightly refused. */
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    const mine = (me.body?.orgs || []) as Array<{ orgId: string; org?: { name?: string } }>;
    let orgId = String(mine.find((m) => m.org?.name === COMPANY)?.orgId || mine[0]?.orgId || '');
    let branchId = '';

    if (!orgId) {
      const setup = await request(app)
        .post('/api/auth/setup-company')
        .set('Authorization', `Bearer ${token}`)
        .send({ companyName: COMPANY, state: 'Karnataka' });
      if (setup.status !== 200) throw new Error(`setup-company failed: ${setup.status} ${JSON.stringify(setup.body)}`);
      orgId = String(setup.body.company.orgId);
      branchId = String(setup.body.branch.id);
      log(`created ${COMPANY}`);
    } else {
      log(`reusing ${COMPANY}`);
    }

    /*
     * The one read that does not go through the API, and it has to be.
     *
     * Every org-scoped route requires `x-branch-id` — including the route that
     * lists branches — so on a re-run there is no way to ask the API which
     * branch to work in. The bootstrap reads it directly; every WRITE below
     * still goes through HTTP, which is the part that matters.
     */
    if (!branchId) {
      const first = await platformPrisma.branch.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      branchId = String(first?.id || '');
      if (!branchId) throw new Error('no branch found for the QA organisation');
    }
    const ctx: Ctx = { token, orgId, branchId };

    /* --- structure ------------------------------------------------------ */
    const post = async (path: string, body: unknown, label: string) => {
      const res = await request(app).post(`/api/orgs/${orgId}${path}`).set(auth(ctx)).send(body as object);
      if (res.status >= 400) {
        /* A duplicate on a second run is the fixture being idempotent, not a
           failure. Anything else is worth seeing. */
        const dup = /exist|duplicate|unique|already/i.test(JSON.stringify(res.body || ''));
        if (!dup) console.warn(`    ! ${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 140)}`);
        return null;
      }
      return res.body;
    };

    const existing = async (path: string, key: string) => {
      const res = await request(app).get(`/api/orgs/${orgId}${path}`).set(auth(ctx));
      const rows = (res.body?.[key] || []) as Array<{ id: string; name?: string }>;
      return new Map(rows.map((r) => [String(r.name || '').trim().toLowerCase(), r]));
    };

    const haveBranches = await existing('/branches', 'branches');
    for (const b of [
      { branchName: 'Bengaluru Branch', branchCode: 'BLR', addressLine1: '44 Residency Road', city: 'Bengaluru', state: 'Karnataka', country: 'India' },
    ]) {
      if (haveBranches.has(b.branchName.toLowerCase())) continue;
      await post('/branches', b, `branch ${b.branchName}`);
    }

    /* A warehouse belongs to a branch; the schema requires it. */
    const haveWh = await existing('/warehouses', 'warehouses');
    for (const w of [{ name: 'Main Warehouse' }, { name: 'Secondary Warehouse' }]) {
      if (haveWh.has(w.name.toLowerCase())) continue;
      await post('/warehouses', { ...w, branchId }, `warehouse ${w.name}`);
    }
    log('branches and warehouses');

    /* --- parties -------------------------------------------------------- */
    const haveCust = await existing('/customers', 'customers');
    for (const c of CUSTOMERS) {
      if (haveCust.has(c.name.toLowerCase())) continue;
      await post('/customers', { ...c, billingAddress: '12 Industrial Layout, Bengaluru 560058' }, `customer ${c.name}`);
    }
    const haveVend = await existing('/vendors', 'vendors');
    for (const v of VENDORS) {
      if (haveVend.has(v.name.toLowerCase())) continue;
      await post('/vendors', { ...v, billingAddress: '8 Peenya Industrial Area, Bengaluru 560058' }, `vendor ${v.name}`);
    }
    log(`${CUSTOMERS.length} customers, ${VENDORS.length} vendors — one of each deliberately long`);

    /* --- items ---------------------------------------------------------- */
    const haveItems = await existing('/items', 'items');
    for (const i of ITEMS) {
      if (haveItems.has(i.name.toLowerCase())) continue;
      await post('/items', i, `item ${i.name}`);
    }
    log(`${ITEMS.length} items`);

    /* --- ledgers -------------------------------------------------------- */
    await post('/ledger/setup', {}, 'chart of accounts');
    log('chart of accounts');

    /* --- features: broad, because the point is interface coverage ------- */
    /* `features` is a map of key → boolean, not a list. */
    const cat = await request(app).get(`/api/orgs/${orgId}/features`).set(auth(ctx));
    const keys = Object.keys((cat.body?.features || {}) as Record<string, boolean>);
    if (keys.length) {
      const all: Record<string, boolean> = {};
      for (const k of keys) all[k] = true;
      await request(app).put(`/api/orgs/${orgId}/features`).set(auth(ctx)).send({ features: all });
      log(`${keys.length} features switched on for coverage`);
    }

    /* --- documents ------------------------------------------------------ */
    const custRows = await existing('/customers', 'customers');
    const customers = [...custRows.values()];
    const vendRows = await existing('/vendors', 'vendors');
    const vendors = [...vendRows.values()];

    const invRes = await request(app).get(`/api/orgs/${orgId}/invoices`).set(auth(ctx));
    const already = (invRes.body?.invoices || []).length;

    if (already < INVOICE_TOTALS.length) {
      for (let n = 0; n < INVOICE_TOTALS.length; n += 1) {
        const total = INVOICE_TOTALS[n];
        const subtotal = Math.round((total / 1.18) * 100) / 100;
        const gst = Math.round((total - subtotal) * 100) / 100;
        const cust = customers[n % customers.length];
        const item = ITEMS[n % ITEMS.length];
        await post(
          '/invoices',
          {
            number: `UIQA-INV-${String(n + 1).padStart(3, '0')}`,
            date: `2026-0${(n % 9) + 1}-1${n % 9}`,
            customerId: cust?.id,
            customerName: cust?.name,
            subtotal,
            cgstTotal: Math.round((gst / 2) * 100) / 100,
            sgstTotal: Math.round((gst / 2) * 100) / 100,
            gstTotal: gst,
            total,
            status: STATUSES[n % STATUSES.length],
            items: [{ description: item.name, quantity: 1, rate: subtotal, gstRate: 18, amount: subtotal }],
          },
          `invoice ${n + 1}`
        );
      }
      log(`${INVOICE_TOTALS.length} invoices — ₹0 to ₹1,24,58,230, across every status`);
    } else {
      log('invoices already present');
    }

    console.log('\n  Done. Sign in at the dev server with:');
    console.log(`    ${OWNER.email} / ${OWNER.password}\n`);
  } finally {
    await new Promise<void>((done) => app.close(() => done()));
  }
};

run().catch((e) => {
  console.error('\n  Seed failed:', e?.message || e, '\n');
  process.exit(1);
});
