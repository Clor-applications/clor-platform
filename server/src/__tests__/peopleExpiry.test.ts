import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Expiry watch (docs/people/02-PRD.md DOC-03) and expiring work permission
 * (LIFE-08): one reminder at 60, 30 and 7 days and on the day — never one a
 * day; a permit at 30 days leaves renewal tasks for HR and the manager; a
 * lapsed permit shows on the profile and in Health check.
 */
const { buildApp } = await import('../app.js');
const { runDocumentReminders, stageOf, daysUntil } = await import('../services/people/documentReminders.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `exp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Exp Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const inWords = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`; };
const plus = (days: number, from = new Date()) => ist(new Date(from.getTime() + days * 86_400_000));

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('expiry watch', () => {
  it('stages: the nearest threshold crossed, each announced once', () => {
    expect(stageOf(61)).toBeNull();
    expect(stageOf(60)).toBe(60);
    expect(stageOf(45)).toBe(60);
    expect(stageOf(30)).toBe(30);
    expect(stageOf(8)).toBe(30);
    expect(stageOf(7)).toBe(7);
    expect(stageOf(1)).toBe(7);
    expect(stageOf(0)).toBe(0);
    expect(stageOf(-10)).toBe(0);
    const now = new Date('2026-10-24T06:00:00Z');
    expect(daysUntil('2026-11-23', now)).toBe(30);
    expect(daysUntil('2026-10-24', now)).toBe(0);
    expect(daysUntil('2026-10-20', now)).toBe(-4);
  });

  it('a contract 45 days out is announced at 60, then 30, then 7, then on expiry: four times over 50 daily runs', async () => {
    const e = (await people(hr).post('/employees', { name: 'Rekha Nair', code: 'EX-1', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const now = new Date();
    const doc = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Fixed-term contract', kind: 'CONTRACT', expiresOn: plus(45, now), ...file('contract') }).expect(201)).body.document;
    /* The job runs for every company in the database, so count this document's own bell entries, not the job's total. */
    const mine = () => platformPrisma.notification.count({ where: { orgId: hr.orgId, kind: 'people.document_expiring', title: { contains: 'Fixed-term contract' } } });
    const stages: number[] = [];
    let seen = await mine();
    for (let day = 0; day <= 50; day += 1) {
      await runDocumentReminders(new Date(now.getTime() + day * 86_400_000));
      const n = await mine();
      if (n > seen) stages.push(day);
      seen = n;
    }
    expect(stages).toEqual([0, 15, 38, 45]);
    const row = await runInTenant(hr.orgId, () => peoplePrisma.employeeDocument.findUniqueOrThrow({ where: { id: doc.id } }));
    expect(row.expiryStage).toBe(0);
    expect(row.expiryNotifiedAt).toBeTruthy();
    const bell = await runInTenant(hr.orgId, () => platformPrisma.notification.findMany({ where: { orgId: hr.orgId, kind: 'people.document_expiring', title: { contains: 'Fixed-term contract' } }, orderBy: { createdAt: 'asc' } }));
    expect(bell.map((n) => n.title)).toEqual([
      'Rekha Nair’s Fixed-term contract expires in 45 days',
      'Rekha Nair’s Fixed-term contract expires in 30 days',
      'Rekha Nair’s Fixed-term contract expires in 7 days',
      'Rekha Nair’s Fixed-term contract expires today',
    ]);
  });

  it('a work permit needs its date; at 30 days HR and the manager get renewal tasks; lapsed, it shows on the profile and in Health check', async () => {
    const boss = (await people(hr).post('/employees', { name: 'Imran Patil', code: 'EX-2', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const e = (await people(hr).post('/employees', { name: 'Deepak Khan', code: 'EX-3', dateOfJoining: '2026-01-05', reportingManagerId: boss.id }).expect(201)).body.employee;
    await people(hr).post(`/employees/${e.id}/documents`, { title: 'Forklift licence', kind: 'CERTIFICATE', ...file('licence') }).expect(400);
    const now = new Date();
    const doc = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Forklift licence', kind: 'CERTIFICATE', expiresOn: plus(20, now), restrictsWork: 'operate the forklift', ...file('licence') }).expect(201)).body.document;
    expect(doc.restrictsWork).toBe('operate the forklift');

    expect(await runDocumentReminders(now)).toBeGreaterThanOrEqual(1);
    const plan = (await people(hr).get(`/employees/${e.id}/checklist`).expect(200)).body;
    expect(plan.renewals.tasks.map((t: any) => [t.title, t.owner, t.dueDate])).toEqual([
      [`Renew Forklift licence (expires ${plus(20, now)})`, 'HR', plus(13, now)],
      ['Plan Deepak Khan’s work while Forklift licence is renewed', 'MANAGER', plus(13, now)],
    ]);
    /* The 7-day reminder does not add the tasks again. */
    await runDocumentReminders(new Date(now.getTime() + 15 * 86_400_000));
    expect((await people(hr).get(`/employees/${e.id}/checklist`).expect(200)).body.renewals.tasks).toHaveLength(2);

    /* Before the date: on the profile with days left; after: expired, and in Health check. */
    const fresh = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.permits;
    expect(fresh).toEqual([expect.objectContaining({ title: 'Forklift licence', expired: false, daysLeft: 20, restrictsWork: 'operate the forklift' })]);
    await runInTenant(hr.orgId, () => peoplePrisma.employeeDocument.update({ where: { id: doc.id }, data: { expiresOn: plus(-3, now) } }));
    const lapsed = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.permits;
    expect(lapsed[0]).toMatchObject({ expired: true, daysLeft: -3 });
    const health = (await people(hr).get('/data-health').expect(200)).body;
    const check = health.checks.find((c: any) => c.id === 'permit-expired');
    expect(check).toBeTruthy();
    expect(check.people).toEqual([expect.objectContaining({ id: e.id, detail: `Forklift licence expired ${inWords(plus(-3, now))} · may not: operate the forklift` })]);
  });
});
