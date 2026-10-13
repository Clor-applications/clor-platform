import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * One person, one login, access anywhere they are invited.
 *
 * A user used to be reachable only inside the account they signed up under.
 * Membership was matched on the account carried in the token, so a membership
 * in anybody else's organisation was unmatchable by construction — it could be
 * written and would never work — and adding somebody who already had a login
 * elsewhere was answered with 409.
 *
 * That is wrong for a general product, not only for the accountant example it
 * was first noticed with. A person joining a second business, an auditor given
 * sight of a group company, a consultant working across two clients: all of
 * them are one person who should not need a second identity with the same
 * address.
 *
 * The account now comes from the MEMBERSHIP that authorised the request, not
 * from the token. For somebody working in their own company the two are the
 * same value, which is why this changed nothing for anyone who already existed.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Owner = { token: string; accountId: string; orgId: string; branchId: string; email: string };

const auth = (o: { token: string; orgId: string; branchId: string }) => ({
  Authorization: `Bearer ${o.token}`,
  'x-org-id': o.orgId,
  'x-branch-id': o.branchId,
});

async function makeOwner(label: string): Promise<Owner> {
  const email = `gid.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `GID ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const orgId = setup.body.company.orgId as string;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } });
  return { token: signup.body.token, accountId: org!.accountId, orgId, branchId: setup.body.branch.id, email };
}

let acme: Owner;
let globex: Owner;

beforeAll(async () => {
  [acme, globex] = await Promise.all([makeOwner('acme'), makeOwner('globex')]);
}, 120_000);

const login = async (email: string) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return res.body.token as string;
};

describe('a person already registered elsewhere', () => {
  it('is invited into the company rather than refused', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(globex))
      .send({
        email: acme.email, // already a user, under a different account
        fullName: 'Acme Owner',
        password: 'Irrelevant!23',
        orgIds: [globex.orgId],
        branchIdsByOrg: { [globex.orgId]: [globex.branchId] },
      })
      .expect(201);

    // The same identity, not a second one with the same address.
    expect(res.body.user.accountId).toBe(acme.accountId);
    expect(await platformPrisma.user.count({ where: { email: acme.email } })).toBe(1);
  });

  /*
   * A membership alone gets you in the door and no further: RBAC still asks
   * what role you hold in THIS company, which is a third independent guard and
   * the reason an invitation is two steps today. Worth collapsing into one
   * eventually — an invited person with no role has a login that can do
   * nothing — but the role is assigned here the way the product does it.
   */
  const grantRole = async (host: Owner, email: string) => {
    const user = await platformPrisma.user.findFirst({ where: { email }, select: { id: true } });
    const role = await platformPrisma.role.findFirst({ where: { orgId: host.orgId }, select: { id: true } });
    await request(app)
      .post(`/api/orgs/${host.orgId}/users/${user!.id}/roles`)
      .set(auth(host))
      .send({ roleId: role!.id })
      .expect(201);
  };

  /*
   * The defect this file was meant to cover and did not.
   *
   * The tests below prove a known foreign orgId can be USED. They say nothing
   * about whether it can be FOUND — and it could not: login and /auth/me
   * filtered memberships by the signed-in user's own accountId, while an
   * invited membership carries the inviting account's. So the company was
   * authorised and invisible, and the only way in was to already know an
   * internal id. That is the advertised CA-firm workflow, unusable.
   */
  it('lists the invited company at login', async () => {
    await grantRole(globex, acme.email);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: acme.email, password: 'Passw0rd!23' })
      .expect(200);

    const orgIds = (res.body.companies || []).map((c: any) => c.orgId);
    expect(orgIds).toContain(acme.orgId);
    expect(orgIds).toContain(globex.orgId);

    // Each company says which account owns it, because they are no longer all
    // the same account.
    const invited = res.body.companies.find((c: any) => c.orgId === globex.orgId);
    expect(invited.accountId).toBeTruthy();
    expect(invited.accountId).not.toBe(res.body.user.accountId);
  });

  it('lists the invited company on /auth/me', async () => {
    await grantRole(globex, acme.email);
    const token = await login(acme.email);
    const res = await request(app)
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${token}`, 'x-org-id': globex.orgId })
      .expect(200);

    const orgIds = (res.body.orgs || []).map((o: any) => o.orgId);
    expect(orgIds).toContain(globex.orgId);
  });

  /*
   * Roles and branches belong to the account that owns the COMPANY, not the one
   * that owns the person. Read from the token they came back empty, which reads
   * as a user with no permissions rather than a lookup against the wrong
   * account.
   */
  it('resolves roles and branches in the invited company', async () => {
    await grantRole(globex, acme.email);
    const token = await login(acme.email);
    const res = await request(app)
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${token}`, 'x-org-id': globex.orgId })
      .expect(200);

    expect(res.body.activeOrgId).toBe(globex.orgId);
    expect(Array.isArray(res.body.allowedBranchIds)).toBe(true);
    expect(res.body.allowedBranchIds.length).toBeGreaterThan(0);
  });

  /* Being findable must not mean being findable by everyone. */
  it('does not list a company nobody invited them to', async () => {
    const outsider = await makeOwner('outsider');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: outsider.email, password: 'Passw0rd!23' })
      .expect(200);
    const orgIds = (res.body.companies || []).map((c: any) => c.orgId);
    expect(orgIds).toContain(outsider.orgId);
    expect(orgIds).not.toContain(globex.orgId);
    expect(orgIds).not.toContain(acme.orgId);
  });

  /* The point of the invitation: one login now reaches both companies. */
  it('can work in both companies with the one login', async () => {
    await grantRole(globex, acme.email);
    const token = await login(acme.email);

    const own = await request(app)
      .get(`/api/orgs/${acme.orgId}/invoices`)
      .set({ Authorization: `Bearer ${token}`, 'x-org-id': acme.orgId, 'x-branch-id': acme.branchId })
      .expect(200);
    expect(own.body).toBeTruthy();

    await request(app)
      .get(`/api/orgs/${globex.orgId}/invoices`)
      .set({ Authorization: `Bearer ${token}`, 'x-org-id': globex.orgId, 'x-branch-id': globex.branchId })
      .expect(200);
  });

  /*
   * Anything written in the invited company must belong to THAT company. The
   * account comes from the membership, so a document raised there carries the
   * host's account, not the visitor's home one.
   */
  it('writes into the company it is working in, not its own', async () => {
    await grantRole(globex, acme.email);
    const token = await login(acme.email);
    const created = await request(app)
      .post(`/api/orgs/${globex.orgId}/invoices`)
      .set({ Authorization: `Bearer ${token}`, 'x-org-id': globex.orgId, 'x-branch-id': globex.branchId })
      .send({
        date: '2026-08-01',
        customerName: 'Globex buyer',
        subtotal: 1000,
        total: 1000,
        items: [{ description: 'Widget', quantity: 1, rate: 1000, gstRate: 0 }],
      })
      .expect(201);

    const row = await prisma.invoice.findUnique({ where: { id: created.body.invoice.id } });
    expect(row?.orgId).toBe(globex.orgId);
    expect(row?.accountId).toBe(globex.accountId);
    expect(row?.accountId).not.toBe(acme.accountId);
  });

  it('refuses a second invitation into a company it already reaches', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(globex))
      .send({
        email: acme.email,
        fullName: 'Acme Owner',
        password: 'Irrelevant!23',
        orgIds: [globex.orgId],
        branchIdsByOrg: { [globex.orgId]: [globex.branchId] },
      })
      .expect(409);
    expect(String(res.body.error)).toMatch(/already has access/i);
  });

  /*
   * Confirming an address is registered is a small leak; returning the name
   * attached to it is a larger one.
   */
  it('does not disclose the name behind an address from another account', async () => {
    const outsider = await makeOwner('outsider');
    const res = await request(app)
      .post('/api/users')
      .set(auth(acme))
      .send({
        email: outsider.email,
        fullName: 'Guessed Name',
        password: 'Irrelevant!23',
        orgIds: [acme.orgId],
        branchIdsByOrg: { [acme.orgId]: [acme.branchId] },
      })
      .expect(201);
    expect(res.body.user.fullName).toBeNull();
  });
});

describe('invitation does not become a takeover', () => {
  /* Setting a password for an identity you do not own is not an invitation. */
  it('leaves the invited person\'s existing password untouched', async () => {
    const before = await platformPrisma.user.findFirst({ where: { email: acme.email }, select: { passwordHash: true } });
    await request(app)
      .post('/api/users')
      .set(auth(globex))
      .send({
        email: acme.email,
        fullName: 'Acme Owner',
        password: 'Attacker!23',
        orgIds: [globex.orgId],
        branchIdsByOrg: { [globex.orgId]: [globex.branchId] },
      });
    const after = await platformPrisma.user.findFirst({ where: { email: acme.email }, select: { passwordHash: true } });
    expect(after?.passwordHash).toBe(before?.passwordHash);

    // And the original password still works.
    await request(app).post('/api/auth/login').send({ email: acme.email, password: 'Passw0rd!23' }).expect(200);
  });
});

describe('an email is one person', () => {
  it('is unique across the whole product, not per account', async () => {
    await expect(
      platformPrisma.user.create({
        data: { accountId: globex.accountId, email: acme.email, fullName: 'Clone', passwordHash: 'x' },
      })
    ).rejects.toThrow();
  });
});
