import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Joining and leaving checklists (HR research, People first release): tasks
 * from the company's template or CLOR's defaults, due dates counted from the
 * joining date or the last day, ticked by people — and by CLOR for what it
 * does itself.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
let c: Ctx;
const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', p: string, b?: unknown) => (request(app) as any)[method](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);

beforeAll(async () => {
  const email = `check.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Checklist Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
}, 60_000);

describe('joining and leaving checklists', () => {
  it('starts the defaults on joining, dated from the joining day, and ticks by person', async () => {
    const e = (await api('post', '/employees', { name: 'Asha', code: 'C1', dateOfJoining: '2026-11-02' }).expect(201)).body.employee;
    const list = (await api('get', `/employees/${e.id}/checklist`).expect(200)).body;
    expect(list.joining.total).toBe(9);
    expect(list.leaving.total).toBe(0);
    const salary = list.joining.tasks.find((t: any) => t.title === 'Assign the salary structure');
    expect(salary).toMatchObject({ owner: 'PAYROLL', dueDate: '2026-11-05', done: false });

    const after = (await api('patch', `/checklist-tasks/${salary.id}`, { done: true, note: 'Structure A' }).expect(200)).body;
    expect(after.joining.done).toBe(1);
    expect(after.joining.tasks.find((t: any) => t.id === salary.id)).toMatchObject({ done: true, doneBy: 'Owner', note: 'Structure A' });

    /* Starting again while one is open does nothing. */
    await api('post', `/employees/${e.id}/checklist/joining`).expect(409);
  });

  it('uses the company template for leaving, and CLOR ticks reader access itself', async () => {
    await api('put', '/checklist-templates/leaving', {
      items: [
        { title: 'Recover company property', owner: 'IT', dueDays: 0 },
        { title: 'Readers and app access removed', owner: 'HR', dueDays: 0 },
        { title: 'Full and final settlement paid', owner: 'PAYROLL', dueDays: 2 },
        { title: '   ', owner: 'HR', dueDays: 1 },
      ],
    }).expect(200);
    const e = (await api('post', '/employees', { name: 'Ravi', code: 'C2', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await api('post', `/employees/${e.id}/resign`, { lastDay: '2026-12-31', leavingType: 'RESIGNED' }).expect(200);

    const { leaving } = (await api('get', `/employees/${e.id}/checklist`).expect(200)).body;
    expect(leaving.tasks.map((t: any) => t.title)).toEqual(['Recover company property', 'Readers and app access removed', 'Full and final settlement paid']);
    expect(leaving.tasks[1]).toMatchObject({ done: true, doneBy: 'CLOR' });
    expect(leaving.tasks[2]).toMatchObject({ owner: 'PAYROLL', dueDate: '2027-01-02' });

    /* Open items across the company, and going back to the defaults. */
    const open = (await api('get', '/checklist-tasks').expect(200)).body.tasks;
    expect(open.some((t: any) => t.employee.code === 'C2' && t.title === 'Full and final settlement paid')).toBe(true);
    const reset = (await api('delete', '/checklist-templates/leaving').expect(200)).body;
    expect(reset.custom).toBe(false);
    expect(reset.items.length).toBe(7);
  });
});
