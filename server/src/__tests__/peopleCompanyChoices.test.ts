import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Company choices (docs/people/workflow-engine/SPEC.md 3.2, 3.3, 3.5, 3.6; DECISIONS.md 2, 3, 5, 6): each has a
 * default that keeps today's behaviour (or the private one), a save, a refusal for the wrong person, another
 * company kept out, and a COMPANY_SETTING audit line with the value before and after. Then what each one changes:
 * who decides attendance requests ("HR only" refuses the manager), HR reading salary revisions, the leaving
 * reason kept from read-only users, and a withdrawn request's notice shown as withdrawn or removed.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { deliverOutbox } = await import('../services/people/outbox.js');
const { chainFor } = await import('../services/attendance/approvalChain.js');
const { cancelRequest } = await import('../services/attendance/requests.js');
const { cancelLeaveRequest } = await import('../routes/leave.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string; email?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `cc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner Asha' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Choices Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '', userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  c.accountId = (await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } }))!.accountId;
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${c.token}`).expect(200)).body.user.id;
  return c;
}
async function withRole(boss: Ctx, label: string, name: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  if (!role) throw new Error(`No ${label} role`);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token, userId: user.body.user.id, email };
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token, userId: user.body.user.id, email };
}
const call = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => call(c, m, `/people${p}`, b);
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => call(c, m, `/attendance${p}`, b);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
const choice = (body: any, key: string) => body.choices.find((x: any) => x.key === key);
const setChoice = (c: Ctx, key: string, value: unknown) => ppl(c, 'put', `/company-choices/${key}`, { value });
const bell = (c: Ctx, where: Record<string, unknown>) => runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, ...where }, orderBy: { createdAt: 'asc' } }));
const drain = () => deliverOutbox(new Date(), 5000);
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/* A Monday at least a month away: a working day for a work-from-home request. */
const futureMonday = (() => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 2);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const REQUESTS_APPROVER = ['ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::APPROVE', 'PEOPLE::Employees::VIEW'];

describe('the choices: defaults, who may change them, audit', () => {
  let c: Ctx;
  let other: Ctx;
  let hr: Ctx;
  let lead: Ctx;
  let viewer: Ctx;
  beforeAll(async () => {
    c = await company();
    other = await company();
    hr = await withRole(c, 'HR Manager', 'Hema HR');
    lead = await withRole(c, 'Team Manager', 'Lata Lead');
    viewer = await withRole(c, 'Viewer', 'Vik Viewer');
  }, 120_000);

  it('a new company starts on the defaults, and the owner may change all of them', async () => {
    const body = (await ppl(c, 'get', '/company-choices').expect(200)).body;
    expect(Object.fromEntries(body.choices.map((x: any) => [x.key, x.value]))).toEqual({
      'attendance.correctionApproval': 'HR_OR_MANAGER',
      'people.hrSeesSalaryRevisions': false,
      'people.leavingsForReadOnly': true,
      'people.leavingReasonForReadOnly': false,
      'notifications.withdrawn': 'SHOW_WITHDRAWN',
    });
    expect(body.choices.every((x: any) => x.canChange && x.changed === null)).toBe(true);
  });

  it('HR changes the approval choices and is named in the audit line with before and after; the pay and privacy ones are the owner’s', async () => {
    const out = (await setChoice(hr, 'attendance.correctionApproval', 'MANAGER_THEN_HR').expect(200)).body;
    expect(choice(out, 'attendance.correctionApproval')).toMatchObject({ value: 'MANAGER_THEN_HR', changed: { by: 'Hema HR' } });
    const log = await runInTenant(c.orgId, () => platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'COMPANY_SETTING', entityId: 'attendance.correctionApproval' }, orderBy: { createdAt: 'desc' } }));
    expect(log).toMatchObject({ action: 'CHANGED', createdByUserId: hr.userId });
    expect(JSON.parse(log!.metadata!)).toEqual({ before: 'HR_OR_MANAGER', after: 'MANAGER_THEN_HR' });
    /* The Attendance app's own column follows in its old words. */
    expect((await att(c, 'get', '/rules').expect(200)).body.rules.correctionApproval).toBe('MANAGER_THEN_HR');
    /* Saving the same value again writes no audit line. */
    await setChoice(hr, 'attendance.correctionApproval', 'MANAGER_THEN_HR').expect(200);
    expect(await runInTenant(c.orgId, () => platformPrisma.auditLog.count({ where: { orgId: c.orgId, entity: 'COMPANY_SETTING', entityId: 'attendance.correctionApproval' } }))).toBe(1);
    await setChoice(hr, 'notifications.withdrawn', 'REMOVE').expect(200);
    const refused = await setChoice(hr, 'people.hrSeesSalaryRevisions', true).expect(403);
    expect(refused.body.error).toMatch(/owner or an admin/);
    expect(choice((await ppl(hr, 'get', '/company-choices').expect(200)).body, 'people.hrSeesSalaryRevisions')).toMatchObject({ canChange: false, why: expect.stringMatching(/owner/) });
    await setChoice(hr, 'people.leavingReasonForReadOnly', true).expect(403);
    await setChoice(c, 'notifications.withdrawn', 'SHOW_WITHDRAWN').expect(200);
    await setChoice(c, 'attendance.correctionApproval', 'HR_OR_MANAGER').expect(200);
  });

  it('a team manager, a viewer and another company may not; a wrong value or key is refused', async () => {
    expect((await setChoice(lead, 'attendance.correctionApproval', 'HR').expect(403)).body.error).toMatch(/Approvals, Edit|whole company/);
    expect((await setChoice(viewer, 'notifications.withdrawn', 'REMOVE').expect(403)).body.code).toBe('NOT_YOURS_TO_CHANGE');
    expect((await ppl(viewer, 'get', '/company-choices').expect(200)).body.choices.every((x: any) => !x.canChange)).toBe(true);
    expect((await request(app).put(`/api/orgs/${c.orgId}/people/company-choices/notifications.withdrawn`).set(at(other)).set('x-org-id', c.orgId).send({ value: 'REMOVE' })).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).put(`/api/orgs/${c.orgId}/people/company-choices/notifications.withdrawn`).set(at(other)).send({ value: 'REMOVE' })).status).toBe(403);
    expect((await setChoice(c, 'attendance.correctionApproval', 'ANYONE').expect(400)).body.error).toMatch(/Pick one/);
    expect((await setChoice(c, 'people.hrSeesSalaryRevisions', 'yes').expect(400)).body.error).toMatch(/Pick one/);
    await setChoice(c, 'nope', true).expect(404);
    const after = (await ppl(c, 'get', '/company-choices').expect(200)).body;
    expect(choice(after, 'notifications.withdrawn').value).toBe('SHOW_WITHDRAWN');
    expect(choice((await ppl(other, 'get', '/company-choices').expect(200)).body, 'notifications.withdrawn').changed).toBeNull();
  });
});

describe('who decides attendance requests', () => {
  it('a company that chose in the Attendance app keeps its rule; the old HR reads as HR or the manager', async () => {
    const c = await company();
    await runInTenant(c.orgId, () => peoplePrisma.attendanceSettings.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId, orgId: c.orgId, correctionApproval: 'MANAGER', updatedByUserId: c.userId }, update: { correctionApproval: 'MANAGER' } }));
    expect(choice((await ppl(c, 'get', '/company-choices').expect(200)).body, 'attendance.correctionApproval').value).toBe('MANAGER');
    expect(await runInTenant(c.orgId, () => chainFor(c.orgId, 'correction'))).toBe('MANAGER');
    await setChoice(c, 'attendance.correctionApproval', 'HR').expect(200);
    expect(await runInTenant(c.orgId, () => chainFor(c.orgId, 'correction'))).toBe('HR_ONLY');
    /* A later change in the Attendance app wins: People's choice steps aside. */
    const rules = (await att(c, 'get', '/rules').expect(200)).body.rules;
    await att(c, 'put', '/rules', { defaultShiftId: rules.defaultShiftId, lateAllowancePerMonth: 0, latePenaltyEvery: 0, leaveApproval: 'HR', correctionApproval: 'MANAGER_THEN_HR' }).expect(200);
    expect(choice((await ppl(c, 'get', '/company-choices').expect(200)).body, 'attendance.correctionApproval').value).toBe('MANAGER_THEN_HR');
  }, 60_000);

  it('by default the manager in scope may decide; under "HR only" the manager is refused and HR decides', async () => {
    const c = await company();
    const lead = await colleague(c, 'Lead Lal', REQUESTS_APPROVER, true);
    const leadEmp = await person(c, { name: 'Lead Lal', code: 'C1' });
    await link(c, leadEmp.id, lead.userId);
    const report = await person(c, { name: 'Rita Report', code: 'C2', reportingManagerId: leadEmp.id });
    const ask = async (date: string) => (await att(c, 'post', '/requests', { employeeId: report.id, kind: 'MISSED_PUNCH', date, checkIn: '09:00', checkOut: '18:00', reason: 'Reader down' }).expect(201)).body.request;
    const past = plus(istToday(), -3);
    const past2 = plus(istToday(), -4);
    const first = await ask(past);
    await att(lead, 'post', `/requests/${first.id}/approve`).expect(200);

    await setChoice(c, 'attendance.correctionApproval', 'HR').expect(200);
    const second = await ask(past2);
    const story = (await att(lead, 'get', `/requests/${second.id}`).expect(200)).body;
    expect(story.decidedBy).toBe('HR');
    const refused = await att(lead, 'post', `/requests/${second.id}/approve`).expect(403);
    expect(refused.body.code).toBe('HR_ONLY');
    expect(refused.body.error).toMatch(/HR decides/);
    await att(c, 'post', `/requests/${second.id}/approve`).expect(200);
  }, 60_000);
});

describe('HR reading salary revisions', () => {
  it('closed by default; the owner opens it, HR reads old and new pay, read only, audited once a day', async () => {
    const c = await company();
    const hr = await withRole(c, 'HR Manager', 'Hari HR');
    const viewer = await withRole(c, 'Viewer', 'Vani Viewer');
    const e = await person(c, { name: 'Pay Person', code: 'P1' });
    await runInTenant(c.orgId, () => payrollPrisma.salaryRevision.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: e.id, currentAnnualCtc: 600000, proposedStructureId: 'structure-x', proposedAnnualCtc: 660000, incrementPercent: 10, effectiveFrom: '2026-12-01', status: 'DRAFT', createdByUserId: c.userId } as any }));

    expect((await ppl(hr, 'get', '/salary-revisions').expect(403)).body.code).toBe('NOT_OPEN');
    expect((await ppl(hr, 'get', '/my-access').expect(200)).body.salaryRevisions).toBe(false);
    await setChoice(c, 'people.hrSeesSalaryRevisions', true).expect(200);
    expect((await ppl(hr, 'get', '/my-access').expect(200)).body.salaryRevisions).toBe(true);
    const list = (await ppl(hr, 'get', '/salary-revisions').expect(200)).body;
    expect(list.readOnly).toBe(true);
    expect(list.revisions).toEqual([expect.objectContaining({ employeeName: 'Pay Person', currentAnnualCtc: 600000, proposedAnnualCtc: 660000, status: 'DRAFT' })]);
    await ppl(hr, 'get', '/salary-revisions').expect(200);
    expect(await runInTenant(c.orgId, () => platformPrisma.auditLog.count({ where: { orgId: c.orgId, action: 'SALARY_REVISION_VIEWED', createdByUserId: hr.userId } }))).toBe(1);
    /* Nothing else in Payroll opens, and a read-only role is not HR. */
    expect((await call(hr, 'get', '/payroll/revisions')).status).toBeGreaterThanOrEqual(400);
    expect((await call(hr, 'post', '/payroll/revisions', { employeeId: e.id })).status).toBeGreaterThanOrEqual(400);
    await ppl(viewer, 'get', '/salary-revisions').expect(403);
    await setChoice(c, 'people.hrSeesSalaryRevisions', false).expect(200);
    await ppl(hr, 'get', '/salary-revisions').expect(403);
  }, 60_000);
});

describe('leavings and the reason for leaving', () => {
  let c: Ctx;
  let hr: Ctx;
  let viewer: Ctx;
  let itAdmin: Ctx;
  let lead: Ctx;
  let leaver: any;
  beforeAll(async () => {
    c = await company();
    hr = await withRole(c, 'HR Manager', 'Hina HR');
    viewer = await withRole(c, 'Viewer', 'Varun Viewer');
    itAdmin = await withRole(c, 'IT Administrator', 'Ishan IT');
    lead = await withRole(c, 'Team Manager', 'Leela Lead');
    const leadEmp = await person(c, { name: 'Leela Lead', code: 'L0' });
    await link(c, leadEmp.id, lead.userId);
    leaver = await person(c, { name: 'Lalit Leaver', code: 'L1', reportingManagerId: leadEmp.id });
    await ppl(c, 'post', `/employees/${leaver.id}/resign`, { lastDay: plus(istToday(), 20), leavingType: 'RESIGNED', reason: 'Family health' }).expect(200);
  }, 120_000);

  const rowOf = async (who: Ctx) => (await ppl(who, 'get', '/lifecycle/leavers?view=notice').expect(200)).body.rows.find((r: any) => r.id === leaver.id);

  it('by default Viewer and IT administrator see who is leaving and the last day, not the reason; HR does', async () => {
    for (const who of [viewer, itAdmin]) {
      const row = await rowOf(who);
      expect(row).toMatchObject({ name: 'Lalit Leaver', dateOfLeaving: plus(istToday(), 20) });
      expect(row.leavingReason).toBeUndefined();
    }
    expect((await rowOf(lead)).leavingReason).toBeUndefined();
    expect(await rowOf(hr)).toMatchObject({ leavingReason: 'Family health' });
    const rec = (await ppl(viewer, 'get', `/employees/${leaver.id}`).expect(200)).body.employee;
    expect(rec).toMatchObject({ leavingReason: null, leavingReasonHidden: true, dateOfLeaving: plus(istToday(), 20) });
    expect((await ppl(hr, 'get', `/employees/${leaver.id}`).expect(200)).body.employee.leavingReason).toBe('Family health');
    const listed = (await ppl(viewer, 'get', '/employees?limit=50').expect(200)).body.employees.find((r: any) => r.id === leaver.id);
    expect(listed.leavingReason).toBeNull();
    const history = (await ppl(viewer, 'get', `/employees/${leaver.id}/history`).expect(200)).body.events;
    expect(history.filter((x: any) => x.kind === 'LEFT').every((x: any) => x.note === null)).toBe(true);
    const journey = JSON.stringify((await ppl(viewer, 'get', `/employees/${leaver.id}/journey`).expect(200)).body);
    expect(journey).not.toMatch(/Family health/);
  });

  it('the owner can show them the reason, or keep the Leaving list from them; a team manager keeps their team', async () => {
    await setChoice(c, 'people.leavingReasonForReadOnly', true).expect(200);
    expect(await rowOf(itAdmin)).toMatchObject({ leavingReason: 'Family health' });
    expect((await ppl(viewer, 'get', `/employees/${leaver.id}`).expect(200)).body.employee.leavingReason).toBe('Family health');
    await setChoice(c, 'people.leavingReasonForReadOnly', false).expect(200);

    await setChoice(c, 'people.leavingsForReadOnly', false).expect(200);
    const hidden = (await ppl(viewer, 'get', '/lifecycle/leavers?view=all').expect(200)).body;
    expect(hidden).toMatchObject({ rows: [], hidden: true });
    expect(await rowOf(itAdmin)).toBeUndefined();
    expect((await ppl(itAdmin, 'get', '/lifecycle/overview').expect(200)).body.counts.lastDaysThisWeek ?? 0).toBe(0);
    expect(await rowOf(lead)).toBeTruthy();
    expect(await rowOf(hr)).toBeTruthy();
    await setChoice(c, 'people.leavingsForReadOnly', true).expect(200);
    expect(await rowOf(viewer)).toBeTruthy();
  });
});

describe('a withdrawn request in the bell', () => {
  let c: Ctx;
  let asker: Ctx;
  let emp: any;
  beforeAll(async () => {
    c = await company();
    asker = await colleague(c, 'Anu Asker', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::CREATE', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::CREATE']);
    emp = await person(c, { name: 'Anu Asker', code: 'W1' });
    await link(c, emp.id, asker.userId);
    await ppl(c, 'post', '/approval-rules', { requestType: 'JOB_CHANGE', name: 'Job changes', steps: [{ approver: { kind: 'USER', id: c.userId }, dueDays: 2 }] }).expect(201);
  }, 120_000);

  /* One open job change per person: each request is about someone new. */
  const askJobChange = async (title: string) => {
    const subject = await person(c, { name: `Subject ${rnd()}` });
    return (await ppl(asker, 'post', '/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: subject.id, title, payload: { employeeId: subject.id, fields: { designation: { before: null, after: 'Lead' } }, reason: 'Growth' } }).expect(201)).body.request;
  };

  it('by default the approver’s notice says "Withdrawn", is read, and opens the closed request', async () => {
    const r = await askJobChange('Designation for Anu');
    const before = await bell(c, { userId: c.userId, subjectKey: `approval:${r.id}` });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ title: 'Waiting for you: Designation for Anu', readAt: null });
    await ppl(asker, 'post', `/requests/${r.id}/withdraw`, {}).expect(200);
    const after = await bell(c, { userId: c.userId, subjectKey: `approval:${r.id}` });
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe('Withdrawn: Designation for Anu');
    expect(after[0].body).toBeNull();
    expect(after[0].readAt).not.toBeNull();
    expect(JSON.parse(after[0].linkJson!)).toEqual({ app: 'people', screen: 'approvals', params: { open: 'APPROVAL', id: r.id } });
    /* The approver can still open it. */
    expect((await ppl(c, 'get', `/requests/${r.id}`).expect(200)).body.request.status).toBe('WITHDRAWN');
  });

  it('under "is removed" the notice goes; other notices stay', async () => {
    await setChoice(c, 'notifications.withdrawn', 'REMOVE').expect(200);
    const keep = await askJobChange('Keep this one');
    const r = await askJobChange('Remove this one');
    await ppl(asker, 'post', `/requests/${r.id}/withdraw`, {}).expect(200);
    expect(await bell(c, { userId: c.userId, subjectKey: `approval:${r.id}` })).toHaveLength(0);
    expect(await bell(c, { userId: c.userId, subjectKey: `approval:${keep.id}` })).toHaveLength(1);
    await setChoice(c, 'notifications.withdrawn', 'SHOW_WITHDRAWN').expect(200);
  });

  it('an attendance request and a leave request withdrawn while waiting do the same', async () => {
    await setChoice(c, 'notifications.withdrawn', 'SHOW_WITHDRAWN').expect(200);
    const wfh = await runInTenant(c.orgId, () => peoplePrisma.attendanceRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: emp.id, kind: 'WFH', date: futureMonday, reason: 'Home', status: 'PENDING', requestedByUserId: asker.userId, history: [{ by: asker.userId, what: 'ASKED', at: new Date().toISOString() }] } as any }));
    const { tellAboutRequest } = await import('../services/attendance/requests.js');
    await runInTenant(c.orgId, () => tellAboutRequest(c.orgId, wfh));
    expect((await bell(c, { userId: c.userId, subjectKey: `attendance:${wfh.id}` }))[0].title).toMatch(/asks for work from home/i);
    await runInTenant(c.orgId, () => cancelRequest(c.accountId, c.orgId, wfh, { userId: asker.userId, employeeId: emp.id, hr: false }));
    await drain();
    const a = await bell(c, { userId: c.userId, subjectKey: `attendance:${wfh.id}` });
    expect(a).toHaveLength(1);
    expect(a[0].title).toMatch(/^Withdrawn: Anu Asker/);
    expect(a[0].readAt).not.toBeNull();
    expect(JSON.parse(a[0].linkJson!).params).toEqual({ id: wfh.id });

    const type = (await att(c, 'post', '/leave/types', { name: `Casual ${rnd()}`, annualDays: 12 }).expect(201)).body.type;
    const leave = (await att(asker, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: type.id, fromDate: futureMonday, toDate: futureMonday, reason: 'Wedding' })).body.request;
    expect(leave?.id).toBeTruthy();
    await drain();
    await runInTenant(c.orgId, () => cancelLeaveRequest(c.accountId, c.orgId, leave.id, asker.userId));
    await drain();
    const l = await bell(c, { subjectKey: `leave:${leave.id}` });
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((n) => n.title.startsWith('Withdrawn: ') && n.readAt)).toBe(true);
  }, 60_000);
});
