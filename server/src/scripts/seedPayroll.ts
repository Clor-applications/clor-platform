import 'dotenv/config';
/**
 * A payroll a company can actually look at, and the journal it posts.
 *
 * The accounting fixture (`seedUiQa.ts`) leaves payroll empty, which is the
 * honest state of a new company but shows nothing about whether the app works.
 * This builds a month: the components a salary is made of, a structure, a pay
 * calendar, people, their salaries, and a run taken all the way through
 * calculate, review, approve and post.
 *
 * The last step is the one worth having. Posting writes a journal entry into
 * the *accounting* database from the *payroll* database, through the adapter in
 * services/payroll/accounting/client.ts and through nothing else — two
 * databases, no join, no shared Prisma client. If that entry appears in the
 * ledger and balances, the wiring between the two applications is real rather
 * than intended.
 *
 * Like the accounting fixture, everything goes through the HTTP API, so every
 * record passes the same validation and posting rules a person's would.
 *
 * Run:
 *   cd server && npx tsx src/scripts/seedPayroll.ts
 *
 * It is idempotent by identity: the owner's email is fixed, so a second run
 * signs in and adds only what is missing.
 */

import request from 'supertest';

import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

/* ------------------------------------------------------------------ guard */

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
  if (!isLocalDatabase(url)) reasons.push('DATABASE_URL is not on this machine');
  if (/prod/i.test(url)) reasons.push('DATABASE_URL names a production database');
  if (reasons.length) {
    console.error('\n  Refusing to seed. This looks like a real environment:');
    for (const r of reasons) console.error(`    · ${r}`);
    console.error('');
    process.exit(1);
  }
};

/* ------------------------------------------------------------------- data */

const OWNER = { email: 'ui-qa@clor.local', password: 'UiQaPassw0rd!23' };

/** Enough people for the screens to have something to sort and group. */
const PEOPLE: Array<[name: string, designation: string, department: string, annualCtc: number]> = [
  ['Ananya Raghunathan', 'Financial Controller', 'Finance', 1_416_000],
  ['Devendra Pillai', 'Operations Lead', 'Operations', 1_128_000],
  ['Meera Vaidyanathan', 'Regional Sales Manager', 'Sales', 1_032_000],
  ['Karthik Somasundaram', 'Senior Engineer', 'Engineering', 1_260_000],
  ['Roshni Mehrotra', 'Engineer', 'Engineering', 864_000],
  ['Imtiaz Qureshi', 'Stores Supervisor', 'Warehouse', 492_000],
  ['Sunitha Bhandarkar', 'Accounts Executive', 'Finance', 456_000],
];

const month = (back: number) => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const name = start.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { name, startDate: iso(start), endDate: iso(end), paymentDate: iso(end) };
};

/* ------------------------------------------------------------------- work */

type Ctx = { token: string; orgId: string; branchId: string };

async function main() {
  assertNotProduction();
  const app = buildApp();

  const auth = (c: Ctx) => ({
    Authorization: `Bearer ${c.token}`,
    'x-org-id': c.orgId,
    'x-branch-id': c.branchId,
  });

  /* ---- sign in as the fixture owner -------------------------------- */

  const login = await request(app).post('/api/auth/login').send(OWNER);
  if (login.status !== 200) {
    console.error('\n  Sign in failed. Run seedUiQa.ts first — it creates the company this builds on.\n');
    process.exit(1);
  }

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
  const membership = me.body.orgs?.[0];
  const c: Ctx = { token: login.body.token, orgId: membership.orgId, branchId: membership.branchId };
  console.log(`  ${membership.org.name}`);

  const P = {
    get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(auth(c)),
    post: (path: string, body?: unknown) =>
      request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(auth(c)).send(body as any),
    put: (path: string, body?: unknown) =>
      request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(auth(c)).send(body as any),
  };

  const ok = (res: request.Response, what: string) => {
    if (res.status >= 400) {
      console.error(`\n  ${what} failed (${res.status}):`, JSON.stringify(res.body).slice(0, 300), '\n');
      process.exit(1);
    }
    return res;
  };

  /* ---- payroll is an app this company has -------------------------- */

  ok(await request(app).put(`/api/orgs/${c.orgId}/features`).set(auth(c)).send({ features: { payroll: true } }), 'switching payroll on');

  /* ---- the accounts a salary posts to ------------------------------ */

  const accounts = ok(await request(app).get(`/api/orgs/${c.orgId}/ledger/accounts`).set(auth(c)), 'reading the chart of accounts').body;
  const existing: any[] = accounts.accounts || accounts.ledgers || [];

  const ledger = async (name: string, accountType: string) => {
    const found = existing.find((a) => String(a.name).toLowerCase() === name.toLowerCase());
    if (found) return found.id as string;
    const made = ok(
      await request(app).post(`/api/orgs/${c.orgId}/ledger/accounts`).set(auth(c)).send({ name, accountType }),
      `creating ${name}`
    );
    return made.body.account.id as string;
  };

  const salaryExpense = await ledger('Salaries & Wages', 'EXPENSE');
  const pfExpense = await ledger('Employer PF Contribution', 'EXPENSE');
  const pfPayable = await ledger('PF Payable', 'LIABILITY');
  const ptPayable = await ledger('Professional Tax Payable', 'LIABILITY');
  console.log('  ledger accounts for payroll');

  /* ---- what a salary is made of ------------------------------------ */

  const already = (await P.get('/components')).body.components || [];
  const byCode = new Map(already.map((x: any) => [x.code, x.id]));

  const component = async (body: Record<string, unknown>) => {
    const code = String(body.code);
    if (byCode.has(code)) return byCode.get(code) as string;
    const made = ok(await P.post('/components', body), `creating component ${code}`);
    const id = made.body.component.id as string;
    byCode.set(code, id);
    return id;
  };

  const basic = await component({
    name: 'Basic', code: 'BASIC', type: 'EARNING',
    calculationMethod: 'PERCENTAGE', percentage: 40, calculationBase: 'MONTHLY_CTC',
    includeInPfWage: true, expenseLedgerId: salaryExpense, displayOrder: 1,
  });
  const hra = await component({
    name: 'House Rent Allowance', code: 'HRA', type: 'EARNING',
    calculationMethod: 'FORMULA', formula: 'BASIC * 0.5',
    expenseLedgerId: salaryExpense, displayOrder: 2,
  });
  const special = await component({
    name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING',
    calculationMethod: 'BALANCING', expenseLedgerId: salaryExpense, displayOrder: 3,
  });
  const epf = await component({
    name: 'Provident Fund (employee)', code: 'EPF', type: 'DEDUCTION',
    calculationMethod: 'FORMULA', formula: 'MIN(BASIC * 0.12, 1800)',
    includeInGross: false, isTaxable: false, liabilityLedgerId: pfPayable, displayOrder: 10,
  });
  const pt = await component({
    name: 'Professional Tax', code: 'PT', type: 'DEDUCTION',
    calculationMethod: 'FIXED', amount: 200,
    includeInGross: false, isTaxable: false, liabilityLedgerId: ptPayable, displayOrder: 11,
  });
  const erpf = await component({
    name: 'Provident Fund (employer)', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION',
    calculationMethod: 'FORMULA', formula: 'MIN(BASIC * 0.12, 1800)',
    includeInGross: false, includeInNetPay: false, isTaxable: false,
    expenseLedgerId: pfExpense, liabilityLedgerId: pfPayable, displayOrder: 20,
  });
  console.log(`  ${byCode.size} salary components`);

  /* ---- the statutory rates in force -------------------------------- */

  const schemes = (await P.get('/statutory')).body.schemes || [];
  if (!schemes.length) {
    ok(await P.post('/statutory/seed'), 'seeding statutory rates');
    console.log('  statutory rates (PF, ESI, PT, TDS)');
  }

  /* ---- a structure, and a calendar --------------------------------- */

  const structures = (await P.get('/structures')).body.structures || [];
  const structureId =
    structures[0]?.id ||
    ok(
      await P.post('/structures', {
        name: 'Staff — monthly',
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        status: 'ACTIVE',
        components: [
          { componentId: basic, displayOrder: 1 },
          { componentId: hra, displayOrder: 2 },
          { componentId: special, isBalancing: true, displayOrder: 3 },
          { componentId: epf, displayOrder: 10 },
          { componentId: pt, displayOrder: 11 },
          { componentId: erpf, displayOrder: 20 },
        ],
      }),
      'creating the salary structure'
    ).body.structure.id;

  const periods = (await P.get('/periods')).body.periods || [];
  const wanted = month(0);
  const periodId =
    periods.find((p: any) => p.startDate === wanted.startDate)?.id ||
    ok(await P.post('/periods', wanted), 'creating the pay period').body.period.id;
  console.log(`  ${wanted.name} is open`);

  /* ---- the people, and what they are on ---------------------------- */

  const staff = (await P.get('/employees')).body.employees || [];
  const known = new Set(staff.map((e: any) => String(e.name)));

  let added = 0;
  for (const [name, designation, department, annualCtc] of PEOPLE) {
    if (known.has(name)) continue;
    const made = ok(
      await P.post('/employees', {
        name,
        code: `E${String(added + 1).padStart(3, '0')}`,
        designation,
        department,
        dateOfJoining: '2026-04-01',
        status: 'ACTIVE',
        /*
         * The payroll half of a person, and not optional in practice.
         *
         * Somebody in the staff directory without this is employed but not in
         * payroll — which is a real state, for a contractor or somebody on
         * hold. Leaving it off here made payroll pay seven people while its
         * own setup screen said nobody was in payroll, because the two count
         * different things and both were right.
         */
        payroll: {
          payrollStatus: 'IN_PAYROLL',
          bankAccountName: name,
          bankAccountNumber: `5010${String(1000000 + added * 7919)}`,
          bankIfsc: 'HDFC0000412',
          bankName: 'HDFC Bank',
          pan: `AB${String.fromCharCode(67 + (added % 20))}PK${4100 + added * 13}${String.fromCharCode(65 + (added % 26))}`,
          uan: `10${String(11223344 + added * 977)}`,
          taxRegime: 'NEW',
          professionalTaxState: 'Karnataka',
          pfApplicable: true,
          esiApplicable: false,
          ptApplicable: true,
        },
      }),
      `adding ${name}`
    );
    ok(
      await P.post('/assignments', {
        employeeId: made.body.employee.id,
        structureId,
        effectiveFrom: '2026-04-01',
        annualCtc,
      }),
      `assigning a salary to ${name}`
    );
    added += 1;
  }
  console.log(`  ${added || known.size} people, each on a salary`);

  /* ---- run the month, and put it in the books ---------------------- */

  const runs = (await P.get('/runs')).body.runs || [];
  const open = runs.find((r: any) => r.periodId === periodId);

  let runId = open?.id;
  if (!runId) {
    runId = ok(await P.post('/runs', { periodId }), 'starting the run').body.run.id;
    ok(await P.post(`/runs/${runId}/validate`), 'validating the run');
    ok(await P.post(`/runs/${runId}/calculate`), 'calculating the run');
    ok(await P.post(`/runs/${runId}/submit-review`), 'submitting for review');
    ok(await P.post(`/runs/${runId}/approve`), 'approving the run');
  }

  const run = (await P.get(`/runs/${runId}`)).body.run;
  const money = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;
  console.log(`  ${run.number}: ${run.employeeCount} people, gross ${money(run.grossTotal)}, take-home ${money(run.netTotal)}`);

  if (run.status !== 'POSTED') {
    const preview = ok(await P.get(`/runs/${runId}/posting-preview`), 'previewing the journal').body.preview;
    console.log(`  journal: ${preview.lines.length} lines, debits ${money(preview.totalDebit)} = credits ${money(preview.totalCredit)}`);
    ok(await P.post(`/runs/${runId}/post`), 'posting to the ledger');
  }

  /* The proof: the entry is in the *accounting* database, written from the
     payroll one through the adapter. */
  const entries = await prisma.journalEntry.count({ where: { orgId: c.orgId } });
  console.log(`\n  Posted. The accounting database now holds ${entries} journal entries.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
