import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/** Round 67: the employee app's language, chosen on Me and kept on the person so every phone follows it. */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `lang.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Language owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Bhasha Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}

const portalFor = async (c: Ctx, employeeId: string, code: string) => {
  const att = (p: string) => `/api/orgs/${c.orgId}/attendance${p}`;
  const list = await request(app).get(att('/portal-access')).set(at(c)).expect(200);
  const issued = await request(app).post(att('/portal-access/codes')).set(at(c)).send({ employeeIds: [employeeId] }).expect(200);
  const ok = await request(app)
    .post('/api/portal/activate')
    .send({ company: list.body.company.code, employeeCode: code, activationCode: issued.body.codes[0].activationCode, password: 'mine pass 1' })
    .expect(200);
  return (method: 'get' | 'put', p: string, body?: unknown) =>
    request(app)[method](`/api/portal${p}`).set('Authorization', `Bearer ${ok.body.token}`).send(body as any);
};

describe('the employee app language', () => {
  it('is English until chosen, then Hindi on every phone, and English again when chosen', async () => {
    const c = await makeOwner();
    const p = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Sunita', code: 'L1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    const me = await portalFor(c, p.id, 'L1');

    expect((await me('get', '/me').expect(200)).body.language).toBe('en');

    expect((await me('put', '/me/language', { language: 'hi' }).expect(200)).body).toEqual({ language: 'hi' });
    expect((await me('get', '/me').expect(200)).body.language).toBe('hi');
    const row = await peoplePrisma.employee.findFirst({ where: { id: p.id }, select: { portalLanguage: true } });
    expect(row?.portalLanguage).toBe('hi');

    /* English is the default, so it is kept as nothing. */
    await me('put', '/me/language', { language: 'en' }).expect(200);
    expect((await me('get', '/me').expect(200)).body.language).toBe('en');
    expect((await peoplePrisma.employee.findFirst({ where: { id: p.id }, select: { portalLanguage: true } }))?.portalLanguage).toBeNull();
  });

  it('takes only a language the app has, and only from a signed-in person', async () => {
    const c = await makeOwner();
    const p = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Imran', code: 'L2', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    const me = await portalFor(c, p.id, 'L2');
    await me('put', '/me/language', { language: 'fr' }).expect(400);
    await me('put', '/me/language', {}).expect(400);
    await request(app).put('/api/portal/me/language').send({ language: 'hi' }).expect(401);
    expect((await me('get', '/me').expect(200)).body.language).toBe('en');
  });
});
