import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Every People event is written where the change is made (contract §7,
 * EVT-01): one test per event, each through the real path, each asserting
 * the envelope that other apps read. `people.obligation.due.v1` belongs to
 * the compliance work and is covered there.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { runDocumentReminders } = await import('../services/people/documentReminders.js');
const { PEOPLE_EVENTS } = await import('../services/people/outbox.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `evt.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Evt Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });
const plus = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

let hr: Ctx;
let e: any;
const events = (name: string, employeeId?: string) => runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findMany({ where: { orgId: hr.orgId, name, ...(employeeId ? { employeeId } : {}) }, orderBy: { occurredAt: 'asc' } }));
beforeAll(async () => {
  hr = await owner();
  e = (await people(hr).post('/employees', { name: 'Nisha Verma', code: 'EV-1', dateOfJoining: '2026-01-05', probationEndDate: plus(10) }).expect(201)).body.employee;
}, 60_000);

describe('every People event comes from its write path', () => {
  it('people.employee.created.v1', async () => {
    const [ev] = await events('people.employee.created.v1', e.id);
    expect(ev).toBeTruthy();
    expect(ev.payload).toMatchObject({ id: e.id, code: 'EV-1', name: 'Nisha Verma', status: 'ACTIVE' });
    expect(ev.correlationId).toBeTruthy();
  });

  it('people.employee.updated.v1', async () => {
    await people(hr).put(`/employees/${e.id}`, { phone: '9000000011' }).expect(200);
    const [ev] = await events('people.employee.updated.v1', e.id);
    expect(ev.payload).toMatchObject({ fields: ['phone'], employee: { id: e.id } });
  });

  it('people.employment.changed.v1 and people.employee.transferred.v1', async () => {
    const entity = (await people(hr).post('/structure/legal-entities', { name: 'Evt Co Pvt Ltd' }).expect(201)).body.item;
    const blr = (await people(hr).post('/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka', legalEntityId: entity.id }).expect(201)).body.item;
    const dept = (await people(hr).post('/structure/departments', { name: 'Design' }).expect(201)).body.item;
    await people(hr).put(`/employees/${e.id}`, { departmentId: dept.id, establishmentId: blr.id }).expect(200);
    const changed = await events('people.employment.changed.v1', e.id);
    expect(changed.map((x) => (x.payload as any).field).sort()).toEqual(['departmentId', 'establishmentId']);
    const [moved] = await events('people.employee.transferred.v1', e.id);
    expect(moved.payload).toMatchObject({ toEstablishmentId: blr.id, toState: 'Karnataka', fields: expect.arrayContaining(['establishmentId']) });
  });

  it('people.employee.probation_confirmed.v1', async () => {
    await people(hr).post(`/employees/${e.id}/probation/decide`, { outcome: 'CONFIRM' }).expect(200);
    const [ev] = await events('people.employee.probation_confirmed.v1', e.id);
    expect(ev.payload).toMatchObject({ employee: { id: e.id, code: 'EV-1' } });
    expect((ev.payload as any).confirmedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('people.invite.sent.v1 and people.invite.returned.v1', async () => {
    const j = (await people(hr).post('/employees', { name: 'Joiner One', code: 'EV-2', dateOfJoining: plus(14) }).expect(201)).body.employee;
    const sms = (await people(hr).post(`/employees/${j.id}/invites`, { channel: 'SMS', sentTo: '9876500001' }).expect(201)).body;
    expect((await events('people.invite.sent.v1', j.id))[0].payload).toMatchObject({ channel: 'SMS', employee: { id: j.id } });
    await request(app).post(`/api/people/join/${sms.link.split('/').pop()}`).send({ fields: { city: 'Mysuru' }, declarations: { accurate: true } }).expect(200);
    expect((await events('people.invite.returned.v1', j.id))[0].payload).toMatchObject({ fields: ['city'], documents: 0 });
  });

  it('people.letter.issued.v1', async () => {
    const pos = (await people(hr).post('/structure/job-positions', { name: 'Designer' }).expect(201)).body.item;
    await people(hr).put(`/employees/${e.id}`, { jobPositionId: pos.id }).expect(200);
    await people(hr).post(`/employees/${e.id}/letters`, { kind: 'CONFIRMATION', extra: { signatory: 'HR' } }).expect(201);
    const [ev] = await events('people.letter.issued.v1', e.id);
    expect(ev.payload).toMatchObject({ kind: 'CONFIRMATION', templateVersion: 0, employee: { id: e.id } });
  });

  it('people.document.expiring.v1', async () => {
    const doc = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Visa', kind: 'OTHER', expiresOn: plus(20), ...file('visa') }).expect(201)).body.document;
    await runDocumentReminders(new Date());
    const mine = (await events('people.document.expiring.v1', e.id)).filter((x) => (x.payload as any).documentId === doc.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].payload).toMatchObject({ title: 'Visa', stage: 30, daysLeft: 20, expiresOn: plus(20) });
    expect(mine[0].correlationId).toBe(`expiry_${doc.id}_30`);
  });

  it('people.policy.published.v1', async () => {
    const p = (await people(hr).post('/policies', { title: 'Code of conduct', category: 'CONDUCT' }).expect(201)).body.policy;
    await people(hr).post(`/policies/${p.id}/versions`, { body: 'Be kind.', effectiveFrom: '2026-01-01' }).expect(201);
    await people(hr).post(`/policies/${p.id}/versions/1/submit`, {}).expect(200);
    const [ev] = await events('people.policy.published.v1');
    expect(ev.payload).toMatchObject({ policyId: p.id, version: 1, title: 'Code of conduct', category: 'CONDUCT', effectiveFrom: '2026-01-01' });
  });

  it('people.employee.separation_scheduled.v1, people.employee.separated.v1 and people.employee.rejoined.v1', async () => {
    const l = (await people(hr).post('/employees', { name: 'Leaver One', code: 'EV-3', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    await people(hr).post(`/employees/${l.id}/resign`, { lastDay: plus(3), leavingType: 'RESIGNED', reason: null }).expect(200);
    expect((await events('people.employee.separation_scheduled.v1', l.id))[0].payload).toMatchObject({ lastWorkingDay: plus(3), type: 'RESIGNED', employee: { id: l.id } });
    const { runSeparations } = await import('../services/people/lifecycle/leaving.js');
    await runSeparations(new Date(Date.now() + 4 * 86_400_000));
    const sep = await events('people.employee.separated.v1', l.id);
    expect(sep).toHaveLength(1);
    expect(sep[0].payload).toMatchObject({ lastWorkingDay: plus(3), settlementRequested: true });
    await people(hr).post(`/employees/${l.id}/rehire`, { rejoinDate: plus(10) }).expect(200);
    const [back] = await events('people.employee.rejoined.v1', l.id);
    expect(back.payload).toMatchObject({ rejoinDate: plus(10), stint: 2, employee: { id: l.id, status: 'ACTIVE', currentEpisodeSeq: 2 } });
    const line = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: l.id, field: 'status', after: 'ACTIVE' } }));
    expect(line).toMatchObject({ source: 'HIRE', before: 'LEFT' });
  });

  it('the catalogue is covered: every listed event has a test, here, in peopleCompliance (obligation.due) or attendanceRules (settlement.hold)', () => {
    const tested = ['people.employee.created.v1', 'people.employee.updated.v1', 'people.employment.changed.v1', 'people.employee.transferred.v1', 'people.employee.probation_confirmed.v1', 'people.employee.separation_scheduled.v1', 'people.employee.separated.v1', 'people.employee.rejoined.v1', 'people.policy.published.v1', 'people.document.expiring.v1', 'people.invite.sent.v1', 'people.invite.returned.v1', 'people.letter.issued.v1', 'people.obligation.due.v1', 'people.settlement.hold.v1'];
    expect([...PEOPLE_EVENTS].filter((n) => !tested.includes(n))).toEqual([]);
  });
});
