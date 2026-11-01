import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The web employee app's gaps (docs/people/design-v1/audit-views/EMPLOYEE-VIEW.md):
 * the feed tells a person with the app alone what others did to their
 * requests (decided with the note, cancelled, shortened) and that leave will
 * lapse; the year's holidays come in one list; Ask HR says where HR wrote
 * last; and the terms carry the notice period the resign form fills from.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `pea.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `PEA Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, peopleEngage: true } }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/* A Monday at least a month ahead, so the leave below is in the future and on working days. */
const monday = (() => {
  let d = plus(istToday(), 35);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = plus(d, 1);
  return d;
})();

async function portalOf(c: Ctx, employee: { id: string; code: string }) {
  const code = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
  const issued = (await att(c, 'post', '/portal-access/codes', { employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: code, employeeCode: employee.code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
  };
}

describe('the employee app feed (/portal/updates)', () => {
  let c: Ctx;
  let asha: any;
  let typeId: string;
  beforeAll(async () => {
    c = await company();
    asha = await person(c, { name: 'Asha', code: 'F1' });
    typeId = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type.id;
  }, 90_000);

  it('says what HR did with the note, leaves out what I did myself, and keeps old keys', async () => {
    const me = await portalOf(c, asha);
    const ask = async (from: string, to: string) => (await me.post('/leave', { leaveTypeId: typeId, fromDate: from, toDate: to, reason: 'Family function' }).expect(201)).body.request;
    const rejected = await ask(monday, monday);
    await att(c, 'post', `/leave/requests/${rejected.id}/reject`, { note: 'Stock count that day' }).expect(200);
    const cancelledByHr = await ask(plus(monday, 1), plus(monday, 1));
    await att(c, 'post', `/leave/requests/${cancelledByHr.id}/approve`, {}).expect(200);
    await att(c, 'post', `/leave/requests/${cancelledByHr.id}/cancel`, {}).expect(200);
    const shortened = await ask(plus(monday, 7), plus(monday, 10));
    await att(c, 'post', `/leave/requests/${shortened.id}/approve`, {}).expect(200);
    await att(c, 'post', `/leave/requests/${shortened.id}/shorten`, { toDate: plus(monday, 8) }).expect(200);
    const mine = await ask(plus(monday, 14), plus(monday, 14));
    await me.post(`/leave/${mine.id}/cancel`).expect(200);

    const feed = (await me.get('/updates').expect(200)).body;
    const byKey = new Map(feed.decided.map((d: any) => [d.key, d]));
    const rej: any = byKey.get(`leave:${rejected.id}:REJECTED`);
    expect(rej).toMatchObject({ kind: 'leave', status: 'REJECTED', note: 'Stock count that day' });
    expect(rej.text).toMatch(/^Casual .* was rejected\. “Stock count that day”$/);
    expect(byKey.get(`leave:${cancelledByHr.id}:CANCELLED`)).toMatchObject({ status: 'CANCELLED' });
    const short: any = byKey.get(`leave:${shortened.id}:SHORTENED:${plus(monday, 8)}`);
    expect(short.text).toMatch(/now ends .*, not /);
    expect(byKey.get(`leave:${shortened.id}:APPROVED`)).toBeTruthy();
    /* My own withdrawal is not news. */
    expect(feed.decided.some((d: any) => d.key.startsWith(`leave:${mine.id}`))).toBe(false);
    /* Every item carries the shape the phone already reads. */
    for (const d of feed.decided) expect(typeof d.key === 'string' && typeof d.text === 'string').toBe(true);
  }, 90_000);

  it('warns a person with no CLOR sign-in that leave will lapse, once the period end is near', async () => {
    const c2 = await company();
    /* A leave period that ends within the coming month: it starts on a day 2..25 days from now. */
    let start = plus(istToday(), 2);
    while (Number(start.slice(8)) > 28) start = plus(start, 1);
    await att(c2, 'put', '/leave/settings', { startMonth: Number(start.slice(5, 7)), startDay: Number(start.slice(8)) }).expect(200);
    await att(c2, 'post', '/leave/types', { name: 'Earned', annualDays: 12 }).expect(201);
    const ravi = await person(c2, { name: 'Ravi', code: 'L1', dateOfJoining: '2024-01-01' });
    const me = await portalOf(c2, ravi);
    const lapse = (await me.get('/updates').expect(200)).body.decided.find((d: any) => d.kind === 'lapse');
    expect(lapse).toBeTruthy();
    expect(lapse.key).toMatch(/^lapse:\d{4}$/);
    expect(lapse.text).toMatch(/of leave will lapse on .* unless you take them: Earned /);
  }, 90_000);
});

describe('my holidays for a year (/portal/holidays)', () => {
  it('lists every holiday of mine and marks the restricted ones with my picks', async () => {
    const c = await company();
    const y = Number(istToday().slice(0, 4)) + 1;
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0', restrictedHolidayQuota: 1 }).expect(200);
    await att(c, 'post', '/holidays', { date: `${y}-01-26`, name: 'Republic Day' }).expect(201);
    const optional = (await att(c, 'post', '/holidays', { date: `${y}-03-04`, name: 'Holi', isOptional: true }).expect(201)).body.holiday;
    await att(c, 'post', '/holidays', { date: `${y + 1}-01-26`, name: 'Republic Day' }).expect(201);
    const e = await person(c, { name: 'Meera', code: 'H1' });
    const me = await portalOf(c, e);
    await me.post(`/holidays/restricted/${optional.id}`, { picked: true }).expect(200);
    const out = (await me.get(`/holidays?year=${y}`).expect(200)).body;
    expect(out).toMatchObject({ year: y, quota: 1, picked: 1, left: 0 });
    expect(out.holidays.map((h: any) => [h.date, h.name, h.restricted, h.picked])).toEqual([
      [`${y}-01-26`, 'Republic Day', false, false],
      [`${y}-03-04`, 'Holi', true, true],
    ]);
    /* A nonsense year falls back to this one rather than failing. */
    expect((await me.get('/holidays?year=abc').expect(200)).body.year).toBe(Number(istToday().slice(0, 4)));
  }, 90_000);
});

describe('Ask HR and resigning in the app', () => {
  it('marks a question where HR wrote last, and not one where I answered', async () => {
    const c = await company();
    const e = await person(c, { name: 'Imran', code: 'D1' });
    const me = await portalOf(c, e);
    const q = (await me.post('/people/desk', { category: 'PAYROLL', subject: 'Salary short', description: 'October salary is 2,000 less.' }).expect(201)).body.request;
    let list = (await me.get('/people/desk').expect(200)).body;
    expect(list.available).toBe(true);
    expect(list.requests.find((r: any) => r.id === q.id).hrWroteLast).toBe(false);
    await ppl(c, 'post', `/desk/${q.id}/messages`, { body: 'Checking with Payroll', internal: true }).expect(201);
    list = (await me.get('/people/desk').expect(200)).body;
    expect(list.requests.find((r: any) => r.id === q.id).hrWroteLast).toBe(false);
    await ppl(c, 'post', `/desk/${q.id}/messages`, { body: 'Which days were you on leave?' }).expect(201);
    list = (await me.get('/people/desk').expect(200)).body;
    expect(list.requests.find((r: any) => r.id === q.id).hrWroteLast).toBe(true);
    await me.post(`/people/desk/${q.id}/messages`, { body: 'Only 14 October.' }).expect(201);
    list = (await me.get('/people/desk').expect(200)).body;
    expect(list.requests.find((r: any) => r.id === q.id).hrWroteLast).toBe(false);
  }, 90_000);

  it('my terms carry the notice period; resigning shows as waiting', async () => {
    const c = await company();
    const e = await person(c, { name: 'Kiran', code: 'R1' });
    const type = await runInTenant(c.orgId, async () => {
      const org = await peoplePrisma.employee.findFirst({ where: { id: e.id }, select: { accountId: true } });
      return peoplePrisma.employeeType.create({ data: { accountId: org!.accountId, orgId: c.orgId, name: `Staff ${rnd()}`, noticeDays: 30, createdByUserId: 'test' } });
    });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { employeeTypeId: type.id } }));
    const me = await portalOf(c, e);
    expect((await me.get('/people/me/details').expect(200)).body.terms.noticeDays).toBe(30);
    await me.post('/people/me/resign', { lastDay: plus(istToday(), 30), reason: 'Moving city' }).expect(202);
    const leaving = (await me.get('/people/me/leaving').expect(200)).body;
    expect(leaving.waiting).toMatchObject({ status: 'WAITING' });
  }, 90_000);
});
