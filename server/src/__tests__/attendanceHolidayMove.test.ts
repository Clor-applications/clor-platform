import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Someone moved from one location to another in the middle of a month gets the
 * old location's holidays before the move and the new one's after it — in the
 * month summary (and so payable days) and when a single day is written.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { isHoliday } = await import('../services/attendance/days.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `move.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Move owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Move Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const post = (c: Ctx, p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any);

describe('holidays after a mid-month move', () => {
  it('come from where the person was on each day', async () => {
    const c = await makeOwner();
    const bengaluru = (await post(c, '/people/structure/areas', { name: `Bengaluru ${rnd()}` }).expect(201)).body.item;
    const pune = (await post(c, '/people/structure/areas', { name: `Pune ${rnd()}` }).expect(201)).body.item;
    /* On Pune's list today; history says they moved from Bengaluru on 15 September. */
    const p = (await post(c, '/people/employees', { name: 'Mover', dateOfJoining: '2026-01-01', areaId: pune.id }).expect(201)).body.employee;
    const stayer = (await post(c, '/people/employees', { name: 'Stayer', dateOfJoining: '2026-01-01', areaId: pune.id }).expect(201)).body.employee;
    const e = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: p.id } });
    await peoplePrisma.employmentEvent.create({ data: { accountId: e.accountId, orgId: c.orgId, employeeId: p.id, kind: 'TRANSFERRED', field: 'areaId', fromId: bengaluru.id, toId: pune.id, effectiveDate: '2026-09-15', source: 'TRANSFER' } });

    /* Tuesdays and Thursdays, none on the default weekly off. */
    await post(c, '/attendance/holidays', { date: '2026-09-03', name: 'Bengaluru early', areaId: bengaluru.id }).expect(201);
    await post(c, '/attendance/holidays', { date: '2026-09-08', name: 'Bengaluru before', areaId: bengaluru.id }).expect(201);
    await post(c, '/attendance/holidays', { date: '2026-09-10', name: 'Pune before', areaId: pune.id }).expect(201);
    await post(c, '/attendance/holidays', { date: '2026-09-22', name: 'Bengaluru after', areaId: bengaluru.id }).expect(201);
    await post(c, '/attendance/holidays', { date: '2026-09-24', name: 'Pune after', areaId: pune.id }).expect(201);

    const rows = (await request(app).get(`/api/orgs/${c.orgId}/attendance/summary?month=2026-09`).set(at(c)).expect(200)).body.rows;
    /* Bengaluru's 3rd and 8th and Pune's 24th; not Pune's 10th, not Bengaluru's 22nd. */
    expect(rows.find((r: any) => r.employeeId === p.id).holidays).toBe(3);
    /* Someone always in Pune has Pune's two. */
    expect(rows.find((r: any) => r.employeeId === stayer.id).holidays).toBe(2);

    /* A single day written later reads the place on that day too. */
    expect(await isHoliday(c.orgId, '2026-09-08', null, pune.id, p.id)).toBe(true);
    expect(await isHoliday(c.orgId, '2026-09-10', null, pune.id, p.id)).toBe(false);
    expect(await isHoliday(c.orgId, '2026-09-22', null, pune.id, p.id)).toBe(false);
    expect(await isHoliday(c.orgId, '2026-09-24', null, pune.id, p.id)).toBe(true);
  }, 60_000);
});
