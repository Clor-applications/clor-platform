import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Hiring hand-offs (People plan 8 Nov 2026, step 4). One hire path: a
 * candidate is hired on an accepted offer, or HR says "without an offer" and
 * why. A declined offer takes the candidate out of the running. The hire
 * files the offer on the record, starts the joining plan, sends the joining
 * form and the app invite, and drafts the offer's pay in Payroll for Payroll
 * to confirm; confirming ticks the joining step, as does an appointment
 * letter. Candidates hear about interviews and about not being taken forward.
 * HR records a claim on someone's behalf and it reaches the inbox and Payroll
 * like any other.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { applyRevision } = await import('../services/payroll/revision.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (n: number, from = today()) => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function owner(): Promise<Ctx> {
  const email = `hire.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Hire Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true, peopleHiring: true } }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
});
const mails = (orgId: string, templateKey: string, to?: string) => platformPrisma.emailOutbox.findMany({ where: { orgId, templateKey, ...(to ? { toEmail: to } : {}) }, orderBy: { createdAt: 'desc' } });
async function offerToken(orgId: string, to: string) {
  const mail = (await mails(orgId, 'people.offer', to))[0];
  return /\/api\/people\/offer\/([a-f0-9]{64})/.exec(mail?.bodyText || '')?.[1] || '';
}
const candidateOf = (c: Ctx, id: string) => api(c).get(`/people/talent/candidates/${id}`).expect(200).then((r) => r.body);

let hr: Ctx;
let structureId: string;
let openingId: string;
let dept: any;

beforeAll(async () => {
  hr = await owner();
  dept = (await api(hr).post('/people/structure/departments', { name: 'Accounts' }).expect(201)).body.item;
  /* Payroll: one structure, Basic as the whole CTC, a reimbursement earning and this month open. */
  const pay = (p: string, b: unknown) => api(hr).post(`/payroll${p}`, b).expect(201);
  const basic = (await pay('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 })).body.component;
  await pay('/components', { name: 'Reimbursement', code: 'REIMB', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, displayOrder: 90 });
  structureId = (await pay('/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2024-01-01', status: 'ACTIVE', components: [{ componentId: basic.id, displayOrder: 1 }] })).body.structure.id;
  const t = today();
  const end = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0)).toISOString().slice(0, 10);
  await pay('/periods', { name: `This month ${rnd()}`, startDate: `${t.slice(0, 7)}-01`, endDate: end, paymentDate: end });
  openingId = (await api(hr).post('/people/talent/openings', { title: 'Accountant', departmentId: dept.id, branchId: hr.branchId, places: 3, status: 'OPEN' }).expect(201)).body.opening.id;
}, 180_000);

describe('one hire path', () => {
  it('a candidate is not hired without an accepted offer; a declined offer takes them out of the running and frees the place', async () => {
    const meera = (await api(hr).post('/people/talent/candidates', { openingId, name: 'Meera K', email: `meera.${rnd()}@example.com` }).expect(201)).body.candidate;
    const email = (await candidateOf(hr, meera.id)).candidate.email;
    /* Nothing offered yet. */
    expect((await api(hr).post(`/people/talent/candidates/${meera.id}/hire`, { dateOfJoining: plus(10) }).expect(409)).body.code).toBe('NO_ACCEPTED_OFFER');
    await api(hr).post('/people/offers', { candidateId: meera.id, designation: 'Accountant', joiningDate: plus(10), annualCtc: 360000, signatory: 'Owner', lines: [] }).expect(201);
    /* Offered, not yet accepted: still not hired. */
    expect((await api(hr).post(`/people/talent/candidates/${meera.id}/hire`, { dateOfJoining: plus(10) }).expect(409)).body.code).toBe('NO_ACCEPTED_OFFER');
    let openings = (await api(hr).get('/people/talent/openings?status=all').expect(200)).body.openings;
    expect(openings.find((o: any) => o.id === openingId)).toMatchObject({ active: 1, hired: 0, places: 3 });
    /* They decline: out of the running, the reason on the card, the opening counts them no longer. */
    const token = await offerToken(hr.orgId, email);
    await request(app).post(`/api/people/offer/${token}/decline`).send({}).expect(200);
    const after = await candidateOf(hr, meera.id);
    expect(after.candidate).toMatchObject({ stage: 'WITHDRAWN', closedReason: 'Declined the offer' });
    expect(after.timeline[0]).toMatchObject({ kind: 'STAGE', toStage: 'WITHDRAWN', text: 'Declined the offer' });
    openings = (await api(hr).get('/people/talent/openings?status=all').expect(200)).body.openings;
    expect(openings.find((o: any) => o.id === openingId)).toMatchObject({ active: 0, hired: 0 });
    /* Someone out of the running is not hired, even with the flag. */
    await api(hr).post(`/people/talent/candidates/${meera.id}/hire`, { dateOfJoining: plus(10), withoutOffer: true, reason: 'Agreed by phone' }).expect(409);
  }, 60_000);

  it('hire without an offer needs the flag and a reason, which goes on the timeline; the opening fills by hires', async () => {
    const arun = (await api(hr).post('/people/talent/candidates', { openingId, name: 'Arun P', phone: '9800000011' }).expect(201)).body.candidate;
    expect((await api(hr).post(`/people/talent/candidates/${arun.id}/hire`, { dateOfJoining: plus(5), withoutOffer: true }).expect(400)).body.code).toBe('REASON_NEEDED');
    const hired = (await api(hr).post(`/people/talent/candidates/${arun.id}/hire`, { dateOfJoining: plus(5), code: 'HH-1', withoutOffer: true, reason: 'Terms agreed by phone; no letter wanted' }).expect(201)).body;
    expect(hired.employee).toMatchObject({ name: 'Arun P', code: 'HH-1' });
    expect(hired.handoffs).toMatchObject({ offerFiled: false, joiningForm: 'NO_EMAIL', appAccess: 'SKIPPED', salary: null });
    expect(hired.handoffs.checklist).toBeGreaterThan(0);
    const c = await candidateOf(hr, arun.id);
    expect(c.candidate.stage).toBe('HIRED');
    expect(c.timeline.find((e: any) => e.kind === 'HIRED').text).toContain('Hired without an accepted offer: Terms agreed by phone; no letter wanted');
    const opening = (await api(hr).get('/people/talent/openings?status=all').expect(200)).body.openings.find((o: any) => o.id === openingId);
    expect(opening).toMatchObject({ hired: 1, places: 3, status: 'OPEN' });
  }, 60_000);
});

describe('what a hire sets in motion', () => {
  let employeeId: string;
  let revisionId: string;
  let email: string;

  it('on an accepted offer with a Payroll structure: the offer is filed on the record, the joining form and app invite go out, and Payroll gets a draft salary', async () => {
    email = `priya.${rnd()}@example.com`;
    const priya = (await api(hr).post('/people/talent/candidates', { openingId, name: 'Priya Shah', email }).expect(201)).body.candidate;
    const offer = (await api(hr).post('/people/offers', { candidateId: priya.id, designation: 'Accountant', joiningDate: plus(7), annualCtc: 480000, structureId, signatory: 'Owner' }).expect(201)).body.offer;
    expect(offer.linesFrom).toBe('STRUCTURE');
    await request(app).post(`/api/people/offer/${await offerToken(hr.orgId, email)}/accept`).send({}).expect(200);
    const hired = (await api(hr).post(`/people/talent/candidates/${priya.id}/hire`, { code: 'HH-2' }).expect(201)).body;
    employeeId = hired.employee.id;
    expect(hired.handoffs).toMatchObject({ offerFiled: true, joiningForm: 'SENT', appAccess: 'SENT', salary: { made: true } });
    revisionId = hired.handoffs.salary.revisionId;
    /* The joining date came from the offer. */
    expect((await api(hr).get(`/people/employees/${employeeId}`).expect(200)).body.employee.dateOfJoining).toBe(plus(7));
    /* The offer points at the record and its letter is among their documents. */
    const offers = (await api(hr).get(`/people/offers?employeeId=${employeeId}`).expect(200)).body.offers;
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ id: offer.id, status: 'ACCEPTED', employeeId, candidateId: priya.id });
    const docs = (await api(hr).get(`/people/employees/${employeeId}/documents`).expect(200)).body.documents;
    expect(docs.some((d: any) => d.id === offers[0].documentId && /^Offer letter/.test(d.title) && d.mime === 'application/pdf')).toBe(true);
    /* The joining form and the employee-app invite, by e-mail. */
    expect((await api(hr).get(`/people/employees/${employeeId}/invites`).expect(200)).body.invites.map((i: any) => [i.status, i.sentTo])).toEqual([['SENT', email]]);
    expect((await mails(hr.orgId, 'people.join_invite', email)).length).toBe(1);
    expect((await mails(hr.orgId, 'attendance.portal_invite', email)).length).toBe(1);
    /* The joining plan, with its salary step open, waiting on Payroll. */
    const plan = (await api(hr).get(`/people/employees/${employeeId}/checklist`).expect(200)).body.joining;
    expect(plan.tasks.find((t: any) => /salary structure/i.test(t.title)).done).toBe(false);
    /* Payroll holds a draft revision from the offer, nothing written to their salary yet. */
    const rev = await runInTenant(hr.orgId, () => payrollPrisma.salaryRevision.findFirst({ where: { orgId: hr.orgId, id: revisionId } }));
    expect(rev).toMatchObject({ employeeId, status: 'DRAFT', proposedStructureId: structureId, effectiveFrom: plus(7), reason: 'From the accepted offer' });
    expect(Number(rev!.proposedAnnualCtc)).toBe(480000);
    expect(await runInTenant(hr.orgId, () => payrollPrisma.salaryAssignment.count({ where: { orgId: hr.orgId, employeeId } }))).toBe(0);
    /* Hiring again finds the same draft rather than making two. */
    await api(hr).post(`/people/talent/candidates/${priya.id}/hire`, {}).expect(409);
  }, 90_000);

  it('Payroll confirming the salary ticks "Assign the salary structure"; an appointment letter ticks its step', async () => {
    /* Payroll reviews and approves in its own screen; here the approval is written and the one step that changes pay, apply, is run as Payroll's route runs it. */
    const rev = await runInTenant(hr.orgId, () => payrollPrisma.salaryRevision.update({ where: { id: revisionId }, data: { status: 'APPROVED', approvedByUserId: hr.userId, approvedAt: new Date() } }));
    const { assignment } = await runInTenant(hr.orgId, () => applyRevision({ accountId: rev.accountId, orgId: hr.orgId, userId: hr.userId, revisionId }));
    expect(assignment).toMatchObject({ employeeId, structureId, status: 'ACTIVE', effectiveFrom: plus(7) });
    let plan = (await api(hr).get(`/people/employees/${employeeId}/checklist`).expect(200)).body.joining;
    const salaryStep = plan.tasks.find((t: any) => /salary structure/i.test(t.title));
    expect(salaryStep.done).toBe(true);
    expect(salaryStep.note).toMatch(/Payroll put them on/);
    expect(plan.tasks.find((t: any) => /appointment letter/i.test(t.title)).done).toBe(false);
    /* The appointment letter names the establishment and the probation end: set on the record as HR would. */
    const est = (await api(hr).post('/people/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka' }).expect(201)).body.item;
    await request(app).put(`/api/orgs/${hr.orgId}/people/employees/${employeeId}`).set(at(hr)).send({ establishmentId: est.id, probationEndDate: plus(187) }).expect(200);
    const letter = await api(hr).post(`/people/employees/${employeeId}/letters`, { kind: 'APPOINTMENT', extra: { signatory: 'Asha, Owner' } });
    expect(letter.status, JSON.stringify(letter.body)).toBe(201);
    plan = (await api(hr).get(`/people/employees/${employeeId}/checklist`).expect(200)).body.joining;
    expect(plan.tasks.find((t: any) => /appointment letter/i.test(t.title))).toMatchObject({ done: true, doneBy: expect.any(String) });
  }, 60_000);

  it('a salary set in Payroll by hand ticks the step too', async () => {
    const e = (await api(hr).post('/people/employees', { name: 'Hand Set', code: 'HH-3', dateOfJoining: plus(1) }).expect(201)).body.employee;
    expect((await api(hr).get(`/people/employees/${e.id}/checklist`).expect(200)).body.joining.tasks.find((t: any) => /salary structure/i.test(t.title)).done).toBe(false);
    await api(hr).post('/payroll/assignments', { employeeId: e.id, structureId, effectiveFrom: plus(1), annualCtc: 300000 }).expect(201);
    expect((await api(hr).get(`/people/employees/${e.id}/checklist`).expect(200)).body.joining.tasks.find((t: any) => /salary structure/i.test(t.title)).done).toBe(true);
  }, 60_000);
});

describe('candidates hear from the company', () => {
  it('an interview set, then moved, e-mails the candidate with the day, time, how and first names; not being taken forward e-mails them plainly', async () => {
    const email = `dev.${rnd()}@example.com`;
    const interviewer = await colleague(hr, 'Ira Menon', ['PEOPLE::Employees::VIEW']);
    const dev = (await api(hr).post('/people/talent/candidates', { openingId, name: 'Dev R', email }).expect(201)).body.candidate;
    const at1 = new Date(Date.parse(`${plus(3)}T05:00:00Z`)); // 10:30 am IST
    const set = (await api(hr).post(`/people/talent/candidates/${dev.id}/interviews`, { at: at1.toISOString(), mode: 'VIDEO', place: 'https://meet.example/dev', interviewerUserIds: [hr.userId, interviewer.userId] }).expect(201)).body.interview;
    let sent = await mails(hr.orgId, 'people.interview', email);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/^Your interview is set: Hire Co/);
    expect(sent[0].bodyText).toContain('10:30 am');
    expect(sent[0].bodyText).toContain('Video call');
    expect(sent[0].bodyText).toContain('Join here: https://meet.example/dev');
    expect(sent[0].bodyText).toContain('You will meet: Asha, Ira');
    expect(sent[0].bodyText).not.toContain('Menon');
    await request(app).put(`/api/orgs/${hr.orgId}/people/talent/interviews/${set.id}`).set(at(hr)).send({ at: new Date(at1.getTime() + 86_400_000).toISOString(), mode: 'IN_PERSON', place: 'Office, 2nd floor', interviewerUserIds: [hr.userId] }).expect(200);
    sent = await mails(hr.orgId, 'people.interview', email);
    expect(sent).toHaveLength(2);
    expect(sent[0].subject).toMatch(/^Your interview has moved/);
    expect(sent[0].bodyText).toContain('Where: Office, 2nd floor');
    /* Not taken forward: the reason stays on the card and never reaches them. */
    await api(hr).post(`/people/talent/candidates/${dev.id}/stage`, { stage: 'REJECTED', reason: 'Salary expectation too high' }).expect(200);
    const no = await mails(hr.orgId, 'people.candidate_not_taken', email);
    expect(no).toHaveLength(1);
    expect(no[0].bodyText).toContain('Accountant');
    expect(no[0].bodyText).not.toContain('Salary expectation');
    /* No e-mail on file, no e-mail sent, no error. */
    const quiet = (await api(hr).post('/people/talent/candidates', { openingId, name: 'Quiet Q', phone: '9800000099' }).expect(201)).body.candidate;
    await api(hr).post(`/people/talent/candidates/${quiet.id}/stage`, { stage: 'REJECTED', reason: 'No show' }).expect(200);
    expect((await mails(hr.orgId, 'people.candidate_not_taken')).length).toBe(1);
  }, 90_000);
});

describe('HR records a claim on someone’s behalf', () => {
  it('the claim is under the person’s name, marked as recorded by HR, waits in the inbox, and once approved is paid with salary through Payroll', async () => {
    const manager = await colleague(hr, 'Kiran', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE']);
    const boss = (await api(hr).post('/people/employees', { name: 'Kiran Rao', code: 'HM-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: boss.id }, data: { userId: manager.userId } }));
    const asha = (await api(hr).post('/people/employees', { name: 'Asha Nair', code: 'HE-1', dateOfJoining: '2024-01-01', reportingManagerId: boss.id }).expect(201)).body.employee;
    await api(hr).post('/payroll/assignments', { employeeId: asha.id, structureId, effectiveFrom: '2024-01-01', annualCtc: 600000 }).expect(201);
    const cats = (await api(hr).get('/people/money/categories').expect(200)).body.categories;
    const travel = cats.find((c: any) => c.name === 'Travel').id;
    /* Checked like the person's own. */
    const empty = await api(hr).post('/people/money/claims', { employeeId: asha.id, title: 'Paper bills', lines: [] });
    expect(empty.status, JSON.stringify(empty.body)).toBe(400);
    await api(hr).post('/people/money/claims', { employeeId: asha.id, lines: [{ spentOn: plus(-2), categoryId: travel, amount: 0, merchant: 'Auto' }] }).expect(400);
    await api(hr).post('/people/money/claims', { employeeId: 'nobody', lines: [{ spentOn: plus(-2), categoryId: travel, amount: 120, merchant: 'Auto' }] }).expect(404);
    const claim = (await api(hr).post('/people/money/claims', { employeeId: asha.id, title: 'Paper bills handed in', lines: [{ spentOn: plus(-2), categoryId: travel, amount: 120, merchant: 'Auto' }, { spentOn: plus(-1), categoryId: travel, amount: 450, merchant: 'Uber', note: 'Client visit' }] }).expect(201)).body.claim;
    expect(claim).toMatchObject({ status: 'SUBMITTED', employeeId: asha.id, employeeName: 'Asha Nair', claimed: 570, recordedByUserId: hr.userId, title: 'Paper bills handed in' });
    expect(claim.lines).toHaveLength(2);
    expect(claim.approvalRequestId).toBeTruthy();
    /* In the manager's one inbox, like a claim from the app; a manager may not record one. */
    const inbox = (await api(manager).get('/people/inbox').expect(200)).body.items;
    expect(inbox.find((i: any) => i.id === claim.approvalRequestId)).toMatchObject({ kind: 'APPROVAL', subKind: 'EXPENSE_CLAIM' });
    await api(manager).post('/people/money/claims', { employeeId: asha.id, lines: [{ spentOn: plus(-2), categoryId: travel, amount: 10, merchant: 'Bus' }] }).expect(403);
    /* The person's own draft is untouched: nothing appears in their app unasked. */
    expect(await runInTenant(hr.orgId, () => peoplePrisma.expenseClaim.count({ where: { orgId: hr.orgId, employeeId: asha.id, status: 'DRAFT' } }))).toBe(0);
    await api(manager).post(`/people/requests/${claim.approvalRequestId}/approve`, {}).expect(200);
    const toPay = (await api(hr).get('/people/money/claims?status=TO_PAY').expect(200)).body.claims;
    expect(toPay.find((c: any) => c.id === claim.id)).toMatchObject({ status: 'APPROVED', toPay: 570 });
    /* Paid with salary: a draft reimbursement waits in Payroll. */
    const paid = (await api(hr).post(`/people/money/claims/${claim.id}/pay`, { mode: 'SALARY' }).expect(200)).body.claim;
    expect(paid).toMatchObject({ status: 'WITH_SALARY', payMode: 'SALARY' });
    const adj = await runInTenant(hr.orgId, () => payrollPrisma.payrollAdjustment.findFirst({ where: { orgId: hr.orgId, employeeId: asha.id, type: 'EARNING' } }));
    expect(adj).toMatchObject({ status: 'DRAFT' });
    expect(Number(adj!.amount)).toBe(570);
  }, 120_000);
});
