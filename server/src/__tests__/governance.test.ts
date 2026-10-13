import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

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

type Ctx = { token: string; orgId: string; branchId: string; userId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const rnd = () => Math.random().toString(36).slice(2, 8);

async function makeOwner(): Promise<Ctx> {
  const email = `gov.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Gov owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Gov Co ${Date.now()}`, state: 'Karnataka' })
    .expect(200);
  return {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    userId: signup.body.user.id,
  };
}

async function makeRole(
  name: string,
  permissions: string[],
  levels?: Record<string, number>,
  org: Ctx = owner
) {
  const role = await request(app)
    .post(`/api/orgs/${org.orgId}/roles`)
    .set(auth(org))
    .send({ name: `${name} ${rnd()}`, roleType: 'CUSTOM', permissions: [] })
    .expect(201);

  await request(app)
    .put(`/api/orgs/${org.orgId}/roles/${role.body.role.id}/permissions`)
    .set(auth(org))
    .send({ permissions, ...(levels ? { levels } : {}) })
    .expect(200);

  return role.body.role.id as string;
}

/** A user with no roles at all; roles or profiles are attached by each test. */
async function makeUser(org: Ctx = owner) {
  const email = `u.${Date.now()}.${rnd()}@example.com`;
  const created = await request(app)
    .post('/api/users')
    .set(auth(org))
    .send({
      email,
      fullName: 'Member',
      password: 'Passw0rd!23',
      orgIds: [org.orgId],
      branchIdsByOrg: { [org.orgId]: [org.branchId] },
    })
    .expect(201);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ emailOrUsername: email, password: 'Passw0rd!23' });
  if (login.status !== 200) {
    // eslint-disable-next-line no-console
    console.log('LOGIN FAILED', login.status, JSON.stringify(login.body), 'created was', created.status);
  }
  expect(login.status).toBe(200);

  return { id: created.body.user.id as string, token: login.body.token as string, email };
}

const ctxFor = (token: string, org: Ctx = owner): Ctx => ({
  token,
  orgId: org.orgId,
  branchId: org.branchId,
  userId: '',
});

const invoiceBody = (over: Record<string, unknown> = {}) => ({
  number: `GOV-${rnd().toUpperCase()}`,
  date: '2026-08-17',
  customerName: 'Acme',
  subtotal: 1000,
  total: 1000,
  items: [],
  ...over,
});

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('role profiles', () => {
  it('grants every role in the profile through one assignment', async () => {
    const salesRole = await makeRole('Sales', ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE']);
    const reportRole = await makeRole('Reporting', ['REPORTS::Trial Balance::VIEW']);

    const profile = await request(app)
      .post(`/api/orgs/${owner.orgId}/role-profiles`)
      .set(auth(owner))
      .send({ name: `Front office ${rnd()}`, description: 'Sales plus reporting', roleIds: [salesRole, reportRole] })
      .expect(201);

    const user = await makeUser();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${user.id}/role-profiles`)
      .set(auth(owner))
      .send({ profileIds: [profile.body.profile.id] })
      .expect(200);

    const me = await request(app)
      .get(`/api/orgs/${owner.orgId}/permissions/me`)
      .set(auth(ctxFor(user.token)))
      .expect(200);

    // Permissions from both roles arrive through the single profile.
    expect(me.body.permissions).toEqual(
      expect.arrayContaining(['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE', 'REPORTS::Trial Balance::VIEW'])
    );
    expect(me.body.profiles).toHaveLength(1);

    // And the permission actually works on a live route.
    await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(ctxFor(user.token))).expect(200);
  });

  it('revokes access when the profile is unassigned', async () => {
    const role = await makeRole('Temp', ['SALES::Invoices::VIEW']);
    const profile = await request(app)
      .post(`/api/orgs/${owner.orgId}/role-profiles`)
      .set(auth(owner))
      .send({ name: `Temp profile ${rnd()}`, roleIds: [role] })
      .expect(201);

    const user = await makeUser();
    const assignUrl = `/api/orgs/${owner.orgId}/users/${user.id}/role-profiles`;

    await request(app).post(assignUrl).set(auth(owner)).send({ profileIds: [profile.body.profile.id] }).expect(200);
    await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(ctxFor(user.token))).expect(200);

    await request(app).post(assignUrl).set(auth(owner)).send({ profileIds: [] }).expect(200);
    await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(ctxFor(user.token))).expect(403);
  });

  it('refuses roles belonging to another organisation', async () => {
    const other = await makeOwner();
    const foreignRole = await request(app)
      .post(`/api/orgs/${other.orgId}/roles`)
      .set(auth(other))
      .send({ name: `Foreign ${rnd()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);

    await request(app)
      .post(`/api/orgs/${owner.orgId}/role-profiles`)
      .set(auth(owner))
      .send({ name: `Bad ${rnd()}`, roleIds: [foreignRole.body.role.id] })
      .expect(400);
  });
});

describe('field-level permissions', () => {
  it('drops restricted fields for a level 0 user and keeps them for level 1', async () => {
    const lowRole = await makeRole('Clerk', ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE']);
    const highRole = await makeRole(
      'Supervisor',
      ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'],
      { 'SALES::Invoices::CREATE': 1 }
    );

    const clerk = await makeUser();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${clerk.id}/roles`)
      .set(auth(owner))
      .send({ roleId: lowRole, branchId: null })
      .expect(201);

    const supervisor = await makeUser();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${supervisor.id}/roles`)
      .set(auth(owner))
      .send({ roleId: highRole, branchId: null })
      .expect(201);

    // paidAmount sits at level 1 in the catalog.
    const asClerk = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(ctxFor(clerk.token)))
      .send(invoiceBody({ paidAmount: 1000 }))
      .expect(201);

    expect(asClerk.body.strippedFields).toContain('paidAmount');
    expect(asClerk.body.invoice.paidAmount).toBe(0);

    const asSupervisor = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(ctxFor(supervisor.token)))
      .send(invoiceBody({ paidAmount: 1000 }))
      .expect(201);

    expect(asSupervisor.body.strippedFields).toEqual([]);
    expect(asSupervisor.body.invoice.paidAmount).toBe(1000);
  });

  it('reports held levels to the client', async () => {
    const role = await makeRole('Levelled', ['SALES::Invoices::EDIT'], { 'SALES::Invoices::EDIT': 2 });
    const user = await makeUser();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${user.id}/roles`)
      .set(auth(owner))
      .send({ roleId: role, branchId: null })
      .expect(201);

    const me = await request(app)
      .get(`/api/orgs/${owner.orgId}/permissions/me`)
      .set(auth(ctxFor(user.token)))
      .expect(200);

    expect(me.body.levels['SALES::Invoices::EDIT']).toBe(2);
  });
});

describe('approval thresholds', () => {
  // Each test gets its own org: approval rules are org-wide and the first
  // matching rule wins, so rules created by an earlier test would otherwise
  // capture this one's documents.

  it('holds a large invoice out of the ledger until it is approved', async () => {
    const org = await makeOwner();
    const approverRole = await makeRole('Approver', ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'], undefined, org);
    const raiserRole = await makeRole('Raiser', ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'], undefined, org);

    await request(app)
      .post(`/api/orgs/${org.orgId}/approval-rules`)
      .set(auth(org))
      .send({ docType: 'INVOICE', name: 'Over 50k', minAmount: 50000, approverRoleId: approverRole, blocksPosting: true })
      .expect(201);

    const raiser = await makeUser(org);
    await request(app).post(`/api/orgs/${org.orgId}/users/${raiser.id}/roles`).set(auth(org)).send({ roleId: raiserRole, branchId: null }).expect(201);
    const approver = await makeUser(org);
    await request(app).post(`/api/orgs/${org.orgId}/users/${approver.id}/roles`).set(auth(org)).send({ roleId: approverRole, branchId: null }).expect(201);

    // Under the threshold: posts immediately.
    const small = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(ctxFor(raiser.token, org)))
      .send(invoiceBody({ subtotal: 1000, total: 1000 }))
      .expect(201);
    expect(small.body.approval).toBeUndefined();

    // Over the threshold: held.
    const big = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(ctxFor(raiser.token, org)))
      .send(invoiceBody({ subtotal: 80000, total: 80000 }))
      .expect(201);

    expect(big.body.approval.required).toBe(true);
    expect(big.body.invoice.status).toBe('Pending Approval');

    const before = await prisma.journalEntry.findMany({
      where: { orgId: org.orgId, sourceDocType: 'INVOICE', sourceDocId: big.body.invoice.id },
    });
    expect(before).toHaveLength(0);

    const pending = await request(app).get(`/api/orgs/${org.orgId}/approvals`).set(auth(ctxFor(raiser.token, org))).expect(200);
    const reqId = pending.body.requests.find((r: any) => r.docId === big.body.invoice.id).id;

    // The raiser cannot approve their own document.
    await request(app)
      .post(`/api/orgs/${org.orgId}/approvals/${reqId}/decide`)
      .set(auth(ctxFor(raiser.token, org)))
      .send({ approve: true })
      .expect(403);

    const decided = await request(app)
      .post(`/api/orgs/${org.orgId}/approvals/${reqId}/decide`)
      .set(auth(ctxFor(approver.token, org)))
      .send({ approve: true, comment: 'Checked' })
      .expect(200);
    expect(decided.body.posted).toBe(true);

    const after = await prisma.journalEntry.findMany({
      where: { orgId: org.orgId, sourceDocType: 'INVOICE', sourceDocId: big.body.invoice.id, status: 'POSTED' },
    });
    expect(after).toHaveLength(1);

    const tb = await request(app).get(`/api/orgs/${org.orgId}/ledger/trial-balance`).set(auth(org)).expect(200);
    expect(tb.body.totals.balanced).toBe(true);
  });

  it('does not hold a document raised by someone who already holds the approver role', async () => {
    const org = await makeOwner();
    const role = await makeRole('SelfApprover', ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'], undefined, org);
    await request(app)
      .post(`/api/orgs/${org.orgId}/approval-rules`)
      .set(auth(org))
      .send({ docType: 'INVOICE', name: 'Self', minAmount: 10, approverRoleId: role })
      .expect(201);

    const user = await makeUser(org);
    await request(app).post(`/api/orgs/${org.orgId}/users/${user.id}/roles`).set(auth(org)).send({ roleId: role, branchId: null }).expect(201);

    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(ctxFor(user.token, org)))
      .send(invoiceBody({ subtotal: 90000, total: 90000 }))
      .expect(201);

    expect(res.body.approval).toBeUndefined();
    expect(res.body.invoice.status).not.toBe('Pending Approval');
  });

  it('rejects a document and leaves it out of the ledger', async () => {
    const org = await makeOwner();
    const approverRole = await makeRole('Rejecter', ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'], undefined, org);
    const raiserRole = await makeRole('Raiser2', ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'], undefined, org);
    await request(app)
      .post(`/api/orgs/${org.orgId}/approval-rules`)
      .set(auth(org))
      .send({ docType: 'INVOICE', name: 'Reject', minAmount: 5000, approverRoleId: approverRole })
      .expect(201);

    const raiser = await makeUser(org);
    await request(app).post(`/api/orgs/${org.orgId}/users/${raiser.id}/roles`).set(auth(org)).send({ roleId: raiserRole, branchId: null }).expect(201);
    const approver = await makeUser(org);
    await request(app).post(`/api/orgs/${org.orgId}/users/${approver.id}/roles`).set(auth(org)).send({ roleId: approverRole, branchId: null }).expect(201);

    const inv = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(ctxFor(raiser.token, org)))
      .send(invoiceBody({ subtotal: 9000, total: 9000 }))
      .expect(201);

    const pending = await request(app).get(`/api/orgs/${org.orgId}/approvals`).set(auth(ctxFor(approver.token, org))).expect(200);
    const reqId = pending.body.requests.find((r: any) => r.docId === inv.body.invoice.id).id;

    const decided = await request(app)
      .post(`/api/orgs/${org.orgId}/approvals/${reqId}/decide`)
      .set(auth(ctxFor(approver.token, org)))
      .send({ approve: false, comment: 'Not budgeted' })
      .expect(200);

    expect(decided.body.posted).toBe(false);
    const entries = await prisma.journalEntry.findMany({
      where: { orgId: org.orgId, sourceDocType: 'INVOICE', sourceDocId: inv.body.invoice.id },
    });
    expect(entries).toHaveLength(0);
  });
});

describe('user permissions (document restrictions)', () => {
  it('limits a user to their assigned customers', async () => {
    const role = await makeRole('Restricted', ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE']);
    const user = await makeUser();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${user.id}/roles`)
      .set(auth(owner))
      .send({ roleId: role, branchId: null })
      .expect(201);

    // No restrictions yet: any customer is allowed.
    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(ctxFor(user.token)))
      .send(invoiceBody({ customerId: 'CUST-A' }))
      .expect(201);

    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${user.id}/permissions`)
      .set(auth(owner))
      .send({ entityType: 'CUSTOMER', entityId: 'CUST-A', label: 'Acme' })
      .expect(201);

    // Now only CUST-A is permitted.
    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(ctxFor(user.token)))
      .send(invoiceBody({ customerId: 'CUST-A' }))
      .expect(201);

    const denied = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(ctxFor(user.token)))
      .send(invoiceBody({ customerId: 'CUST-B' }))
      .expect(403);
    expect(String(denied.body.error)).toMatch(/not permitted/i);
  });

  it('surfaces restrictions to the client and removes them cleanly', async () => {
    const role = await makeRole('Restricted2', ['SALES::Invoices::VIEW']);
    const user = await makeUser();
    await request(app).post(`/api/orgs/${owner.orgId}/users/${user.id}/roles`).set(auth(owner)).send({ roleId: role, branchId: null }).expect(201);

    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${user.id}/permissions`)
      .set(auth(owner))
      .send({ entityType: 'COST_CENTRE', entityId: 'CC-01' })
      .expect(201);

    const me = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(ctxFor(user.token))).expect(200);
    expect(me.body.restrictions.COST_CENTRE).toEqual(['CC-01']);

    await request(app)
      .delete(`/api/orgs/${owner.orgId}/users/${user.id}/permissions/${created.body.permission.id}`)
      .set(auth(owner))
      .expect(200);

    const after = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(ctxFor(user.token))).expect(200);
    expect(after.body.restrictions.COST_CENTRE).toBeUndefined();
  });

  it('rejects a duplicate restriction', async () => {
    const user = await makeUser();
    const url = `/api/orgs/${owner.orgId}/users/${user.id}/permissions`;
    await request(app).post(url).set(auth(owner)).send({ entityType: 'VENDOR', entityId: 'V-1' }).expect(201);
    await request(app).post(url).set(auth(owner)).send({ entityType: 'VENDOR', entityId: 'V-1' }).expect(409);
  });
});
