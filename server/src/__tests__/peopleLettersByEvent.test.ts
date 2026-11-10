import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Letters by event (People plan 8 Nov 2026, step 6). Where the company has
 * saved its own letter for a kind, CLOR issues it by itself: appointment on
 * joining, confirmation on confirming probation, increment on a pay rise,
 * relieving and experience on leaving. Once each per stint (or revision),
 * signed by the signatory on file, ticking the plan step that waits for it.
 * No letter of its own: nothing is issued and nothing fails. An employee asks
 * for a letter or a copy of a document in the app; approved, the letter lands
 * in their documents, or HR gets a task. Help desk escalations and seat
 * requests are no longer offered on Approval rules.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { applyRevision } = await import('../services/payroll/revision.js');
const { runSeparations } = await import('../services/people/lifecycle/leaving.js');
const { appointmentOnHire } = await import('../services/people/letters.js');
const { startChecklist } = await import('../services/people/checklists.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const SIGNS = 'Meera Shah, HR Manager';

async function owner(): Promise<Ctx> {
  const email = `lbe.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Letters Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return c;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
});
async function portalFor(c: Ctx, companyCode: string, employee: { id: string; code: string }) {
  const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: employee.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
  return { Authorization: `Bearer ${token}` };
}
const letters = (c: Ctx, employeeId: string) => runInTenant(c.orgId, () => peoplePrisma.employeeDocument.findMany({ where: { orgId: c.orgId, employeeId, kind: 'LETTER' }, orderBy: { createdAt: 'asc' } }));
/* The PDF's lines, joined: a sentence may wrap. */
const textOf = (doc: { data: Uint8Array | Buffer }) => [...Buffer.from(doc.data).toString('latin1').matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join(' ');
const plan = async (c: Ctx, employeeId: string) => (await api(c).get(`/people/employees/${employeeId}/checklist`).expect(200)).body;
const saveLetter = (c: Ctx, kind: string, body: string) => api(c).post('/people/letter-templates', { kind, body }).expect(201);
const approveAll = async (c: Ctx, id: string) => {
  let r = (await api(c).post(`/people/requests/${id}/approve`, { comment: 'Fine' }).expect(200)).body;
  while (r.request.status === 'WAITING') r = (await api(c).post(`/people/requests/${id}/approve`, { comment: 'Fine' }).expect(200)).body;
  return r;
};

let hr: Ctx;
let companyCode = '';
let structureId = '';

beforeAll(async () => {
  hr = await owner();
  const { platformPrisma } = await import('../utils/platformPrisma.js');
  hr.accountId = (await platformPrisma.org.findUnique({ where: { id: hr.orgId }, select: { accountId: true } }))!.accountId;
  companyCode = (await api(hr).get('/attendance/portal-access').expect(200)).body.company.code;
  const pay = (p: string, b: unknown) => api(hr).post(`/payroll${p}`, b).expect(201);
  const basic = (await pay('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 })).body.component;
  structureId = (await pay('/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2024-01-01', status: 'ACTIVE', components: [{ componentId: basic.id, displayOrder: 1 }] })).body.structure.id;
}, 120_000);

describe('the Letters screen and Approval rules', () => {
  it('says which letters an event issues and who signs them; the signatory is a company setting', async () => {
    const before = (await api(hr).get('/people/letter-templates').expect(200)).body;
    expect(before.signatory).toBe('');
    expect(before.kinds.find((k: any) => k.kind === 'APPOINTMENT')).toMatchObject({ issuedWhen: 'someone joins' });
    expect(before.kinds.find((k: any) => k.kind === 'INCREMENT')).toMatchObject({ issuedWhen: 'Payroll applies a pay rise' });
    expect(before.kinds.find((k: any) => k.kind === 'EMPLOYMENT')).toMatchObject({ label: 'Employment certificate', issuedWhen: null });
    expect((await api(hr).put('/people/letter-settings', { signatory: `  ${SIGNS}  ` }).expect(200)).body).toEqual({ signatory: SIGNS });
    expect((await api(hr).get('/people/letter-templates').expect(200)).body.signatory).toBe(SIGNS);
  });

  it('Approval rules no longer offer help desk escalations or seat requests; letters and document copies stay', async () => {
    const types = (await api(hr).get('/people/approval-rules').expect(200)).body.requestTypes;
    expect(types).not.toContain('DESK_ESCALATION');
    expect(types).not.toContain('SEAT_REQUEST');
    expect(types).toEqual(expect.arrayContaining(['LETTER_REQUEST', 'DOCUMENT_REQUEST', 'LEAVE']));
  });
});

describe('appointment on joining', () => {
  it('without a letter of the company’s own, nothing is issued and the hire goes through', async () => {
    const e = (await api(hr).post('/people/employees', { name: 'No Letter', code: 'LB-0', dateOfJoining: plus(2) }).expect(201)).body.employee;
    expect(await letters(hr, e.id)).toHaveLength(0);
    expect((await plan(hr, e.id)).joining.tasks.find((t: any) => /appointment letter/i.test(t.title)).done).toBe(false);
  });

  it('with one: issued once on joining, signed by the signatory, ticking the joining step; not for someone who joined long ago', async () => {
    await saveLetter(hr, 'APPOINTMENT', 'Dear {{name}},\n\nYou are appointed at {{orgName}} from {{dateOfJoining}}.\n\n{{extra.signatory}}');
    const e = (await api(hr).post('/people/employees', { name: 'Kavya Rao', code: 'LB-1', dateOfJoining: plus(3) }).expect(201)).body.employee;
    const docs = await letters(hr, e.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ letterKind: 'APPOINTMENT', issuedFor: 'APPOINTMENT:stint1', templateVersion: 1, classification: 'EMPLOYEE_VISIBLE' });
    expect(textOf(docs[0])).toContain(SIGNS);
    expect((await plan(hr, e.id)).joining.tasks.find((t: any) => /appointment letter/i.test(t.title))).toMatchObject({ done: true });
    /* Run again (a retry, a second hand-off): still one letter. */
    const again = await runInTenant(hr.orgId, () => appointmentOnHire({ accountId: docs[0].accountId, orgId: hr.orgId, userId: hr.userId, source: 'SYSTEM', correlationId: 'again' }, { id: e.id, dateOfJoining: plus(3), status: 'ACTIVE' }));
    expect(again).toEqual({ issued: false, why: 'Already issued.' });
    expect(await letters(hr, e.id)).toHaveLength(1);
    /* A record added for someone who joined years ago is not a hire. */
    const old = (await api(hr).post('/people/employees', { name: 'Long Here', code: 'LB-2', dateOfJoining: '2020-04-01' }).expect(201)).body.employee;
    expect(await letters(hr, old.id)).toHaveLength(0);
  });

  it('a letter that asks for something CLOR cannot fill is skipped, and the step says why', async () => {
    await saveLetter(hr, 'APPOINTMENT', 'Dear {{name}},\n\nReport to {{extra.reportsTo}}.\n\n{{extra.signatory}}');
    const e = (await api(hr).post('/people/employees', { name: 'Hole Case', code: 'LB-3', dateOfJoining: plus(1) }).expect(201)).body.employee;
    expect(await letters(hr, e.id)).toHaveLength(0);
    const step = (await plan(hr, e.id)).joining.tasks.find((t: any) => /appointment letter/i.test(t.title));
    expect(step.done).toBe(false);
    expect(step.note).toMatch(/could not issue the appointment letter on its own\. Fill in before issuing: reportsTo\./);
    await saveLetter(hr, 'APPOINTMENT', 'Dear {{name}},\n\nYou are appointed at {{orgName}} from {{dateOfJoining}}.\n\n{{extra.signatory}}');
  });
});

describe('confirmation, increment and leaving', () => {
  it('confirming probation issues the confirmation letter and ticks a step that asks for it', async () => {
    await saveLetter(hr, 'CONFIRMATION', 'Dear {{name}},\n\nYour services are confirmed from {{confirmedOn}}.\n\n{{extra.signatory}}');
    const e = (await api(hr).post('/people/employees', { name: 'Sana Iqbal', code: 'LB-4', dateOfJoining: '2025-06-01', probationEndDate: plus(-1) }).expect(201)).body.employee;
    await runInTenant(hr.orgId, () => startChecklist({ accountId: hr.accountId, orgId: hr.orgId, userId: hr.userId }, { id: e.id }, 'PROBATION', today(), { items: [{ title: 'Confirmation letter issued', owner: 'HR', dueDays: 0 }] }));
    await api(hr).post(`/people/employees/${e.id}/probation/decide`, { outcome: 'CONFIRM' }).expect(200);
    const docs = await letters(hr, e.id);
    expect(docs.map((d) => [d.letterKind, d.issuedFor])).toEqual([['CONFIRMATION', 'CONFIRMATION:stint1']]);
    expect(textOf(docs[0])).toContain('confirmed from');
    expect((await plan(hr, e.id)).probation.tasks.find((t: any) => t.title === 'Confirmation letter issued')).toMatchObject({ done: true });
  });

  it('a pay rise Payroll applies issues the increment letter, once per revision; a first salary does not', async () => {
    await saveLetter(hr, 'INCREMENT', 'Dear {{name}},\n\nYour pay is revised from {{extra.effectiveFrom}}.\n\n{{extra.signatory}}');
    const e = (await api(hr).post('/people/employees', { name: 'Vikram Joshi', code: 'LB-5', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await api(hr).post('/payroll/assignments', { employeeId: e.id, structureId, effectiveFrom: '2024-01-01', annualCtc: 300000 }).expect(201);
    const from = `${today().slice(0, 7)}-01`;
    const rev = await runInTenant(hr.orgId, () => payrollPrisma.salaryRevision.create({ data: { accountId: hr.accountId, orgId: hr.orgId, employeeId: e.id, proposedStructureId: structureId, proposedAnnualCtc: 360000, currentAnnualCtc: 300000, effectiveFrom: from, status: 'APPROVED', createdByUserId: hr.userId } }));
    await runInTenant(hr.orgId, () => applyRevision({ accountId: hr.accountId, orgId: hr.orgId, userId: hr.userId, revisionId: rev.id }));
    const docs = await letters(hr, e.id);
    expect(docs.map((d) => [d.letterKind, d.issuedFor])).toEqual([['INCREMENT', `INCREMENT:${rev.id}`]]);
    expect(textOf(docs[0])).toContain(`revised from 1 ${new Date(`${from}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })}`);
    /* Someone's first salary through a revision is not a rise. */
    const fresh = (await api(hr).post('/people/employees', { name: 'First Pay', code: 'LB-6', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const first = await runInTenant(hr.orgId, () => payrollPrisma.salaryRevision.create({ data: { accountId: hr.accountId, orgId: hr.orgId, employeeId: fresh.id, proposedStructureId: structureId, proposedAnnualCtc: 300000, effectiveFrom: from, status: 'APPROVED', createdByUserId: hr.userId } }));
    await runInTenant(hr.orgId, () => applyRevision({ accountId: hr.accountId, orgId: hr.orgId, userId: hr.userId, revisionId: first.id }));
    expect(await letters(hr, fresh.id)).toHaveLength(0);
  });

  it('leaving issues the relieving and experience letters on the day they leave, and ticks the leaving step once both are on file', async () => {
    await saveLetter(hr, 'RELIEVING', 'Dear {{name}},\n\nYou are relieved on {{dateOfLeaving}}, {{leavingWords}}.\n\n{{extra.signatory}}');
    await saveLetter(hr, 'EXPERIENCE', '{{name}} worked with us from {{dateOfJoining}} to {{dateOfLeaving}}. We wish {{extra.pronounObject}} well.\n\n{{extra.signatory}}');
    const e = (await api(hr).post('/people/employees', { name: 'Anita Desai', code: 'LB-7', dateOfJoining: '2025-01-01', gender: 'FEMALE' }).expect(201)).body.employee;
    /* On notice: nothing yet. */
    await api(hr).post(`/people/employees/${e.id}/resign`, { lastDay: plus(3), leavingType: 'RESIGNED' }).expect(200);
    expect(await letters(hr, e.id)).toHaveLength(0);
    let step = (await plan(hr, e.id)).leaving.tasks.find((t: any) => t.title === 'Relieving and experience letters issued');
    expect(step.done).toBe(false);
    /* The day after the last day: Left, both letters, the step ticked. A second run adds nothing. */
    await runSeparations(new Date(Date.now() + 4 * 86_400_000));
    await runSeparations(new Date(Date.now() + 5 * 86_400_000));
    const docs = await letters(hr, e.id);
    expect(docs.map((d) => [d.letterKind, d.issuedFor]).sort()).toEqual([['EXPERIENCE', 'EXPERIENCE:stint1'], ['RELIEVING', 'RELIEVING:stint1']]);
    expect(textOf(docs.find((d) => d.letterKind === 'RELIEVING')!)).toContain('following your resignation');
    expect(textOf(docs.find((d) => d.letterKind === 'EXPERIENCE')!)).toContain('We wish her well.');
    step = (await plan(hr, e.id)).leaving.tasks.find((t: any) => t.title === 'Relieving and experience letters issued');
    expect(step).toMatchObject({ done: true, note: 'Issued: both letters are on their documents.' });
  }, 60_000);

  it('no leaving letters for an absconding', async () => {
    const e = (await api(hr).post('/people/employees', { name: 'Gone Quiet', code: 'LB-8', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await api(hr).post(`/people/employees/${e.id}/resign`, { lastDay: plus(-2), leavingType: 'ABSCONDED' }).expect(200);
    expect((await api(hr).get(`/people/employees/${e.id}`).expect(200)).body.employee.status).toBe('LEFT');
    expect(await letters(hr, e.id)).toHaveLength(0);
  });
});

describe('asking for a letter in the employee app', () => {
  it('a letter asked for is approved by HR and lands in My documents; the leaving letters only once leaving; one open ask at a time', async () => {
    const role = (await api(hr).post('/people/structure/job-positions', { name: 'Analyst' }).expect(201)).body.item;
    const e = (await api(hr).post('/people/employees', { name: 'Rohan Mehta', code: 'LB-9', dateOfJoining: '2024-03-01', jobPositionId: role.id }).expect(201)).body.employee;
    const rohan = await portalFor(hr, companyCode, e);
    const mine = (await request(app).get('/api/portal/people/me/letters').set(rohan).expect(200)).body;
    expect(mine.kinds.map((k: any) => k.kind)).toEqual(['EMPLOYMENT']);
    expect(mine.requests).toEqual([]);
    expect((await request(app).post('/api/portal/people/me/letters').set(rohan).send({ kind: 'EXPERIENCE' }).expect(400)).body.error).toBe('This letter is for when you are leaving.');
    await request(app).post('/api/portal/people/me/letters').set(rohan).send({ kind: 'SERVICE_CERT' }).expect(400);
    await request(app).post('/api/portal/people/me/letters').set(rohan).send({ kind: 'COPY' }).expect(400);
    const asked = (await request(app).post('/api/portal/people/me/letters').set(rohan).send({ kind: 'EMPLOYMENT', note: 'For my bank' }).expect(201)).body;
    expect(asked.request).toMatchObject({ status: 'WAITING', title: 'Rohan Mehta: employment certificate' });
    await request(app).post('/api/portal/people/me/letters').set(rohan).send({ kind: 'EMPLOYMENT' }).expect(409);
    /* The company had no rule: HR decides, and the rule now shows on Approval rules. */
    const rules = (await api(hr).get('/people/approval-rules').expect(200)).body.rules;
    expect(rules.find((r: any) => r.requestType === 'LETTER_REQUEST' && r.active)).toMatchObject({ name: 'Letters (default: HR)' });
    const done = await approveAll(hr, asked.request.id);
    expect(done.request.status).toBe('APPROVED');
    expect(done.outcome).toMatchObject({ documentId: expect.any(String) });
    const docs = await letters(hr, e.id);
    expect(docs.map((d) => [d.letterKind, d.issuedFor])).toEqual([['EMPLOYMENT', `REQUEST:${asked.request.id}`]]);
    expect(textOf(docs[0])).toContain(SIGNS);
    const visible = (await request(app).get('/api/portal/documents').set(rohan).expect(200)).body.documents;
    expect(visible.map((d: any) => d.id)).toContain(done.outcome.documentId);
    const after = (await request(app).get('/api/portal/people/me/letters').set(rohan).expect(200)).body;
    expect(after.requests[0]).toMatchObject({ id: asked.request.id, type: 'LETTER_REQUEST', status: 'APPROVED', issued: true });
  }, 60_000);

  it('a letter that cannot be made yet becomes a task for HR, ticked when HR issues it', async () => {
    const role = (await api(hr).post('/people/structure/job-positions', { name: 'Planner' }).expect(201)).body.item;
    const e = (await api(hr).post('/people/employees', { name: 'Isha Kapoor', code: 'LB-10', dateOfJoining: '2024-03-01', jobPositionId: role.id }).expect(201)).body.employee;
    const isha = await portalFor(hr, companyCode, e);
    /* On notice: the leaving letters can be asked for now. */
    await api(hr).post(`/people/employees/${e.id}/resign`, { lastDay: plus(10), leavingType: 'RESIGNED' }).expect(200);
    expect((await request(app).get('/api/portal/people/me/letters').set(isha).expect(200)).body.kinds.map((k: any) => k.kind)).toEqual(['EMPLOYMENT', 'SERVICE_CERT', 'RELIEVING', 'EXPERIENCE']);
    await api(hr).put('/people/letter-settings', { signatory: '' }).expect(200);
    try {
      const asked = (await request(app).post('/api/portal/people/me/letters').set(isha).send({ kind: 'SERVICE_CERT' }).expect(201)).body;
      const done = await approveAll(hr, asked.request.id);
      expect(done.request.status).toBe('APPROVED');
      /* No signatory on file, and no establishment for the certificate to name. */
      expect(done.outcome).toMatchObject({ task: true, why: 'Fill in before issuing: establishment, signatory.' });
      expect(await letters(hr, e.id)).toHaveLength(0);
      let task = (await plan(hr, e.id)).letters.tasks[0];
      expect(task).toMatchObject({ done: false });
      expect(task.title).toMatch(/^Issue service certificate \(asked /);
      expect(task.note).toContain('Fill in before issuing: establishment, signatory.');
      const est = (await api(hr).post('/people/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka' }).expect(201)).body.item;
      await api(hr).put(`/people/employees/${e.id}`, { establishmentId: est.id }).expect(200);
      await api(hr).post(`/people/employees/${e.id}/letters`, { kind: 'SERVICE_CERT', extra: { signatory: 'Asha, Owner' } }).expect(201);
      task = (await plan(hr, e.id)).letters.tasks[0];
      expect(task).toMatchObject({ done: true });
    } finally {
      await api(hr).put('/people/letter-settings', { signatory: SIGNS }).expect(200);
    }
  }, 60_000);

  it('a copy of a document, approved, is a task on HR’s list to share it', async () => {
    const e = (await api(hr).post('/people/employees', { name: 'Neel Bose', code: 'LB-11', dateOfJoining: '2024-03-01' }).expect(201)).body.employee;
    const neel = await portalFor(hr, companyCode, e);
    const asked = (await request(app).post('/api/portal/people/me/letters').set(neel).send({ kind: 'COPY', what: 'my signed appointment letter', note: 'Lost mine' }).expect(201)).body;
    expect(asked.request).toMatchObject({ status: 'WAITING', title: 'Neel Bose: a copy of my signed appointment letter' });
    const done = await approveAll(hr, asked.request.id);
    expect(done.outcome).toMatchObject({ task: true });
    const task = (await plan(hr, e.id)).letters.tasks[0];
    expect(task).toMatchObject({ title: 'Share a copy of my signed appointment letter', done: false, owner: 'HR' });
    expect(task.note).toContain('Lost mine');
  }, 60_000);
});
