import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * The role suggestion, with TypeSafe's API replaced by a stub.
 *
 * What is under test is this product's side of it: off without a key, only
 * roles the caller could hand out are offered, the answer comes back as a
 * role id the dropdown can use, and a failing service is a sentence rather
 * than a 500. Whether Jev picks well is a question for real job descriptions,
 * not for a unit test.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const uid = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  const email = `suggest.${uid()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Suggest owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Suggest Co ${uid()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200); // seeds the stock roles
}, 60_000);

afterEach(() => {
  delete process.env.TYPESAFE_API_KEY;
  vi.restoreAllMocks();
});

/** Stubs TypeSafe, answering with whichever criterion `pick` chooses. */
const stubTypeSafe = (pick: (criteria: Record<string, string>) => string, confidence = 0.9) => {
  const calls: any[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const criteria = body.questions.role.criteria as Record<string, string>;
    const choice = pick(criteria);
    const others = Object.keys(criteria).filter((k) => k !== choice);
    const probabilities: Record<string, number> = { [choice]: confidence };
    for (const k of others) probabilities[k] = (1 - confidence) / others.length;
    return new Response(JSON.stringify({ answers: { role: { choice, probabilities, confidence } } }), { status: 200 });
  });
  return calls;
};

const byName = (name: string) => (criteria: Record<string, string>) =>
  Object.keys(criteria).find((k) => criteria[k].startsWith(`${name}:`))!;

describe('role suggestion', () => {
  it('is off, and says so, without an API key', async () => {
    const status = await request(app).get(`/api/orgs/${owner.orgId}/users/role-suggestion`).set(auth(owner)).expect(200);
    expect(status.body.enabled).toBe(false);
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/users/role-suggestion`)
      .set(auth(owner))
      .send({ jobTitle: 'Accounts clerk' })
      .expect(503);
    expect(res.body.code).toBe('suggestion_unavailable');
  });

  it('returns the suggested role as an id the dropdown can use, and sends no company data', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    const calls = stubTypeSafe(byName('Billing Clerk'));
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/users/role-suggestion`)
      .set(auth(owner))
      .send({ jobTitle: 'Front desk billing', duties: 'Raises invoices and takes payments at the counter' })
      .expect(200);

    const roles = (await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200)).body.roles;
    expect(res.body.roleId).toBe(roles.find((r: any) => r.name === 'Billing Clerk').id);
    expect(res.body.noFit).toBe(false);
    expect(res.body.alternatives[0].name).toBe('Billing Clerk');

    expect(Object.keys(calls[0].state).sort()).toEqual(['job_title', 'what_they_do']);
    expect(calls[0].questions.role.type).toBe('choice');
    expect(Object.keys(calls[0].questions.role.criteria)).toContain('__none__');
  });

  it('can say that no role fits', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    stubTypeSafe(() => '__none__', 0.7);
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/users/role-suggestion`)
      .set(auth(owner))
      .send({ jobTitle: 'Drone pilot' })
      .expect(200);
    expect(res.body.roleId).toBeNull();
    expect(res.body.noFit).toBe(true);
  });

  it('offers a non-administrator only roles they could hand out', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({
        name: `Hiring clerk ${uid()}`,
        permissions: ['SETTINGS::Users::VIEW', 'SETTINGS::Users::EDIT', 'SETTINGS::Users::CREATE', 'SETTINGS::Roles::VIEW', 'SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'],
      })
      .expect(201);
    const email = `clerk.${uid()}@example.com`;
    const user = await request(app)
      .post('/api/users')
      .set(auth(owner))
      .send({ email, fullName: 'Clerk', password: 'Passw0rd!23', orgIds: [owner.orgId], branchIdsByOrg: { [owner.orgId]: [owner.branchId] } })
      .expect(201);
    await request(app).post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/roles`).set(auth(owner)).send({ roleId: role.body.role.id }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
    const clerk = { ...owner, token: login.body.token };

    const calls = stubTypeSafe((criteria) => Object.keys(criteria)[0]);
    await request(app).post(`/api/orgs/${owner.orgId}/users/role-suggestion`).set(auth(clerk)).send({ jobTitle: 'Anything' }).expect(200);
    const offered = Object.values(calls[0].questions.role.criteria as Record<string, string>).map((d) => d.split(':')[0]);
    expect(offered).not.toContain('Administrator');
    expect(offered).not.toContain('Owner');
    expect(offered).not.toContain('Accountant'); // holds far more than the clerk
  });

  it('turns a failing service into a sentence, not a 500', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('overloaded', { status: 529 }));
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/users/role-suggestion`)
      .set(auth(owner))
      .send({ jobTitle: 'Accounts clerk' })
      .expect(502);
    expect(res.body.error).toMatch(/Pick a role yourself/);
  });
});
