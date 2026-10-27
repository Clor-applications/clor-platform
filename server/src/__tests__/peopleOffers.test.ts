import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Offers sent from CLOR (HR-VIEW gap 5): the offer letter carries the CTC
 * and its monthly lines (from a salary structure when Payroll is on, typed
 * otherwise), goes by e-mail with a link to accept that runs out on the
 * accept-by day, and accepting records the time and IP and moves the person
 * on: a draft hire is sent the joining form, a candidate is ready to hire.
 */
const { buildApp } = await import('../app.js');
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
async function owner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `of.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Offer Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
async function linkFor(orgId: string, to: string) {
  const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId, templateKey: 'people.offer', toEmail: to }, orderBy: { createdAt: 'desc' } });
  return /\/api\/people\/offer\/([a-f0-9]{64})/.exec(mail?.bodyText || '')?.[1] || '';
}

describe('offers with an accept link', () => {
  let hr: Ctx;
  beforeAll(async () => {
    hr = await owner({ people: true, attendance: true, payroll: false, peopleHiring: true });
  }, 60_000);

  it('to a draft hire, with typed lines: a letter with the CTC annexure, on the record, e-mailed; accepting records the day and IP and sends the joining form', async () => {
    const e = (await people(hr).post('/employees', { name: 'Neha Rao', code: 'OF-1', email: 'neha@example.com', dateOfJoining: plus(30) }).expect(201)).body.employee;
    const setup = (await people(hr).get('/offers/setup').expect(200)).body;
    expect(setup).toEqual({ payrollOn: false, structures: [] });

    /* Checked before anything is sent. */
    await people(hr).post('/offers', { employeeId: e.id, designation: 'Designer', annualCtc: 0, signatory: 'Asha, HR' }).expect(400);
    await people(hr).post('/offers', { employeeId: e.id, designation: 'Designer', annualCtc: 600000, signatory: 'Asha, HR', structureId: 'x' }).expect(400);
    const tooMuch = await people(hr).post('/offers', { employeeId: e.id, designation: 'Designer', annualCtc: 120000, signatory: 'Asha, HR', lines: [{ label: 'Basic', monthly: 20000 }] }).expect(400);
    expect(tooMuch.body.error).toMatch(/more than the CTC/);
    const preview = (await people(hr).post('/offers/preview', { annualCtc: 600000, lines: [{ label: 'Basic', monthly: 25000 }, { label: 'House rent allowance', monthly: 12500 }] }).expect(200)).body;
    expect(preview.from).toBe('TYPED');
    expect(preview.annexure).toContain('  Monthly gross: Rs 37,500');

    const made = (await people(hr).post('/offers', {
      employeeId: e.id, designation: 'Designer', joiningDate: plus(30), acceptBy: plus(5), annualCtc: 600000, signatory: 'Asha Rao, HR Manager',
      lines: [{ label: 'Basic', monthly: 25000 }, { label: 'House rent allowance', monthly: 12500 }],
    }).expect(201)).body;
    expect(made.offer).toMatchObject({ status: 'SENT', email: 'neha@example.com', annualCtc: 600000, linesFrom: 'TYPED', employeeId: e.id });
    expect(made.text).toContain('Your cost to the company (CTC) will be Rs 6,00,000 a year');
    expect(made.text).toContain('ANNEXURE: PAY OFFERED');
    expect(made.text).toContain('  House rent allowance: Rs 12,500');
    expect(made.text).toContain('Asha Rao, HR Manager');
    const docs = (await people(hr).get(`/employees/${e.id}/documents`).expect(200)).body.documents;
    expect(docs.find((d: any) => d.id === made.offer.documentId)).toMatchObject({ kind: 'LETTER', mime: 'application/pdf' });

    const token = await linkFor(hr.orgId, 'neha@example.com');
    expect(token).toHaveLength(64);
    const page = await request(app).get(`/api/people/offer/${token}`).expect(200);
    expect(page.text).toContain('Neha Rao');
    expect(page.text).toContain('Accept the offer');
    expect(page.text).not.toContain('OF-1');
    await request(app).get(`/api/people/offer/${token}/pdf`).expect(200).expect('content-type', /pdf/);

    const accepted = (await request(app).post(`/api/people/offer/${token}/accept`).set('X-Forwarded-For', '203.0.113.9').send({}).expect(200)).body;
    expect(accepted).toMatchObject({ status: 'ACCEPTED', next: 'JOINING_FORM_SENT' });
    const row = await runInTenant(hr.orgId, () => peoplePrisma.offer.findFirst({ where: { id: made.offer.id } }));
    expect(row?.acceptedAt).toBeTruthy();
    expect(row?.acceptedIp).toBeTruthy();
    const listed = (await people(hr).get(`/offers?employeeId=${e.id}`).expect(200)).body.offers;
    expect(listed[0]).toMatchObject({ status: 'ACCEPTED', acceptedIp: row?.acceptedIp });
    expect(listed[0]).not.toHaveProperty('tokenHash');
    const invite = await runInTenant(hr.orgId, () => peoplePrisma.joinInvite.findFirst({ where: { employeeId: e.id } }));
    expect(invite).toMatchObject({ channel: 'EMAIL', sentTo: 'neha@example.com', status: 'SENT' });
    const line = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: e.id, field: 'offer', before: 'sent' } }));
    expect(line?.after).toMatch(/^accepted /);
    const bell = await platformPrisma.notification.findFirst({ where: { orgId: hr.orgId, kind: 'people.offer' } });
    expect(bell?.title).toBe('Neha Rao accepted the offer');

    /* Once only. */
    await request(app).post(`/api/people/offer/${token}/accept`).send({}).expect(410);
    await request(app).post(`/api/people/offer/${token}/decline`).send({}).expect(410);
    await request(app).get('/api/people/offer/not-a-token').set('Accept', 'application/json').expect(404);
  });

  it('to a candidate: makes them offered; a newer offer withdraws the older; an offer past its day cannot be accepted; declining tells HR', async () => {
    const job = (await people(hr).post('/workspace/recruitment', { title: 'Accountant', status: 'OPEN', details: { openings: 1 } }).expect(201)).body.record;
    const cand = (await people(hr).post('/workspace/candidates', { title: 'Meera K', status: 'INTERVIEW', details: { jobId: job.id, email: 'meera@example.com', phone: '' } }).expect(201)).body.record;
    const first = (await people(hr).post('/offers', { candidateId: cand.id, designation: 'Accountant', annualCtc: 360000, signatory: 'Owner', lines: [] }).expect(201)).body.offer;
    expect(first.acceptBy).toBe(plus(7));
    const after = (await people(hr).get('/workspace/candidates').expect(200)).body.records.find((r: any) => r.id === cand.id);
    expect(after.status).toBe('OFFERED');
    const firstToken = await linkFor(hr.orgId, 'meera@example.com');
    const second = (await people(hr).post('/offers', { candidateId: cand.id, designation: 'Senior accountant', annualCtc: 420000, signatory: 'Owner' }).expect(201)).body.offer;
    expect((await people(hr).get(`/offers?candidateId=${cand.id}`).expect(200)).body.offers.map((o: any) => o.status)).toEqual(['SENT', 'WITHDRAWN']);
    await request(app).post(`/api/people/offer/${firstToken}/accept`).send({}).expect(410);

    const token = await linkFor(hr.orgId, 'meera@example.com');
    await runInTenant(hr.orgId, () => peoplePrisma.offer.update({ where: { id: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    expect((await request(app).get(`/api/people/offer/${token}`).set('Accept', 'application/json').expect(200)).body.status).toBe('EXPIRED');
    await request(app).post(`/api/people/offer/${token}/accept`).send({}).expect(410);

    const third = (await people(hr).post('/offers', { candidateId: cand.id, designation: 'Senior accountant', annualCtc: 420000, signatory: 'Owner' }).expect(201)).body.offer;
    const t3 = await linkFor(hr.orgId, 'meera@example.com');
    const accepted = (await request(app).post(`/api/people/offer/${t3}/accept`).send({}).expect(200)).body;
    expect(accepted.next).toBe('READY_TO_HIRE');
    const ready = (await people(hr).get('/workspace/candidates').expect(200)).body.records.find((r: any) => r.id === cand.id);
    expect(ready).toMatchObject({ status: 'OFFERED', details: { offerAcceptedOn: today(), offerId: third.id } });

    const other = (await people(hr).post('/workspace/candidates', { title: 'Arun', status: 'APPLIED', details: { jobId: job.id, email: 'arun@example.com', phone: '' } }).expect(201)).body.record;
    await people(hr).post('/offers', { candidateId: other.id, designation: 'Accountant', annualCtc: 300000, signatory: 'Owner' }).expect(201);
    const t4 = await linkFor(hr.orgId, 'arun@example.com');
    expect((await request(app).post(`/api/people/offer/${t4}/decline`).send({}).expect(200)).body.status).toBe('DECLINED');
    await people(hr).post(`/offers/${third.id}/withdraw`, {}).expect(409);
  });

  it('with Payroll on, the monthly lines come from a salary structure by Payroll’s own engine', async () => {
    const pay = await owner({ people: true, attendance: true, payroll: true });
    const comp = (await request(app).post(`/api/orgs/${pay.orgId}/payroll/components`).set(at(pay)).send({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC' }).expect(201)).body.component;
    const structure = (await request(app).post(`/api/orgs/${pay.orgId}/payroll/structures`).set(at(pay)).send({ name: 'Staff', frequency: 'MONTHLY', effectiveFrom: '2025-01-01', status: 'ACTIVE', components: [{ componentId: comp.id, displayOrder: 1 }] }).expect(201)).body.structure;
    const setup = (await people(pay).get('/offers/setup').expect(200)).body;
    expect(setup.payrollOn).toBe(true);
    expect(setup.structures.map((s: any) => s.id)).toEqual([structure.id]);
    const e = (await people(pay).post('/employees', { name: 'Kiran S', code: 'P-1', email: 'kiran@example.com', dateOfJoining: plus(20) }).expect(201)).body.employee;
    const made = (await people(pay).post('/offers', { employeeId: e.id, designation: 'Clerk', annualCtc: 600000, structureId: structure.id, signatory: 'Owner' }).expect(201)).body;
    expect(made.offer).toMatchObject({ linesFrom: 'STRUCTURE', structureId: structure.id, lines: [{ label: 'Basic', monthly: 25000, kind: 'EARNING' }] });
    expect(made.text).toContain('  Basic: Rs 25,000');
  }, 60_000);

  it('needs the Documents grant to send, and Recruitment too for a candidate', async () => {
    const role = await request(app).post(`/api/orgs/${hr.orgId}/roles`).set(at(hr)).send({ name: `Docs ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
    await request(app).put(`/api/orgs/${hr.orgId}/roles/${role.body.role.id}/permissions`).set(at(hr)).send({ permissions: ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Documents::CREATE'] }).expect(200);
    const email = `d.${Date.now()}.${rnd()}@example.com`;
    const user = await request(app).post('/api/users').set(at(hr)).send({ email, fullName: 'Docs', password: 'Passw0rd!23', orgIds: [hr.orgId], branchIdsByOrg: { [hr.orgId]: [hr.branchId] } }).expect(201);
    await request(app).post(`/api/orgs/${hr.orgId}/users/${user.body.user.id}/roles`).set(at(hr)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
    const docs = { token: login.body.token, orgId: hr.orgId, branchId: hr.branchId, userId: user.body.user.id };
    await people(docs).post('/offers', { candidateId: 'x', designation: 'A', annualCtc: 1, signatory: 'B' }).expect(403);
    await people(docs).post('/offers', { employeeId: 'x', designation: 'A', annualCtc: 1, signatory: 'B' }).expect(404);
  });
});
