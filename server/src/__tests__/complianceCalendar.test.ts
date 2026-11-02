import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Compliance calendar (HR research, Phase 2): statutory due dates worked out
 * from what applies to the company, owned, marked done with a reference and
 * evidence, beside the company's own deadlines.
 */
const { buildApp } = await import('../app.js');
const { dueDates, staleLevyItem } = await import('../services/people/compliance.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('due dates', () => {
  const all = { payroll: true, pf: true, esi: true, ptStates: ['Karnataka', 'Kerala', 'Meghalaya', 'Odisha'], lwfStates: ['MAHARASHTRA', 'KARNATAKA'], posh: true, people: 40 };
  const due = (from: string, to: string) => dueDates(all, from, to);
  const find = (list: any[], code: string, period: string) => list.find((d) => d.code === code && d.period === period);

  it('puts the monthly ones in the month after, TDS for March in April', () => {
    const list = due('2026-10-01', '2027-05-31');
    expect(find(list, 'PF_ECR', '2026-09')?.dueDate).toBe('2026-10-15');
    expect(find(list, 'ESIC', '2026-09')?.dueDate).toBe('2026-10-15');
    expect(find(list, 'TDS_DEPOSIT', '2026-09')?.dueDate).toBe('2026-10-07');
    expect(find(list, 'TDS_DEPOSIT', '2027-03')?.dueDate).toBe('2027-04-30');
    expect(find(list, 'PT_KARNATAKA', '2026-09')).toMatchObject({ dueDate: '2026-10-20', note: expect.stringMatching(/confirm/) });
    /* Kerala is half-yearly: August's deduction is remitted by 10 September, one deadline for the half-year. */
    expect(find(list, 'PT_KERALA', '2026-Apr–Sep')).toBeUndefined();
    expect(find(list, 'PT_KERALA', '2026-Oct–Mar')).toMatchObject({ dueDate: '2027-03-10' });
    expect(list.filter((d: any) => d.code === 'PT_KERALA')).toHaveLength(1);
    /* A state CLOR has no date for: the last day of the next month, and it says so. */
    expect(find(list, 'PT_MEGHALAYA', '2026-09')).toMatchObject({ dueDate: '2026-10-31', note: expect.stringMatching(/does not know/) });
    /* Odisha has no professional tax from April 2026: no deadline. */
    expect(list.some((d: any) => d.code === 'PT_ODISHA')).toBe(false);
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

  it('lists each LWF fund the company is covered for, Kerala’s shops fund monthly by the 5th', () => {
    const list = dueDates({ ...all, ptStates: [], lwfStates: [], lwfFunds: [{ state: 'KERALA', fund: '' }, { state: 'KERALA', fund: 'Shops and Commercial Establishments Workers Welfare Fund' }] } as any, '2026-11-01', '2027-02-28');
    expect(find(list, 'LWF_KERALA_SHOPS', '2026-Nov')).toMatchObject({ dueDate: '2026-12-05' });
    expect(find(list, 'LWF_KERALA', '2026-Jul–Dec')).toMatchObject({ dueDate: '2027-01-15' });
    /* A state below its size, left out by applicability, brings nothing. */
    expect(list.some((d: any) => d.code === 'LWF_KARNATAKA')).toBe(false);
  });

  it('knows an older calendar’s PT items that the current one replaces', () => {
    expect(staleLevyItem('PT_KA', '2026-09')).toBe(true);
    expect(staleLevyItem('PT_KARNATAKA', '2026-09')).toBe(false);
    /* Tamil Nadu files by half-year: its old monthly items go. */
    expect(staleLevyItem('PT_TAMIL_NADU', '2026-09')).toBe(true);
    expect(staleLevyItem('PT_TAMIL_NADU', '2026-Apr–Sep')).toBe(false);
    expect(staleLevyItem('LWF_KERALA_SHOPS', '2026-Nov')).toBe(false);
    expect(staleLevyItem('PF_ECR', '2026-09')).toBe(false);
  });

  it('leaves out what does not apply', () => {
    const list = dueDates({ payroll: false, pf: false, esi: false, ptStates: [], lwfStates: [], posh: false, people: 4 }, '2026-01-01', '2027-12-31');
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

    /* The calendar's deadlines are made in Compliance now (People audit gap 10): from Payroll's settings, as obligations. */
    const list = (await api('get', '/obligations').expect(200)).body.obligations.filter((o: any) => o.source === 'STATUTORY');
    const codes = new Set(list.map((o: any) => o.ruleId));
    expect(codes.has('PF_ECR')).toBe(true);
    expect(codes.has('TDS_DEPOSIT')).toBe(true);
    expect(codes.has('PT_KARNATAKA')).toBe(true);
    expect(codes.has('ESIC')).toBe(false);
    expect(codes.has('POSH_REPORT')).toBe(false);

    const pf = list.find((o: any) => o.ruleId === 'PF_ECR');
    expect(pf).toMatchObject({ link: { app: 'payroll', screen: 'reports' }, requiredProof: ['PAYMENT_CHALLAN'], owner: 'Payroll' });
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 challan').toString('base64')}`;
    const proof = (await api('post', `/obligations/${pf.id}/proofs`, { name: 'challan.pdf', mime: 'application/pdf', dataUrl: pdf }).expect(201)).body.proof;
    const after = (await api('patch', `/obligations/${pf.id}`, { status: 'DONE', ownerName: 'Meera (payroll)', reference: 'TRRN 1234567890' }).expect(200)).body.obligation;
    expect(after).toMatchObject({ status: 'DONE', owner: 'Meera (payroll)', reference: 'TRRN 1234567890', doneBy: 'Owner' });
    const ev = (await api('get', `/obligations/${pf.id}/proofs/${proof.id}`).expect(200)).body.proof;
    expect(Buffer.from(ev.dataUrl.split(',')[1], 'base64').toString()).toBe('%PDF-1.4 challan');
    await api('post', `/obligations/${pf.id}/proofs`, { name: 'x.exe', mime: 'application/x-msdownload', dataUrl: pdf }).expect(400);

    /* Opening again does not double anything. */
    const again = (await api('get', '/obligations').expect(200)).body.obligations.filter((o: any) => o.source === 'STATUTORY');
    expect(again.length).toBe(list.length);

    /* The company's own deadline, and the old calendar refusing writes with where to go. */
    await api('post', '/obligations', { title: 'Shops & Establishments licence renewal', dueOn: '2026-12-31', ownerName: 'Admin' }).expect(201);
    expect((await api('get', '/obligations').expect(200)).body.obligations.find((o: any) => o.source === 'OWN')).toMatchObject({ title: 'Shops & Establishments licence renewal', dueOn: '2026-12-31', owner: 'Admin', link: null });
    await api('post', '', { title: 'x', dueDate: '2026-12-31' }).expect(410);
    await api('patch', `/${pf.id}`, { status: 'DONE' }).expect(410);
  }, 60_000);
});
