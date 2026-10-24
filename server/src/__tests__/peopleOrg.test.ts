import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Teams and seats (docs/people/02-PRD.md ORG-01, ORG-04): a team under a
 * department; approved seats on it with a budget reference; a person is
 * placed in a team and a seat; a seat holds one person; an open seat shows
 * on the chart; a list in use cannot be deleted, only made inactive.
 */
const { buildApp } = await import('../app.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `org.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Org Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('teams and seats', () => {
  it('a team under a department, seats on it, people placed in them; one person per seat; open seats on the chart; delete blocked in use', async () => {
    const ops = (await people(hr).post('/structure/departments', { name: 'Operations' }).expect(201)).body.item;
    const guard = (await people(hr).post('/structure/job-positions', { name: 'Security guard' }).expect(201)).body.item;
    const team = (await people(hr).post('/structure/teams', { name: 'Night shift', departmentId: ops.id, description: 'Pune site, nights' }).expect(201)).body.item;
    expect(team).toMatchObject({ name: 'Night shift', departmentId: ops.id, isActive: true });
    await people(hr).post('/structure/teams', { name: 'Night shift' }).expect(409);
    const s1 = (await people(hr).post('/structure/seats', { name: 'Night guard 1', teamId: team.id, jobPositionId: guard.id, budgetRef: 'FY27-OPS-04' }).expect(201)).body.item;
    const s2 = (await people(hr).post('/structure/seats', { name: 'Night guard 2', teamId: team.id, jobPositionId: guard.id, budgetRef: 'FY27-OPS-04' }).expect(201)).body.item;
    expect((await people(hr).get('/structure/seats').expect(200)).body.items.map((x: any) => x.name)).toEqual(['Night guard 1', 'Night guard 2']);

    const a = (await people(hr).post('/employees', { name: 'Anil Iyer', code: 'T-1', dateOfJoining: '2026-01-05', teamId: team.id, seatId: s1.id, jobPositionId: guard.id }).expect(201)).body.employee;
    expect(a).toMatchObject({ teamId: team.id, seatId: s1.id, teamName: 'Night shift', seatName: 'Night guard 1' });
    /* A seat holds one person. */
    const refused = await people(hr).post('/employees', { name: 'Arjun Shah', code: 'T-2', dateOfJoining: '2026-01-05', teamId: team.id, seatId: s1.id }).expect(409);
    expect(refused.body.error).toContain('Anil Iyer (T-1) already holds that seat');
    await people(hr).post('/employees', { name: 'Bad Seat', code: 'T-9', seatId: 'nope' }).expect(400);
    const b = (await people(hr).post('/employees', { name: 'Arjun Shah', code: 'T-2', dateOfJoining: '2026-01-05', teamId: team.id }).expect(201)).body.employee;
    /* The chart shows the open seat; filled, it is gone. */
    expect((await people(hr).get('/org-chart').expect(200)).body.openSeats).toEqual([expect.objectContaining({ id: s2.id, name: 'Night guard 2', teamName: 'Night shift', budgetRef: 'FY27-OPS-04' })]);
    await people(hr).put(`/employees/${b.id}`, { seatId: s2.id }).expect(200);
    expect((await people(hr).get('/org-chart').expect(200)).body.openSeats).toEqual([]);
    /* Moving teams is history. */
    const day = (await people(hr).post('/structure/teams', { name: 'Day shift', departmentId: ops.id }).expect(201)).body.item;
    await people(hr).put(`/employees/${a.id}`, { teamId: day.id, seatId: null, effectiveFrom: '2026-10-01' }).expect(200);
    const moved = (await people(hr).get(`/employees/${a.id}/history`).expect(200)).body.events.find((x: any) => x.field === 'teamId');
    expect(moved).toMatchObject({ from: 'Night shift', to: 'Day shift', title: 'Team changed' });
    expect((await people(hr).get('/org-chart').expect(200)).body.openSeats.map((x: any) => x.id)).toEqual([s1.id]);

    /* In use: not deleted; inactive instead. Free: deleted. */
    expect((await people(hr).del(`/structure/teams/${day.id}`).expect(409)).body.error).toContain('1 person uses this');
    expect((await people(hr).del(`/structure/seats/${s2.id}`).expect(409)).body.error).toContain('1 person uses this');
    await people(hr).put(`/structure/teams/${day.id}`, { name: 'Day shift', isActive: false }).expect(200);
    expect((await people(hr).get('/structure/teams').expect(200)).body.items.find((x: any) => x.id === day.id).isActive).toBe(false);
    await people(hr).del(`/structure/seats/${s1.id}`).expect(200);
    expect((await people(hr).get('/structure/seats').expect(200)).body.items.map((x: any) => x.id)).toEqual([s2.id]);
  });
});
