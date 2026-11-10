import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * People plan step 5, the leaving side of the hand-offs: the full and final reads what People
 * knows about the leaving.
 *  1. a resignation's notice: owed from the employment type, served from the resignation date,
 *     the shortfall recovered at a day's pay unless the company waived it;
 *  2. money a department recorded on the clearance sign-off becomes its own line;
 *  3. a register asset still with them becomes a ₹0 deduction for HR to price;
 *  4. accounts' clearance figure is not added twice, and a withdrawn leaving's lines are not read.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { noticeLine } = await import('../services/payroll/finalSettlement.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
  put: (c: Ctx, p: string, b?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
};
const own = <T,>(c: Ctx, fn: () => Promise<T>) => runInTenant(c.orgId, fn);

async function makeOwner(): Promise<Ctx> {
  const email = `leaving.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Leaving Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const orgId = setup.body.company.orgId;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } });
  const c = { token: signup.body.token, orgId, branchId: setup.body.branch.id, accountId: org!.accountId };
  await request(app).put(`/api/orgs/${orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  return c;
}

/** Someone who resigned on 1 Oct with a 30-day notice type and left on 14 Oct: 14 days served, 16 short. */
async function resigned(c: Ctx, o: { waived?: boolean; resignedOn?: string | null } = {}) {
  const person = await api.post(c, '/employees', { name: 'Ravi Kumar', code: `E${rnd()}`, dateOfJoining: '2025-03-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  const employeeId = person.body.employee.id as string;
  await api.put(c, `/employees/${employeeId}`, { name: 'Ravi Kumar', dateOfJoining: '2025-03-01', dateOfLeaving: '2026-10-14', status: 'LEFT' }).expect(200);
  await own(c, async () => {
    const type = await peoplePrisma.employeeType.create({ data: { accountId: c.accountId, orgId: c.orgId, name: `Permanent ${rnd()}`, noticeDays: 30, createdByUserId: 'hr' } });
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { leavingType: 'RESIGNED', resignedOn: o.resignedOn === undefined ? '2026-10-01' : o.resignedOn, noticeWaived: Boolean(o.waived), employeeTypeId: type.id } });
  });
  return employeeId;
}

const propose = async (c: Ctx, employeeId: string) => (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
const line = (s: any, code: string) => s.lines.find((l: any) => l.code === code);

describe('notice on the full and final', () => {
  it('works out the shortfall at a day\'s pay from the gross', async () => {
    const c = await makeOwner();
    const employeeId = await resigned(c);
    const type = await own(c, () => peoplePrisma.employee.findFirstOrThrow({ where: { id: employeeId }, select: { employeeTypeId: true } }));
    const l = await own(c, () => noticeLine(c.orgId, { leavingType: 'RESIGNED', resignedOn: '2026-10-01', noticeWaived: false, employeeTypeId: type.employeeTypeId }, '2026-10-14', 30_000, 'SLIP-1'));
    expect(l).toMatchObject({ code: 'NOTICE', kind: 'DEDUCTION', amount: 16_000 });
    expect(l.explanation).toMatch(/14 days served of 30 days' notice, 16 days short/);
  });

  it('proposes the shortfall line from what People recorded, with no payslip yet', async () => {
    const c = await makeOwner();
    const s = await propose(c, await resigned(c));
    expect(line(s, 'NOTICE')).toMatchObject({ kind: 'DEDUCTION', label: 'Notice not served', amount: 0 });
    expect(line(s, 'NOTICE').explanation).toMatch(/16 days short\. No approved payslip yet/);
  });

  it('recovers nothing when the company waived it, and asks for the date when it is missing', async () => {
    const c = await makeOwner();
    const waived = await propose(c, await resigned(c, { waived: true }));
    expect(line(waived, 'NOTICE')).toMatchObject({ kind: 'EARNING', amount: 0 });
    expect(line(waived, 'NOTICE').explanation).toMatch(/waived/);
    const noDate = await propose(c, await resigned(c, { resignedOn: null }));
    expect(line(noDate, 'NOTICE').explanation).toMatch(/No resignation date/);
  });
});

describe('clearance on the full and final', () => {
  it('adds money each department recorded and assets not returned, but not accounts\' figure or a withdrawn line', async () => {
    const c = await makeOwner();
    const employeeId = await resigned(c);
    await own(c, async () => {
      const base = { accountId: c.accountId, orgId: c.orgId, employeeId, leavingDate: '2026-10-14' };
      const laptop = await peoplePrisma.peopleRecord.create({ data: { accountId: c.accountId, orgId: c.orgId, kind: 'assets', title: 'Laptop', status: 'ASSIGNED', employeeId, details: { assetTag: 'LT-042' }, createdBy: 'hr', updatedBy: 'hr' } });
      const phone = await peoplePrisma.peopleRecord.create({ data: { accountId: c.accountId, orgId: c.orgId, kind: 'assets', title: 'Phone', status: 'RETURNED', employeeId, details: { assetTag: 'PH-7' }, createdBy: 'hr', updatedBy: 'hr' } });
      await peoplePrisma.clearanceLine.createMany({
        data: [
          { ...base, dept: 'IT', label: 'Laptop, devices and accounts', items: [{ title: 'Laptop', assetId: laptop.id, tag: 'LT-042', returned: false }, { title: 'Phone', assetId: phone.id, tag: 'PH-7', returned: false }], sortOrder: 1 },
          { ...base, dept: 'ADMIN', label: 'ID card, keys and access', items: [{ title: 'ID card', returned: false }], direction: 'OWES', amount: 500, note: 'ID card lost', sortOrder: 2 },
          { ...base, dept: 'FINANCE', label: 'Advances, loans and claims', direction: 'OWES', amount: 9_000, sortOrder: 3 },
          { ...base, dept: 'CUSTOM', label: 'Security deposit', direction: 'OWED', amount: 2_000, sortOrder: 4 },
          { ...base, dept: 'CUSTOM', label: 'Old line', direction: 'OWES', amount: 7_777, status: 'WITHDRAWN', sortOrder: 5 },
        ],
      });
    });
    const s = await propose(c, employeeId);
    const clearance = s.lines.filter((l: any) => l.code.startsWith('CLEARANCE_'));
    expect(clearance.map((l: any) => [l.label, l.kind, Number(l.amount)])).toEqual([
      ['Not returned: Laptop (LT-042)', 'DEDUCTION', 0],
      ['Clearance: ID card, keys and access', 'DEDUCTION', 500],
      ['Clearance: Security deposit', 'EARNING', 2_000],
    ]);
    expect(clearance[1].explanation).toMatch(/ID card lost.*Not handed back: ID card/);
    expect(s.lines.some((l: any) => Number(l.amount) === 9_000 || Number(l.amount) === 7_777)).toBe(false);
    /* HR prices the laptop and the settlement saves. */
    const priced = s.lines.map((l: any) => (l.label === 'Not returned: Laptop (LT-042)' ? { ...l, amount: 35_000 } : l));
    const saved = (await api.put(c, `/settlements/${s.id}`, { lines: priced }).expect(200)).body.settlement;
    expect(Number(saved.lines.find((l: any) => l.label === 'Not returned: Laptop (LT-042)').amount)).toBe(35_000);
  });
});
