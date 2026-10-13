import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * A document number belongs to the business, not to one of its branches.
 *
 * Uniqueness used to be scoped per branch, so a company with a Head Office and
 * a second branch could issue INV-1 twice — two different invoices wearing one
 * number. That is not a series anyone can file, quote in a GST return, or hand
 * an auditor, and the second one is indistinguishable from the first in every
 * report that groups by number.
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
let secondBranchId = '';

const auth = (c: Ctx, branchId?: string) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': branchId || c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `branchnum.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Branch owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Branch Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

const makeInvoice = (branchId: string, number: string) =>
  request(app)
    .post(`/api/orgs/${owner.orgId}/invoices`)
    .set(auth(owner, branchId))
    .send({
      number,
      date: '2026-08-28',
      customerName: 'Acme Traders',
      subtotal: 1000,
      gstTotal: 0,
      total: 1000,
      items: [{ description: 'Consulting', quantity: 1, rate: 1000, gstRate: 0 }],
    });

beforeAll(async () => {
  owner = await makeOwner();
  const branch = await request(app)
    .post(`/api/orgs/${owner.orgId}/branches`)
    .set(auth(owner))
    .send({
      branchCode: `BR${rnd()}`,
      branchName: 'Second Branch',
      addressLine1: '2 Industrial Layout',
      state: 'Karnataka',
    })
    .expect(201);
  secondBranchId = String(branch.body.branch?.id || branch.body.id);
  expect(secondBranchId).toBeTruthy();

  // Creating a branch does not grant the creator access to it; membership is
  // assigned, the same way an administrator would.
  const me = await request(app).get('/api/auth/me').set(auth(owner)).expect(200);
  const userId = String(me.body.user?.id || me.body.id);
  await request(app)
    .post(`/api/orgs/${owner.orgId}/users/${userId}/branches`)
    .set(auth(owner))
    .send({ branchIds: [owner.branchId, secondBranchId] })
    .expect(200);
}, 60_000);

describe('document numbers are unique across branches', () => {
  it('refuses a number another branch already used', async () => {
    const number = `INV-SHARED-${rnd()}`;

    await makeInvoice(owner.branchId, number).expect(201);

    const clash = await makeInvoice(secondBranchId, number);
    expect(clash.status).toBe(409);
    // The message must name the real reason: it is not this branch's number
    // that clashes, which is exactly what the old wording claimed.
    expect(String(clash.body.error)).toMatch(/every branch/i);
  });

  it('still allows each branch its own distinct numbers', async () => {
    const tag = rnd();
    await makeInvoice(owner.branchId, `INV-HO-${tag}`).expect(201);
    await makeInvoice(secondBranchId, `INV-BR-${tag}`).expect(201);
  });
});
