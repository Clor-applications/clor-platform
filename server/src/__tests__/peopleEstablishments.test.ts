import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Legal entities and establishments (docs/people/02-PRD.md FND-07, ORG-01;
 * review R-07). A person's work state is their establishment's; editing their
 * home address is not a transfer.
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
  const email = `est.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Est Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
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

describe('the company in law and its establishments', () => {
  it('a legal entity holds establishments in different states; the PAN is shown masked', async () => {
    const entity = (await people(hr).post('/structure/legal-entities', { name: 'Meridian Facilities Pvt Ltd', pan: 'AAACM1234F', cin: 'U74999KA2015PTC080000' }).expect(201)).body.item;
    expect(entity.pan).toBe('******234F');
    await people(hr).post('/structure/legal-entities', { name: 'Bad PAN Ltd', pan: 'ABC' }).expect(400);
    const blr = (await people(hr).post('/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka', legalEntityId: entity.id }).expect(201)).body.item;
    const pune = (await people(hr).post('/structure/establishments', { name: 'Pune shop', kind: 'SHOP', state: 'Maharashtra', legalEntityId: entity.id, registrations: [{ type: 'SE_REG', number: 'MH/PUNE/2026/1', validTill: '2027-03-31' }] }).expect(201)).body.item;
    expect(pune.registrations).toEqual([{ type: 'SE_REG', number: 'MH/PUNE/2026/1', validTill: '2027-03-31' }]);
    await people(hr).post('/structure/establishments', { name: 'Nowhere', kind: 'OFFICE' }).expect(400);
    const listed = (await people(hr).get('/structure/establishments').expect(200)).body.items;
    expect(listed.map((x: any) => [x.name, x.state, x.kind]).sort()).toEqual([['Bengaluru office', 'Karnataka', 'OFFICE'], ['Pune shop', 'Maharashtra', 'SHOP']]);
    /* The entity is used by its establishments and cannot be deleted while they belong to it. */
    const entities = (await people(hr).get('/structure/legal-entities').expect(200)).body.items;
    expect(entities.find((x: any) => x.id === entity.id).employeeCount).toBe(2);
    await people(hr).del(`/structure/legal-entities/${entity.id}`).expect(409);
    /* Sending the masked PAN back does not overwrite the real one. */
    await people(hr).put(`/structure/legal-entities/${entity.id}`, { name: 'Meridian Facilities Pvt Ltd', pan: '******234F' }).expect(200);
    expect((await people(hr).get('/structure/legal-entities').expect(200)).body.items.find((x: any) => x.id === entity.id).pan).toBe('******234F');
    void blr;
  });

  it('a person works at an establishment; their work state is its state, and moving them is recorded as a transfer', async () => {
    const blr = (await people(hr).post('/structure/establishments', { name: `BLR ${rnd()}`, kind: 'OFFICE', state: 'Karnataka' }).expect(201)).body.item;
    const mh = (await people(hr).post('/structure/establishments', { name: `MH ${rnd()}`, kind: 'SHOP', state: 'Maharashtra' }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Meera Shah', code: `W-${rnd()}`, establishmentId: blr.id, state: 'Kerala', city: 'Kochi' }).expect(201)).body.employee;
    const one = (await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee;
    expect(one).toMatchObject({ establishmentId: blr.id, establishment: blr.name, workState: 'Karnataka', state: 'Kerala' });

    /* The home address changes: no transfer, no "work state" in history (review R-07). */
    await people(hr).put(`/employees/${e.id}`, { state: 'Tamil Nadu', city: 'Chennai' }).expect(200);
    let history = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body.events;
    expect(history.filter((x: any) => x.kind === 'TRANSFERRED')).toEqual([]);

    /* The establishment changes: a transfer, with the state's rules named. */
    await people(hr).put(`/employees/${e.id}`, { establishmentId: mh.id, changeNote: 'Moving to the Pune shop' }).expect(200);
    history = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body.events;
    const moved = history.find((x: any) => x.field === 'establishmentId');
    expect(moved).toMatchObject({ kind: 'TRANSFERRED', from: `${blr.name} (Karnataka)`, to: `${mh.name} (Maharashtra)` });
    expect(moved.payrollImpact).toMatch(/Professional Tax/);
    expect((await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee.workState).toBe('Maharashtra');
    const used = (await people(hr).get('/structure/establishments').expect(200)).body.items.find((x: any) => x.id === mh.id);
    expect(used.employeeCount).toBe(1);
    await people(hr).del(`/structure/establishments/${mh.id}`).expect(409);
    await people(hr).put(`/employees/${e.id}`, { establishmentId: 'not-here' }).expect(400);
  });

  it('is a company’s own list', async () => {
    const other = await owner();
    const mine = (await people(hr).post('/structure/establishments', { name: `Only mine ${rnd()}`, state: 'Karnataka' }).expect(201)).body.item;
    expect((await people(other).get('/structure/establishments').expect(200)).body.items.find((x: any) => x.id === mine.id)).toBeUndefined();
    await people(other).post('/employees', { name: 'Stranger', code: 'X-1', establishmentId: mine.id }).expect(400);
  });
});
