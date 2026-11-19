import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Weekly wages (round 66): daily-rated workers in a weekly pay group. Days ×
 * rate plus overtime, PF spread across the month's weeks under one ceiling,
 * ESI per wage period, professional tax once on the month's last sheet,
 * canteen and advance recovery inside the half-the-wages cap, the bank file,
 * paid, the wage slip and the month's summary with its ECR.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { isLastOfMonth, paidDaysFrom } = await import('../services/payroll/weeklyWages.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  patch: (c: Ctx, path: string, body?: unknown) => request(app).patch(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
  del: (c: Ctx, path: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `weekly.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Weekly Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  /* Attendance off: days are typed in. */
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true } }).expect(200);
  await api.post(c, '/statutory/seed').expect(200);
  const { body } = await api.get(c, '/statutory').expect(200);
  for (const code of ['PF', 'ESI', 'PT']) await api.put(c, `/statutory/schemes/${body.schemes.find((s: any) => s.code === code).id}`, { isEnabled: true }).expect(200);
  return c;
}

async function worker(c: Ctx, name: string, code: string, uan: string) {
  const person = await api
    .post(c, '/employees', {
      name,
      code,
      dateOfJoining: '2026-04-01',
      status: 'ACTIVE',
      payroll: {
        payrollStatus: 'IN_PAYROLL',
        pfApplicable: true,
        esiApplicable: true,
        ptApplicable: true,
        professionalTaxState: 'Karnataka',
        uan,
        bankAccountNumber: `5010${code}99`,
        bankIfsc: 'HDFC0000123',
        bankAccountName: name,
      },
    })
    .expect(201);
  return person.body.employee.id as string;
}

describe('weekly wage helpers', () => {
  it('knows the last sheet of a month and counts paid days', () => {
    expect(isLastOfMonth('2027-01-24', 7)).toBe(false);
    expect(isLastOfMonth('2027-01-31', 7)).toBe(true);
    expect(isLastOfMonth('2027-01-17', 14)).toBe(false);
    expect(isLastOfMonth('2027-01-24', 14)).toBe(true);
    const row = { present: 4, halfDays: 1, leave: 1, unpaidLeaveDays: 0, holidays: 1, weeklyOffs: 1 };
    expect(paidDaysFrom(row, false)).toBe(6.5);
    expect(paidDaysFrom(row, true)).toBe(7.5);
  });
});

describe('weekly wages', () => {
  it('pays a month of weeks with PF, ESI and PT right for the month', async () => {
    const c = await makeOwner();
    const monthly = (await api.post(c, '/pay-groups', { name: `Staff ${rnd()}`, frequency: 'MONTHLY' }).expect(201)).body.payGroup.id;
    const group = (await api.post(c, '/pay-groups', { name: `Site ${rnd()}`, frequency: 'WEEKLY' }).expect(201)).body.payGroup.id;
    const ravi = await worker(c, 'Ravi Kumar', 'W1', '100000000001');
    const anil = await worker(c, 'Anil Shetty', 'W2', '100000000002');

    /* A monthly group has no daily rates. */
    const refused = await api.put(c, '/weekly-wages/rates', { employeeId: ravi, payGroupId: monthly, dailyRate: 800 }).expect(400);
    expect(refused.body.code).toBe('NOT_WEEKLY');

    await api.put(c, '/weekly-wages/rates', { employeeId: ravi, payGroupId: group, dailyRate: 800, canteenPerDay: 20, advanceBalance: 1000, advancePerSheet: 300 }).expect(200);
    await api.put(c, '/weekly-wages/rates', { employeeId: anil, payGroupId: group, dailyRate: 1100 }).expect(200);
    const rates = (await api.get(c, `/weekly-wages/rates?payGroupId=${group}`).expect(200)).body.rates;
    expect(rates.map((r: any) => r.name)).toEqual(['Anil Shetty', 'Ravi Kumar']);

    const starts = ['2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25'];
    const sheets: any[] = [];
    for (const [i, startDate] of starts.entries()) {
      if (i === 2) {
        /* One after another: a sheet that skips a week is refused. */
        const skip = await api.post(c, '/weekly-wages/sheets', { payGroupId: group, startDate: '2027-01-25' }).expect(409);
        expect(skip.body.code).toBe('OUT_OF_ORDER');
      }
      const made = (await api.post(c, '/weekly-wages/sheets', { payGroupId: group, startDate }).expect(201)).body.sheet;
      expect(made).toMatchObject({ startDate, endDate: starts[i + 1] ? `2027-01-${String(Number(starts[i + 1].slice(8)) - 1).padStart(2, '0')}` : '2027-01-31', wageMonth: '2027-01', lastOfMonth: i === 3, status: 'DRAFT' });
      expect(made.lines.every((l: any) => l.daysWorked === 0)).toBe(true);
      let sheet = made;
      for (const line of made.lines) {
        sheet = (await api.patch(c, `/weekly-wages/sheets/${made.id}/lines/${line.id}`, { daysWorked: 6, ...(i === 0 && line.employeeId === ravi ? { overtimeHours: 2 } : {}) }).expect(200)).body.sheet;
      }
      if (i === 1) {
        /* PF adds up week by week: the second week waits for the first. */
        const early = await api.post(c, `/weekly-wages/sheets/${made.id}/approve`).expect(409);
        expect(early.body.code).toBe('EARLIER_DRAFT');
      }
      if (i >= 1) await api.post(c, `/weekly-wages/sheets/${sheets[i - 1].id}/approve`).expect(200);
      sheets.push(sheet);
    }
    await api.post(c, `/weekly-wages/sheets/${sheets[3].id}/approve`).expect(200);

    const line = (i: number, who: string) => sheets[i].lines.find((l: any) => l.employeeId === who);
    const fresh = await Promise.all(sheets.map(async (s) => (await api.get(c, `/weekly-wages/sheets/${s.id}`).expect(200)).body.sheet));
    sheets.splice(0, 4, ...fresh);

    /* Ravi: 6 × ₹800 = ₹4,800, plus 2 hours at twice ₹100 = ₹400 in the first week. */
    expect(line(0, ravi)).toMatchObject({ gross: 5200, pfWage: 4800, overtimeAmount: 400, pfEmployee: 576, esiEmployee: 39, canteen: 120, advanceRecovery: 300 });
    expect(line(0, ravi).net).toBe(5200 - 576 - 39 - 120 - 300);
    /* PF across the month: 576 a week until the ₹15,000 ceiling, then the rest — ₹1,800 for the month, not four times it. */
    expect([0, 1, 2, 3].map((i) => line(i, ravi).pfEmployee)).toEqual([576, 576, 576, 72]);
    expect([0, 1, 2, 3].map((i) => line(i, anil).pfEmployee)).toEqual([792, 792, 216, 0]);
    /* ESI: Ravi's month at ₹800 a day is under the threshold; Anil's at ₹1,100 is not. */
    expect(line(1, ravi).esiEmployee).toBe(36);
    expect(line(1, anil).esiEmployee).toBe(0);
    /* Professional tax once, on the last sheet, on the month: Anil's ₹26,400 is in Karnataka's ₹200 band, Ravi's ₹19,600 is not. */
    expect([0, 1, 2].map((i) => line(i, anil).ptEmployee)).toEqual([0, 0, 0]);
    expect(line(3, anil).ptEmployee).toBe(200);
    expect(line(3, ravi).ptEmployee).toBe(0);
    /* The advance came down by what each sheet recovered, and stops at the balance. */
    expect([0, 1, 2, 3].map((i) => line(i, ravi).advanceRecovery)).toEqual([300, 300, 300, 100]);
    const after = (await api.get(c, `/weekly-wages/rates?payGroupId=${group}`).expect(200)).body.rates.find((r: any) => r.employeeId === ravi);
    expect(after.advanceBalance).toBe(0);

    /* Back to draft puts the recovery back; only the latest sheet. */
    await api.post(c, `/weekly-wages/sheets/${sheets[2].id}/reopen`).expect(409);
    await api.post(c, `/weekly-wages/sheets/${sheets[3].id}/reopen`).expect(200);
    const back = (await api.get(c, `/weekly-wages/rates?payGroupId=${group}`).expect(200)).body.rates.find((r: any) => r.employeeId === ravi);
    expect(back.advanceBalance).toBe(100);
    await api.post(c, `/weekly-wages/sheets/${sheets[3].id}/approve`).expect(200);

    /* Bank file: account numbers only in the CSV; the screen gets counts. */
    await api.get(c, `/weekly-wages/sheets/${sheets[0].id}/bank-file`).expect(200).expect((r) => {
      expect(r.body).toMatchObject({ reference: 'WAGES-2027-01-04', bankCount: 2, cash: [] });
      expect(JSON.stringify(r.body)).not.toContain('5010W199');
    });
    const csv = await api.get(c, `/weekly-wages/sheets/${sheets[0].id}/bank-file?format=csv`).expect(200);
    expect(csv.text).toContain('5010W199');
    expect(csv.text.split('\n')).toHaveLength(3);

    /* Paid: not before the last day of the sheet. */
    await api.post(c, `/weekly-wages/sheets/${sheets[0].id}/paid`, { paidOn: '2027-01-09' }).expect(400);
    const paid = (await api.post(c, `/weekly-wages/sheets/${sheets[0].id}/paid`, { paidOn: '2027-01-11', reference: 'UTR123' }).expect(200)).body.sheet;
    expect(paid).toMatchObject({ status: 'PAID', paidOn: '2027-01-11', paymentReference: 'UTR123' });
    await api.post(c, `/weekly-wages/sheets/${sheets[0].id}/reopen`).expect(409);
    await api.del(c, `/weekly-wages/sheets/${sheets[0].id}`).expect(409);

    /* The wage slip. */
    const slip = (await api.get(c, `/weekly-wages/sheets/${sheets[0].id}/slips/${ravi}`).expect(200)).body;
    expect(slip.sheet).toMatchObject({ startDate: '2027-01-04', status: 'PAID' });
    expect(slip.line).toMatchObject({ name: 'Ravi Kumar', gross: 5200, bankAccount: expect.stringMatching(/W199$/) });

    /* The month, for the returns. */
    const month = (await api.get(c, '/weekly-wages/months/2027-01').expect(200)).body;
    expect(month.drafts).toBe(0);
    expect(month.rows.find((r: any) => r.employeeId === ravi)).toMatchObject({ pfEmployee: 1800, daysWorked: 24, gross: 19600, sheets: 4 });
    expect(month.rows.find((r: any) => r.employeeId === anil)).toMatchObject({ pfEmployee: 1800, ptEmployee: 200, esiEmployee: 0, gross: 26400 });
    expect(month.totals.pfEmployee).toBe(3600);
    const ecr = await api.get(c, '/weekly-wages/months/2027-01?format=ecr').expect(200);
    const ecrLines = ecr.text.split('\n');
    expect(ecrLines).toHaveLength(2);
    expect(ecrLines.find((l: string) => l.startsWith('100000000001'))).toBe('100000000001#~#RAVI KUMAR#~#19600#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#4#~#0');
    const summaryCsv = await api.get(c, '/weekly-wages/months/2027-01?format=csv').expect(200);
    expect(summaryCsv.text.split('\n')[0]).toContain('PF (employee)');

    /* The next sheet starts straight after; a later draft can be deleted. */
    expect((await api.get(c, `/weekly-wages/next-start?payGroupId=${group}`).expect(200)).body.startDate).toBe('2027-02-01');
    const feb = (await api.post(c, '/weekly-wages/sheets', { payGroupId: group, startDate: '2027-02-01' }).expect(201)).body.sheet;
    expect(feb.wageMonth).toBe('2027-02');
    await api.del(c, `/weekly-wages/sheets/${feb.id}`).expect(200);
    const listed = (await api.get(c, `/weekly-wages/sheets?payGroupId=${group}`).expect(200)).body.sheets;
    expect(listed.map((s: any) => s.startDate)).toEqual(['2027-01-25', '2027-01-18', '2027-01-11', '2027-01-04']);

    /* The monthly payroll is untouched: no run exists. */
    expect(await payrollPrisma.payrollRun.count({ where: { orgId: c.orgId } })).toBe(0);
  });

  it('keeps one company out of another company\'s sheets', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const group = (await api.post(a, '/pay-groups', { name: `Site ${rnd()}`, frequency: 'FORTNIGHTLY' }).expect(201)).body.payGroup.id;
    const who = await worker(a, 'Suma Rao', 'W9', '100000000009');
    await api.put(a, '/weekly-wages/rates', { employeeId: who, payGroupId: group, dailyRate: 700 }).expect(200);
    const sheet = (await api.post(a, '/weekly-wages/sheets', { payGroupId: group, startDate: '2027-01-04' }).expect(201)).body.sheet;
    expect(sheet.endDate).toBe('2027-01-17');
    await request(app).get(`/api/orgs/${b.orgId}/payroll/weekly-wages/sheets/${sheet.id}`).set(at(b)).expect(404);
    await request(app).get(`/api/orgs/${a.orgId}/payroll/weekly-wages/sheets/${sheet.id}`).set(at(b)).expect(403);
    /* Nothing to pay: approving a sheet with no days is refused. */
    const empty = await api.post(a, `/weekly-wages/sheets/${sheet.id}/approve`).expect(400);
    expect(empty.body.code).toBe('NOTHING_TO_PAY');
  });
});
