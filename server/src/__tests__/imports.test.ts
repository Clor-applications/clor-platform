import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { parseCsv, toCsv } from '../services/csv.js';
import { prisma } from '../utils/prisma.js';

/**
 * Requirements 15 and 16: importing documents, and a downloadable template.
 *
 * The behaviour worth protecting is that nothing is written until the operator
 * has been shown what is wrong, that a bad row does not stop the good ones, and
 * that a journal which does not balance can never reach the ledger.
 */

/**
 * One listening server for the whole file, not one per request.
 *
 * supertest given an Express app binds a fresh ephemeral-port listener for
 * every single request; a run makes thousands of listen/close cycles, and
 * the suite's residual flake was a raw Node-level 400 "Bad Request" that
 * never reached Express (absent from both morgan and the anomaly log) —
 * socket churn, not application behaviour. Given an already-listening
 * server, supertest reuses it.
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `imp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Import owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Import Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

const setFeature = async (key: string, enabled: boolean) => {
  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  const features = { ...(current.body.features || {}), [key]: enabled };
  await request(app).put(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).send({ features }).expect(200);
};

const stage = (docType: string, csv: string) =>
  request(app).post(`/api/orgs/${owner.orgId}/imports`).set(auth(owner)).send({ docType, csv });

const validate = (batchId: string) =>
  request(app).post(`/api/orgs/${owner.orgId}/imports/${batchId}/validate`).set(auth(owner));

const commit = (batchId: string) =>
  request(app).post(`/api/orgs/${owner.orgId}/imports/${batchId}/commit`).set(auth(owner));

/** Two ledger codes that exist in every org's default chart. */
let cashCode = '';
let salesCode = '';

beforeAll(async () => {
  owner = await makeOwner();
  await setFeature('imports', true);

  // Touch the ledger so the default chart exists, then read real codes from it.
  await request(app).get(`/api/orgs/${owner.orgId}/ledger/trial-balance`).set(auth(owner)).expect(200);
  const accounts = await request(app).get(`/api/orgs/${owner.orgId}/ledger/accounts`).set(auth(owner)).expect(200);
  const rows = accounts.body.accounts as Array<{ code: string; controlKind: string | null }>;
  cashCode = rows.find((a) => a.controlKind === 'CASH')!.code;
  salesCode = rows.find((a) => a.controlKind === 'SALES')!.code;
}, 60_000);

describe('the CSV reader', () => {
  it('keeps commas and newlines that live inside quoted fields', () => {
    const { headers, rows } = parseCsv('name,note\n"Acme, Ltd","line one\nline two"\n');
    expect(headers).toEqual(['name', 'note']);
    expect(rows[0].name).toBe('Acme, Ltd');
    expect(rows[0].note).toBe('line one\nline two');
  });

  it('reads an escaped quote as a single quote', () => {
    const { rows } = parseCsv('name\n"He said ""hello"""\n');
    expect(rows[0].name).toBe('He said "hello"');
  });

  it('treats headers case- and space-insensitively', () => {
    const { rows } = parseCsv(' Invoice No , Date \nINV-1,2026-04-01\n');
    expect(rows[0]['invoice no']).toBe('INV-1');
  });

  it('survives CRLF line endings', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('round-trips a value that needs quoting', () => {
    const csv = toCsv(['name'], [{ name: 'A, "B"' }]);
    expect(parseCsv(csv).rows[0].name).toBe('A, "B"');
  });
});

describe('templates', () => {
  it('offers a journal template whose sample actually balances', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/imports/template/JOURNAL`)
      .set(auth(owner))
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const { headers, rows } = parseCsv(res.text);
    expect(headers).toContain('entry_ref');
    expect(headers).toContain('debit');

    const debit = rows.reduce((s, r) => s + Number(r.debit || 0), 0);
    const credit = rows.reduce((s, r) => s + Number(r.credit || 0), 0);
    expect(debit).toBe(credit);
  });

  it('offers a bill template now that bills exist on the server', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/imports/template/BILL`)
      .set(auth(owner))
      .expect(200);

    const { headers } = parseCsv(res.text);
    expect(headers).toContain('bill_no');
    expect(headers).toContain('vendor_name');
  });

  it('still refuses a document type that does not exist at all', async () => {
    await request(app)
      .get(`/api/orgs/${owner.orgId}/imports/template/NONSENSE`)
      .set(auth(owner))
      .expect(400);
  });
});

describe('staging', () => {
  it('names the missing columns rather than repeating an error on every row', async () => {
    const res = await stage('JOURNAL', 'entry_ref,date\nJV-1,2026-04-01\n').expect(400);
    expect(String(res.body.error)).toMatch(/account_code/);
  });

  it('rejects a file with headers but no rows', async () => {
    await stage('JOURNAL', 'entry_ref,date,account_code,debit,credit\n').expect(400);
  });

  it('numbers rows the way the file does, so an error points at the right line', async () => {
    const csv = `entry_ref,date,account_code,debit,credit\nJV-A,2026-04-01,${cashCode},100,\nJV-A,2026-04-01,${salesCode},,100\n`;
    const staged = await stage('JOURNAL', csv).expect(201);
    const detail = await request(app)
      .get(`/api/orgs/${owner.orgId}/imports/${staged.body.batch.id}`)
      .set(auth(owner))
      .expect(200);
    expect(detail.body.rows.map((r: any) => r.rowNumber)).toEqual([2, 3]);
  });
});

describe('journal import', () => {
  it('refuses to commit before validation has run', async () => {
    const csv = `entry_ref,date,account_code,debit,credit\nJV-N,2026-04-01,${cashCode},50,\nJV-N,2026-04-01,${salesCode},,50\n`;
    const staged = await stage('JOURNAL', csv).expect(201);
    const res = await commit(staged.body.batch.id).expect(400);
    expect(String(res.body.error)).toMatch(/validate/i);
  });

  it('reports an entry that does not balance, and writes nothing', async () => {
    const csv = `entry_ref,date,account_code,debit,credit\nJV-BAD,2026-04-01,${cashCode},100,\nJV-BAD,2026-04-01,${salesCode},,90\n`;
    const staged = await stage('JOURNAL', csv).expect(201);
    const res = await validate(staged.body.batch.id).expect(200);

    expect(res.body.batch.errorRows).toBe(2);
    expect(res.body.batch.validRows).toBe(0);
    expect(String(res.body.issues[0].error)).toMatch(/does not balance/i);

    const done = await commit(staged.body.batch.id).expect(200);
    expect(done.body.committed).toBe(0);
  });

  it('rejects a line carrying both a debit and a credit', async () => {
    const csv = `entry_ref,date,account_code,debit,credit\nJV-BOTH,2026-04-01,${cashCode},100,100\nJV-BOTH,2026-04-01,${salesCode},,100\n`;
    const staged = await stage('JOURNAL', csv).expect(201);
    const res = await validate(staged.body.batch.id).expect(200);
    expect(res.body.issues.some((i: any) => /either a debit or a credit/i.test(i.error))).toBe(true);
  });

  it('rejects an unknown account code by name', async () => {
    const csv = `entry_ref,date,account_code,debit,credit\nJV-UNK,2026-04-01,NOPE,100,\nJV-UNK,2026-04-01,${salesCode},,100\n`;
    const staged = await stage('JOURNAL', csv).expect(201);
    const res = await validate(staged.body.batch.id).expect(200);
    expect(res.body.issues.some((i: any) => /no ledger account with code "NOPE"/i.test(i.error))).toBe(true);
  });

  it('commits a balanced entry and moves the trial balance by it', async () => {
    const before = await request(app)
      .get(`/api/orgs/${owner.orgId}/ledger/trial-balance`)
      .set(auth(owner))
      .expect(200);

    const csv = `entry_ref,date,narration,account_code,debit,credit\nJV-OK,2026-04-01,Imported opening,${cashCode},750,\nJV-OK,2026-04-01,Imported opening,${salesCode},,750\n`;
    const staged = await stage('JOURNAL', csv).expect(201);
    await validate(staged.body.batch.id).expect(200);
    const done = await commit(staged.body.batch.id).expect(200);

    expect(done.body.committed).toBe(2);
    expect(done.body.failures).toHaveLength(0);

    const after = await request(app)
      .get(`/api/orgs/${owner.orgId}/ledger/trial-balance`)
      .set(auth(owner))
      .expect(200);

    expect(after.body.totals.debit - before.body.totals.debit).toBe(750);
    expect(after.body.totals.balanced).toBe(true);
  });

  it('lets the good entries through while holding back the bad one', async () => {
    const csv = [
      'entry_ref,date,account_code,debit,credit',
      `GOOD,2026-04-02,${cashCode},200,`,
      `GOOD,2026-04-02,${salesCode},,200`,
      `BAD,2026-04-02,${cashCode},300,`,
      `BAD,2026-04-02,${salesCode},,250`,
    ].join('\n');

    const staged = await stage('JOURNAL', csv).expect(201);
    const validated = await validate(staged.body.batch.id).expect(200);
    expect(validated.body.batch.validRows).toBe(2);
    expect(validated.body.batch.errorRows).toBe(2);

    const done = await commit(staged.body.batch.id).expect(200);
    expect(done.body.committed).toBe(2);
  });

  it('does not write the same rows twice when a commit is repeated', async () => {
    const csv = `entry_ref,date,account_code,debit,credit\nJV-TWICE,2026-04-03,${cashCode},400,\nJV-TWICE,2026-04-03,${salesCode},,400\n`;
    const staged = await stage('JOURNAL', csv).expect(201);
    await validate(staged.body.batch.id).expect(200);
    await commit(staged.body.batch.id).expect(200);

    const before = await request(app)
      .get(`/api/orgs/${owner.orgId}/ledger/trial-balance`)
      .set(auth(owner))
      .expect(200);

    const again = await commit(staged.body.batch.id).expect(200);
    expect(again.body.committed).toBe(0);

    const after = await request(app)
      .get(`/api/orgs/${owner.orgId}/ledger/trial-balance`)
      .set(auth(owner))
      .expect(200);
    expect(after.body.totals.debit).toBe(before.body.totals.debit);
  });
});

describe('invoice import', () => {
  it('keeps the historical number and totals the lines', async () => {
    const num = `OLD-${rnd().toUpperCase()}`;
    const csv = [
      'invoice_no,date,customer_name,description,quantity,rate,gst_rate',
      `${num},2026-04-04,"Acme, Ltd",Consulting,2,1000,18`,
      `${num},2026-04-04,"Acme, Ltd",Support,1,500,18`,
    ].join('\n');

    const staged = await stage('INVOICE', csv).expect(201);
    await validate(staged.body.batch.id).expect(200);
    const done = await commit(staged.body.batch.id).expect(200);
    expect(done.body.committed).toBe(2);

    const list = await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).expect(200);
    const found = list.body.invoices.find((i: any) => i.number === num);

    expect(found).toBeTruthy();
    // 2500 net + 18% = 2950, and the quoted comma in the name survived.
    expect(Number(found.total)).toBeCloseTo(2950, 2);
    expect(found.customerName).toBe('Acme, Ltd');
  });

  it('carries the columns the creation form has: due date, refs, unit, HSN and a line discount', async () => {
    const num = `EXT-${rnd().toUpperCase()}`;
    const csv = [
      'invoice_no,date,customer_name,description,quantity,rate,gst_rate,due_date,item_code,unit,hsn_sac,discount_pct,ref_no,ref_date,place_of_supply',
      `${num},2026-04-04,Acme,Consulting,2,1000,18,2026-05-04,FG-100,Hrs,9983,10,SO-77,2026-04-01,Karnataka`,
    ].join('\n');

    const staged = await stage('INVOICE', csv).expect(201);
    await validate(staged.body.batch.id).expect(200);
    await commit(staged.body.batch.id).expect(200);

    const list = await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).expect(200);
    const found = list.body.invoices.find((i: any) => i.number === num);
    expect(found).toBeTruthy();

    expect(found.dueDate).toBe('2026-05-04');
    expect(found.refNo).toBe('SO-77');
    expect(found.refDate).toBe('2026-04-01');
    expect(found.placeOfSupplyState).toBe('Karnataka');

    // 2 x 1000 less 10% is 1800 taxable, plus 18% is 2124. Importing without
    // the discount column brought every discounted historical line in at list
    // price, which is the figure this pins.
    expect(Number(found.total)).toBeCloseTo(2124, 2);

    // The list endpoint does not carry line JSON, so the lines are read from
    // the row itself.
    const row = await prisma.invoice.findFirst({ where: { number: num }, select: { itemsJson: true } });
    const line = JSON.parse(String(row?.itemsJson || '[]'))[0];
    expect(line.unit).toBe('Hrs');
    expect(line.hsnSac).toBe('9983');
    expect(line.itemCode).toBe('FG-100');
    expect(line.discountPct).toBe(10);
  });

  it('rejects a quantity that is not a number', async () => {
    const csv =
      'invoice_no,date,customer_name,description,quantity,rate,gst_rate\nBADQ,2026-04-05,Acme,Consulting,many,1000,18\n';
    const staged = await stage('INVOICE', csv).expect(201);
    const res = await validate(staged.body.batch.id).expect(200);
    expect(String(res.body.issues[0].error)).toMatch(/quantity/i);
  });
});

describe('the imports feature switch', () => {
  it('turns importing off', async () => {
    await setFeature('imports', false);
    try {
      const res = await stage('JOURNAL', 'entry_ref,date,account_code,debit,credit\nX,2026-04-01,1,1,\n').expect(400);
      expect(String(res.body.error)).toMatch(/switched off/i);
    } finally {
      await setFeature('imports', true);
    }
  });
});
