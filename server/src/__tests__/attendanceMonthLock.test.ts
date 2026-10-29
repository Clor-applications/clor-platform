import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Closing an attendance month: its days are final. Every way a day is written
 * (a manager's mark, deleting a day, leave, recalculation, a reader's late
 * upload) leaves a closed month alone, so the payable days Payroll takes from
 * it cannot move afterwards. Reopening lets it change again.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});

async function makeOwner(): Promise<Ctx> {
  const email = `lock.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Lock Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const person = async (c: Ctx, code: string) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;

describe('a closed month', () => {
  it('cannot be closed before it ends', async () => {
    const c = await makeOwner();
    const now = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    await att(c).post(`/months/${now}/close`).expect(400);
  });

  it('keeps its days, whatever tries to change them, until it is reopened', async () => {
    const c = await makeOwner();
    const p = await person(c, '401');
    const day = await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    const recordId = day.body.record.id;
    expect(recordId).toBeTruthy();
    // A day from a reader, before the month closes.
    const sn = `TST${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
    await att(c).post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201);
    const reader = (body: string) => request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain').send(body);
    await reader('401\t2026-09-05 09:00:00\t0\t1\n401\t2026-09-05 18:00:00\t1\t1').expect(200);
    expect(await peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-09-05', source: 'DEVICE' } })).toBe(1);

    // The checklist first: the month has working days with no attendance, so closing needs an acknowledgement.
    const refused = await att(c).post('/months/2026-09/close').expect(409);
    expect(refused.body.code).toBe('MONTH_NOT_READY');
    expect(refused.body.readiness.checks.find((x: any) => x.key === 'noRecord').count).toBeGreaterThan(0);
    const closed = await att(c).post('/months/2026-09/close', { acknowledge: true }).expect(200);
    expect(closed.body.closed).toBeTruthy();
    // What Payroll takes is kept as a numbered snapshot.
    expect(closed.body.snapshot.version).toBe(1);
    const snap = await att(c).get('/months/2026-09/snapshots/1').expect(200);
    expect(snap.body.rows.some((r: any) => r.employeeId === p.id)).toBe(true);
    expect((await att(c).get('/summary?month=2026-09').expect(200)).body.closed).toBeTruthy();

    // A manager's mark and a delete are refused.
    const mark = await att(c).put('/records', { employeeId: p.id, date: '2026-09-03', checkIn: '09:00', checkOut: '18:00' }).expect(409);
    expect(mark.body.code).toBe('ATTENDANCE_MONTH_CLOSED');
    expect((await att(c).del(`/records/${recordId}`).expect(409)).body.code).toBe('ATTENDANCE_MONTH_CLOSED');

    // A reader's late upload is kept as a punch, and the reader is not told to resend, but the day does not move.
    await reader('401\t2026-09-04 09:00:00\t0\t1').expect(200);
    expect(await peoplePrisma.devicePunch.count({ where: { serialNumber: sn } })).toBe(3);
    expect(await peoplePrisma.attendanceRecord.count({ where: { employeeId: p.id, date: '2026-09-04' } })).toBe(0);

    // Recalculation leaves it alone and says so.
    const re = await att(c).post('/recompute', { from: '2026-09-01', to: '2026-09-30' }).expect(200);
    expect(re.body).toMatchObject({ recomputed: 0 });
    expect(re.body.skippedClosed).toBe(1);

    // Reopening says why (closure audit, 27 Oct 2026); reopened, it changes again.
    expect((await att(c).post('/months/2026-09/reopen').expect(400)).body.code).toBe('REASON_NEEDED');
    await att(c).post('/months/2026-09/reopen', { reason: 'Correct a missed holiday' }).expect(200);
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-03', checkIn: '09:00', checkOut: '18:00' }).expect(200);
  });
});
