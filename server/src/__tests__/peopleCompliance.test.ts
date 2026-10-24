import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Compliance (docs/people/02-PRD.md COMP-01..06): a rule library seeded
 * from the catalogue, versioned and never overwritten; "Check with your
 * adviser" until a named person checks it; obligations worked out from the
 * establishments and headcount — a Maharashtra shop brings Maharashtra
 * items, without one none; each opens to source, scope, proof, owner,
 * history and there is no score; the employee register exports per
 * establishment with the fields the rule names.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { runObligationDues } = await import('../services/people/complianceRules.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `comp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Comp Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  patch: (path: string, body: unknown) => request(app).patch(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('compliance', () => {
  it('the library is seeded unchecked; editing makes a new version and keeps the old; a named check shows on the rule (COMP-01, COMP-05)', async () => {
    const rules = (await people(hr).get('/compliance/rules').expect(200)).body.rules;
    expect(rules.length).toBeGreaterThanOrEqual(10);
    const posh = rules.find((r: any) => r.ruleId === 'IN-POSH-IC');
    expect(posh).toMatchObject({ version: 1, reviewStatus: 'DRAFT', checkedLine: 'Check with your adviser', threshold: { minHeadcount: 10 }, dueRule: { kind: 'STANDING' } });
    expect(JSON.stringify(rules)).not.toMatch(/score|%/i);

    const v2 = (await people(hr).post('/compliance/rules', { ruleId: 'IN-POSH-IC', obligation: posh.obligation + ' Minutes of each meeting kept.', effectiveFrom: '2026-11-01' }).expect(201)).body.rule;
    expect(v2).toMatchObject({ version: 2, supersedesVersion: 1, reviewStatus: 'DRAFT', active: true });
    const all = (await people(hr).get('/compliance/rules?all=1').expect(200)).body.rules.filter((r: any) => r.ruleId === 'IN-POSH-IC');
    expect(all.map((r: any) => [r.version, r.active, r.effectiveTo])).toEqual([[2, true, null], [1, false, '2026-10-31']]);
    await people(hr).post('/compliance/rules', { ruleId: 'IN-OWN-01', title: 'Our own: fire drill' }).expect(400);
    const own = (await people(hr).post('/compliance/rules', { ruleId: 'IN-OWN-01', title: 'Our own: fire drill', obligation: 'Hold a fire drill every half year.', legalSource: 'Company policy', jurisdiction: 'IN', dueRule: { kind: 'HALF_YEARLY', months: [4, 10], day: 15 } }).expect(201)).body.rule;
    expect(own.version).toBe(1);

    const checked = (await people(hr).post('/compliance/rules/IN-POSH-IC/versions/2/check', {}).expect(200)).body.rule;
    expect(checked.reviewStatus).toBe('CHECKED');
    expect(checked.checkedLine).toMatch(/^Last checked by Asha HR on \d{4}-\d{2}-\d{2}$/);
    await people(hr).post('/compliance/rules/IN-POSH-IC/versions/9/check', {}).expect(404);
  });

  it('a Maharashtra shop brings Maharashtra and state items; without one, none; headcount switches POSH on; due is told once with its event (COMP-02, COMP-03)', async () => {
    const none = (await people(hr).get('/compliance/obligations').expect(200)).body.obligations;
    expect(none.filter((o: any) => o.establishmentId)).toEqual([]);
    const entity = (await people(hr).post('/structure/legal-entities', { name: 'Comp Co Pvt Ltd' }).expect(201)).body.item;
    const pune = (await people(hr).post('/structure/establishments', { name: 'Pune shop', kind: 'SHOP', state: 'Maharashtra', legalEntityId: entity.id }).expect(201)).body.item;
    const mh = (await people(hr).get(`/compliance/obligations?establishmentId=${pune.id}`).expect(200)).body.obligations;
    expect(mh.map((o: any) => o.ruleId).sort()).toEqual(expect.arrayContaining(['IN-SE-REG', 'IN-ANNUAL-RETURN', 'IN-LWF']));
    expect(mh.find((o: any) => o.ruleId === 'IN-TS-SE-REG')).toBeUndefined();
    expect(mh.find((o: any) => o.ruleId === 'IN-KA-SERVICE-CERT')).toBeUndefined();
    const reg = mh.find((o: any) => o.ruleId === 'IN-SE-REG');
    expect(reg).toMatchObject({ establishment: 'Pune shop', state: 'Maharashtra', status: 'UPCOMING', requiredProof: ['REGISTRATION_CERTIFICATE'], ruleChecked: false, owner: 'HR' });
    expect(reg.legalSource).toContain('C-ST-01');
    /* A Karnataka office brings the Karnataka item too. */
    const blr = (await people(hr).post('/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka', legalEntityId: entity.id }).expect(201)).body.item;
    expect((await people(hr).get(`/compliance/obligations?establishmentId=${blr.id}`).expect(200)).body.obligations.map((o: any) => o.ruleId)).toEqual(expect.arrayContaining(['IN-KA-SERVICE-CERT', 'IN-SE-REG']));
    /* Below ten people there is no POSH committee item; at ten there is. */
    expect((await people(hr).get('/compliance/obligations').expect(200)).body.obligations.find((o: any) => o.ruleId === 'IN-POSH-IC')).toBeUndefined();
    for (let i = 0; i < 10; i += 1) await people(hr).post('/employees', { name: `Person ${i}`, code: `C-${i}`, dateOfJoining: '2026-01-05', establishmentId: pune.id, gender: i % 2 ? 'FEMALE' : 'MALE', guardianName: `Parent ${i}` }).expect(201);
    const withTen = (await people(hr).get('/compliance/obligations').expect(200)).body.obligations;
    expect(withTen.find((o: any) => o.ruleId === 'IN-POSH-IC')).toMatchObject({ status: 'DUE', establishmentId: null });
    /* Owner, proof and done: the history stays on the row. */
    const doc = (await people(hr).post(`/employees/${(await people(hr).get('/employees?limit=1').expect(200)).body.employees[0].id}/documents`, { title: 'S&E registration certificate', kind: 'OTHER', classification: 'HR_ONLY', data: `data:text/plain;base64,${Buffer.from('cert').toString('base64')}`, mime: 'text/plain' }).expect(201)).body.document;
    await people(hr).patch(`/compliance/obligations/${reg.id}`, { proofDocIds: ['nope'] }).expect(400);
    const done = (await people(hr).patch(`/compliance/obligations/${reg.id}`, { ownerUserId: hr.userId, proofDocIds: [doc.id], status: 'DONE', note: 'Registered 12 Oct' }).expect(200)).body.obligation;
    expect(done).toMatchObject({ status: 'DONE', owner: 'Asha HR', doneBy: 'Asha HR', proofDocIds: [doc.id], note: 'Registered 12 Oct' });
    /* The job tells of what is due, once each, with the event other apps read. */
    const told = await runObligationDues(new Date());
    expect(told).toBeGreaterThanOrEqual(1);
    const events = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findMany({ where: { orgId: hr.orgId, name: 'people.obligation.due.v1' } }));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.map((e) => (e.payload as any).ruleId)).toEqual(expect.arrayContaining(['IN-POSH-IC']));
    expect(events.map((e) => (e.payload as any).obligationId)).not.toContain(reg.id);
    const again = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { orgId: hr.orgId, name: 'people.obligation.due.v1' } }));
    await runObligationDues(new Date());
    expect(await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { orgId: hr.orgId, name: 'people.obligation.due.v1' } }))).toBe(again);
  });

  it('the employee register exports per establishment with the fields the rule names, and the leave register reads approved leave (COMP-06)', async () => {
    const pune = (await people(hr).get('/structure/establishments').expect(200)).body.items.find((e: any) => e.name === 'Pune shop');
    const reg = (await people(hr).get(`/compliance/registers/employees?establishmentId=${pune.id}`).expect(200)).body;
    expect(reg.establishment).toMatchObject({ name: 'Pune shop', state: 'Maharashtra' });
    expect(reg.columns).toEqual(['Sl. no.', 'Employee ID', 'Name', 'Father’s / guardian’s name', 'Date of birth', 'Gender', 'Designation', 'Department', 'Date of joining', 'Employee type', 'Phone', 'Address', 'UAN / ESIC: in Payroll']);
    expect(reg.rows).toHaveLength(10);
    expect(reg.rows[0].slice(0, 4)).toEqual(['1', 'C-0', 'Person 0', 'Parent 0']);
    expect((await people(hr).get('/compliance/registers/employees').expect(200)).body.rows.length).toBeGreaterThanOrEqual(10);
    await people(hr).get('/compliance/registers/leave?from=2026-13-01&to=x').expect(400);
    const leave = (await people(hr).get(`/compliance/registers/leave?establishmentId=${pune.id}&from=2026-01-01&to=2026-12-31`).expect(200)).body;
    expect(leave.columns).toEqual(['Employee ID', 'Name', 'Leave type', 'From', 'To', 'Days', 'Approved on']);
    expect(leave.rows).toEqual([]);
  });
});
