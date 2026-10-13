import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * A branch you create is a branch you can use.
 *
 * Creating one wrote the branch and nothing else, so the person who had just
 * added it got 403 "No access to branch" the moment they switched to it: the
 * warehouses under it would not list, and no document could be raised there.
 * The branch existed and its author was locked out of it.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;

const auth = (c: Ctx, branchId = c.branchId) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': branchId,
});

beforeAll(async () => {
  const email = `ba.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Branch owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Branch Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}, 60_000);

describe('a newly created branch is usable by its creator', () => {
  it('lets the creator work in the branch straight away', async () => {
    const code = `B${rnd().slice(0, 4)}`.toUpperCase();
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/branches`)
      .set(auth(owner))
      .send({
        branchCode: code,
        branchName: 'Mumbai Branch',
        addressLine1: '44 Nariman Point',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        gstRegistrationType: 'UNREGISTERED',
      })
      .expect(201);

    const newBranchId = created.body.branch.id as string;

    // The request that used to come back 403.
    await request(app)
      .get(`/api/orgs/${owner.orgId}/warehouses`)
      .set(auth(owner, newBranchId))
      .expect(200);
  });

  it('lets a warehouse be created in it, which is what a branch is for', async () => {
    const code = `W${rnd().slice(0, 4)}`.toUpperCase();
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/branches`)
      .set(auth(owner))
      .send({
        branchCode: code,
        branchName: 'Delhi Branch',
        addressLine1: '9 Connaught Place',
        city: 'New Delhi',
        state: 'Delhi',
        country: 'India',
        gstRegistrationType: 'UNREGISTERED',
      })
      .expect(201);

    const branchId = created.body.branch.id as string;
    const wh = await request(app)
      .post(`/api/orgs/${owner.orgId}/warehouses`)
      .set(auth(owner, branchId))
      .send({ branchId, name: 'Delhi Store', state: 'Delhi', country: 'India' })
      .expect(201);

    expect(wh.body.warehouse.branchId).toBe(branchId);

    const list = await request(app)
      .get(`/api/orgs/${owner.orgId}/warehouses`)
      .set(auth(owner, branchId))
      .expect(200);
    expect((list.body.warehouses || []).some((w: any) => w.id === wh.body.warehouse.id)).toBe(true);
  });
});
