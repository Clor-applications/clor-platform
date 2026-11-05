import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * A bigger company: 600 people, nobody marked for a week. Month close and the
 * Exception Center must reach every one of them, a kind must reach all of that
 * kind, and a bulk change past its batch size is refused in plain words, never
 * cut short. People are seeded straight into the table, not one form at a time.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const PEOPLE = 600;
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});

/* Days counted from today in India's time, never UTC. */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lastMonth = () => {
  const d = new Date(`${istToday().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

let boss: Ctx;
let ids: string[] = [];
const from = plusDays(istToday(), -7);
const to = plusDays(istToday(), -1);

beforeAll(async () => {
  const email = `many.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Many Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  boss = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${boss.orgId}/features`).set(at(boss)).send({ features: { people: true, attendance: true } }).expect(200);
  boss.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  const first = (await request(app).post(`/api/orgs/${boss.orgId}/people/employees`).set(at(boss)).send({ name: 'Person 0000', code: 'M-0000', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
  const accountId = (await runInTenant(boss.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: first.id } }))).accountId;
  await runInTenant(boss.orgId, () =>
    peoplePrisma.employee.createMany({
      data: Array.from({ length: PEOPLE - 1 }, (_, i) => ({ accountId, orgId: boss.orgId, name: `Person ${String(i + 1).padStart(4, '0')}`, code: `M-${String(i + 1).padStart(4, '0')}`, status: 'ACTIVE', dateOfJoining: '2025-01-01', createdByUserId: boss.userId })) as any,
    })
  );
  ids = (await runInTenant(boss.orgId, () => peoplePrisma.employee.findMany({ where: { orgId: boss.orgId }, select: { id: true }, orderBy: { code: 'asc' } }))).map((e) => e.id);
  expect(ids).toHaveLength(PEOPLE);
  /* Three people checked in yesterday and never out. */
  for (const id of ids.slice(0, 3)) await att(boss).put('/records', { employeeId: id, date: to, checkIn: '09:00' }).expect(200);
}, 180_000);

describe(`month close with ${PEOPLE} people`, () => {
  it('lists every person with something open, and the checklist adds up to them', async () => {
    const month = lastMonth();
    const r = (await att(boss).get(`/months/${month}/readiness`).expect(200)).body;
    const open = r.people.filter((p: any) => p.missingOut || p.noRecord || p.unapprovedOvertime || p.unvalidated);
    expect(r.people).toHaveLength(PEOPLE);
    expect(open).toHaveLength(PEOPLE);
    const noRecord = r.checks.find((c: any) => c.key === 'noRecord').count;
    expect(open.reduce((s: number, p: any) => s + p.noRecord, 0)).toBe(noRecord);
    expect(new Set(open.map((p: any) => p.employeeId)).size).toBe(PEOPLE);
  }, 60_000);
});

describe(`the Exception Center with ${PEOPLE} people`, () => {
  it('reaches every item of one kind, past the old 1,000, and counts the figures over all of them', async () => {
    const all = (await att(boss).get(`/exceptions?from=${from}&to=${to}`).expect(200)).body;
    const noRecord = all.counts.NO_RECORD;
    expect(noRecord).toBeGreaterThan(1000);
    expect(all.counts.MISSING_OUT).toBe(3);
    expect(all.figures.medium).toBe(noRecord);
    expect(all.figures.high).toBe(3);

    const one = (await att(boss).get(`/exceptions?from=${from}&to=${to}&kind=NO_RECORD`).expect(200)).body;
    expect(one.total).toBe(noRecord);
    expect(one.exceptions).toHaveLength(noRecord);
    expect(one.truncated).toBe(false);
    expect(one.exceptions.every((x: any) => x.kind === 'NO_RECORD')).toBe(true);
    expect(new Set(one.exceptions.map((x: any) => x.employeeId)).size).toBe(PEOPLE);

    const out = (await att(boss).get(`/exceptions?from=${from}&to=${to}&kind=MISSING_OUT`).expect(200)).body;
    expect(out.exceptions.map((x: any) => x.kind)).toEqual(['MISSING_OUT', 'MISSING_OUT', 'MISSING_OUT']);
    expect(out.total).toBe(3);
  }, 60_000);

  it('refuses a bulk change past 500 in plain words, and settles 600 picked in two batches', async () => {
    /* The working day with the most people unmarked (the range may hold a weekly off or a holiday). */
    const one = (await att(boss).get(`/exceptions?from=${from}&to=${to}&kind=NO_RECORD`).expect(200)).body;
    const perDay = new Map<string, number>();
    for (const x of one.exceptions) perDay.set(x.date, (perDay.get(x.date) || 0) + 1);
    const day = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const keys = ids.map((id) => `NO_RECORD:${id}:${day}`);
    const refused = await att(boss).post('/exceptions/state/bulk', { keys: keys.slice(0, 501), status: 'RESOLVED' }).expect(400);
    expect(refused.body.error).toBe('At most 500 items at a time. Send the rest in another batch.');

    const before = (await att(boss).get(`/exceptions?from=${day}&to=${day}&kind=NO_RECORD`).expect(200)).body;
    const openOnDay = before.exceptions.filter((x: any) => keys.includes(x.key)).length;
    expect(openOnDay).toBeGreaterThan(0);
    let updated = 0;
    for (let i = 0; i < keys.length; i += 500) updated += (await att(boss).post('/exceptions/state/bulk', { keys: keys.slice(i, i + 500), status: 'RESOLVED', note: 'Office closed' }).expect(200)).body.updated;
    expect(updated).toBe(PEOPLE);
    const after = (await att(boss).get(`/exceptions?from=${day}&to=${day}&kind=NO_RECORD`).expect(200)).body;
    expect(after.total).toBe(0);
    const settled = (await att(boss).get(`/exceptions?from=${day}&to=${day}&kind=NO_RECORD&show=all`).expect(200)).body;
    expect(settled.exceptions.filter((x: any) => x.status === 'RESOLVED')).toHaveLength(openOnDay);
  }, 60_000);
});
