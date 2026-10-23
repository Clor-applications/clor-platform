import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The recycle bin (services/recycleBin.ts): a delete keeps a copy for
 * RECYCLE_BIN_DAYS; restore writes it back under the same id, with what went
 * with it; a clash is refused with the reason; expired items are purged.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { purgeRecycleBin } = await import('../services/recycleBin.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const jwt = (await import('jsonwebtoken')).default;

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `bin.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Bin Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}${p}`).set(at(c)),
});

let c: Ctx;
beforeAll(async () => {
  c = await makeOwner();
}, 60_000);

describe('recycle bin', () => {
  it('keeps a deleted holiday and restores it under the same id', async () => {
    const h = (await api(c).post('/attendance/holidays', { date: '2026-11-14', name: 'Diwali' }).expect(201)).body.holiday;
    await api(c).del(`/attendance/holidays/${h.id}`).expect(200);
    expect(await peoplePrisma.holiday.count({ where: { id: h.id } })).toBe(0);

    const bin = (await api(c).get('/recycle-bin').expect(200)).body;
    expect(bin.days).toBe(30);
    const item = bin.items.find((i: any) => i.kind === 'holiday');
    expect(item).toMatchObject({ type: 'Holiday', label: 'Diwali · 2026-11-14' });
    expect(new Date(item.purgeAfter).getTime() - new Date(item.deletedAt).getTime()).toBe(30 * 86_400_000);

    await api(c).post(`/recycle-bin/${item.id}/restore`).expect(200);
    const back = await peoplePrisma.holiday.findUniqueOrThrow({ where: { id: h.id } });
    expect(back.name).toBe('Diwali');
    expect((await api(c).get('/recycle-bin').expect(200)).body.items).toHaveLength(0);
  });

  it('refuses a restore when something now stands in its place', async () => {
    const h = (await api(c).post('/attendance/holidays', { date: '2026-12-25', name: 'Christmas' }).expect(201)).body.holiday;
    await api(c).del(`/attendance/holidays/${h.id}`).expect(200);
    await api(c).post('/attendance/holidays', { date: '2026-12-25', name: 'Christmas' }).expect(201);
    const item = (await api(c).get('/recycle-bin')).body.items.find((i: any) => i.kind === 'holiday');
    const r = await api(c).post(`/recycle-bin/${item.id}/restore`).expect(409);
    expect(r.body.error).toMatch(/Cannot restore/);
    /* Still in the bin, to delete for good. */
    await api(c).del(`/recycle-bin/${item.id}`).expect(200);
    expect(await peoplePrisma.deletedItem.count({ where: { id: item.id } })).toBe(0);
  });

  it('brings an employee back with their notes and the people who reported to them', async () => {
    const boss = (await api(c).post('/people/employees', { name: 'Meera', code: 'B1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    const report = (await api(c).post('/people/employees', { name: 'Ravi', code: 'R1', dateOfJoining: '2026-01-01', reportingManagerId: boss.id }).expect(201)).body.employee;
    await api(c).post(`/people/employees/${boss.id}/notes`, { body: 'Leads the night shift.' }).expect(201);

    await api(c).del(`/people/employees/${boss.id}`).expect(200);
    expect((await peoplePrisma.employee.findUniqueOrThrow({ where: { id: report.id } })).reportingManagerId).toBeNull();
    expect(await peoplePrisma.employeeNote.count({ where: { employeeId: boss.id } })).toBe(0);

    const item = (await api(c).get('/recycle-bin')).body.items.find((i: any) => i.kind === 'employee');
    expect(item.label).toBe('Meera (B1)');
    await api(c).post(`/recycle-bin/${item.id}/restore`).expect(200);
    expect((await peoplePrisma.employee.findUniqueOrThrow({ where: { id: boss.id } })).name).toBe('Meera');
    expect(await peoplePrisma.employeeNote.count({ where: { employeeId: boss.id } })).toBe(1);
    expect((await peoplePrisma.employee.findUniqueOrThrow({ where: { id: report.id } })).reportingManagerId).toBe(boss.id);
  });

  it('records restores in the audit log, and Attendance sees only its own entries', async () => {
    const entries = (await api(c).get('/audit?app=attendance&limit=200').expect(200)).body.entries;
    expect(entries.some((e: any) => e.action === 'RESTORE' && /Meera/.test(e.message))).toBe(true);
    expect(entries.every((e: any) => /^(ATTENDANCE_|PEOPLE_)/.test(e.entity) || ['Employee', 'Company'].includes(e.entity))).toBe(true);
  });

  it('purges items whose days are over', async () => {
    const h = (await api(c).post('/attendance/holidays', { date: '2026-08-15', name: 'Independence Day' }).expect(201)).body.holiday;
    await api(c).del(`/attendance/holidays/${h.id}`).expect(200);
    expect(await purgeRecycleBin(new Date(Date.now() + 31 * 86_400_000))).toBeGreaterThan(0);
    expect(await peoplePrisma.deletedItem.count({ where: { orgId: c.orgId } })).toBe(0);
  });
});

/*
 * A-14: the subscription ceiling in the shared permission check covered only
 * Accounting's modules. The recycle bin authorises with that check alone, so
 * an account that no longer had People or Attendance could still restore
 * (and permanently delete) their records from it.
 */
describe('the recycle bin after People and Attendance leave the subscription', () => {
  it('refuses to restore their records', async () => {
    const o = await makeOwner();
    const h = (await api(o).post('/attendance/holidays', { date: '2026-12-25', name: 'Christmas' }).expect(201)).body.holiday;
    await api(o).del(`/attendance/holidays/${h.id}`).expect(200);
    const item = (await api(o).get('/recycle-bin').expect(200)).body.items.find((i: any) => i.kind === 'holiday');
    const accountId = (jwt.decode(o.token) as any).accountId;
    await platformPrisma.subscriptionItem.deleteMany({ where: { subscription: { accountId }, appCode: { in: ['people', 'attendance'] } } });
    const res = await api(o).post(`/recycle-bin/${item.id}/restore`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('APP_NOT_SUBSCRIBED');
    expect(await peoplePrisma.holiday.count({ where: { id: h.id } })).toBe(0);
  });
});
