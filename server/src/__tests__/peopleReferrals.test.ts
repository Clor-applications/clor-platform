import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Employee referrals (A20, services/people/talent/referrals.ts): HR opens a job to referrals
 * with a bonus and an audience; staff refer from CLOR or the employee app, or share their own
 * link; duplicates are refused (the race too) and the first referrer keeps the credit; the
 * referrer reads the stage in plain words only; the bonus becomes due, goes to Payroll as one
 * draft earning, or is forfeited when the hire leaves before the date.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { settleBonuses, sendBonusToPayroll, forfeitBonus, sweepOutcomes, linkFor, referrerById } = await import('../services/people/talent/referrals.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (n: number, from = today()) => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function owner(features: Record<string, boolean> = {}): Promise<Ctx> {
  const email = `ref.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Refer Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, ...features } }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b?: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
async function portal(c: Ctx, employee: { id: string; code: string }) {
  const company = (await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200)).body.company.code;
  const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company, employeeCode: employee.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
  const h = { Authorization: `Bearer ${token}` };
  return {
    get: (p: string) => request(app).get(`/api/portal${p}`).set(h),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set(h).send(b as any),
  };
}
const NEUTRAL = 'We can’t take this referral. HR already has this person’s details. Thank you for thinking of them.';
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')}`;

describe('employee referrals, end to end', () => {
  let c: Ctx;
  let recruiterView: Ctx;
  let staffUser: Ctx;
  let outsider: Ctx;
  let sales: any;
  let ops: any;
  let ravi: any;
  let meena: any;
  let opening: any;
  beforeAll(async () => {
    c = await owner({ payroll: false });
    sales = (await api(c).post('/structure/departments', { name: 'Sales' }).expect(201)).body.item;
    ops = (await api(c).post('/structure/departments', { name: 'Operations' }).expect(201)).body.item;
    ravi = (await api(c).post('/employees', { name: 'Ravi Kumar', code: 'E-1', dateOfJoining: '2024-01-01', departmentId: sales.id, phone: '9811111111' }).expect(201)).body.employee;
    meena = (await api(c).post('/employees', { name: 'Meena Iyer', code: 'E-2', dateOfJoining: '2024-01-01', departmentId: ops.id }).expect(201)).body.employee;
    staffUser = await colleague(c, 'Ravi', []);
    await link(c, ravi.id, staffUser.userId);
    recruiterView = await colleague(c, 'Rekha', ['PEOPLE::Recruitment::VIEW']);
    outsider = await colleague(c, 'Nobody', []);
    opening = (await api(c).post('/talent/openings', { title: 'Sales executive', departmentId: sales.id, places: 2, status: 'OPEN' }).expect(201)).body.opening;
  }, 120_000);

  it('HR opens a job to referrals; other roles and other companies are refused; bad settings are refused', async () => {
    await api(recruiterView).put(`/talent/openings/${opening.id}/referrals`, { referralOpen: true }).expect(403);
    await api(staffUser).put(`/talent/openings/${opening.id}/referrals`, { referralOpen: true }).expect(403);
    await api(c).put(`/talent/openings/${opening.id}/referrals`, { referralOpen: true, referAudience: 'DEPARTMENTS', referDepartmentIds: [] }).expect(400);
    await api(c).put(`/talent/openings/${opening.id}/referrals`, { referralOpen: true, referralBonus: -5 }).expect(400);
    const other = await owner();
    await api(other).put(`/talent/openings/${opening.id}/referrals`, { referralOpen: true }).expect(404);
    const s = (await api(c).put(`/talent/openings/${opening.id}/referrals`, { referralOpen: true, referralBonus: 5000, referralBonusDays: 30, referAudience: 'DEPARTMENTS', referDepartmentIds: [sales.id], internalApply: true }).expect(200)).body.settings;
    expect(s).toMatchObject({ referralOpen: true, referralBonus: 5000, referralBonusDays: 30, referAudience: 'DEPARTMENTS', internalApply: true });
    /* Recruitment view alone reads the settings without the amount. */
    const seen = (await api(recruiterView).get(`/talent/openings/${opening.id}/referrals`).expect(200)).body.settings;
    expect(seen).toMatchObject({ referralOpen: true, referralBonus: null, hasBonus: true });
    /* The staff who may refer were told on the bell. */
    const bell = await runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, userId: staffUser.userId, kind: 'people.referral' } }));
    expect(bell.map((n) => n.title)).toEqual(['Know someone for Sales executive?']);
  }, 60_000);

  it('only people who work here, in the audience, see and refer; a résumé is checked by its bytes', async () => {
    const jobs = (await api(staffUser).get('/referrals/me').expect(200)).body;
    expect(jobs.employee).toBe(true);
    expect(jobs.jobs.map((j: any) => j.title)).toEqual(['Sales executive']);
    expect(jobs.jobs[0]).toMatchObject({ canRefer: true, canApply: true, bonus: 5000 });
    expect(jobs.jobs[0].bonusAfter).toBe('30 days after they join, if they are still here and you still work here then');
    /* A user with no employee record: nothing to refer from. */
    expect((await api(outsider).get('/referrals/me').expect(200)).body).toMatchObject({ employee: false, jobs: [] });
    expect((await api(outsider).post('/referrals/me/refer', { openingId: opening.id, name: 'X', phone: '9822222222' }).expect(403)).body.code).toBe('NOT_EMPLOYEE');
    /* Meena is in Operations: the job is open to Sales only. */
    const meenaApp = await portal(c, meena);
    expect((await meenaApp.get('/people/referrals').expect(200)).body.jobs).toHaveLength(0);
    expect((await meenaApp.post('/people/referrals/refer', { openingId: opening.id, name: 'Friend', phone: '9822222222' }).expect(403)).body.code).toBe('NOT_YOURS');
    /* Contact needed; not myself; a file that is not what it says is refused. */
    await api(staffUser).post('/referrals/me/refer', { openingId: opening.id, name: 'No contact' }).expect(400);
    expect((await api(staffUser).post('/referrals/me/refer', { openingId: opening.id, name: 'Me', phone: '+91 98111 11111' }).expect(400)).body.code).toBe('SELF');
    await api(staffUser).post('/referrals/me/refer', { openingId: opening.id, name: 'Fake', phone: '9833333333', resume: { name: 'cv.pdf', data: `data:application/pdf;base64,${Buffer.from('not a pdf at all').toString('base64')}` } }).expect(400);
    const made = await api(staffUser).post('/referrals/me/refer', { openingId: opening.id, name: 'Priya Shah', phone: '98444 44444', email: 'priya@example.com', relation: 'College friend', note: 'Sold insurance for 3 years', resume: { name: 'priya.pdf', data: PDF } }).expect(201);
    const r = await runInTenant(c.orgId, () => peoplePrisma.referral.findUniqueOrThrow({ where: { id: made.body.referral.id } }));
    expect(r).toMatchObject({ referrerEmployeeId: ravi.id, via: 'FORM', phoneKey: '9844444444', emailKey: 'priya@example.com', bonusStatus: 'NONE' });
    expect(Number(r.bonusAmount)).toBe(5000);
    const cand = await runInTenant(c.orgId, () => peoplePrisma.candidate.findUniqueOrThrow({ where: { id: r.candidateId } }));
    expect(cand).toMatchObject({ source: 'REFERRAL', sourceDetail: 'Ravi Kumar', stage: 'APPLIED', resumeMime: 'application/pdf' });
    /* HR sees the referrer on the candidate; an interviewer-only view does not get it. */
    const card = (await api(c).get(`/talent/candidates/${r.candidateId}`).expect(200)).body;
    expect(card.referral).toMatchObject({ referrer: 'Ravi Kumar', relation: 'College friend', via: 'FORM' });
  }, 90_000);

  it('the same person twice is refused politely, the first referrer keeps the credit, and a race makes one referral', async () => {
    /* Same phone in another shape, on the same opening. */
    const again = await api(staffUser).post('/referrals/me/refer', { openingId: opening.id, name: 'Priya S', phone: '+91-9844444444' }).expect(409);
    expect(again.body).toMatchObject({ code: 'DUPLICATE_REFERRAL' });
    /* One neutral answer for every refusal: nothing about whether they applied or work here. */
    expect(again.body.error).toBe(NEUTRAL);
    /* Another opening, within six months, by e-mail: still the first referral. */
    const second = (await api(c).post('/talent/openings', { title: 'Store manager', status: 'OPEN' }).expect(201)).body.opening;
    await api(c).put(`/talent/openings/${second.id}/referrals`, { referralOpen: true }).expect(200);
    const meenaApp = await portal(c, meena);
    expect((await meenaApp.post('/people/referrals/refer', { openingId: second.id, name: 'Priya', email: 'PRIYA@example.com' }).expect(409)).body.error).toBe(NEUTRAL);
    /* Someone who works here is not referred. */
    expect((await meenaApp.post('/people/referrals/refer', { openingId: second.id, name: 'Ravi again', phone: '98111 11111' }).expect(409)).body.error).toBe(NEUTRAL);
    /* The real reasons are in the audit log, for HR. */
    const refused = await runInTenant(c.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'Referral', action: 'REFUSED_DUPLICATE' } }));
    expect(refused.map((a) => JSON.parse(a.metadata || '{}').reason).sort()).toEqual(['ON_OPENING', 'REFERRED', 'WORKS_HERE']);
    /* Two people refer one new friend at the same moment: one referral. */
    const ravisApp = await portal(c, ravi);
    const both = await Promise.all([
      ravisApp.post('/people/referrals/refer', { openingId: second.id, name: 'Kiran', phone: '9855555555' }),
      meenaApp.post('/people/referrals/refer', { openingId: second.id, name: 'Kiran R', phone: '+91 98555 55555' }),
    ]);
    expect(both.map((b) => b.status).sort()).toEqual([201, 409]);
    expect(await runInTenant(c.orgId, () => peoplePrisma.referral.count({ where: { orgId: c.orgId, phoneKey: '9855555555' } }))).toBe(1);
  }, 90_000);

  it('the friend applies through the referrer’s link; the link stops when referrals stop', async () => {
    const app1 = await portal(c, ravi);
    const l = (await app1.post('/people/referrals/link', { openingId: opening.id }).expect(200)).body;
    expect(l.link).toMatch(/\/api\/people\/refer\/[a-f0-9]{48}$/);
    expect(l.shareText).toContain('Sales executive');
    /* Asked again: the same link. */
    expect((await api(staffUser).post('/referrals/me/link', { openingId: opening.id }).expect(200)).body.link).toBe(l.link);
    const path = new URL(l.link).pathname;
    const page = await request(app).get(path).expect(200);
    expect(page.text).toContain('referred by Ravi');
    await request(app).post(path).type('form').send({ name: 'Anil Rao', phone: '9866666666', note: 'Ravi told me' }).expect(200);
    const r = await runInTenant(c.orgId, () => peoplePrisma.referral.findFirstOrThrow({ where: { orgId: c.orgId, phoneKey: '9866666666' } }));
    expect(r).toMatchObject({ via: 'LINK', referrerEmployeeId: ravi.id });
    /* A duplicate through the link is thanked the same way and makes nothing. */
    const dup = await request(app).post(path).type('form').send({ name: 'Anil', phone: '98666 66666' }).expect(200);
    expect(dup.text).toContain('Thank you');
    expect(await runInTenant(c.orgId, () => peoplePrisma.referral.count({ where: { orgId: c.orgId, phoneKey: '9866666666' } }))).toBe(1);
    await request(app).get('/api/people/refer/' + 'a'.repeat(48)).expect(410);
    /* Referrals off: the link says the job is not taking applications. */
    await api(c).put(`/talent/openings/${opening.id}/referrals`, { referralOpen: false }).expect(200);
    await request(app).get(path).expect(410);
    await api(c).put(`/talent/openings/${opening.id}/referrals`, { referralOpen: true }).expect(200);
    await request(app).get(path).expect(200);
  }, 60_000);

  it('an employee applies themselves once; hiring them moves them, no second record', async () => {
    const app1 = await portal(c, ravi);
    const a = (await app1.post('/people/referrals/apply', { openingId: opening.id, note: 'I know the area' }).expect(201)).body.application;
    expect((await app1.post('/people/referrals/apply', { openingId: opening.id }).expect(409)).body.code).toBe('DUPLICATE');
    await api(c).post(`/talent/candidates/${a.id}/stage`, { stage: 'OFFER' }).expect(200);
    const before = await runInTenant(c.orgId, () => peoplePrisma.employee.count({ where: { orgId: c.orgId } }));
    const h = (await api(c).post(`/talent/candidates/${a.id}/hire`, {}).expect(201)).body;
    expect(h).toMatchObject({ movedFromWithin: true, employee: { id: ravi.id } });
    expect(await runInTenant(c.orgId, () => peoplePrisma.employee.count({ where: { orgId: c.orgId } }))).toBe(before);
    expect((await app1.get('/people/referrals').expect(200)).body.applications[0]).toMatchObject({ job: 'Sales executive', status: 'Moved to this job' });
  }, 60_000);

  it('the referrer reads plain stages only; Joined and Not taken forward reach them; HR lists and filters', async () => {
    const app1 = await portal(c, ravi);
    const all = await runInTenant(c.orgId, () => peoplePrisma.referral.findMany({ where: { orgId: c.orgId, referrerEmployeeId: ravi.id, openingId: opening.id } }));
    const priya = all.find((r) => r.phoneKey === '9844444444')!;
    const anil = all.find((r) => r.phoneKey === '9866666666')!;
    await api(c).post(`/talent/candidates/${anil.candidateId}/stage`, { stage: 'REJECTED', reason: 'Wants a desk job; salary ask too high' }).expect(200);
    await api(c).post(`/talent/candidates/${priya.candidateId}/stage`, { stage: 'INTERVIEW' }).expect(200);
    await runInTenant(c.orgId, () => peoplePrisma.candidateEvent.create({ data: { accountId: priya.accountId, orgId: c.orgId, candidateId: priya.candidateId, kind: 'NOTE', text: 'Secret interview notes' } }));
    let mine = (await app1.get('/people/referrals').expect(200)).body;
    const words = Object.fromEntries(mine.referrals.map((r: any) => [r.name, r.status]));
    expect(words).toMatchObject({ 'Priya Shah': 'Interviewing', 'Anil Rao': 'Not taken forward' });
    const blob = JSON.stringify(mine);
    expect(blob).not.toMatch(/Secret|salary ask|desk job/);
    /* What's new tells Ravi about Anil. */
    const updates = (await app1.get('/updates').expect(200)).body.decided;
    expect(updates.some((u: any) => u.kind === 'referral' && /Anil Rao was not taken forward/.test(u.text))).toBe(true);
    /* Priya: offer, hire with a joining date in the past so the bonus date has come. */
    await api(c).post(`/talent/candidates/${priya.candidateId}/stage`, { stage: 'OFFER' }).expect(200);
    await api(c).post(`/talent/candidates/${priya.candidateId}/hire`, { dateOfJoining: plus(-40) }).expect(201);
    const after = await runInTenant(c.orgId, () => peoplePrisma.referral.findUniqueOrThrow({ where: { id: priya.id } }));
    expect(after).toMatchObject({ outcome: 'JOINED', bonusStatus: 'WAITING', bonusDueOn: plus(-10) });
    mine = (await app1.get('/people/referrals').expect(200)).body;
    expect(mine.referrals.find((r: any) => r.name === 'Priya Shah')).toMatchObject({ status: 'Joined', bonus: { amount: 5000 } });
    const bell = await runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, userId: staffUser.userId, kind: 'people.referral' }, orderBy: { createdAt: 'asc' } }));
    expect(bell.map((n) => n.title)).toEqual(expect.arrayContaining(['Anil Rao was not taken forward for Sales executive', 'Priya Shah is joining as Sales executive']));
    /* HR's list: filters, the referrer, and amounts only for Recruitment edit. */
    const list = (await api(c).get('/talent/referrals?status=joined').expect(200)).body;
    expect(list.rows.map((r: any) => r.candidate)).toEqual(['Priya Shah']);
    expect(list.rows[0]).toMatchObject({ referrer: 'Ravi Kumar' });
    const viewOnly = (await api(recruiterView).get('/talent/referrals').expect(200)).body;
    expect(viewOnly.money).toBe(false);
    expect(viewOnly.rows.every((r: any) => r.bonusAmount === null)).toBe(true);
    await api(outsider).get('/talent/referrals').expect(403);
    await api(recruiterView).post(`/talent/referrals/${priya.id}/bonus/paid`).expect(403);
    const report = (await api(c).get('/talent/referrals/report').expect(200)).body;
    expect(report.byEmployee.find((x: any) => x.referrer === 'Ravi Kumar')).toMatchObject({ joined: 1 });
    expect(report.totals.joined).toBe(1);
  }, 90_000);

  it('without Payroll the bonus is due, for HR to pay by hand once', async () => {
    const priya = await runInTenant(c.orgId, () => peoplePrisma.referral.findFirstOrThrow({ where: { orgId: c.orgId, phoneKey: '9844444444' } }));
    /* HR's list only reads; the job winds the clock. */
    expect((await api(c).get('/talent/referrals?status=bonusDue').expect(200)).body.rows).toHaveLength(0);
    await runInTenant(c.orgId, () => settleBonuses(c.orgId));
    const due = (await api(c).get('/talent/referrals?status=bonusDue').expect(200)).body.rows;
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ bonusStatus: 'DUE', bonusAmount: 5000 });
    expect(due[0].bonusNote).toMatch(/pay it by hand/);
    await api(c).post(`/talent/referrals/${priya.id}/bonus/paid`).expect(200);
    await api(c).post(`/talent/referrals/${priya.id}/bonus/paid`).expect(409);
    expect((await runInTenant(c.orgId, () => peoplePrisma.referral.findUniqueOrThrow({ where: { id: priya.id } }))).bonusStatus).toBe('PAID');
  }, 60_000);
});

describe('the referral bonus with Payroll', () => {
  it('a draft earning once, whatever runs twice; a hire who left forfeits it', async () => {
    const c = await owner({ payroll: true });
    const dept = (await api(c).post('/structure/departments', { name: 'Kitchen' }).expect(201)).body.item;
    const asha = (await api(c).post('/employees', { name: 'Asha Rao', code: 'K-1', dateOfJoining: '2024-01-01', departmentId: dept.id }).expect(201)).body.employee;
    const o = (await api(c).post('/talent/openings', { title: 'Cook', places: 3, status: 'OPEN' }).expect(201)).body.opening;
    await api(c).put(`/talent/openings/${o.id}/referrals`, { referralOpen: true, referralBonus: 3000, referralBonusDays: 30 }).expect(200);
    const app1 = await portal(c, asha);
    await app1.post('/people/referrals/refer', { openingId: o.id, name: 'Cook One', phone: '9700000001' }).expect(201);
    await app1.post('/people/referrals/refer', { openingId: o.id, name: 'Cook Two', phone: '9700000002' }).expect(201);
    const [one, two] = await runInTenant(c.orgId, () => peoplePrisma.referral.findMany({ where: { orgId: c.orgId }, orderBy: { phoneKey: 'asc' } }));
    for (const r of [one, two]) {
      await api(c).post(`/talent/candidates/${r.candidateId}/stage`, { stage: 'OFFER' }).expect(200);
      await api(c).post(`/talent/candidates/${r.candidateId}/hire`, { dateOfJoining: plus(-35) }).expect(201);
    }
    /* Cook Two left after a week. */
    const twoHire = await runInTenant(c.orgId, () => peoplePrisma.candidate.findUniqueOrThrow({ where: { id: two.candidateId } }));
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: twoHire.employeeId! }, data: { status: 'LEFT', dateOfLeaving: plus(-28) } }));
    /* No open month yet: due, with the reason. */
    await runInTenant(c.orgId, () => settleBonuses(c.orgId));
    let r1 = await runInTenant(c.orgId, () => peoplePrisma.referral.findUniqueOrThrow({ where: { id: one.id } }));
    expect(r1).toMatchObject({ bonusStatus: 'DUE' });
    expect(r1.bonusNote).toMatch(/no open month/);
    expect((await runInTenant(c.orgId, () => peoplePrisma.referral.findUniqueOrThrow({ where: { id: two.id } }))).bonusStatus).toBe('FORFEITED');
    /* A month opens; HR sends it again — twice at once — and one draft earning exists. */
    const month = today().slice(0, 7);
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    await request(app).post(`/api/orgs/${c.orgId}/payroll/periods`).set(at(c)).send({ name: `Month ${month}`, startDate: `${month}-01`, endDate: end, paymentDate: end }).expect(201);
    const sends = await Promise.all([api(c).post(`/talent/referrals/${one.id}/bonus/send`), runInTenant(c.orgId, () => sendBonusToPayroll(c.orgId, one.id))]);
    expect(sends[0].status).toBe(200);
    const adj = await runInTenant(c.orgId, () => payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, employeeId: asha.id } }));
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ id: `referral-bonus:${one.id}`, status: 'DRAFT', type: 'EARNING' });
    expect(Number(adj[0].amount)).toBe(3000);
    r1 = await runInTenant(c.orgId, () => peoplePrisma.referral.findUniqueOrThrow({ where: { id: one.id } }));
    expect(r1).toMatchObject({ bonusStatus: 'SENT', bonusAdjustmentId: `referral-bonus:${one.id}` });
    /* Paid by hand is refused once it is with Payroll; HR approves it in Payroll. */
    await api(c).post(`/talent/referrals/${one.id}/bonus/paid`).expect(409);
    await request(app).post(`/api/orgs/${c.orgId}/payroll/adjustments/${encodeURIComponent(adj[0].id)}/approve`).set(at(c)).expect(200);
    /* Other company: nothing of this company's referrals. */
    const other = await owner();
    expect((await api(other).get('/talent/referrals').expect(200)).body.rows).toHaveLength(0);
    await api(other).post(`/talent/referrals/${one.id}/bonus/forfeit`, { reason: 'x' }).expect(404);
  }, 120_000);

  it('a manager limited to their own team sees only their team’s referrals', async () => {
    const c = await owner();
    const lead = (await api(c).post('/employees', { name: 'Lead Person', code: 'L-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const report = (await api(c).post('/employees', { name: 'Team Member', code: 'L-2', dateOfJoining: '2024-01-01', reportingManagerId: lead.id }).expect(201)).body.employee;
    const stranger = (await api(c).post('/employees', { name: 'Other Team', code: 'L-3', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const mgr = await colleague(c, 'Lead', ['PEOPLE::Recruitment::VIEW'], true);
    await link(c, lead.id, mgr.userId);
    const o = (await api(c).post('/talent/openings', { title: 'Helper', status: 'OPEN' }).expect(201)).body.opening;
    await api(c).put(`/talent/openings/${o.id}/referrals`, { referralOpen: true }).expect(200);
    await (await portal(c, report)).post('/people/referrals/refer', { openingId: o.id, name: 'Mine One', phone: '9600000001' }).expect(201);
    await (await portal(c, stranger)).post('/people/referrals/refer', { openingId: o.id, name: 'Theirs One', phone: '9600000002' }).expect(201);
    expect((await api(c).get('/talent/referrals').expect(200)).body.rows).toHaveLength(2);
    expect((await api(mgr).get('/talent/referrals').expect(200)).body.rows.map((r: any) => r.candidate)).toEqual(['Mine One']);
  }, 90_000);
});

describe('review fixes: links, the bonus clock and the referrer rule', () => {
  /* A company with Payroll on, an opening with a bonus and Asha who refers. */
  async function setup(bonusDays: number | null = 30) {
    const c = await owner({ payroll: true });
    const asha = (await api(c).post('/employees', { name: 'Asha Rao', code: 'Q-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const o = (await api(c).post('/talent/openings', { title: 'Helper', places: 9, status: 'OPEN' }).expect(201)).body.opening;
    await api(c).put(`/talent/openings/${o.id}/referrals`, { referralOpen: true, referralBonus: 2000, referralBonusDays: bonusDays }).expect(200);
    const me = await portal(c, asha);
    return { c, asha, o, me };
  }
  async function hireOne(c: Ctx, me: any, o: any, phone: string, joined: string) {
    await me.post('/people/referrals/refer', { openingId: o.id, name: `Friend ${phone.slice(-2)}`, phone }).expect(201);
    const r = await runInTenant(c.orgId, () => peoplePrisma.referral.findFirstOrThrow({ where: { orgId: c.orgId, phoneKey: phone } }));
    await api(c).post(`/talent/candidates/${r.candidateId}/stage`, { stage: 'OFFER' }).expect(200);
    await api(c).post(`/talent/candidates/${r.candidateId}/hire`, { dateOfJoining: joined }).expect(201);
    return r;
  }
  const month = async (c: Ctx) => {
    const m = today().slice(0, 7);
    const end = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    await request(app).post(`/api/orgs/${c.orgId}/payroll/periods`).set(at(c)).send({ name: `Month ${m} ${rnd()}`, startDate: `${m}-01`, endDate: end, paymentDate: end }).expect(201);
  };
  const ref = (c: Ctx, id: string) => runInTenant(c.orgId, () => peoplePrisma.referral.findUniqueOrThrow({ where: { id } }));

  it('a rotated link secret: the link shown again works and the old one stops', async () => {
    const { c, asha, o, me } = await setup();
    const first = (await me.post('/people/referrals/link', { openingId: o.id }).expect(200)).body.link;
    await request(app).get(new URL(first).pathname).expect(200);
    const before = process.env.REFERRAL_LINK_SECRET;
    process.env.REFERRAL_LINK_SECRET = `rotated-${rnd()}`;
    try {
      const again = (await me.post('/people/referrals/link', { openingId: o.id }).expect(200)).body.link;
      expect(again).not.toBe(first);
      /* Shown again, the link is saved anew: the old one stops. */
      await request(app).get(new URL(first).pathname).expect(410);
      await request(app).get(new URL(again).pathname).expect(200);
      const e = await runInTenant(c.orgId, () => referrerById(c.orgId, asha.id));
      expect((await runInTenant(c.orgId, () => linkFor(e!, o.id))).link).toBe(again);
    } finally {
      if (before === undefined) delete process.env.REFERRAL_LINK_SECRET;
      else process.env.REFERRAL_LINK_SECRET = before;
    }
  }, 90_000);

  it('the public page says what the referrer will see', async () => {
    const { o, me } = await setup();
    const l = (await me.post('/people/referrals/link', { openingId: o.id }).expect(200)).body.link;
    expect((await request(app).get(new URL(l).pathname).expect(200)).text).toContain('Asha will see your name and whether you joined, never anything else.');
  }, 60_000);

  it('a hire the referral did not hear of is swept; the date follows the hire’s probation as it is now', async () => {
    const { c, me, o } = await setup(null);
    await me.post('/people/referrals/refer', { openingId: o.id, name: 'Swept One', phone: '9500000001' }).expect(201);
    const r = await runInTenant(c.orgId, () => peoplePrisma.referral.findFirstOrThrow({ where: { orgId: c.orgId, phoneKey: '9500000001' } }));
    await api(c).post(`/talent/candidates/${r.candidateId}/stage`, { stage: 'OFFER' }).expect(200);
    await api(c).post(`/talent/candidates/${r.candidateId}/hire`, { dateOfJoining: plus(-10) }).expect(201);
    /* As if the call after the hire had failed. */
    await runInTenant(c.orgId, () => peoplePrisma.referral.update({ where: { id: r.id }, data: { outcome: null, outcomeAt: null, bonusStatus: 'NONE', bonusDueOn: null } }));
    await runInTenant(c.orgId, () => sweepOutcomes(r.accountId, c.orgId));
    let now = await ref(c, r.id);
    expect(now).toMatchObject({ outcome: 'JOINED', bonusStatus: 'WAITING', bonusDueOn: plus(80) });
    expect(now.bonusNote).toMatch(/90 days after they joined/);
    /* Probation set (and then extended) on the hire's record: the date follows it. */
    const hireId = (await runInTenant(c.orgId, () => peoplePrisma.candidate.findUniqueOrThrow({ where: { id: r.candidateId } }))).employeeId!;
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: hireId }, data: { probationEndDate: plus(170) } }));
    await runInTenant(c.orgId, () => settleBonuses(c.orgId));
    now = await ref(c, r.id);
    expect(now).toMatchObject({ bonusStatus: 'WAITING', bonusDueOn: plus(170), bonusNote: 'Due when their probation ends.' });
  }, 90_000);

  it('forfeit and send at once: one wins, and no draft earning is left behind', async () => {
    const { c, asha, me, o } = await setup();
    await month(c);
    const r = await hireOne(c, me, o, '9500000002', plus(-10));
    await runInTenant(c.orgId, () => peoplePrisma.referral.update({ where: { id: r.id }, data: { bonusStatus: 'DUE' } }));
    const who = { accountId: r.accountId, orgId: c.orgId, userId: c.userId };
    const out = await Promise.allSettled([runInTenant(c.orgId, () => sendBonusToPayroll(c.orgId, r.id)), runInTenant(c.orgId, () => forfeitBonus(who, r.id, 'Let go in probation'))]);
    expect(out[1].status).toBe('fulfilled');
    expect((await ref(c, r.id)).bonusStatus).toBe('FORFEITED');
    const live = await runInTenant(c.orgId, () => payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, employeeId: asha.id, status: { not: 'CANCELLED' } } }));
    expect(live).toHaveLength(0);
    /* A bonus already with Payroll: forfeiting it removes the draft. */
    const r2 = await hireOne(c, me, o, '9500000003', plus(-40));
    await runInTenant(c.orgId, () => settleBonuses(c.orgId));
    expect((await ref(c, r2.id)).bonusStatus).toBe('SENT');
    await api(c).post(`/talent/referrals/${r2.id}/bonus/forfeit`, { reason: 'Rehire of a former employee' }).expect(200);
    expect(await runInTenant(c.orgId, () => payrollPrisma.payrollAdjustment.count({ where: { id: `referral-bonus:${r2.id}` } }))).toBe(0);
  }, 120_000);

  it('a referrer who left: not paid by default (notice counts as here); paid in the final settlement when the company says so', async () => {
    const { c, asha, me, o } = await setup();
    await month(c);
    const r1 = await hireOne(c, me, o, '9500000004', plus(-10));
    const r2 = await hireOne(c, me, o, '9500000005', plus(-10));
    /* Serving notice: still here, and the job card says the rule. */
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: asha.id }, data: { status: 'ON_NOTICE', dateOfLeaving: plus(40) } }));
    const jobs = (await me.get('/people/referrals').expect(200)).body.jobs;
    expect(jobs[0].bonusAfter).toMatch(/and you still work here then/);
    /* Left before the date (due in 20 days): forfeited under the default rule. */
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: asha.id }, data: { status: 'LEFT', dateOfLeaving: plus(-1) } }));
    await runInTenant(c.orgId, () => peoplePrisma.referral.update({ where: { id: r2.id }, data: { bonusStatus: 'NONE' } }));
    await runInTenant(c.orgId, () => settleBonuses(c.orgId));
    expect(await ref(c, r1.id)).toMatchObject({ bonusStatus: 'FORFEITED', bonusNote: 'The referrer left before the bonus date.' });
    /* The company pays anyway: due on the date, to be paid in the final settlement, never a draft on a payslip. */
    await api(c).put('/talent/referrals/rule', { forfeitIfReferrerLeaves: false }).expect(200);
    expect((await api(c).get('/talent/referrals/rule').expect(200)).body).toEqual({ forfeitIfReferrerLeaves: false });
    await runInTenant(c.orgId, () => peoplePrisma.referral.update({ where: { id: r2.id }, data: { bonusStatus: 'WAITING' } }));
    await runInTenant(c.orgId, () => settleBonuses(c.orgId, plus(25)));
    const two = await ref(c, r2.id);
    expect(two.bonusStatus).toBe('DUE');
    expect(two.bonusNote).toMatch(/final settlement or by hand/);
    expect(await runInTenant(c.orgId, () => payrollPrisma.payrollAdjustment.count({ where: { id: `referral-bonus:${r2.id}` } }))).toBe(0);
    await api(c).post(`/talent/referrals/${r2.id}/bonus/send`).expect(200);
    expect((await ref(c, r2.id)).bonusStatus).toBe('DUE');
  }, 120_000);

  it('moving someone from within books a job change for the date; someone suspended is not moved', async () => {
    const c = await owner();
    const ops = (await api(c).post('/structure/departments', { name: 'Ops' }).expect(201)).body.item;
    const store = (await api(c).post('/structure/departments', { name: 'Store' }).expect(201)).body.item;
    const kiran = (await api(c).post('/employees', { name: 'Kiran S', code: 'W-1', dateOfJoining: '2024-01-01', departmentId: ops.id }).expect(201)).body.employee;
    const susi = (await api(c).post('/employees', { name: 'Susi T', code: 'W-2', dateOfJoining: '2024-01-01', departmentId: ops.id }).expect(201)).body.employee;
    const o = (await api(c).post('/talent/openings', { title: 'Store lead', departmentId: store.id, places: 2, status: 'OPEN' }).expect(201)).body.opening;
    await api(c).put(`/talent/openings/${o.id}/referrals`, { internalApply: true }).expect(200);
    const a = (await (await portal(c, kiran)).post('/people/referrals/apply', { openingId: o.id }).expect(201)).body.application;
    const b = (await (await portal(c, susi)).post('/people/referrals/apply', { openingId: o.id }).expect(201)).body.application;
    for (const x of [a, b]) await api(c).post(`/talent/candidates/${x.id}/stage`, { stage: 'OFFER' }).expect(200);
    await api(c).post(`/talent/candidates/${a.id}/hire`, { dateOfJoining: plus(7) }).expect(201);
    const changes = await runInTenant(c.orgId, () => peoplePrisma.scheduledChange.findMany({ where: { orgId: c.orgId, employeeId: kiran.id, status: 'PENDING' } }));
    expect(changes.map((x) => [x.field, x.toValue, x.effectiveOn])).toEqual([['departmentId', store.id, plus(7)]]);
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: susi.id }, data: { status: 'SUSPENDED' } }));
    expect((await api(c).post(`/talent/candidates/${b.id}/hire`, {}).expect(409)).body.error).toMatch(/suspended/);
  }, 90_000);
});
