import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Company master data (People → Settings → Company): business units, grades
 * and cost centres, set on each employee, filtered on, imported by name,
 * kept in employment history, and protected while in use.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('company master data', () => {
  it('business units, grades and cost centres on employees', async () => {
    const email = `masters.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Masters Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true } }).expect(200);
    const people = (m: 'get' | 'post' | 'put' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);

    const retail = (await people('post', '/structure/business-units', { name: 'Retail', description: 'Stores' }).expect(201)).body.item;
    const mfg = (await people('post', '/structure/business-units', { name: 'Manufacturing' }).expect(201)).body.item;
    const l2 = (await people('post', '/structure/grades', { name: 'L2' }).expect(201)).body.item;
    const cc = (await people('post', '/structure/cost-centres', { name: 'Plant 1' }).expect(201)).body.item;
    expect((await people('get', '/structure/business-units').expect(200)).body.items.map((i: any) => i.name).sort()).toEqual(['Manufacturing', 'Retail']);

    const e = (await people('post', '/employees', { name: 'Asha', code: 'M1', dateOfJoining: '2026-01-01', businessUnitId: retail.id, gradeId: l2.id, costCenterId: cc.id }).expect(201)).body.employee;
    expect(e).toMatchObject({ businessUnitName: 'Retail', gradeName: 'L2', costCenterName: 'Plant 1' });
    await people('post', '/employees', { name: 'Bad', businessUnitId: 'nope' }).expect(400);
    expect((await people('get', `/employees?businessUnitId=${retail.id}`).expect(200)).body.employees.map((x: any) => x.code)).toEqual(['M1']);

    /* A move between business units is history, with its effect. Dated in the past it lands now; a future date would wait (FND-02). */
    await people('put', `/employees/${e.id}`, { businessUnitId: mfg.id, effectiveFrom: '2026-10-01' }).expect(200);
    const moved = (await people('get', `/employees/${e.id}/history`).expect(200)).body.events.find((x: any) => x.field === 'businessUnitId');
    expect(moved).toMatchObject({ from: 'Retail', to: 'Manufacturing', effectiveDate: '2026-10-01', title: 'Business unit changed' });

    /* In use: not deleted. Free: goes to the recycle bin. */
    await people('delete', `/structure/business-units/${mfg.id}`).expect(409);
    await people('delete', `/structure/business-units/${retail.id}`).expect(200);

    /* Import by name creates what is missing. */
    const imp = (await people('post', '/employees/import', { rows: [{ name: 'Ravi', code: 'M2', businessUnit: 'Services', grade: 'l2', costCentre: 'Head Office' }] }).expect(200)).body;
    expect(imp.results[0].ok).toBe(true);
    const ravi = (await people('get', `/employees/${imp.results[0].id}`).expect(200)).body.employee;
    expect(ravi).toMatchObject({ businessUnitName: 'Services', gradeName: 'L2', costCenterName: 'Head Office' });
  }, 60_000);
});

describe('company details', () => {
  it('keeps legal name, PAN, TAN, address and registrations, refusing bad formats', async () => {
    const email = `profile.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Profile Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    const url = `/api/orgs/${c.orgId}/company-profile`;
    const before = (await request(app).get(url).set(at(c)).expect(200)).body.company;
    expect(before).toMatchObject({ state: 'Karnataka', pan: '' });
    await request(app).put(url).set(at(c)).send({ legalName: 'X', pan: 'ABC' }).expect(400);
    const saved = (await request(app).put(url).set(at(c)).send({ legalName: 'Profile Private Limited', pan: 'aabcp1234q', tan: 'BLRP12345A', addressLine: '12 MG Road', city: 'Bengaluru', pincode: '560001', epfCode: 'KNBNG0012345000', esicCode: '53000123450001001', ptRegistration: 'PT-KA-001' }).expect(200)).body.company;
    expect(saved).toMatchObject({ legalName: 'Profile Private Limited', pan: 'AABCP1234Q', tan: 'BLRP12345A', city: 'Bengaluru', epfCode: 'KNBNG0012345000', state: 'Karnataka' });
  });
});
