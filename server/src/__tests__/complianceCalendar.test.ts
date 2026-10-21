import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Compliance calendar (HR research, Phase 2): statutory due dates worked out
 * from what applies to the company, owned, marked done with a reference and
 * evidence, beside the company's own deadlines.
 */
const { buildApp } = await import('../app.js');
const { dueDates } = await import('../services/people/compliance.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('due dates', () => {
  const all = { payroll: true, pf: true, esi: true, ptStates: ['Karnataka', 'Kerala'], posh: true, people: 40 };
  const due = (from: string, to: string) => dueDates(all, from, to);
  const find = (list: any[], code: string, period: string) => list.find((d) => d.code === code && d.period === period);

  it('puts the monthly ones in the month after, TDS for March in April', () => {
    const list = due('2026-10-01', '2027-05-31');
    expect(find(list, 'PF_ECR', '2026-09')?.dueDate).toBe('2026-10-15');
    expect(find(list, 'ESIC', '2026-09')?.dueDate).toBe('2026-10-15');
    expect(find(list, 'TDS_DEPOSIT', '2026-09')?.dueDate).toBe('2026-10-07');
    expect(find(list, 'TDS_DEPOSIT', '2027-03')?.dueDate).toBe('2027-04-30');
    expect(find(list, 'PT_KARNATAKA', '2026-09')).toMatchObject({ dueDate: '2026-10-20', note: expect.stringMatching(/confirm/) });
    /* A state CLOR has no date for: the last day of the next month, and it says so. */
    expect(find(list, 'PT_KERALA', '2026-09')).toMatchObject({ dueDate: '2026-10-31', note: expect.stringMatching(/does not know/) });
  });

  it('puts 24Q, Form 16, bonus and the POSH report on their dates', () => {
    const list = due('2026-07-01', '2027-06-30');
    expect(find(list, 'TDS_24Q', '2026-Q1')?.dueDate).toBe('2026-07-31');
    expect(find(list, 'TDS_24Q', '2026-Q2')?.dueDate).toBe('2026-10-31');
    expect(find(list, 'TDS_24Q', '2026-Q3')?.dueDate).toBe('2027-01-31');
    expect(find(list, 'TDS_24Q', '2026-Q4')?.dueDate).toBe('2027-05-31');
    expect(find(list, 'FORM16', '2027')?.dueDate).toBe('2027-06-15');
    expect(find(list, 'BONUS', '2026')?.dueDate).toBe('2026-11-30');
    expect(find(list, 'POSH_REPORT', '2027')?.dueDate).toBe('2027-01-31');
  });

  it('leaves out what does not apply', () => {
    const list = dueDates({ payroll: false, pf: false, esi: false, ptStates: [], posh: false, people: 4 }, '2026-01-01', '2027-12-31');
    expect(list).toEqual([]);
  });
});

describe('the calendar', () => {
  it('lists what applies, takes an owner, a reference and evidence, and a company deadline', async () => {
    const email = `cal.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Calendar Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
    await request(app).post(`/api/orgs/${c.orgId}/payroll/employees`).set(at(c)).send({ name: 'Ravi', code: 'K1', dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: true, esiApplicable: false, ptApplicable: true, professionalTaxState: 'Karnataka' } }).expect(201);
    const api = (m: 'get' | 'post' | 'patch', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people/compliance${p}`).set(at(c)).send(b as any);

    const cal = (await api('get', '').expect(200)).body;
    expect(cal.applies).toMatchObject({ payroll: true, pf: true, esi: false, ptStates: ['Karnataka'], posh: false });
    const codes = new Set(cal.tasks.map((t: any) => t.code));
    expect(codes.has('PF_ECR')).toBe(true);
    expect(codes.has('TDS_DEPOSIT')).toBe(true);
    expect(codes.has('PT_KARNATAKA')).toBe(true);
    expect(codes.has('ESIC')).toBe(false);

    const pf = cal.tasks.find((t: any) => t.code === 'PF_ECR');
    expect(pf.link).toEqual({ app: 'payroll', screen: 'reports' });
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 challan').toString('base64')}`;
    const after = (await api('patch', `/${pf.id}`, { status: 'DONE', owner: 'Meera (payroll)', reference: 'TRRN 1234567890', evidence: { name: 'challan.pdf', mime: 'application/pdf', dataUrl: pdf } }).expect(200)).body;
    expect(after.tasks.find((t: any) => t.id === pf.id)).toMatchObject({ status: 'DONE', owner: 'Meera (payroll)', reference: 'TRRN 1234567890', evidenceName: 'challan.pdf', doneBy: 'Owner', overdue: false });
    const ev = (await api('get', `/${pf.id}/evidence`).expect(200)).body.evidence;
    expect(Buffer.from(ev.dataUrl.split(',')[1], 'base64').toString()).toBe('%PDF-1.4 challan');
    await api('patch', `/${pf.id}`, { evidence: { name: 'x.exe', mime: 'application/x-msdownload', dataUrl: pdf } }).expect(400);

    /* Opening again does not double anything. */
    const again = (await api('get', '').expect(200)).body;
    expect(again.tasks.length).toBe(cal.tasks.length);

    await api('post', '', { title: 'Shops & Establishments licence renewal', dueDate: '2026-12-31', owner: 'Admin' }).expect(201);
    const withOwn = (await api('get', '').expect(200)).body;
    expect(withOwn.tasks.find((t: any) => t.code === 'CUSTOM')).toMatchObject({ title: 'Shops & Establishments licence renewal', dueDate: '2026-12-31', status: 'OPEN', link: null });
  }, 60_000);
});
