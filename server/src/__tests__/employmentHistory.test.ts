import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Employment history (HR research, Phase 1): joined, moved, changed, left and
 * rehired, each with its effective date, source, who recorded it, before and
 * after, and what it means for payroll.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
let c: Ctx;
const people = (method: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[method](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);

beforeAll(async () => {
  const email = `hist.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `History Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
}, 60_000);


/* Leaving takes effect once the last day has passed: dates relative to today keep these tests true on any day (two days back clears the IST/UTC boundary). */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const LAST_DAY = day(-2);
const REJOIN = day(1);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('employment history', () => {
  it('keeps every change with its date, before and after, and payroll impact', async () => {
    const sales = (await people('post', '/structure/departments', { name: 'Sales' }).expect(201)).body;
    const finance = (await people('post', '/structure/departments', { name: 'Finance' }).expect(201)).body;
    const salesId = (sales.item || sales.department || sales).id;
    const financeId = (finance.item || finance.department || finance).id;
    const boss = (await people('post', '/employees', { name: 'Meera', code: 'H1', dateOfJoining: '2019-04-01' }).expect(201)).body.employee;
    const e = (await people('post', '/employees', { name: 'Ravi', code: 'H2', dateOfJoining: '2020-06-01', departmentId: salesId }).expect(201)).body.employee;

    /* A move on the form, counted from the first of a past month, with a reason. (A future date would wait as a
       scheduled change instead, docs/people/02-PRD.md FND-02: see peopleEffectiveDating.test.ts.) */
    await people('put', `/employees/${e.id}`, { departmentId: financeId, reportingManagerId: boss.id, effectiveFrom: '2026-09-01', changeNote: 'Moved to accounts team' }).expect(200);
    /* A bulk transfer back, dated. */
    await people('post', '/employees/transfer', { employeeIds: [e.id], field: 'departmentId', targetId: salesId, effectiveDate: '2026-10-01', note: 'Reorganisation' }).expect(200);
    /* Leaves after more than five years: gratuity. */
    await people('post', `/employees/${e.id}/resign`, { lastDay: LAST_DAY, leavingType: 'RESIGNED', reason: 'Higher studies' }).expect(200);
    await people('post', `/employees/${e.id}/rehire`, { rejoinDate: REJOIN }).expect(200);

    const { events } = (await people('get', `/employees/${e.id}/history`).expect(200)).body;
    /* Newest first by effective date; two changes made in one edit share a date. */
    expect(events.map((x: any) => x.effectiveDate)).toEqual([REJOIN, LAST_DAY, '2026-10-01', '2026-09-01', '2026-09-01', '2020-06-01']);
    expect(events.map((x: any) => x.kind).sort()).toEqual(['CHANGED', 'JOINED', 'LEFT', 'REHIRED', 'TRANSFERRED', 'TRANSFERRED']);

    const toFinance = events.find((x: any) => x.field === 'departmentId' && x.to === 'Finance');
    expect(toFinance).toMatchObject({ from: 'Sales', effectiveDate: '2026-09-01', source: 'FORM', note: 'Moved to accounts team', by: 'Owner' });
    expect(toFinance.payrollImpact).toMatch(/booked to Finance from 1 Sep 2026/);

    const manager = events.find((x: any) => x.field === 'reportingManagerId');
    expect(manager).toMatchObject({ to: 'Meera', title: 'Manager changed' });

    const back = events.find((x: any) => x.source === 'TRANSFER');
    expect(back).toMatchObject({ from: 'Finance', to: 'Sales', effectiveDate: '2026-10-01', note: 'Reorganisation' });

    const left = events.find((x: any) => x.kind === 'LEFT');
    expect(left).toMatchObject({ effectiveDate: LAST_DAY, source: 'RESIGNATION', note: 'Higher studies' });
    /* Joined 2020-06-01: more than five years by any last day these tests use, so gratuity applies. */
    const served = Number((String(left.payrollImpact).match(/Gratuity applies \((\d+(?:\.\d+)?) years/) || [])[1]);
    expect(served).toBeGreaterThanOrEqual(6);

    expect(events.find((x: any) => x.kind === 'REHIRED')).toMatchObject({ effectiveDate: REJOIN, source: 'REHIRE' });
    expect(events.find((x: any) => x.kind === 'JOINED')).toMatchObject({ effectiveDate: '2020-06-01', note: 'Sales' });
  });

  it('shows the joining date for someone added before history was kept', async () => {
    const e = (await people('post', '/employees', { name: 'Old Timer', code: 'H3', dateOfJoining: '2015-01-10' }).expect(201)).body.employee;
    const { peoplePrisma } = await import('../utils/peoplePrisma.js');
    await peoplePrisma.employmentEvent.deleteMany({ where: { employeeId: e.id } });
    const { events } = (await people('get', `/employees/${e.id}/history`).expect(200)).body;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'JOINED', effectiveDate: '2015-01-10' });
  });
});
