import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Data health (HR research: the implementation auditor): duplicates, missing
 * joining dates and the statutory and bank details payroll files need, each
 * with who and which screen fixes it — and never the identifiers themselves.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('data health', () => {
  it('names what blocks payroll, who, and where to fix it', async () => {
    const email = `health.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Health Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
    const people = (b: unknown) => request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send(b as any).expect(201);
    const payroll = (b: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll/employees`).set(at(c)).send(b as any).expect(201);

    await people({ name: 'Asha Rao', code: 'D1', dateOfJoining: '2024-01-01', dateOfBirth: '1990-05-05' });
    await people({ name: 'asha  rao', code: 'D2', dateOfJoining: '2024-02-01', dateOfBirth: '1990-05-05' });
    await people({ name: 'No Date', code: 'D3' });
    await payroll({ name: 'Bad Pan', code: 'P1', dateOfJoining: '2024-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE12345', pfApplicable: true, bankAccountNumber: '111122223333', bankIfsc: 'SBIN0000001' } });
    await payroll({ name: 'Same Bank', code: 'P2', dateOfJoining: '2024-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE1234F', uan: '100200300400', bankAccountNumber: '1111 2222 3333', bankIfsc: 'sbin0000001' } });

    const h = (await request(app).get(`/api/orgs/${c.orgId}/people/data-health`).set(at(c)).expect(200)).body;
    const check = (id: string) => h.checks.find((x: any) => x.id === id);

    expect(check('duplicate-person').people.map((p: any) => p.code).sort()).toEqual(['D1', 'D2']);
    expect(check('no-joining-date').people.map((p: any) => p.code)).toEqual(['D3']);
    expect(check('pan')).toMatchObject({ severity: 'BLOCKS_PAYROLL', screen: 'people', count: 1 });
    expect(check('pan').people[0]).toMatchObject({ code: 'P1', detail: 'not in the PAN format' });
    expect(check('uan').people[0]).toMatchObject({ code: 'P1', detail: 'missing' });
    expect(check('no-salary').count).toBe(2);
    expect(check('shared-bank').people.map((p: any) => p.code).sort()).toEqual(['P1', 'P2']);
    expect(check('shared-pan')).toBeUndefined();
    /* Payroll problems first. */
    expect(h.checks[0].severity).toBe('BLOCKS_PAYROLL');
    expect(h.blocking).toBeGreaterThanOrEqual(6);
    /* The identifiers themselves never leave. */
    const text = JSON.stringify(h);
    expect(text).not.toContain('ABCDE12345');
    expect(text).not.toContain('111122223333');
  }, 60_000);
});
