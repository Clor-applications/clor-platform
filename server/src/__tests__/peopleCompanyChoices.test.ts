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

const app = buildApp().listen(0, '127.0.0.1');
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
      'leave.onEngine': false,
      'attendance.onEngine': false,
      'payroll.onEngine': false,
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

/*
 * Review of #87, blockers 1 and 2, should-fix 3: a leaver who has LEFT (not on notice) carries the reason on every
 * surface that tells their story: the stint's end, the history notes, the journey and its Why, the Activity tab's
 * change line and the reason it came with, the record, the list, the Leaving list. None of them may show it to a
 * Viewer, an IT administrator or a team manager, unless the company or the leaving says so.
 */
describe('a leaver who has left: the reason on every surface', () => {
  const REASON = 'Family health';
  const lastDay = plus(istToday(), -5);
  let c: Ctx;
  let hr: Ctx;
  let viewer: Ctx;
  let itAdmin: Ctx;
  let lead: Ctx;
  let leaver: any;
  /* An approved LEAVING request records the leaving with its request id and reason: the change log's leavingReason line. */
  const leaveByRequest = async (e: any, reason: string) => {
    const { leaveEmployee } = await import('../services/people/lifecycle/leaving.js');
    const existing = await runInTenant(c.orgId, () => peoplePrisma.employee.findFirstOrThrow({ where: { id: e.id } }));
    const requestId = `req_${rnd()}`;
    await runInTenant(c.orgId, () => leaveEmployee({ accountId: c.accountId, orgId: c.orgId, userId: c.userId, source: 'APPROVAL', correlationId: requestId, requestId, reason }, existing as any, { lastDay, leavingType: 'RESIGNED', reason }));
  };
  beforeAll(async () => {
    c = await company();
    hr = await withRole(c, 'HR Manager', 'Hamsa HR');
    viewer = await withRole(c, 'Viewer', 'Vinay Viewer');
    itAdmin = await withRole(c, 'IT Administrator', 'Indu IT');
    lead = await withRole(c, 'Team Manager', 'Latha Lead');
    const leadEmp = await person(c, { name: 'Latha Lead', code: 'G0' });
    await link(c, leadEmp.id, lead.userId);
    leaver = await person(c, { name: 'Gopal Gone', code: 'G1', reportingManagerId: leadEmp.id });
    await leaveByRequest(leaver, REASON);
  }, 120_000);

  /* Everything a reader can open about the leaver. */
  const everything = async (who: Ctx) => {
    const id = leaver.id;
    const journey = (await ppl(who, 'get', `/employees/${id}/journey`).expect(200)).body;
    const whys = await Promise.all(journey.entries.map(async (e: any) => (await ppl(who, 'get', `/employees/${id}/why/${e.key}`)).body));
    return {
      record: (await ppl(who, 'get', `/employees/${id}`).expect(200)).body,
      list: (await ppl(who, 'get', '/employees?status=ALL&limit=50').expect(200)).body.employees.find((r: any) => r.id === id),
      history: (await ppl(who, 'get', `/employees/${id}/history`).expect(200)).body,
      journey,
      whys,
      activity: (await ppl(who, 'get', `/employees/${id}/activity`).expect(200)).body,
      leavers: (await ppl(who, 'get', '/lifecycle/leavers?view=all').expect(200)).body.rows.find((r: any) => r.id === id) || null,
    };
  };

  it('the leaving really left the reason on each surface, and HR reads all of it', async () => {
    const all = await everything(hr);
    expect(all.record.employee).toMatchObject({ status: 'LEFT', leavingReason: REASON });
    expect(all.history.episodes[0]).toMatchObject({ endType: 'RESIGNED', endReason: REASON });
    expect(JSON.stringify(all.history.events)).toContain(REASON);
    expect(all.journey.episodes[0].endReason).toBe(REASON);
    const line = all.activity.events.flatMap((e: any) => e.changes || []).find((x: any) => x.field === 'leavingReason');
    expect(line).toMatchObject({ after: REASON, redacted: false });
    expect(all.activity.events.some((e: any) => e.reason === REASON)).toBe(true);
  });

  it('Viewer, IT administrator and the team manager read none of it by default (blockers 1 and 2)', async () => {
    for (const who of [viewer, itAdmin, lead]) {
      const all = await everything(who);
      expect(all.record.employee.status).toBe('LEFT');
      for (const [where, body] of Object.entries(all)) expect(JSON.stringify(body), `${where} for ${who.email}`).not.toContain(REASON);
      expect(all.history.episodes[0]).toMatchObject({ endType: 'RESIGNED', endReason: null });
      const line = all.activity.events.flatMap((e: any) => e.changes || []).find((x: any) => x.field === 'leavingReason');
      expect(line).toMatchObject({ before: null, after: null, redacted: true });
    }
  });

  it('the company switch opens it to Viewer and IT administrator, never to a team manager (should-fix 3)', async () => {
    await setChoice(c, 'people.leavingReasonForReadOnly', true).expect(200);
    for (const who of [viewer, itAdmin]) {
      const all = await everything(who);
      expect(all.history.episodes[0].endReason).toBe(REASON);
      expect(all.record.employee.leavingReason).toBe(REASON);
    }
    expect(JSON.stringify(await everything(lead))).not.toContain(REASON);
    await setChoice(c, 'people.leavingReasonForReadOnly', false).expect(200);
  });

  it('a team manager reads it only when the leaving’s exit interview is not kept from managers', async () => {
    const iv = await runInTenant(c.orgId, () => peoplePrisma.exitInterview.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: leaver.id, leavingDate: lastDay, status: 'SUBMITTED', submittedAt: new Date(), hideFromManager: true, enteredBy: 'EMPLOYEE' } }));
    expect(JSON.stringify(await everything(lead))).not.toContain(REASON);
    await runInTenant(c.orgId, () => peoplePrisma.exitInterview.update({ where: { id: iv.id }, data: { hideFromManager: false } }));
    const all = await everything(lead);
    expect(all.record.employee.leavingReason).toBe(REASON);
    expect(all.history.episodes[0].endReason).toBe(REASON);
    expect(all.leavers).toMatchObject({ leavingReason: REASON });
    /* Viewer and IT are not the managers: the leaving's switch does not open it to them. */
    for (const who of [viewer, itAdmin]) expect(JSON.stringify(await everything(who))).not.toContain(REASON);
    await runInTenant(c.orgId, () => peoplePrisma.exitInterview.delete({ where: { id: iv.id } }));
  });

  it('a reason typed for two leavings is never offered as a suggestion', async () => {
    const second = await person(c, { name: 'Gita Gone', code: 'G2' });
    await leaveByRequest(second, REASON);
    const values = (await ppl(hr, 'get', '/suggestions?field=reason').expect(200)).body.values || [];
    expect(JSON.stringify(values)).not.toContain(REASON);
  });
});

/* Should-fix 6: "leavings: no" keeps who is leaving off the employee list, the record, the counts and the export too. */
describe('leavings kept from Viewer and IT administrator on the list and record', () => {
  let c: Ctx;
  let hr: Ctx;
  let viewer: Ctx;
  let lead: Ctx;
  let going: any;
  let staying: any;
  beforeAll(async () => {
    c = await company();
    hr = await withRole(c, 'HR Manager', 'Hasan HR');
    viewer = await withRole(c, 'Viewer', 'Vimal Viewer');
    lead = await withRole(c, 'Team Manager', 'Lohit Lead');
    const leadEmp = await person(c, { name: 'Lohit Lead', code: 'N0' });
    await link(c, leadEmp.id, lead.userId);
    going = await person(c, { name: 'Neha Notice', code: 'N1', reportingManagerId: leadEmp.id });
    staying = await person(c, { name: 'Sunil Stays', code: 'N2' });
    await ppl(c, 'post', `/employees/${going.id}/resign`, { lastDay: plus(istToday(), 20), leavingType: 'RESIGNED', reason: 'Moving' }).expect(200);
    await setChoice(c, 'people.leavingsForReadOnly', false).expect(200);
  }, 120_000);

  it('the viewer sees someone on notice as active, with no last day, filter or count to give it away', async () => {
    const list = (await ppl(viewer, 'get', '/employees?limit=50').expect(200)).body.employees;
    expect(list.find((r: any) => r.id === going.id)).toMatchObject({ status: 'ACTIVE', dateOfLeaving: null, leavingType: null, leavingReason: null, leavingsHidden: true });
    const ids = async (q: string) => (await ppl(viewer, 'get', `/employees?limit=50${q}`).expect(200)).body.employees.map((r: any) => r.id).sort();
    /* On notice and active are one group to them; the left-between filter is ignored. */
    expect(await ids('&status=ON_NOTICE')).toEqual(await ids('&status=ACTIVE'));
    expect(await ids('&status=ON_NOTICE')).toEqual(expect.arrayContaining([going.id, staying.id]));
    expect(await ids(`&status=ALL&leftFrom=${istToday()}&leftTo=${plus(istToday(), 60)}`)).toEqual(await ids('&status=ALL'));
    const rec = (await ppl(viewer, 'get', `/employees/${going.id}`).expect(200)).body.employee;
    expect(rec).toMatchObject({ status: 'ACTIVE', dateOfLeaving: null, resignedOn: null, leavingsHidden: true });
    expect(rec.leavingReasonHidden).toBeUndefined();
    const counts = (await ppl(viewer, 'get', '/employees/counts').expect(200)).body;
    expect(counts).toMatchObject({ onNotice: null, leftThisMonth: null, leavingsHidden: true });
    expect(counts.active).toBeGreaterThanOrEqual(3);
    const overview = (await ppl(viewer, 'get', '/overview').expect(200)).body;
    expect(overview).toMatchObject({ leftThisMonth: null, leavingsHidden: true });
    expect(overview.byStatus.ON_NOTICE).toBe(0);
    /* Nor through the leaving plan's tasks or Home's final-pay banner. */
    const tasks = (await ppl(viewer, 'get', '/lifecycle/tasks?view=open').expect(200)).body.rows;
    const leavingTask = (t: any) => t.employee.id === going.id && t.kind === 'LEAVING';
    expect(tasks.some(leavingTask)).toBe(false);
    expect((await ppl(hr, 'get', '/lifecycle/tasks?view=open').expect(200)).body.rows.some(leavingTask)).toBe(true);
    expect((await ppl(viewer, 'get', '/final-pay').expect(200)).body.rows).toEqual([]);
  });

  it('an export by someone the leavings are kept from says active too', async () => {
    const exporter = await colleague(c, 'Esha Export', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EXPORT']);
    const csv = await request(app).get(`/api/orgs/${c.orgId}/people/employees/export?columns=name,status`).set(at(exporter)).expect(200);
    expect(csv.text).toMatch(/Neha Notice,Active/);
    expect(csv.text).not.toMatch(/On notice/);
    const hrCsv = await request(app).get(`/api/orgs/${c.orgId}/people/employees/export?columns=name,status`).set(at(hr)).expect(200);
    expect(hrCsv.text).toMatch(/Neha Notice,On notice/);
  });

  it('HR, the owner and the team manager still see the notice; the owner turns it back on', async () => {
    for (const who of [hr, c, lead]) {
      const rec = (await ppl(who, 'get', `/employees/${going.id}`).expect(200)).body.employee;
      expect(rec).toMatchObject({ status: 'ON_NOTICE', dateOfLeaving: plus(istToday(), 20) });
      expect(rec.leavingsHidden).toBeUndefined();
    }
    expect((await ppl(hr, 'get', '/employees/counts').expect(200)).body.onNotice).toBe(1);
    await setChoice(c, 'people.leavingsForReadOnly', true).expect(200);
    expect((await ppl(viewer, 'get', `/employees/${going.id}`).expect(200)).body.employee).toMatchObject({ status: 'ON_NOTICE', dateOfLeaving: plus(istToday(), 20) });
  });
});

/* Review item 4: under "HR only" the manager's queues in the employee app and in People hold nothing to decide, and only whole-company approvers hear of it. */
describe('"HR only" across the manager’s queues and the notices', () => {
  it('the employee-app queue, the People inbox and the notices leave the team manager out', async () => {
    const c = await company();
    const companyCode = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
    const lead = await colleague(c, 'Lead Lakshmi', REQUESTS_APPROVER, true);
    /* A whole-company approver who did not raise the requests (the owner raises them and is never told of their own). */
    const boss = await colleague(c, 'Bina Boss', REQUESTS_APPROVER);
    const leadEmp = await person(c, { name: 'Lead Lakshmi', code: 'H0' });
    await link(c, leadEmp.id, lead.userId);
    const report = await person(c, { name: 'Ravi Report', code: 'H1', reportingManagerId: leadEmp.id });
    const act = (await att(c, 'post', '/portal-access/codes', { employeeIds: [leadEmp.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'H0', activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
    const portal = { Authorization: `Bearer ${token}` };
    const ask = async (date: string) => (await att(c, 'post', '/requests', { employeeId: report.id, kind: 'MISSED_PUNCH', date, checkIn: '09:00', checkOut: '18:00', reason: 'Reader down' }).expect(201)).body.request;
    const queue = async () => (await request(app).get('/api/portal/approvals').set(portal).expect(200)).body;
    const inbox = async (who: Ctx) => (await ppl(who, 'get', '/inbox').expect(200)).body.items.filter((i: any) => i.kind === 'ATTENDANCE').map((i: any) => i.id);

    /* By default the manager decides: in their app queue and their People inbox. */
    const first = await ask(plus(istToday(), -3));
    await drain();
    expect((await queue()).corrections.map((r: any) => r.id)).toContain(first.id);
    expect(await inbox(lead)).toContain(first.id);
    expect(await bell(c, { userId: lead.userId, subjectKey: `attendance:${first.id}` })).toHaveLength(1);
    await att(c, 'post', `/requests/${first.id}/approve`).expect(200);

    await setChoice(c, 'attendance.correctionApproval', 'HR').expect(200);
    const second = await ask(plus(istToday(), -4));
    await drain();
    const q = await queue();
    expect(q.chain.correction).toBe('HR');
    expect(q.corrections.map((r: any) => r.id)).not.toContain(second.id);
    expect(await inbox(lead)).not.toContain(second.id);
    expect(await inbox(c)).toContain(second.id);
    /* The notice goes to whole-company approvers only. */
    expect(await bell(c, { userId: lead.userId, subjectKey: `attendance:${second.id}` })).toHaveLength(0);
    expect(await bell(c, { userId: boss.userId, subjectKey: `attendance:${second.id}` })).toHaveLength(1);
  }, 90_000);
});

/* Review item 5 and the leave.ts nit: "is removed" for attendance and leave withdrawals; HR cancelling a waiting request retires the notice too. */
describe('withdrawn and cancelled attendance and leave requests in the bell', () => {
  let c: Ctx;
  let asker: Ctx;
  let emp: any;
  let typeId = '';
  beforeAll(async () => {
    c = await company();
    asker = await colleague(c, 'Asha Asker', ['PEOPLE::Employees::VIEW', 'ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::CREATE', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::CREATE']);
    emp = await person(c, { name: 'Asha Asker', code: 'R1' });
    await link(c, emp.id, asker.userId);
    typeId = (await att(c, 'post', '/leave/types', { name: `Casual ${rnd()}`, annualDays: 12 }).expect(201)).body.type.id;
  }, 120_000);
  const wfh = async (date: string) => {
    const { tellAboutRequest } = await import('../services/attendance/requests.js');
    const r = await runInTenant(c.orgId, () => peoplePrisma.attendanceRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: emp.id, kind: 'WFH', date, reason: 'Home', status: 'PENDING', requestedByUserId: asker.userId, history: [{ by: asker.userId, what: 'ASKED', at: new Date().toISOString() }] } as any }));
    await runInTenant(c.orgId, () => tellAboutRequest(c.orgId, r));
    expect(await bell(c, { userId: c.userId, subjectKey: `attendance:${r.id}` })).toHaveLength(1);
    return r;
  };
  const leave = async (date: string) => {
    const l = (await att(asker, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: typeId, fromDate: date, toDate: date, reason: 'Errand' })).body.request;
    expect(l?.id).toBeTruthy();
    await drain();
    expect((await bell(c, { subjectKey: `leave:${l.id}` })).length).toBeGreaterThan(0);
    return l;
  };
  const monday = (weeks: number) => plus(futureMonday, weeks * 7);

  it('under "is removed" a withdrawn attendance request’s and leave request’s notices go', async () => {
    await setChoice(c, 'notifications.withdrawn', 'REMOVE').expect(200);
    const r = await wfh(monday(1));
    await runInTenant(c.orgId, () => cancelRequest(c.accountId, c.orgId, r, { userId: asker.userId, employeeId: emp.id, hr: false }));
    await drain();
    expect(await bell(c, { subjectKey: `attendance:${r.id}` })).toHaveLength(0);
    const l = await leave(monday(2));
    await runInTenant(c.orgId, () => cancelLeaveRequest(c.accountId, c.orgId, l.id, asker.userId));
    await drain();
    expect(await bell(c, { subjectKey: `leave:${l.id}` })).toHaveLength(0);
    await setChoice(c, 'notifications.withdrawn', 'SHOW_WITHDRAWN').expect(200);
  }, 60_000);

  it('HR cancelling a waiting leave or attendance request marks the approvers’ notice cancelled, and still tells the person', async () => {
    const l = await leave(monday(3));
    await att(c, 'post', `/leave/requests/${l.id}/cancel`, {}).expect(200);
    await drain();
    const notices = await bell(c, { subjectKey: `leave:${l.id}` });
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((n) => n.title.startsWith('Cancelled: ') && n.readAt)).toBe(true);
    expect(await bell(c, { userId: asker.userId, dedupeKey: `leave-decided:${l.id}:CANCELLED` })).toHaveLength(1);

    const r = await wfh(monday(4));
    await runInTenant(c.orgId, () => cancelRequest(c.accountId, c.orgId, r, { userId: c.userId, employeeId: null, hr: true } as any));
    await drain();
    const a = await bell(c, { subjectKey: `attendance:${r.id}` });
    expect(a).toHaveLength(1);
    expect(a[0].title).toMatch(/^Cancelled: /);
    expect(await bell(c, { userId: asker.userId, dedupeKey: `request-decided:${r.id}:CANCELLED` })).toHaveLength(1);
  }, 60_000);
});

/* The salary-revisions read line: two pages loading at once still write one line for the day (review nit). */
describe('the once-a-day read line under a race', () => {
  it('ten reads at once write one audit line', async () => {
    const c = await company();
    const hr = await withRole(c, 'HR Manager', 'Harsha HR');
    await setChoice(c, 'people.hrSeesSalaryRevisions', true).expect(200);
    await Promise.all(Array.from({ length: 10 }, () => ppl(hr, 'get', '/salary-revisions').expect(200)));
    expect(await runInTenant(c.orgId, () => platformPrisma.auditLog.count({ where: { orgId: c.orgId, action: 'SALARY_REVISION_VIEWED', createdByUserId: hr.userId } }))).toBe(1);
  }, 60_000);
});

/*
 * Re-review of #87 (probe on 5434): the reason typed for leaving also travelled through the audit trail, a
 * resignation request's payload and the workforce pending list, and the leaving plan ignored "leavings: no".
 */
describe('probe: the reason and the leaving on the remaining surfaces', () => {
  const SECRET = 'Caring for my father';
  let c: Ctx;
  let hr: Ctx;
  let viewer: Ctx;
  let itAdmin: Ctx;
  let auditor: Ctx;
  let lead: Ctx;
  let resigner: any;
  let stayer: any;
  let requestId = '';
  beforeAll(async () => {
    c = await company();
    hr = await withRole(c, 'HR Manager', 'Hridya HR');
    viewer = await withRole(c, 'Viewer', 'Vasu Viewer');
    itAdmin = await withRole(c, 'IT Administrator', 'Ira IT');
    auditor = await withRole(c, 'External Auditor', 'Aditi Auditor');
    lead = await withRole(c, 'Team Manager', 'Lalitha Lead');
    const leadEmp = await person(c, { name: 'Lalitha Lead', code: 'P0' });
    await link(c, leadEmp.id, lead.userId);
    resigner = await person(c, { name: 'Prakash Portal', code: 'P1', reportingManagerId: leadEmp.id });
    stayer = await person(c, { name: 'Sita Stays', code: 'P2', reportingManagerId: leadEmp.id });
    /* HR records a leaving, the person stays on, HR records it again and enters an exit interview. Each body carries the reason. */
    await ppl(hr, 'post', `/employees/${stayer.id}/resign`, { lastDay: plus(istToday(), 25), leavingType: 'RESIGNED', reason: SECRET }).expect(200);
    await ppl(hr, 'post', `/employees/${stayer.id}/stay`, { reason: `${SECRET}, sorted` }).expect(200);
    await ppl(hr, 'post', `/employees/${stayer.id}/resign`, { lastDay: plus(istToday(), 30), leavingType: 'RESIGNED', reason: SECRET }).expect(200);
    await ppl(hr, 'get', `/leaving/${stayer.id}`).expect(200);
    await ppl(hr, 'post', `/leaving/${stayer.id}/exit-interview`, { answers: { reason: 'PAY', comeBack: 'MAYBE', keptYou: SECRET } }).expect(200);
    /* The person resigns from the employee app: a LEAVING request with the reason, to the manager first. */
    const companyCode = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
    const act = (await att(c, 'post', '/portal-access/codes', { employeeIds: [resigner.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'P1', activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
    requestId = (await request(app).post('/api/portal/people/me/resign').set({ Authorization: `Bearer ${token}` }).send({ lastDay: plus(istToday(), 40), reason: SECRET }).expect(202)).body.request.id;
  }, 180_000);

  it('the audit trail never holds the reason, for Viewer and External Auditor or anyone', async () => {
    for (const who of [viewer, auditor]) {
      const res = await call(who, 'get', '/audit?limit=200');
      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
    const rows = await runInTenant(c.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId } }));
    expect(rows.some((r) => /resign/.test(r.metadata || ''))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    /* The exit interview's own line keeps no reason code either. */
    const iv = rows.find((r) => r.entity === 'ExitInterview' && r.action === 'SUBMITTED');
    expect(iv).toBeTruthy();
    expect(JSON.parse(iv!.metadata || '{}').reason).toBeUndefined();
  });

  it('a resignation request’s reason: HR reads it; Viewer, IT and the deciding manager do not', async () => {
    const read = async (who: Ctx) => ppl(who, 'get', `/requests/${requestId}`);
    expect((await read(hr)).body.request.payload.reason).toBe(SECRET);
    for (const who of [viewer, itAdmin]) {
      const res = await read(who);
      expect([200, 403, 404]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
    /* The manager decides the last day: the request is theirs, the reason is not (until HR allows it for that leaving). */
    const waiting = (await ppl(lead, 'get', '/requests').expect(200)).body.waitingForMe.find((r: any) => r.id === requestId);
    expect(waiting).toBeTruthy();
    expect(waiting.payload).toMatchObject({ reason: null, reasonHidden: true, lastDay: plus(istToday(), 40) });
    expect(JSON.stringify((await read(lead)).body)).not.toContain(SECRET);
  });

  it('"leavings: no" keeps resignations out of pending actions and the leaving plan shut for Viewer and IT', async () => {
    const pending = async (who: Ctx) => (await ppl(who, 'get', '/workforce/pending').expect(200)).body.requests.map((r: any) => r.id);
    expect(await pending(viewer)).toContain(requestId);
    await setChoice(c, 'people.leavingsForReadOnly', false).expect(200);
    for (const who of [viewer, itAdmin]) {
      expect(await pending(who)).not.toContain(requestId);
      await ppl(who, 'get', `/leaving/${stayer.id}`).expect(404);
      /* Nor the record's Activity ("resign", "stay") or its open leaving tasks. */
      const activity = JSON.stringify((await ppl(who, 'get', `/employees/${stayer.id}/activity`).expect(200)).body);
      expect(activity).not.toMatch(/resign|\/stay|exit interview|on notice/i);
      expect((await ppl(who, 'get', `/employees/${stayer.id}/checklist`).expect(200)).body.leaving.total).toBe(0);
    }
    expect((await ppl(hr, 'get', `/employees/${stayer.id}/checklist`).expect(200)).body.leaving.total).toBeGreaterThan(0);
    expect(JSON.stringify((await ppl(hr, 'get', `/employees/${stayer.id}/activity`).expect(200)).body)).toMatch(/resign/i);
    expect(await pending(hr)).toContain(requestId);
    expect(await pending(lead)).toContain(requestId);
    expect((await ppl(hr, 'get', `/leaving/${stayer.id}`).expect(200)).body.person).toMatchObject({ status: 'ON_NOTICE', dateOfLeaving: plus(istToday(), 30) });
    expect((await ppl(lead, 'get', `/leaving/${stayer.id}`).expect(200)).body.person.status).toBe('ON_NOTICE');
    await setChoice(c, 'people.leavingsForReadOnly', true).expect(200);
    expect((await ppl(viewer, 'get', `/leaving/${stayer.id}`).expect(200)).body.person.status).toBe('ON_NOTICE');
  });
});

/* What integrations read of a person: pinned, so the reason typed for leaving can never be added by accident. */
describe('the public API and webhook employee fields', () => {
  it('carry status and the last day, never the reason', async () => {
    const { EMPLOYEE_FIELDS, publicEmployee } = await import('../routes/publicApi.js');
    const { employeeEvent } = await import('../services/attendance/webhooks.js');
    expect(Object.keys(EMPLOYEE_FIELDS).sort()).toEqual(['code', 'dateOfJoining', 'dateOfLeaving', 'department', 'designation', 'devicePin', 'id', 'name', 'status', 'updatedAt', 'workEmail']);
    const row = { id: 'e1', code: 'E1', name: 'A', status: 'LEFT', department: null, designation: null, dateOfJoining: '2025-01-01', dateOfLeaving: '2026-10-01', devicePin: '7', workEmail: null, updatedAt: new Date(), leavingReason: 'Family health', leavingType: 'RESIGNED' };
    expect(Object.keys(employeeEvent(row)).sort()).toEqual(['code', 'dateOfJoining', 'dateOfLeaving', 'department', 'designation', 'id', 'name', 'readerId', 'status', 'updatedAt']);
    const pub = publicEmployee(Object.fromEntries(Object.keys(EMPLOYEE_FIELDS).map((k) => [k, (row as any)[k]])));
    expect(JSON.stringify(pub)).not.toContain('Family health');
    expect(pub).toMatchObject({ status: 'LEFT', dateOfLeaving: '2026-10-01' });
  });
});

/* Rows written before the log stopped storing the reason: the log is append-only, so they are masked on read. */
describe('older audit rows that hold a leaving reason', () => {
  it('Viewer and External Auditor read them masked; the owner and HR with the audit trail read them as written', async () => {
    const OLD = 'Old reason: burnout';
    const c = await company();
    const viewer = await withRole(c, 'Viewer', 'Varsha Viewer');
    const auditor = await withRole(c, 'External Auditor', 'Arun Auditor');
    const hrAudit = await colleague(c, 'Hari Records', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'SETTINGS::Audit trail::VIEW']);
    const e = await person(c, { name: 'Omkar Old', code: 'O1' });
    const raw = (entity: string, action: string, metadata: unknown, message: string) => ({ accountId: c.accountId, orgId: c.orgId, branchId: c.branchId, entity, entityId: e.id, action, message, metadata: JSON.stringify(metadata), createdByUserId: c.userId });
    await runInTenant(c.orgId, () => platformPrisma.auditLog.createMany({ data: [
      raw('PEOPLE_EMPLOYEE', 'RESIGN', { path: 'people/employees/:id/resign', ids: [e.id], body: { lastDay: '2026-11-30', leavingType: 'RESIGNED', reason: OLD } }, 'POST people/employees/:id/resign'),
      raw('PEOPLE_EMPLOYEE', 'STAY', { path: 'people/employees/:id/stay', ids: [e.id], body: { reason: OLD } }, 'POST people/employees/:id/stay'),
      raw('PEOPLE_EMPLOYEE', 'UPDATE', { path: 'people/employees/:id', ids: [e.id], body: { leavingReason: OLD, department: 'Sales' } }, 'PUT people/employees/:id'),
      raw('ExitInterview', 'SUBMITTED', { employeeId: e.id, reason: 'BURNOUT' }, `Exit interview entered for ${e.name}`),
      raw('PEOPLE_REQUEST', 'CREATE', { path: 'people/requests', ids: [], body: { requestType: 'LEAVING', subjectEmployeeId: e.id, payload: { employeeId: e.id, reason: OLD } } }, 'POST people/requests'),
    ] }));
    const trail = async (who: Ctx) => JSON.stringify((await call(who, 'get', '/audit?limit=50').expect(200)).body);
    for (const who of [viewer, auditor]) {
      const body = await trail(who);
      expect(body).not.toContain(OLD);
      expect(body).not.toContain('BURNOUT');
      expect(body).toContain('[hidden]');
      /* What else the rows say stays readable. */
      expect(body).toContain('Sales');
      expect(body).toContain('2026-11-30');
    }
    for (const who of [c, hrAudit]) {
      const body = await trail(who);
      expect(body).toContain(OLD);
      expect(body).toContain('BURNOUT');
    }
  }, 60_000);
});
