import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Employment stints (docs/people/02-PRD.md FND-06 and LIFE-06; review R-03).
 * One employee id for a person's whole time with the company; a rejoin opens
 * the next stint and keeps the first joining date, instead of overwriting it.
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

async function owner(): Promise<Ctx> {
  const email = `stint.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Stint Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('employment stints', () => {
  it('a new person starts their first stint on the joining date, and that date never moves', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'S-1', dateOfJoining: '2022-01-10' }).expect(201)).body.employee;
    const stints = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body.episodes;
    expect(stints).toEqual([expect.objectContaining({ seq: 1, startDate: '2022-01-10', endDate: null, current: true })]);
    const row = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id }, select: { firstJoiningDate: true, currentEpisodeSeq: true } });
    expect(row).toEqual({ firstJoiningDate: '2022-01-10', currentEpisodeSeq: 1 });
  });

  it('leaving closes the stint; a rejoin needs a date, opens stint 2 and keeps the first joining date', async () => {
    const e = (await people(hr).post('/employees', { name: 'Meera Shah', code: 'S-2', dateOfJoining: '2022-01-10' }).expect(201)).body.employee;
    await people(hr).post(`/employees/${e.id}/resign`, { lastDay: '2024-03-31', leavingType: 'RESIGNED', reason: 'Moved city' }).expect(200);

    /* Before: a rehire without a date kept the old joining date and recorded nothing; now it is refused. */
    const refused = await people(hr).post(`/employees/${e.id}/rehire`, {}).expect(400);
    expect(refused.body.code).toBe('REJOIN_DATE_REQUIRED');
    await people(hr).post(`/employees/${e.id}/rehire`, { rejoinDate: '2024-03-01' }).expect(400);

    const back = (await people(hr).post(`/employees/${e.id}/rehire`, { rejoinDate: '2026-02-01' }).expect(200)).body.employee;
    /* The current stint is what Attendance and leave proration read; the first day stays on its own field. */
    expect(back).toMatchObject({ status: 'ACTIVE', dateOfJoining: '2026-02-01', firstJoiningDate: '2022-01-10', currentEpisodeSeq: 2, dateOfLeaving: null });

    const history = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body;
    expect(history.episodes).toEqual([
      expect.objectContaining({ seq: 1, startDate: '2022-01-10', endDate: '2024-03-31', endType: 'RESIGNED', endReason: 'Moved city', current: false }),
      expect.objectContaining({ seq: 2, startDate: '2026-02-01', endDate: null, current: true }),
    ]);
    expect(history.events.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['JOINED', 'LEFT', 'REHIRED']));
    expect(history.events.find((x: any) => x.kind === 'REHIRED')).toMatchObject({ effectiveDate: '2026-02-01', note: 'Stint 2' });
  });

  it('a second leaving and rejoin make stint 3, with every earlier stint intact', async () => {
    const e = (await people(hr).post('/employees', { name: 'Anil Iyer', code: 'S-3', dateOfJoining: '2020-06-01' }).expect(201)).body.employee;
    await people(hr).post(`/employees/${e.id}/resign`, { lastDay: '2021-05-31', leavingType: 'CONTRACT_ENDED' }).expect(200);
    await people(hr).post(`/employees/${e.id}/rehire`, { rejoinDate: '2022-01-01' }).expect(200);
    await people(hr).post(`/employees/${e.id}/resign`, { lastDay: '2023-12-31', leavingType: 'RESIGNED' }).expect(200);
    await people(hr).post(`/employees/${e.id}/rehire`, { rejoinDate: '2025-01-01' }).expect(200);
    const stints = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body.episodes;
    expect(stints.map((s: any) => [s.seq, s.startDate, s.endDate])).toEqual([
      [1, '2020-06-01', '2021-05-31'],
      [2, '2022-01-01', '2023-12-31'],
      [3, '2025-01-01', null],
    ]);
  });

  it('stints are a company’s own: another company reads none, and the policy fails closed', async () => {
    const other = await owner();
    const e = (await people(hr).post('/employees', { name: 'Farah Nair', code: 'S-4', dateOfJoining: '2023-01-01' }).expect(201)).body.employee;
    expect(await runInTenant(other.orgId, () => peoplePrisma.employmentEpisode.count({ where: { employeeId: e.id } }))).toBe(0);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.employmentEpisode.count({ where: { employeeId: e.id } }))).toBe(1);
    /* A connection that names no company and sets no bypass sees nothing (A-35 shape); the wrapped client
       outside a request runs as background work with the bypass on, so the policy is read directly. */
    const [{ qual }] = await peoplePrisma.$queryRaw<Array<{ qual: string }>>`SELECT pg_get_expr(polqual, polrelid) AS qual FROM pg_policy WHERE polname = 'tenant_isolation' AND polrelid = '"EmploymentEpisode"'::regclass`;
    expect(qual).toContain("current_setting('clor.bypass'::text, true) = 'on'::text");
    expect(qual).toContain("NULLIF(current_setting('clor.org_id'::text, true), ''::text)");
    expect(qual).not.toContain('IS NULL');
  });
});
