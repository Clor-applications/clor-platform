import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Private cases (docs/people/02-PRD.md PRIV-01..06): named members only —
 * the company owner gets 404; a conflicted member is left out; the summary
 * and evidence are sealed in the database; opening evidence is logged where
 * the presiding officer sees it; the legal clock; never in the export; the
 * annual report is counts only; the committee set-up warns.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `case.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Case Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/\s/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const plus = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

let boss: Ctx;
let presiding: Ctx;
let member: Ctx;
let conflicted: Ctx;
let external: Ctx;
let hr: Ctx;
beforeAll(async () => {
  boss = await owner();
  hr = await colleague(boss, 'Asha HR', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Private Cases::VIEW', 'PEOPLE::Private Cases::CREATE', 'PEOPLE::Private Cases::EDIT']);
  presiding = await colleague(boss, 'Meera Iyer', []);
  member = await colleague(boss, 'Ravi Das', []);
  conflicted = await colleague(boss, 'Imran Patil', []);
  external = await colleague(boss, 'Lata Rao', []);
}, 120_000);

describe('private cases', () => {
  it('the committee set-up warns until it meets the rule (PRIV-06)', async () => {
    const thin = (await people(hr).put('/private-cases/committee/POSH_IC', { members: [{ userId: presiding.userId, role: 'PRESIDING', gender: 'MALE' }, { userId: member.userId, role: 'MEMBER', gender: 'MALE' }] }).expect(200)).body.committee;
    expect(thin.warnings).toEqual(expect.arrayContaining([
      'The presiding officer must be a senior woman employee.',
      'Name at least two employee members.',
      'Name one external member (from an NGO or someone familiar with sexual harassment issues).',
      'At least half the members must be women: 0 of 2 are.',
    ]));
    const full = (await people(hr).put('/private-cases/committee/POSH_IC', { members: [
      { userId: presiding.userId, role: 'PRESIDING', gender: 'FEMALE', termStart: '2026-01-01', termEnd: '2028-12-31' },
      { userId: member.userId, role: 'MEMBER', gender: 'MALE' },
      { userId: conflicted.userId, role: 'MEMBER', gender: 'MALE' },
      { userId: external.userId, role: 'EXTERNAL', gender: 'FEMALE', external: true },
    ] }).expect(200)).body.committee;
    expect(full.warnings).toEqual([]);
    expect(full.members.map((m: any) => m.name)).toEqual(['Meera Iyer', 'Ravi Das', 'Imran Patil', 'Lata Rao']);
    /* Only the grant opens the set-up. */
    await people(member).get('/private-cases/committee/POSH_IC').expect(403);
  });

  it('a complaint taken in goes to the committee less the conflicted member; only members open it — the owner gets 404; sealed at rest; evidence opens logged (PRIV-01..03)', async () => {
    const complainant = (await people(boss).post('/employees', { name: 'Sana Reddy', code: 'PC-1', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    /* The respondent is Imran's own employee record: Imran is conflicted. */
    const respondent = (await people(boss).post('/employees', { name: 'Imran Patil', code: 'PC-2', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: respondent.id }, data: { userId: conflicted.userId } }));
    await people(member).post('/private-cases', { kind: 'POSH', summary: 'x'.repeat(20), incidentOn: plus(-5) }).expect(403);
    await people(hr).post('/private-cases', { kind: 'POSH', summary: 'short', incidentOn: plus(-5) }).expect(400);
    const made = (await people(hr).post('/private-cases', { kind: 'POSH', complainantEmployeeId: complainant.id, respondentEmployeeIds: [respondent.id], summary: 'Repeated remarks about appearance in the Pune office, three times in October, with witnesses.', incidentOn: plus(-10) }).expect(201)).body.case;
    expect(made.reference).toMatch(/^PC-\d{4}-001$/);
    expect(made.inquiryDue).toBe(plus(90));
    expect(made.lateFiling).toBe(false);

    /* Who can open it: the presiding officer and the unconflicted members. Not the conflicted member, not HR who took it in, not the owner. */
    await people(conflicted).get(`/private-cases/${made.id}`).expect(404);
    await people(hr).get(`/private-cases/${made.id}`).expect(404);
    await people(boss).get(`/private-cases/${made.id}`).expect(404);
    expect((await people(boss).get('/private-cases').expect(200)).body.cases).toEqual([]);
    expect((await people(conflicted).get('/private-cases').expect(200)).body.cases).toEqual([]);
    const opened = (await people(presiding).get(`/private-cases/${made.id}`).expect(200)).body.case;
    expect(opened).toMatchObject({ myRole: 'PRESIDING', complainant: 'Sana Reddy (PC-1)', respondents: ['Imran Patil (PC-2)'], onBehalf: true });
    expect(opened.summary).toContain('Repeated remarks');
    expect(opened.members.map((m: any) => m.name).sort()).toEqual(['Lata Rao', 'Meera Iyer', 'Ravi Das']);
    expect(opened.excluded).toEqual([{ name: 'Imran Patil', why: 'named as a respondent' }]);
    expect((await people(member).get('/private-cases').expect(200)).body.cases.map((c: any) => c.reference)).toEqual([made.reference]);

    /* Sealed at rest: neither the summary nor the evidence is readable in the table. */
    const raw = await runInTenant(boss.orgId, () => peoplePrisma.privateCase.findUniqueOrThrow({ where: { id: made.id } }));
    expect(raw.summaryEnc).toMatch(/^pc1\./);
    expect(raw.summaryEnc).not.toContain('remarks');
    const ev = (await people(member).post(`/private-cases/${made.id}/evidence`, { title: 'Chat screenshot', data: `data:text/plain;base64,${Buffer.from('the message itself').toString('base64')}`, mime: 'text/plain' }).expect(201)).body.evidence;
    const rawEv = await runInTenant(boss.orgId, () => peoplePrisma.privateCaseEvidence.findUniqueOrThrow({ where: { id: ev.id } }));
    expect(rawEv.dataEnc).not.toContain(Buffer.from('the message itself').toString('base64'));
    expect(rawEv.titleEnc).not.toContain('Chat');
    /* Opening evidence writes an access row the presiding officer sees; members do not see the log. */
    const file = (await people(member).get(`/private-cases/${made.id}/evidence/${ev.id}`).expect(200)).body.evidence;
    expect(Buffer.from(file.dataUrl.split(',')[1], 'base64').toString()).toBe('the message itself');
    const log = (await people(presiding).get(`/private-cases/${made.id}`).expect(200)).body.case.access;
    expect(log.find((a: any) => a.what === 'EVIDENCE')).toMatchObject({ who: 'Ravi Das', evidenceId: ev.id });
    expect(log.filter((a: any) => a.what === 'OPEN').length).toBeGreaterThanOrEqual(2);
    expect((await people(member).get(`/private-cases/${made.id}`).expect(200)).body.case.access).toBeNull();
    await people(conflicted).get(`/private-cases/${made.id}/evidence/${ev.id}`).expect(404);

    /* The clock: only the presiding officer moves it; close inquiry → report in 10 days; report → action in 60; close with the action. */
    await people(member).post(`/private-cases/${made.id}/advance`, { step: 'START_INQUIRY' }).expect(403);
    await people(presiding).post(`/private-cases/${made.id}/advance`, { step: 'START_INQUIRY' }).expect(200);
    const closed = (await people(presiding).post(`/private-cases/${made.id}/advance`, { step: 'CLOSE_INQUIRY', on: plus(0) }).expect(200)).body.case;
    expect(closed.clock).toMatchObject({ inquiryClosedOn: plus(0), reportDue: plus(10) });
    const reported = (await people(presiding).post(`/private-cases/${made.id}/advance`, { step: 'REPORT', on: plus(0) }).expect(200)).body.case;
    expect(reported.clock.actionDue).toBe(plus(60));
    await people(presiding).post(`/private-cases/${made.id}/advance`, { step: 'CLOSE' }).expect(400);
    const done = (await people(presiding).post(`/private-cases/${made.id}/advance`, { step: 'CLOSE', outcome: 'Written warning; moved to another team.' }).expect(200)).body.case;
    expect(done.status).toBe('CLOSED');
  });

  it('a complaint from the app returns a reference only; a late filing is flagged and the window can be extended once with a reason (PRIV-02, PRIV-03)', async () => {
    const e = (await people(boss).post('/employees', { name: 'Kavya Reddy', code: 'PC-3', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const access = (await request(app).get(`/api/orgs/${boss.orgId}/attendance/portal-access`).set(at(boss)).expect(200)).body;
    const act = (await request(app).post(`/api/orgs/${boss.orgId}/attendance/portal-access/codes`).set(at(boss)).send({ employeeIds: [e.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: access.company.code, employeeCode: 'PC-3', activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
    const r = (await request(app).post('/api/portal/people/private-cases').set({ Authorization: `Bearer ${token}` }).send({ kind: 'POSH', summary: 'An incident at the year-end party, five months ago; I was afraid to say.', incidentOn: plus(-150) }).expect(201)).body;
    expect(Object.keys(r).sort()).toEqual(['inquiryDue', 'receivedOn', 'reference']);
    const row = await runInTenant(boss.orgId, () => peoplePrisma.privateCase.findFirstOrThrow({ where: { orgId: boss.orgId, reference: r.reference } }));
    const opened = (await people(presiding).get(`/private-cases/${row.id}`).expect(200)).body.case;
    expect(opened).toMatchObject({ complainant: 'Kavya Reddy (PC-3)', onBehalf: false });
    expect(opened.clock.lateFiling).toBe(true);
    await people(presiding).post(`/private-cases/${row.id}/advance`, { step: 'EXTEND' }).expect(400);
    const ext = (await people(presiding).post(`/private-cases/${row.id}/advance`, { step: 'EXTEND', reason: 'She was prevented from coming forward by her supervisor.' }).expect(200)).body.case;
    expect(ext.clock.lateFiling).toBe(false);
    expect(ext.clock.extensionReason).toContain('prevented');
    await people(presiding).post(`/private-cases/${row.id}/advance`, { step: 'EXTEND', reason: 'again' }).expect(409);
  });

  it('never in the company export; the annual report is counts only (PRIV-04, PRIV-05)', async () => {
    const exp = await request(app).get(`/api/orgs/${boss.orgId}/export`).set(at(boss));
    const text = JSON.stringify(exp.body || {});
    expect(text).not.toMatch(/privateCase|committeeSetup/i);
    expect(text).not.toContain('Repeated remarks');
    const report = (await people(hr).get(`/private-cases/report/${plus(0).slice(0, 4)}`).expect(200)).body.report;
    expect(report).toMatchObject({ received: 2, disposed: 1 });
    expect(JSON.stringify(report)).not.toMatch(/Sana|Imran|Kavya|PC-\d/);
    /* The committee files it (gap 12): a member without the grant reads it and is told so on the list; someone off the committee is refused. */
    const asMember = (await people(member).get(`/private-cases/report/${plus(0).slice(0, 4)}`).expect(200)).body.report;
    expect(asMember).toMatchObject({ received: 2, disposed: 1, committee: { presiding: 'Meera Iyer', members: 4, external: 1, women: 2 }, dueOn: `${Number(plus(0).slice(0, 4)) + 1}-01-31` });
    expect(asMember.company).toMatch(/^Case Co /);
    expect((await people(member).get('/private-cases').expect(200)).body.annualReport).toBe(true);
    const outsider = await colleague(boss, 'Nobody Else', ['PEOPLE::Employees::VIEW']);
    await people(outsider).get(`/private-cases/report/${plus(0).slice(0, 4)}`).expect(403);
    expect((await people(outsider).get('/private-cases').expect(200)).body.annualReport).toBe(false);
    /* Another company's owner reads their own (empty) year, never this one. */
    const elsewhere = await owner();
    expect((await people(elsewhere).get(`/private-cases/report/${plus(0).slice(0, 4)}`).expect(200)).body.report).toMatchObject({ received: 0, disposed: 0, committee: { members: 0 } });
  });
});
