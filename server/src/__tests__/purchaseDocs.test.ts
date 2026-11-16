import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * Bills, credit notes and debit notes, and importing them — requirement 15.
 *
 * Each of these moves the books in a specific direction. The tests assert the
 * direction and the account, because a document type that posts the wrong way
 * still balances and still looks fine in the list.
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
const app = buildApp().listen(0, '127.0.0.1');
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
  const email = `pd.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Docs owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Docs Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

const setFeature = async (key: string, enabled: boolean) => {
  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  const features = { ...(current.body.features || {}), [key]: enabled };
  await request(app).put(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).send({ features }).expect(200);
};

const tb = async () => {
  const res = await request(app).get(`/api/orgs/${owner.orgId}/ledger/trial-balance`).set(auth(owner)).expect(200);
  return res.body;
};

/** Net movement on a control account: debit positive. */
const net = (body: any, controlKind: string) => {
  const row = body.rows.find((r: any) => r.controlKind === controlKind);
  return row ? Math.round((Number(row.debit || 0) - Number(row.credit || 0)) * 100) / 100 : 0;
};

const moved = (before: any, after: any, kind: string) =>
  Math.round((net(after, kind) - net(before, kind)) * 100) / 100;

const docBody = (over: Record<string, unknown> = {}) => ({
  date: '2026-04-10',
  partyName: 'Supplier Co',
  subtotal: 1000,
  cgstTotal: 90,
  sgstTotal: 90,
  igstTotal: 0,
  gstTotal: 180,
  total: 1180,
  items: [{ description: 'Material', quantity: 1, rate: 1000, gstRate: 18 }],
  ...over,
});

beforeAll(async () => {
  owner = await makeOwner();
  await setFeature('imports', true);
  await setFeature('creditNotes', true);
  await setFeature('debitNotes', true);
}, 60_000);

describe('purchase bills', () => {
  it('debits purchases and input GST, and credits the vendor', async () => {
    const before = await tb();
    await request(app).post(`/api/orgs/${owner.orgId}/bills`).set(auth(owner)).send(docBody()).expect(201);
    const after = await tb();

    expect(moved(before, after, 'PURCHASES')).toBe(1000);
    expect(moved(before, after, 'CGST_IN')).toBe(90);
    expect(moved(before, after, 'SGST_IN')).toBe(90);
    // Credit to the vendor shows as a negative net debit.
    expect(moved(before, after, 'AP')).toBe(-1180);
    expect(after.totals.balanced).toBe(true);
  });

  /* The specification's entry: Dr Purchases + Input GST; Cr TDS Payable;
     Cr Vendor NET of the deduction. One validated posting through the
     central service — no balance is touched by hand anywhere. */
  it('splits the credit between TDS Payable and the vendor when the bill deducts', async () => {
    const before = await tb();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/bills`)
      .set(auth(owner))
      .send(docBody({ date: '2026-04-15', tdsAmount: 20 }))
      .expect(201);
    const after = await tb();

    expect(moved(before, after, 'PURCHASES')).toBe(1000);
    expect(moved(before, after, 'TDS_PAYABLE')).toBe(-20);
    /* The vendor is owed the total less what the department is owed. */
    expect(moved(before, after, 'AP')).toBe(-1160);
    expect(after.totals.balanced).toBe(true);
  });

  it('allocates its own number when none is supplied', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/bills`)
      .set(auth(owner))
      .send(docBody({ date: '2026-04-11' }))
      .expect(201);
    expect(String(res.body.document.number)).toMatch(/\w/);
  });

  it('reverses the posting when the bill is removed, rather than editing history', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/bills`)
      .set(auth(owner))
      .send(docBody({ date: '2026-04-12' }))
      .expect(201);

    const before = await tb();
    const del = await request(app)
      .delete(`/api/orgs/${owner.orgId}/bills/${created.body.document.id}`)
      .set(auth(owner))
      .expect(200);
    const after = await tb();

    expect(del.body.reversedEntries).toBe(1);
    expect(moved(before, after, 'PURCHASES')).toBe(-1000);
    expect(moved(before, after, 'AP')).toBe(1180);
    expect(after.totals.balanced).toBe(true);
  });
});

describe('a bill changed more than once (audit, 17 Nov 2026)', () => {
  const bills = () => `/api/orgs/${owner.orgId}/bills`;
  const amended = (subtotal: number) => docBody({ date: '2026-04-14', subtotal, cgstTotal: subtotal * 0.09, sgstTotal: subtotal * 0.09, gstTotal: subtotal * 0.18, total: subtotal * 1.18, items: [{ description: 'Material', quantity: 1, rate: subtotal, gstRate: 18 }] });

  it('holds the last amount after a second edit, not the first amount again on top of it', async () => {
    const before = await tb();
    const created = await request(app).post(bills()).set(auth(owner)).send(amended(1000)).expect(201);
    const id = created.body.document.id;
    await request(app).patch(`${bills()}/${id}`).set(auth(owner)).send(amended(1200)).expect(200);
    /* The second edit found the first edit's reversal as "posted" and reversed that too, bringing the 1,000 back. */
    await request(app).patch(`${bills()}/${id}`).set(auth(owner)).send(amended(1300)).expect(200);
    const after = await tb();
    expect(moved(before, after, 'PURCHASES')).toBe(1300);
    expect(moved(before, after, 'AP')).toBe(-1534);
    expect(after.totals.balanced).toBe(true);

    /* And removed after being edited: nothing of it is left. */
    await request(app).delete(`${bills()}/${id}`).set(auth(owner)).expect(200);
    const gone = await tb();
    expect(moved(before, gone, 'PURCHASES')).toBe(0);
    expect(moved(before, gone, 'AP')).toBe(0);
    expect(gone.totals.balanced).toBe(true);
  }, 60_000);

  it('stays out of the books when it is cancelled and then removed', async () => {
    const before = await tb();
    const created = await request(app).post(bills()).set(auth(owner)).send(amended(1000)).expect(201);
    const id = created.body.document.id;
    await request(app).post(`${bills()}/${id}/cancel`).set(auth(owner)).expect(200);
    const cancelled = await tb();
    expect(moved(before, cancelled, 'PURCHASES')).toBe(0);
    await request(app).delete(`${bills()}/${id}`).set(auth(owner)).expect(200);
    const gone = await tb();
    expect(moved(before, gone, 'PURCHASES')).toBe(0);
    expect(moved(before, gone, 'AP')).toBe(0);
  }, 60_000);
});

describe('an invoice cancelled twice (audit, 17 Nov 2026)', () => {
  it('does not post the sale again when it is cancelled, put back and cancelled again', async () => {
    const before = await tb();
    const invoices = `/api/orgs/${owner.orgId}/invoices`;
    const created = await request(app)
      .post(invoices)
      .set(auth(owner))
      .send({ ...docBody({ date: '2026-04-15', partyName: 'Acme Ltd' }), customerName: 'Acme Ltd', status: 'Unpaid' })
      .expect(201);
    const id = created.body.invoice.id;
    const posted = await tb();
    expect(moved(before, posted, 'SALES')).toBe(-1000);
    const status = (next: string) => request(app).patch(`${invoices}/${id}/status`).set(auth(owner)).send({ status: next }).expect(200);
    await status('Cancelled');
    await status('Unpaid');
    await status('Cancelled');
    const after = await tb();
    expect(moved(before, after, 'SALES')).toBe(0);
    expect(moved(before, after, 'AR')).toBe(0);
    expect(after.totals.balanced).toBe(true);
  }, 60_000);
});

describe('credit notes', () => {
  it('reverses revenue and output GST, and credits the customer', async () => {
    const before = await tb();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/credit-notes`)
      .set(auth(owner))
      .send(docBody({ partyName: 'Acme Ltd', date: '2026-04-13' }))
      .expect(201);
    const after = await tb();

    // A sales return: revenue comes back down (a debit to SALES).
    expect(moved(before, after, 'SALES')).toBe(1000);
    expect(moved(before, after, 'CGST_OUT')).toBe(90);
    expect(moved(before, after, 'AR')).toBe(-1180);
    expect(after.totals.balanced).toBe(true);
  });
});

describe('debit notes', () => {
  it('debits the vendor and reverses purchases and input GST', async () => {
    const before = await tb();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/debit-notes`)
      .set(auth(owner))
      .send(docBody({ date: '2026-04-14' }))
      .expect(201);
    const after = await tb();

    expect(moved(before, after, 'AP')).toBe(1180);
    expect(moved(before, after, 'PURCHASES')).toBe(-1000);
    expect(moved(before, after, 'CGST_IN')).toBe(-90);
    expect(after.totals.balanced).toBe(true);
  });
});

describe('a note raised on account', () => {
  it('records what it was knocked off against without touching the books', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/debit-notes`)
      .set(auth(owner))
      .send(docBody({ date: '2026-04-15', settlementMode: 'ON_ACCOUNT', billIds: ['b1', 'b2'] }))
      .expect(201);

    const noteId = created.body.document.id;
    const before = await tb();

    const settled = await request(app)
      .patch(`/api/orgs/${owner.orgId}/debit-notes/${noteId}/settlement`)
      .set(auth(owner))
      .send({
        settlementMode: 'ON_ACCOUNT',
        billIds: ['b1', 'b2'],
        allocations: [
          { docId: 'b1', amount: 800, date: '2026-04-16' },
          { docId: 'b2', amount: 380, date: '2026-04-16' },
        ],
      })
      .expect(200);

    expect(settled.body.document.allocations).toHaveLength(2);
    expect(settled.body.document.settlementMode).toBe('ON_ACCOUNT');

    // Settlement is sub-ledger detail: no amount moved, so no account moved.
    const after = await tb();
    expect(moved(before, after, 'AP')).toBe(0);
    expect(moved(before, after, 'PURCHASES')).toBe(0);
    expect(after.totals.balanced).toBe(true);
  });

  it('refuses to allocate more than the note is worth', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/debit-notes`)
      .set(auth(owner))
      .send(docBody({ date: '2026-04-17', settlementMode: 'ON_ACCOUNT' }))
      .expect(201);

    const res = await request(app)
      .patch(`/api/orgs/${owner.orgId}/debit-notes/${created.body.document.id}/settlement`)
      .set(auth(owner))
      .send({ allocations: [{ docId: 'b1', amount: 99999 }] })
      .expect(400);

    expect(String(res.body.error)).toMatch(/more than this note is worth/i);
  });

  it('rejects an allocation with no amount', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/debit-notes`)
      .set(auth(owner))
      .send(docBody({ date: '2026-04-18', settlementMode: 'ON_ACCOUNT' }))
      .expect(201);

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/debit-notes/${created.body.document.id}/settlement`)
      .set(auth(owner))
      .send({ allocations: [{ docId: 'b1', amount: 0 }] })
      .expect(400);
  });
});

describe('importing the new document types', () => {
  const runImport = async (docType: string, csv: string) => {
    const staged = await request(app)
      .post(`/api/orgs/${owner.orgId}/imports`)
      .set(auth(owner))
      .send({ docType, csv })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/imports/${staged.body.batch.id}/validate`)
      .set(auth(owner))
      .expect(200);
    return request(app)
      .post(`/api/orgs/${owner.orgId}/imports/${staged.body.batch.id}/commit`)
      .set(auth(owner))
      .expect(200);
  };

  it('no longer refuses bills and notes', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/imports/specs`).set(auth(owner)).expect(200);
    const types = res.body.specs.map((s: any) => s.docType);
    expect(types).toEqual(expect.arrayContaining(['INVOICE', 'JOURNAL', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE']));
    expect(res.body.unsupported).toHaveLength(0);
  });

  it('imports a bill and posts it to the ledger', async () => {
    const before = await tb();
    const num = `IMPB-${rnd().toUpperCase()}`;
    const csv = [
      'bill_no,date,vendor_name,description,quantity,rate,gst_rate,tax_type',
      `${num},2026-04-15,Supplier Co,Material,1,1000,18,CGST_SGST`,
    ].join('\n');

    const done = await runImport('BILL', csv);
    expect(done.body.committed).toBe(1);

    const after = await tb();
    expect(moved(before, after, 'PURCHASES')).toBe(1000);
    expect(moved(before, after, 'AP')).toBe(-1180);
    expect(after.totals.balanced).toBe(true);
  });

  it('splits GST into CGST and SGST, or all to IGST when the file says inter-state', async () => {
    const before = await tb();
    const csv = [
      'bill_no,date,vendor_name,description,quantity,rate,gst_rate,tax_type',
      `IGSTB-${rnd().toUpperCase()},2026-04-16,Supplier Co,Material,1,1000,18,IGST`,
    ].join('\n');

    await runImport('BILL', csv);
    const after = await tb();

    expect(moved(before, after, 'IGST_IN')).toBe(180);
    expect(moved(before, after, 'CGST_IN')).toBe(0);
  });

  it('imports a credit note the right way round', async () => {
    const before = await tb();
    const csv = [
      'note_no,date,customer_name,description,quantity,rate,gst_rate,tax_type',
      `IMPCN-${rnd().toUpperCase()},2026-04-17,Acme Ltd,Returned goods,1,1000,18,CGST_SGST`,
    ].join('\n');

    await runImport('CREDIT_NOTE', csv);
    const after = await tb();

    expect(moved(before, after, 'SALES')).toBe(1000);
    expect(moved(before, after, 'AR')).toBe(-1180);
  });

  it('posts an imported invoice to the ledger, not just into the list', async () => {
    const before = await tb();
    const csv = [
      'invoice_no,date,due_date,customer_name,item,description,quantity,rate,gst_rate,tax_type',
      `IMPINV-${rnd().toUpperCase()},2026-04-18,2026-05-18,Acme Ltd,SRV-1,Consulting,1,1000,18,CGST_SGST`,
    ].join('\n');

    await runImport('INVOICE', csv);
    const after = await tb();

    // Regression: imported invoices used to be written to the table without
    // any posting, so the books were short by everything imported.
    expect(moved(before, after, 'AR')).toBe(1180);
    expect(moved(before, after, 'SALES')).toBe(-1000);
    expect(after.totals.balanced).toBe(true);
  });
});

/*
 * A held document keeps the status its raiser gave it. Release used to force
 * every one to "Unpaid", so an expense recorded as paid came back unpaid.
 */
describe('a purchase document held for approval', () => {
  it('comes back with the status it was raised with once released', async () => {
    await setFeature('approvals', true);
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Bill approver ${rnd()}`, roleType: 'CUSTOM', permissions: ['PURCHASE::Bills::VIEW'] })
      .expect(201);
    const roleId = role.body.role.id;
    await request(app)
      .post(`/api/orgs/${owner.orgId}/approval-rules`)
      .set(auth(owner))
      .send({ docType: 'BILL', name: `Bill hold ${rnd()}`, minAmount: 50000, approverRoleId: roleId })
      .expect(201);
    const email = `bill.approver.${rnd()}@example.com`;
    const user = await request(app)
      .post('/api/users')
      .set(auth(owner))
      .send({ email, fullName: 'Bill approver', password: 'Passw0rd!23', orgIds: [owner.orgId], branchIdsByOrg: { [owner.orgId]: [owner.branchId] } })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/roles`)
      .set(auth(owner))
      .send({ roleId, branchId: null })
      .expect(201);
    const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
    const approver: Ctx = { token: login.body.token, orgId: owner.orgId, branchId: owner.branchId };

    const held = await request(app)
      .post(`/api/orgs/${owner.orgId}/bills`)
      .set(auth(owner))
      .send(docBody({ date: '2026-04-20', subtotal: 60000, cgstTotal: 0, sgstTotal: 0, gstTotal: 0, total: 60000,
        items: [{ description: 'Machine', quantity: 1, rate: 60000, gstRate: 0 }], status: 'Paid' }))
      .expect(201);
    expect(held.body.approval?.required).toBe(true);
    expect(held.body.document.status).toBe('Pending Approval');
    expect(held.body.document.heldStatus).toBeUndefined();

    const inbox = await request(app).get(`/api/orgs/${owner.orgId}/approvals`).set(auth(approver)).expect(200);
    const pending = inbox.body.requests.find((r: any) => r.docId === held.body.document.id);
    expect(pending).toBeTruthy();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/approvals/${pending.id}/decide`)
      .set(auth(approver))
      .send({ approve: true, comment: 'ok' })
      .expect(200);

    const list = await request(app).get(`/api/orgs/${owner.orgId}/bills`).set(auth(owner)).expect(200);
    const rows = list.body.documents || list.body.bills || list.body.items || [];
    const row = rows.find((d: any) => d.id === held.body.document.id);
    expect(row?.status).toBe('Paid');
    expect(row?.heldStatus).toBeUndefined();
  });
});
