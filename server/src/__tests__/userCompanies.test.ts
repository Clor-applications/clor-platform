import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * Which companies one person can work in.
 *
 * Access was granted a company at a time — switch company, invite the same
 * email, pick a role — so "what can this person see?" could only be answered by
 * visiting every company and looking. A CA firm putting ten clients on an intern
 * made ten trips and had no way to check the result.
 *
 * A membership is a key to a company's books, so every test here is really
 * about the boundary.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const makeOwner = async (label: string): Promise<Ctx> => {
  const email = `uc.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `${label} Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    userId: signup.body.user?.id || '',
  };
};

const addCompany = async (c: Ctx, name: string) => {
  const res = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${c.token}`)
    .send({ companyName: `${name} ${Date.now()}-${rnd()}`, state: 'Kerala' })
    .expect(200);
  return String(res.body.company.orgId);
};

const inviteStaff = async (c: Ctx) => {
  const email = `staff.${Date.now()}.${rnd()}@example.com`;
  const res = await request(app)
    .post('/api/users')
    .set(auth(c))
    .send({ email, fullName: 'An Intern', password: 'Passw0rd!23' })
    .expect(201);
  return String(res.body.user.id);
};

let owner: Ctx;
let staffId: string;
let secondOrgId: string;

beforeAll(async () => {
  owner = await makeOwner('main');
  secondOrgId = await addCompany(owner, 'Client B');
  staffId = await inviteStaff(owner);
}, 60_000);

describe("a person's company access", () => {
  it('lists every company in the account and says which are open to them', async () => {
    const res = await request(app).get(`/api/users/${staffId}/companies`).set(auth(owner)).expect(200);
    const ids = res.body.companies.map((c: any) => c.orgId);
    expect(ids).toContain(owner.orgId);
    expect(ids).toContain(secondOrgId);
    // Invited into the first company only.
    expect(res.body.companies.find((c: any) => c.orgId === owner.orgId).hasAccess).toBe(true);
    expect(res.body.companies.find((c: any) => c.orgId === secondOrgId).hasAccess).toBe(false);
  });

  it('grants several companies at once', async () => {
    await request(app)
      .put(`/api/users/${staffId}/companies`)
      .set(auth(owner))
      .send({ orgIds: [owner.orgId, secondOrgId] })
      .expect(200);

    const res = await request(app).get(`/api/users/${staffId}/companies`).set(auth(owner)).expect(200);
    expect(res.body.companies.every((c: any) => c.hasAccess)).toBe(true);
  });

  /* The list is the complete set: leaving a company out takes the access away. */
  it('takes access away for anything left out', async () => {
    await request(app)
      .put(`/api/users/${staffId}/companies`)
      .set(auth(owner))
      .send({ orgIds: [owner.orgId] })
      .expect(200);

    const res = await request(app).get(`/api/users/${staffId}/companies`).set(auth(owner)).expect(200);
    expect(res.body.companies.find((c: any) => c.orgId === secondOrgId).hasAccess).toBe(false);
  });

  /*
   * A role left behind on a company the person can no longer open is a
   * permission waiting to come back the moment anybody re-adds them — silently,
   * at whatever level they had before.
   */
  it('removes the role along with the access', async () => {
    const roles = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const roleId = String(roles.body.roles[0].id);
    await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${staffId}/role`)
      .set(auth(owner))
      .send({ roleId })
      .expect(200);

    const before = await request(app).get(`/api/users/${staffId}/companies`).set(auth(owner)).expect(200);
    expect(before.body.companies.find((c: any) => c.orgId === owner.orgId).role).toBeTruthy();

    await request(app).put(`/api/users/${staffId}/companies`).set(auth(owner)).send({ orgIds: [] }).expect(200);
    // Put them back, and they must arrive with no role rather than the old one.
    await request(app)
      .put(`/api/users/${staffId}/companies`)
      .set(auth(owner))
      .send({ orgIds: [owner.orgId] })
      .expect(200);

    const after = await request(app).get(`/api/users/${staffId}/companies`).set(auth(owner)).expect(200);
    expect(after.body.companies.find((c: any) => c.orgId === owner.orgId).role).toBeNull();
  });

  /*
   * The boundary. A membership is a key to a company's books, and an id in a
   * request body is not evidence that the caller owns that company.
   */
  it("will not hand out a key to another account's company", async () => {
    const stranger = await makeOwner('stranger');
    await request(app)
      .put(`/api/users/${staffId}/companies`)
      .set(auth(owner))
      .send({ orgIds: [owner.orgId, stranger.orgId] })
      .expect(200);

    /*
     * Asked of the database, not of the listing.
     *
     * The listing is scoped by account, so a membership wrongly created against
     * another account's company would simply be invisible here while being
     * perfectly real — a row that lets somebody walk into a company nobody
     * invited them to. The row is the thing that must not exist.
     */
    const leaked = await platformPrisma.userOrgMembership.findFirst({
      where: { userId: staffId, orgId: stranger.orgId },
      select: { id: true },
    });
    expect(leaked).toBeNull();
  });

  it("will not touch another account's user", async () => {
    const stranger = await makeOwner('other');
    await request(app).get(`/api/users/${stranger.userId}/companies`).set(auth(owner)).expect(404);
    await request(app)
      .put(`/api/users/${stranger.userId}/companies`)
      .set(auth(owner))
      .send({ orgIds: [owner.orgId] })
      .expect(404);
  });
});
