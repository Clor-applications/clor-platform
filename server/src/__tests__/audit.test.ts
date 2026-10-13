import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * The audit trail, read.
 *
 * It has been written since the invoice routes were built — and until now there
 * was no route that could read a single row of it. A product that records who
 * changed what and shows nobody is not keeping an audit trail; it is filling a
 * table.
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

const makeOwner = async (state = 'Karnataka'): Promise<Ctx> => {
  const email = `audit.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Audit owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Audit Co ${Date.now()}-${rnd()}`, state })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
};

const raiseInvoice = async (c: Ctx, over: Record<string, unknown> = {}) => {
  const res = await request(app)
    .post(`/api/orgs/${c.orgId}/invoices`)
    .set(auth(c))
    .send({
      number: `INV-${rnd()}`,
      date: '2026-09-09',
      customerName: 'Acme Traders',
      subtotal: 1000,
      cgstTotal: 90,
      sgstTotal: 90,
      igstTotal: 0,
      gstTotal: 180,
      total: 1180,
      status: 'Unpaid',
      items: [{ description: 'MS Angle', quantity: 1, rate: 1000, gstRate: 18, amount: 1000 }],
      ...over,
    });
  expect(res.status).toBe(201);
  return res.body.invoice;
};

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('the audit trail', () => {
  /*
   * The gap that mattered most: the trail carried edits, status changes and
   * deletions, and not the creation. A document appearing out of nowhere is the
   * first thing an auditor asks about and it had no entry at all.
   */
  it('records an invoice being raised', async () => {
    const inv = await raiseInvoice(owner);
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/audit?entity=INVOICE&action=CREATE`)
      .set(auth(owner))
      .expect(200);
    const row = res.body.entries.find((e: any) => e.entityId === inv.id);
    expect(row).toBeTruthy();
    expect(row.action).toBe('CREATE');
    expect(row.metadata.total).toBe(1180);
    expect(row.message).toContain(inv.number);
  });

  /* Who did it, not just that it was done. */
  it('names the person who made the change', async () => {
    await raiseInvoice(owner);
    const res = await request(app).get(`/api/orgs/${owner.orgId}/audit`).set(auth(owner)).expect(200);
    expect(res.body.entries[0].by.email).toContain('@example.com');
    expect(res.body.entries[0].by.name).toBe('Audit owner');
  });

  /*
   * "Edited" is not an audit entry. The per-field diff is the thing that lets
   * somebody see what actually moved.
   *
   * This used to prove the point by editing a posted invoice's total from
   * 1,180 to 118 — which is exactly the edit P0-1 forbids, because the ledger
   * did not follow it. The diff is asserted on a field that is still the
   * user's to change, and the refusal of the old one is asserted beside it.
   */
  it('carries the per-field diff of an edit', async () => {
    const inv = await raiseInvoice(owner);
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${inv.id}`)
      .set(auth(owner))
      .send({ dueDate: '2026-12-31' })
      .expect(200);

    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/audit?entity=INVOICE&action=UPDATE&entityId=${inv.id}`)
      .set(auth(owner))
      .expect(200);
    const row = res.body.entries[0];
    expect(row).toBeTruthy();
    expect(String(row.metadata.changes.dueDate.to)).toBe('2026-12-31');
  });

  it('records nothing for an edit the accounting rules refuse', async () => {
    const inv = await raiseInvoice(owner);
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${inv.id}`)
      .set(auth(owner))
      .send({ total: 118, subtotal: 100, gstTotal: 18, cgstTotal: 9, sgstTotal: 9 })
      .expect(409);

    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/audit?entity=INVOICE&action=UPDATE&entityId=${inv.id}`)
      .set(auth(owner))
      .expect(200);
    expect(res.body.entries).toHaveLength(0);
  });

  it('filters by record, action and free text', async () => {
    const inv = await raiseInvoice(owner);
    const byText = await request(app)
      .get(`/api/orgs/${owner.orgId}/audit?q=${encodeURIComponent(inv.number)}`)
      .set(auth(owner))
      .expect(200);
    expect(byText.body.entries.length).toBeGreaterThan(0);
    expect(byText.body.entries.every((e: any) => e.message.includes(inv.number))).toBe(true);

    const byAction = await request(app)
      .get(`/api/orgs/${owner.orgId}/audit?action=DELETE`)
      .set(auth(owner))
      .expect(200);
    expect(byAction.body.entries.every((e: any) => e.action === 'DELETE')).toBe(true);
  });

  /*
   * A date range that excludes today must not silently include it, and one that
   * includes today must not miss what happened an hour ago — the classic
   * midnight-vs-end-of-day mistake, which reads as a missing entry.
   */
  it('honours the date range to the end of the closing day', async () => {
    await raiseInvoice(owner);
    const today = new Date().toISOString().slice(0, 10);
    const withToday = await request(app)
      .get(`/api/orgs/${owner.orgId}/audit?from=${today}&to=${today}`)
      .set(auth(owner))
      .expect(200);
    expect(withToday.body.entries.length).toBeGreaterThan(0);

    const beforeToday = await request(app)
      .get(`/api/orgs/${owner.orgId}/audit?from=2000-01-01&to=2000-01-02`)
      .set(auth(owner))
      .expect(200);
    expect(beforeToday.body.entries).toHaveLength(0);
  });

  it('pages without repeating an entry', async () => {
    await raiseInvoice(owner);
    await raiseInvoice(owner);
    await raiseInvoice(owner);
    const first = await request(app).get(`/api/orgs/${owner.orgId}/audit?limit=2`).set(auth(owner)).expect(200);
    expect(first.body.entries).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app)
      .get(`/api/orgs/${owner.orgId}/audit?limit=2&cursor=${first.body.nextCursor}`)
      .set(auth(owner))
      .expect(200);
    const ids = new Set(first.body.entries.map((e: any) => e.id));
    expect(second.body.entries.some((e: any) => ids.has(e.id))).toBe(false);
  });

  it('offers only the records and actions that exist', async () => {
    await raiseInvoice(owner);
    const res = await request(app).get(`/api/orgs/${owner.orgId}/audit/facets`).set(auth(owner)).expect(200);
    expect(res.body.entities).toContain('INVOICE');
    expect(res.body.actions).toContain('CREATE');
  });

  /*
   * The trail says what another company did. Leaking it is worse than leaking a
   * document: it is a list of everything that company has ever changed.
   */
  it("never shows another account's trail", async () => {
    const inv = await raiseInvoice(owner);
    const other = await makeOwner('Kerala');
    const res = await request(app).get(`/api/orgs/${other.orgId}/audit`).set(auth(other)).expect(200);
    expect(res.body.entries.find((e: any) => e.entityId === inv.id)).toBeUndefined();
  });

  /*
   * Two companies inside ONE account — the CA firm case.
   *
   * Both share an accountId, so scoping by account alone looks right and is
   * not: the trail is a list of everything a company has ever changed, and one
   * client seeing another's is worse than leaking a single document.
   */
  it("keeps one account's two companies apart", async () => {
    const inv = await raiseInvoice(owner);
    const second = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ companyName: `Audit Co Two ${Date.now()}-${rnd()}`, state: 'Kerala' })
      .expect(200);
    const sibling: Ctx = { token: owner.token, orgId: second.body.company.orgId, branchId: second.body.branch.id };
    expect(sibling.orgId).not.toBe(owner.orgId);

    const res = await request(app).get(`/api/orgs/${sibling.orgId}/audit`).set(auth(sibling)).expect(200);
    expect(res.body.entries.find((e: any) => e.entityId === inv.id)).toBeUndefined();

    // And the filter list must not advertise the other company's records either.
    const facets = await request(app)
      .get(`/api/orgs/${sibling.orgId}/audit/facets`)
      .set(auth(sibling))
      .expect(200);
    expect(facets.body.entities).not.toContain('INVOICE');
  });

  it('refuses an org the caller is not in', async () => {
    const other = await makeOwner('Goa');
    await request(app).get(`/api/orgs/${other.orgId}/audit`).set(auth(owner)).expect(403);
  });

  /*
   * Read-only is the feature, not an omission. A trail its own product can edit
   * or delete is evidence of nothing.
   */
  it('exposes no way to write, change or remove an entry', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/audit`).set(auth(owner)).expect(200);
    const id = res.body.entries[0].id;
    await request(app).post(`/api/orgs/${owner.orgId}/audit`).set(auth(owner)).send({ entity: 'X' }).expect(404);
    await request(app).patch(`/api/orgs/${owner.orgId}/audit/${id}`).set(auth(owner)).send({ message: 'x' }).expect(404);
    await request(app).delete(`/api/orgs/${owner.orgId}/audit/${id}`).set(auth(owner)).expect(404);
  });
});
