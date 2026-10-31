import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Letters and document versions (docs/people/02-PRD.md DOC-02, DOC-04,
 * DOC-07): a template is versioned; an issued letter is a PDF on the record
 * that names the version; a service certificate asked for in Karnataka is
 * due in 7 days; a Karnataka establishment cannot say it holds originals;
 * replacing a file keeps the earlier version.
 */
const { buildApp } = await import('../app.js');
const { textPdf } = await import('../services/people/pdf.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `let.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Letter Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('letters', () => {
  it('the PDF writer makes a readable file', () => {
    const pdf = textPdf({ title: 'Test letter', paragraphs: ['Dear Asha,', '', ...Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1}: ${'word '.repeat(12)}`), 'Regards'] });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('(Dear Asha,) Tj');
    expect(pdf.toString('latin1')).toContain('/Count 2');
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('a template is versioned and refuses unknown fields; an issued letter is a PDF on the record naming the version', async () => {
    const list = (await people(hr).get('/letter-templates').expect(200)).body;
    expect(list.templates.map((t: any) => t.kind)).toEqual(['OFFER', 'APPOINTMENT', 'CONFIRMATION', 'INCREMENT', 'RELIEVING', 'EXPERIENCE', 'SERVICE_CERT', 'ABSENCE_NOTICE_1', 'ABSENCE_NOTICE_2']);
    expect(list.templates.find((t: any) => t.kind === 'APPOINTMENT')).toMatchObject({ builtIn: true, version: 0, extra: ['signatory'] });
    const bad = await people(hr).post('/letter-templates', { kind: 'APPOINTMENT', body: 'Dear {{name}}, your salary is {{salary}}.' }).expect(400);
    expect(bad.body.error).toContain('{{salary}}');
    const v1 = (await people(hr).post('/letter-templates', { kind: 'APPOINTMENT', name: 'Appointment letter', body: 'Dear {{name}},\n\nYou are appointed as {{designation}} at {{orgName}} from {{dateOfJoining}}. Your ID is {{code}}.\n\n{{extra.signatory}}' }).expect(201)).body.template;
    expect(v1).toMatchObject({ version: 1, active: true, fields: ['name', 'designation', 'orgName', 'dateOfJoining', 'code'], extra: ['signatory'] });
    const v2 = (await people(hr).post('/letter-templates', { kind: 'APPOINTMENT', body: 'Dear {{name}},\n\nYou are appointed as {{designation}} at {{orgName}} from {{dateOfJoining}}. Your ID is {{code}}. Report to {{extra.reportsTo}}.\n\n{{extra.signatory}}' }).expect(201)).body.template;
    expect(v2.version).toBe(2);
    expect((await people(hr).get('/letter-templates/APPOINTMENT/versions').expect(200)).body.versions.map((t: any) => [t.version, t.active])).toEqual([[2, true], [1, false]]);

    const designer = (await people(hr).post('/structure/job-positions', { name: 'Designer' }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Nisha Verma', code: 'LT-1', dateOfJoining: '2026-11-10', jobPositionId: designer.id }).expect(201)).body.employee;
    const hole = await people(hr).post(`/employees/${e.id}/letters`, { kind: 'APPOINTMENT', extra: { signatory: 'Asha Menon, HR' } }).expect(400);
    expect(hole.body.error).toBe('Fill in before issuing: reportsTo.');
    const issued = (await people(hr).post(`/employees/${e.id}/letters`, { kind: 'APPOINTMENT', extra: { signatory: 'Asha Menon, HR', reportsTo: 'Imran Patil' } }).expect(201)).body;
    expect(issued.document).toMatchObject({ kind: 'LETTER', mime: 'application/pdf', templateId: v2.id, templateVersion: 2, classification: 'EMPLOYEE_VISIBLE' });
    expect(issued.text).toContain('You are appointed as Designer');
    expect(issued.text).toContain('from 10 November 2026');
    const doc = (await people(hr).get(`/documents/${issued.document.id}`).expect(200)).body.document;
    expect(doc.dataUrl.startsWith('data:application/pdf;base64,')).toBe(true);
    const bytes = Buffer.from(doc.dataUrl.split(',')[1], 'base64').toString('latin1');
    expect(bytes).toContain('%PDF-');
    expect(bytes).toContain('Report to Imran Patil');
    const { peoplePrisma } = await import('../utils/peoplePrisma.js');
    const { runInTenant } = await import('../utils/tenantScope.js');
    expect(await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: e.id, field: 'letter' } }))).toMatchObject({ after: 'Appointment letter issued (template v2)' });
    expect(await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { employeeId: e.id, name: 'people.letter.issued.v1' } }))).toBe(1);
  });

  it('a service certificate asked for in Karnataka is due in 7 days, and a Karnataka establishment cannot hold originals', async () => {
    const entity = (await people(hr).post('/structure/legal-entities', { name: 'Letter Co Pvt Ltd' }).expect(201)).body.item;
    const blr = (await people(hr).post('/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka', legalEntityId: entity.id }).expect(201)).body.item;
    const pune = (await people(hr).post('/structure/establishments', { name: 'Pune shop', kind: 'SHOP', state: 'Maharashtra', legalEntityId: entity.id, holdsOriginals: true }).expect(201)).body.item;
    expect(pune.holdsOriginals).toBe(true);
    const refused = await people(hr).put(`/structure/establishments/${blr.id}`, { name: 'Bengaluru office', holdsOriginals: true }).expect(400);
    expect(refused.body.error).toContain('Karnataka does not allow');
    await people(hr).post('/structure/establishments', { name: 'Mysuru shop', kind: 'SHOP', state: 'Karnataka', holdsOriginals: true }).expect(400);

    const guard = (await people(hr).post('/structure/job-positions', { name: 'Security guard' }).expect(201)).body.item;
    const ka = (await people(hr).post('/employees', { name: 'Ravi Das', code: 'LT-2', dateOfJoining: '2024-01-05', establishmentId: blr.id, jobPositionId: guard.id }).expect(201)).body.employee;
    const mh = (await people(hr).post('/employees', { name: 'Pooja Kumar', code: 'LT-3', dateOfJoining: '2024-01-05', establishmentId: pune.id }).expect(201)).body.employee;
    const due = (await people(hr).get(`/employees/${ka.id}/letters/service-certificate?askedOn=2026-10-24`).expect(200)).body;
    expect(due).toMatchObject({ state: 'Karnataka', dueDays: 7, dueOn: '2026-10-31' });
    expect(due.source).toContain('C-ST-02');
    expect((await people(hr).get(`/employees/${mh.id}/letters/service-certificate?askedOn=2026-10-24`).expect(200)).body).toMatchObject({ state: 'Maharashtra', dueDays: null, dueOn: null });

    const asked = (await people(hr).post(`/employees/${ka.id}/letters/requests`, { kind: 'SERVICE_CERT', askedOn: '2026-10-24' }).expect(201)).body;
    expect(asked).toMatchObject({ dueOn: '2026-10-31', dueDays: 7 });
    const plan = (await people(hr).get(`/employees/${ka.id}/checklist`).expect(200)).body;
    expect(plan.letters.tasks).toEqual([expect.objectContaining({ title: 'Issue service certificate (asked 2026-10-24)', owner: 'HR', dueDate: '2026-10-31', done: false })]);
    /* Asked on a past day, it falls due seven days from the asking, not from when it was typed in, and shows late once that has passed. */
    expect(plan.letters.tasks[0].overdue).toBe(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) > '2026-10-31');
    /* Issuing it ticks the task. The default template needs the leaving date; this person is still here, so it is refused until that is set. */
    /* A leaving letter is for someone leaving or gone (Workforce final audit W17); leaving is recorded through its own step. */
    await people(hr).post(`/employees/${ka.id}/letters`, { kind: 'SERVICE_CERT', extra: { signatory: 'HR' } }).expect(409);
    await people(hr).post(`/employees/${ka.id}/resign`, { lastDay: '2026-10-20', leavingType: 'RESIGNED' }).expect(200);
    await people(hr).post(`/employees/${ka.id}/letters`, { kind: 'SERVICE_CERT', extra: { signatory: 'HR' } }).expect(201);
    expect((await people(hr).get(`/employees/${ka.id}/checklist`).expect(200)).body.letters.tasks[0].done).toBe(true);
  });

  it('replacing a file keeps the earlier version under the newer one', async () => {
    const e = (await people(hr).post('/employees', { name: 'Kiran Khan', code: 'LT-4', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const v1 = (await people(hr).post(`/employees/${e.id}/documents`, { title: 'Aadhaar', kind: 'ID_PROOF', ...file('v1') }).expect(201)).body.document;
    expect(v1.version).toBe(1);
    const v2 = (await people(hr).post(`/documents/${v1.id}/replace`, { ...file('v2') }).expect(201)).body.document;
    expect(v2).toMatchObject({ version: 2, supersedesId: v1.id, title: 'Aadhaar', kind: 'ID_PROOF' });
    const listed = (await people(hr).get(`/employees/${e.id}/documents`).expect(200)).body.documents;
    expect(listed.map((d: any) => d.id)).toEqual([v2.id]);
    const versions = (await people(hr).get(`/documents/${v2.id}/versions`).expect(200)).body.versions;
    expect(versions.map((d: any) => [d.version, d.supersededById])).toEqual([[2, null], [1, v2.id]]);
    expect((await people(hr).get(`/documents/${v1.id}/versions`).expect(200)).body.versions.map((d: any) => d.version)).toEqual([2, 1]);
    await people(hr).post(`/documents/${v1.id}/replace`, { ...file('v3') }).expect(409);
    const old = (await people(hr).get(`/documents/${v1.id}`).expect(200)).body.document;
    expect(Buffer.from(old.dataUrl.split(',')[1], 'base64').toString()).toBe('v1');
  });
});
