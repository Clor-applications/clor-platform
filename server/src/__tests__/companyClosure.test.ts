import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Closing a company (LX-07 part 2): a company-wide administrator with a fresh
 * authenticator code (A-21), a full export first, a notice
 * period that can be cancelled, then every row of that company deleted in every
 * database — and nothing of any other company touched.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { Prisma: AccountingPrisma } = await import('@prisma/client');
const { Prisma: PlatformPrisma } = await import('../generated/platform/index.js');
const { Prisma: PeoplePrisma } = await import('../generated/people/index.js');
const { Prisma: PayrollPrisma } = await import('../generated/payroll/index.js');
const { scheduleClosure, cancelClosure, purgeClosedCompanies, noticeDays } = await import('../services/companyClosure.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; name: string; stepUp?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeCompany(): Promise<Ctx> {
  const email = `close.${Date.now()}.${rnd()}@example.com`;
  const name = `Closing Co ${rnd()}`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: name, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '', name };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  await request(app).post(`/api/orgs/${ctx.orgId}/people/employees`).set(at(ctx)).send({ name: 'Some One', dateOfJoining: '2025-01-01' }).expect(201);
  const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { accountId: true, createdByUserId: true } });
  const made = { ...ctx, userId: org.createdByUserId, accountId: org.accountId };
  return { ...made, stepUp: await stepUp(made) };
}

/** Enrol an authenticator for this person and return a fresh step-up token. */
async function stepUp(c: Ctx) {
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any);
  const { secret } = (await sec('/two-factor/setup').expect(200)).body;
  /* One time step for both codes: reading the clock twice failed when a 30-second boundary fell between the calls. */
  await clearOfStepEdge();
  const s0 = stepNow();
  await sec('/two-factor/enable', { code: codeAt(secret, s0) }).expect(200);
  return (await sec('/step-up', { code: codeAt(secret, s0 + 1) }).expect(200)).body.token as string;
}

/** A role by name (the defaults are made on first listing). */
const roleId = async (c: Ctx, name: string) => {
  const roles = (await request(app).get(`/api/orgs/${c.orgId}/roles`).set(at(c)).expect(200)).body.roles as Array<{ id: string; name: string; roleType: string }>;
  return roles.find((r) => r.name === name) || roles.find((r) => (name === 'Administrator' ? r.roleType === 'ADMIN' : r.roleType !== 'ADMIN'))!;
};

/** Another member of the company, signed in; `admin` gives them the Administrator role. */
async function colleague(c: Ctx, admin: boolean): Promise<Ctx> {
  const email = `close.m.${Date.now()}.${rnd()}@example.com`;
  const made = await request(app).post('/api/users').set(at(c)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  const role = await roleId(c, admin ? 'Administrator' : 'Viewer');
  await request(app).put(`/api/orgs/${c.orgId}/users/${made.body.user.id}/role`).set(at(c)).send({ roleId: role.id }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { ...c, token: login.body.token, userId: made.body.user.id, stepUp: undefined };
}

/** Rows this company has in every table of every database (the closure record excluded). */
async function rowsOf(orgId: string) {
  let total = 0;
  for (const [client, dmmf] of [[prisma, AccountingPrisma.dmmf], [payrollPrisma, PayrollPrisma.dmmf], [peoplePrisma, PeoplePrisma.dmmf], [platformPrisma, PlatformPrisma.dmmf]] as const) {
    for (const m of (dmmf as any).datamodel.models) {
      if (m.name === 'OrgClosure' || !m.fields.some((f: any) => f.name === 'orgId')) continue;
      const d = (client as any)[m.name.charAt(0).toLowerCase() + m.name.slice(1)];
      if (d?.count) total += await d.count({ where: { orgId } });
    }
  }
  return total + (await platformPrisma.org.count({ where: { id: orgId } }));
}

const closure = (c: Ctx) => ({
  get: () => request(app).get(`/api/orgs/${c.orgId}/closure`).set(at(c)),
  post: (b: Record<string, unknown>) => request(app).post(`/api/orgs/${c.orgId}/closure`).set({ ...at(c), ...(c.stepUp ? { 'x-step-up': c.stepUp } : {}) }).send(b),
  del: () => request(app).delete(`/api/orgs/${c.orgId}/closure`).set(at(c)),
});

describe('closing a company', () => {
  it('needs a fresh full export, the name typed, and the owner', async () => {
    const c = await makeCompany();
    const noExport = await closure(c).post({ confirmName: c.name });
    expect(noExport.status).toBe(409);
    expect(noExport.body.code).toBe('EXPORT_FIRST');

    await request(app).get(`/api/orgs/${c.orgId}/export?scope=all`).set(at(c)).expect(200);
    expect((await closure(c).get().expect(200)).body.lastFullExportAt).toBeTruthy();

    const wrongName = await closure(c).post({ confirmName: 'Something else' });
    expect(wrongName.status).toBe(400);
    expect(wrongName.body.code).toBe('CONFIRM_NAME');

    await expect(scheduleClosure({ accountId: c.accountId, orgId: c.orgId, userId: 'someone-else', confirmName: c.name })).rejects.toMatchObject({ code: 'ADMIN_ONLY' });
  });

  /* A-21: decided by being an administrator of the whole company, not by having created it, and only with a fresh authenticator code. */
  const exported = async (c: Ctx) => {
    await request(app).get(`/api/orgs/${c.orgId}/export?scope=all`).set(at(c)).expect(200);
    return c;
  };
  const stepsDown = async (c: Ctx) => {
    const other = await colleague(c, true);
    await request(app).put(`/api/orgs/${c.orgId}/users/${c.userId}/role`).set(at(other)).send({ roleId: (await roleId(c, 'Viewer')).id }).expect(200);
    return other;
  };

  it('A-21: is refused to the creator once they are no longer an administrator', async () => {
    const c = await exported(await makeCompany());
    await stepsDown(c);
    const res = await closure(c).post({ confirmName: c.name });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_ONLY');
  });

  it('A-21: is open to the administrator running the company, though they did not create it', async () => {
    const c = await exported(await makeCompany());
    const other = await stepsDown(c);
    const withCode = await exported({ ...other, stepUp: await stepUp(other) });
    expect((await closure(withCode).get().expect(200)).body.canClose).toBe(true);
    await closure(withCode).post({ confirmName: c.name }).expect(201);
    /* And the former creator cannot stop it. */
    expect((await closure(c).del()).status).toBe(403);
    await closure(withCode).del().expect(200);
  });

  it('A-21: needs a fresh authenticator code, whatever the company policy', async () => {
    const c = await exported(await makeCompany());
    const noCode = await closure({ ...c, stepUp: undefined }).post({ confirmName: c.name });
    expect(noCode.status).toBe(403);
    expect(noCode.body.code).toBe('STEP_UP_REQUIRED');
    const other = await exported(await colleague(c, true));
    const noAuthenticator = await closure(other).post({ confirmName: c.name });
    expect(noAuthenticator.status).toBe(403);
    expect(noAuthenticator.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
  });

  it('A-21: is refused to a member who is not an administrator', async () => {
    const c = await exported(await makeCompany());
    const clerk = await colleague(c, false);
    const res = await closure(clerk).post({ confirmName: c.name });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_ONLY');
    expect((await closure(clerk).get().expect(200)).body.canClose).toBe(false);
  });

  it('can be cancelled during the notice period, and not after it', async () => {
    const c = await makeCompany();
    await request(app).get(`/api/orgs/${c.orgId}/export?scope=all`).set(at(c)).expect(200);
    const made = await closure(c).post({ confirmName: c.name, reason: 'Moving to another product' }).expect(201);
    const days = (Date.parse(made.body.closure.deleteAfter) - Date.parse(made.body.closure.requestedAt)) / 86_400_000;
    expect(Math.round(days)).toBe(noticeDays());

    const again = await closure(c).post({ confirmName: c.name });
    expect(again.status).toBe(409);

    expect((await closure(c).del().expect(200)).body.closure.status).toBe('CANCELLED');
    expect(await rowsOf(c.orgId)).toBeGreaterThan(0);

    await closure(c).post({ confirmName: c.name }).expect(201);
    const late = new Date(Date.now() + (noticeDays() + 1) * 86_400_000);
    await expect(cancelClosure({ accountId: c.accountId, orgId: c.orgId, userId: c.userId, now: late })).rejects.toMatchObject({ code: 'TOO_LATE' });
  });

  it('after the notice period deletes every row of that company, and none of another', async () => {
    const closing = await makeCompany();
    const staying = await makeCompany();
    const stayingBefore = await rowsOf(staying.orgId);
    expect(await rowsOf(closing.orgId)).toBeGreaterThan(0);

    await request(app).get(`/api/orgs/${closing.orgId}/export?scope=all`).set(at(closing)).expect(200);
    await closure(closing).post({ confirmName: closing.name }).expect(201);

    /* A day before the notice ends: nothing happens. */
    expect(await purgeClosedCompanies(new Date(Date.now() + (noticeDays() - 1) * 86_400_000), { only: [closing.orgId, staying.orgId] })).toEqual([]);
    expect(await rowsOf(closing.orgId)).toBeGreaterThan(0);

    /* Only this test's companies: other suites sharing the database have closures of their own. */
    const done = await purgeClosedCompanies(new Date(Date.now() + (noticeDays() + 1) * 86_400_000), { only: [closing.orgId, staying.orgId] });
    expect(done.map((d) => d.orgId)).toContain(closing.orgId);
    expect(await rowsOf(closing.orgId)).toBe(0);
    expect(await rowsOf(staying.orgId)).toBe(stayingBefore);

    const record = await platformPrisma.orgClosure.findUniqueOrThrow({ where: { orgId: closing.orgId } });
    expect(record.status).toBe('DELETED');
    expect(record.deletedAt).toBeTruthy();
    expect(JSON.parse(record.deletedCounts || '{}')['platform.Org']).toBe(1);
  });
});
