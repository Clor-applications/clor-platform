import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Changes with their impact (docs/people/02-PRD.md LIFE-04, COMP-04). Before
 * a transfer is saved, the form can ask what else it affects; when a move
 * between states lands, each difference becomes a review task for HR on the
 * person's record, once.
 */
const { buildApp } = await import('../app.js');
const { deliverOutbox } = await import('../services/people/outbox.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `chg.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Chg Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('what a change affects', () => {
  it('a move from Karnataka to Maharashtra lists the differences first, then leaves HR review tasks when it lands', async () => {
    const entity = (await people(hr).post('/structure/legal-entities', { name: 'Chg Co Pvt Ltd' }).expect(201)).body.item;
    const blr = (await people(hr).post('/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka', legalEntityId: entity.id }).expect(201)).body.item;
    const pune = (await people(hr).post('/structure/establishments', { name: 'Pune shop', kind: 'SHOP', state: 'Maharashtra', legalEntityId: entity.id }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Kavya Reddy', code: 'CH-1', dateOfJoining: '2026-01-05', establishmentId: blr.id }).expect(201)).body.employee;

    /* Preview: the differences to review, nothing claimed as "told", and nothing for a same-state move.
       (Professional Tax appears only with a payroll profile that deducts it: peopleChangeImpact.test.ts.) */
    const preview = (await people(hr).get(`/employees/${e.id}/change-impact?establishmentId=${pune.id}`).expect(200)).body.impact;
    expect(preview.map((i: any) => i.key)).toEqual(['se', 'leave']);
    expect(JSON.stringify(preview)).not.toMatch(/told/i);
    const same = (await people(hr).get(`/employees/${e.id}/change-impact?establishmentId=${blr.id}`).expect(200)).body.impact;
    expect(same).toEqual([]);
    const dept = (await people(hr).get(`/employees/${e.id}/change-impact?departmentId=x`).expect(200)).body.impact;
    expect(dept.map((i: any) => i.key)).toEqual(['cost']);

    /* The move lands; the transfer event names both places and states. */
    await people(hr).put(`/employees/${e.id}`, { establishmentId: pune.id }).expect(200);
    const { peoplePrisma } = await import('../utils/peoplePrisma.js');
    const { runInTenant } = await import('../utils/tenantScope.js');
    const ev = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findFirst({ where: { employeeId: e.id, name: 'people.employee.transferred.v1' } }));
    expect(ev?.payload).toMatchObject({ fromEstablishmentId: blr.id, toEstablishmentId: pune.id, fromState: 'Karnataka', toState: 'Maharashtra' });

    await deliverOutbox(new Date(), 1000);
    const plan = (await people(hr).get(`/employees/${e.id}/checklist`).expect(200)).body;
    const titles = plan.changes.tasks.map((t: any) => t.title).sort();
    expect(titles).toEqual(['Leave policy for Maharashtra may apply', 'Shops & Establishments rules differ (Maharashtra)']);
    expect(plan.changes.tasks.every((t: any) => t.owner === 'HR' && t.dueDate)).toBe(true);

    /* Delivered again (a retry), the same tasks are not added twice. */
    await deliverOutbox(new Date(), 1000);
    expect((await people(hr).get(`/employees/${e.id}/checklist`).expect(200)).body.changes.tasks).toHaveLength(2);
  });
});
