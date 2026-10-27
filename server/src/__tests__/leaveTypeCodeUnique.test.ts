import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * O-12: one code per leave type is held by the database, not only by the
 * route's check. Two saves at the same moment can both pass codeTakenBy; the
 * partial unique index (migration 20261101090100_leave_type_code_unique) then
 * refuses the second, and the route still answers with its own friendly 409.
 *
 * To stand in for that race deterministically, the route's check is switched
 * off (`skipCheck`): its lookup by code finds nothing, as it would for two
 * requests that both looked before either wrote.
 */
const bypass = vi.hoisted(() => ({ skipCheck: false }));
vi.mock('../utils/peoplePrisma.js', async (importOriginal) => {
  const real: any = await importOriginal();
  const peoplePrisma = new Proxy(real.peoplePrisma, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key !== 'leaveType') return value;
      return new Proxy(value, {
        get(model, k) {
          const fn = Reflect.get(model, k);
          if (k !== 'findFirst') return typeof fn === 'function' ? fn.bind(model) : fn;
          return (args: any) => (bypass.skipCheck && args?.where?.code ? Promise.resolve(null) : fn.call(model, args));
        },
      });
    },
  });
  return { ...real, peoplePrisma };
});

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
async function company(): Promise<Ctx> {
  const email = `ltc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LTC Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: false } }).expect(200);
  return c;
}

describe('one code per leave type, in the database', () => {
  let c: Ctx;
  let other: Ctx;
  let casual: any;
  beforeAll(async () => {
    c = await company();
    other = await company();
    casual = (await att(c, 'post', '/leave/types', { name: 'Casual', code: 'CL', annualDays: 12 }).expect(201)).body.type;
  }, 60_000);

  it('the database refuses a second type with the same code, ignoring case', async () => {
    const write = (code: string | null, name = `Type ${rnd()}`) =>
      runInTenant(c.orgId, () => peoplePrisma.leaveType.create({ data: { accountId: casual.accountId, orgId: c.orgId, name, code, createdByUserId: casual.createdByUserId } }));
    await expect(write('cl')).rejects.toMatchObject({ code: 'P2002' });
    await expect(write('CL')).rejects.toMatchObject({ code: 'P2002' });
    /* No code is not a code: any number of types may have none. */
    await write(null);
    await write(null);
  });

  it('a duplicate code is a 409 LEAVE_TYPE_CODE_TAKEN even when the route check is passed', async () => {
    bypass.skipCheck = true;
    try {
      const created = await att(c, 'post', '/leave/types', { name: 'Casual (new)', code: 'cl', annualDays: 6 }).expect(409);
      expect(created.body.code).toBe('LEAVE_TYPE_CODE_TAKEN');
      expect(created.body.error).toContain('The code cl is already used by');

      bypass.skipCheck = false;
      const sick = (await att(c, 'post', '/leave/types', { name: 'Sick', code: 'SL', annualDays: 6 }).expect(201)).body.type;
      bypass.skipCheck = true;
      const edited = await att(c, 'put', `/leave/types/${sick.id}`, { name: 'Sick', code: 'Cl', annualDays: 6 }).expect(409);
      expect(edited.body.code).toBe('LEAVE_TYPE_CODE_TAKEN');

      /* The refused save left nothing behind: Sick keeps its code, and only one type has CL. */
      const types = (await att(c, 'get', '/leave/types').expect(200)).body.types;
      expect(types.find((t: any) => t.id === sick.id).code).toBe('SL');
      expect(types.filter((t: any) => String(t.code || '').toLowerCase() === 'cl')).toHaveLength(1);
    } finally {
      bypass.skipCheck = false;
    }
  });

  it('a clash on the name is not reported as a clash on the code', async () => {
    const twin = await att(c, 'post', '/leave/types', { name: 'Casual', code: 'CX', annualDays: 6 });
    expect(twin.status).toBe(409);
    expect(twin.body.code).not.toBe('LEAVE_TYPE_CODE_TAKEN');
  });

  it('another company may use the same code', async () => {
    bypass.skipCheck = true;
    try {
      await att(other, 'post', '/leave/types', { name: 'Casual', code: 'CL', annualDays: 12 }).expect(201);
    } finally {
      bypass.skipCheck = false;
    }
  });
});
