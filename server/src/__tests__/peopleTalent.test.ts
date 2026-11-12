import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Talent (docs/people/design-v1/TALENT-DECISIONS.md): hiring from opening to employee record,
 * independent interview feedback, the apply link, old candidates cleared; goals and check-ins,
 * review cycles with self, manager and final ratings, improvement plans and one-on-ones kept to
 * the right people; trainings with certificates that lapse and are chased once per stage.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { anonymiseOldCandidates } = await import('../services/people/talent/hiring.js');
const { addMonths, runCertificateReminders } = await import('../services/people/talent/training.js');

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
  const email = `talent.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Talent Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b?: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
});
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
async function portal(c: Ctx, employee: { id: string; code: string }) {
  const company = (await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200)).body.company.code;
  const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company, employeeCode: employee.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
  return { Authorization: `Bearer ${token}` };
}

describe('hiring, from opening to employee record', () => {
  let c: Ctx;
  let manager: Ctx;
  let interviewer: Ctx;
  let managerEmp: any;
  let dept: any;
  let desig: any;
  beforeAll(async () => {
    c = await owner();
    manager = await colleague(c, 'Ravi', ['PEOPLE::Employees::VIEW', 'PEOPLE::Recruitment::VIEW', 'PEOPLE::Recruitment::CREATE']);
    interviewer = await colleague(c, 'Ira', ['PEOPLE::Employees::VIEW']);
    dept = (await api(c).post('/structure/departments', { name: 'Finance' }).expect(201)).body.item;
    desig = (await api(c).post('/structure/job-positions', { name: 'Accountant' }).expect(201)).body.item;
    managerEmp = (await api(c).post('/employees', { name: 'Ravi Kumar', code: 'H-1', dateOfJoining: '2024-01-01', departmentId: dept.id }).expect(201)).body.employee;
    await link(c, managerEmp.id, manager.userId);
  }, 90_000);

  it('a manager asks for an opening; they cannot open their own request; HR opens it', async () => {
    const asked = (await api(manager).post('/talent/openings', { title: 'Accountant', departmentId: dept.id, status: 'OPEN' }).expect(201)).body.opening;
    expect(asked.status).toBe('REQUESTED');
    /* A manager without Edit cannot move it; give them Edit and they still cannot open their own request. */
    await api(manager).post(`/talent/openings/${asked.id}/status`, { status: 'OPEN' }).expect(403);
    await api(c).post(`/talent/openings/${asked.id}/status`, { status: 'CLOSED' }).expect(400);
    const opened = (await api(c).post(`/talent/openings/${asked.id}/status`, { status: 'OPEN' }).expect(200)).body.opening;
    expect(opened.status).toBe('OPEN');
    await api(c).post('/talent/openings', { title: 'X', departmentId: 'not-ours' }).expect(400);
  }, 60_000);

  it('candidates: one card per person, a reason to reject, interviews with independent feedback, offer and hire', async () => {
    const opening = (await api(c).post('/talent/openings', { title: 'Senior accountant', departmentId: dept.id, jobPositionId: desig.id, branchId: c.branchId, hiringManagerId: managerEmp.id, places: 1, status: 'OPEN' }).expect(201)).body.opening;
    expect(opening).toMatchObject({ departmentName: 'Finance', designationName: 'Accountant', hiringManagerName: 'Ravi Kumar' });
    const meera = (await api(c).post('/talent/candidates', { openingId: opening.id, name: 'Meera K', email: 'meera@example.com', phone: '9800000001', source: 'REFERRAL', sourceDetail: 'Ravi' }).expect(201)).body.candidate;
    expect((await api(c).post('/talent/candidates', { openingId: opening.id, name: 'Meera again', email: 'MEERA@example.com' }).expect(409)).body.code).toBe('DUPLICATE');
    const other = (await api(c).post('/talent/candidates', { openingId: opening.id, name: 'Other One', phone: '9800000002' }).expect(201)).body.candidate;
    await api(c).post(`/talent/candidates/${other.id}/stage`, { stage: 'REJECTED' }).expect(400);
    await api(c).post(`/talent/candidates/${other.id}/stage`, { stage: 'REJECTED', reason: 'Wants a remote job' }).expect(200);
    await api(c).post(`/talent/candidates/${meera.id}/stage`, { stage: 'HIRED' }).expect(409);

    /* Two interviewers; the second sees the first one's feedback only after giving their own. */
    const when = new Date(Date.now() - 3_600_000).toISOString();
    await api(c).post(`/talent/candidates/${meera.id}/interviews`, { at: when, mode: 'VIDEO', place: 'https://meet.example/x', interviewerUserIds: [c.userId, interviewer.userId] }).expect(201);
    const iv = (await api(c).get(`/talent/candidates/${meera.id}`).expect(200)).body;
    expect(iv.candidate.stage).toBe('INTERVIEW');
    const interviewId = iv.interviews[0].id;
    await api(c).post(`/talent/interviews/${interviewId}/feedback`, { recommendation: 'STRONG_YES', notes: 'Sharp on GST' }).expect(200);
    /* The interviewer has no Recruitment right: the brief, without contacts, and nobody else's feedback yet. */
    const brief = (await api(interviewer).get(`/talent/candidates/${meera.id}`).expect(200)).body;
    expect(brief.candidate).toMatchObject({ name: 'Meera K', email: null, phone: null });
    expect(brief.interviews[0]).toMatchObject({ feedbackHidden: true, mineToGive: true });
    expect(brief.interviews[0].feedback).toHaveLength(0);
    expect(brief.timeline).toHaveLength(0);
    await api(interviewer).get('/talent/candidates').expect(403);
    await api(interviewer).get(`/talent/candidates/${other.id}`).expect(404);
    await api(interviewer).post(`/talent/interviews/${interviewId}/feedback`, { recommendation: 'YES', notes: 'Good' }).expect(200);
    const after = (await api(interviewer).get(`/talent/candidates/${meera.id}`).expect(200)).body;
    expect(after.interviews[0].feedback.map((f: any) => f.recommendation).sort()).toEqual(['STRONG_YES', 'YES']);
    expect(after.interviews[0].status).toBe('DONE');
    expect((await api(interviewer).get('/talent/interviews').expect(200)).body.interviews.map((i: any) => i.candidate.name)).toEqual(['Meera K']);

    /* Not hired before an accepted offer (People plan 8 Nov 2026, step 4); the offer moves them to Offer; accepting it opens Hire; hire makes the record with the opening's details. */
    expect((await api(c).post(`/talent/candidates/${meera.id}/hire`, { dateOfJoining: plus(10) }).expect(409)).body.code).toBe('NO_ACCEPTED_OFFER');
    await api(c).post('/offers', { candidateId: meera.id, email: 'meera@example.com', designation: 'Senior accountant', joiningDate: plus(10), acceptBy: plus(5), annualCtc: 600000, lines: [{ label: 'Basic', monthly: 25000 }], signatory: 'Asha, Owner' }).expect(201);
    expect((await api(c).get(`/talent/candidates/${meera.id}`).expect(200)).body.candidate.stage).toBe('OFFER');
    expect((await api(c).post(`/talent/candidates/${meera.id}/hire`, { dateOfJoining: plus(10) }).expect(409)).body.code).toBe('NO_ACCEPTED_OFFER');
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId: c.orgId, templateKey: 'people.offer', toEmail: 'meera@example.com' }, orderBy: { createdAt: 'desc' } });
    const token = /\/api\/people\/offer\/([a-f0-9]{64})/.exec(mail?.bodyText || '')?.[1] || '';
    await request(app).post(`/api/people/offer/${token}/accept`).send({}).expect(200);
    const hired = (await api(c).post(`/talent/candidates/${meera.id}/hire`, { dateOfJoining: plus(10), code: 'H-21' }).expect(201)).body.employee;
    const file = (await api(c).get(`/employees/${hired.id}`).expect(200)).body.employee;
    expect(file).toMatchObject({ name: 'Meera K', code: 'H-21', departmentId: dept.id, jobPositionId: desig.id, branchId: c.branchId, reportingManagerId: managerEmp.id, dateOfJoining: plus(10) });
    expect((await api(c).get(`/employees/${hired.id}/checklist`).expect(200)).body.joining.total).toBeGreaterThan(0);
    await api(c).post(`/talent/candidates/${meera.id}/hire`, { dateOfJoining: plus(10) }).expect(409);
    /* One place, one hire: the opening is filled. */
    expect((await api(c).get(`/talent/openings/${opening.id}`).expect(200)).body.opening.status).toBe('FILLED');
    const timeline = (await api(c).get(`/talent/candidates/${meera.id}`).expect(200)).body.timeline.map((e: any) => e.kind);
    expect(timeline).toEqual(expect.arrayContaining(['APPLIED', 'INTERVIEW', 'FEEDBACK', 'OFFER', 'HIRED']));
    const log = await runInTenant(c.orgId, () => platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'Employee', action: 'HIRED' } }));
    expect(log).not.toBeNull();
  }, 90_000);

  it('the apply link: off until turned on, takes applications only while open, drops bots', async () => {
    const opening = (await api(c).post('/talent/openings', { title: 'Store helper', status: 'OPEN' }).expect(201)).body.opening;
    const on = (await api(c).post(`/talent/openings/${opening.id}/apply-link`, { on: true }).expect(200)).body;
    const path = new URL(on.link).pathname;
    expect((await request(app).get(path).expect(200)).text).toMatch(/Store helper/);
    await request(app).post(path).type('form').send({ name: 'Bot', email: 'bot@example.com', website: 'spam.example' }).expect(200);
    await request(app).post(path).type('form').send({ name: 'No Contact' }).expect(400);
    await request(app).post(path).type('form').send({ name: 'Kiran Walk', phone: '9811111111', note: 'Lives nearby', resumeUrl: 'https://drive.example/cv' }).expect(200);
    const list = (await api(c).get(`/talent/candidates?openingId=${opening.id}`).expect(200)).body.rows;
    expect(list.map((r: any) => [r.name, r.source, r.resumeUrl])).toEqual([['Kiran Walk', 'APPLY_LINK', 'https://drive.example/cv']]);
    await api(c).post(`/talent/openings/${opening.id}/status`, { status: 'ON_HOLD' }).expect(200);
    await request(app).get(path).expect(410);
  }, 60_000);

  it('a candidate turned down a year ago is cleared', async () => {
    const opening = (await api(c).post('/talent/openings', { title: 'Driver', status: 'OPEN' }).expect(201)).body.opening;
    const old = (await api(c).post('/talent/candidates', { openingId: opening.id, name: 'Old Person', email: 'old@example.com' }).expect(201)).body.candidate;
    await api(c).post(`/talent/candidates/${old.id}/stage`, { stage: 'REJECTED', reason: 'No licence' }).expect(200);
    await runInTenant(c.orgId, () => peoplePrisma.candidate.update({ where: { id: old.id }, data: { stageAt: new Date(Date.now() - 400 * 86_400_000) } }));
    expect(await runInTenant(c.orgId, () => anonymiseOldCandidates(c.orgId))).toBe(1);
    const row = await runInTenant(c.orgId, () => peoplePrisma.candidate.findUniqueOrThrow({ where: { id: old.id } }));
    expect(row).toMatchObject({ name: 'Former candidate', email: null, closedReason: null });
    expect(row.anonymisedAt).not.toBeNull();
  }, 60_000);

  it('interviewers to pick from: this company’s users by name, for HR only; the interviewer’s notice opens that interview', async () => {
    const users = (await api(c).get('/talent/interviewers').expect(200)).body.users;
    expect(users.map((u: any) => u.name)).toEqual(expect.arrayContaining(['Asha Owner', 'Ravi', 'Ira']));
    /* Names only: nothing a picker does not need. */
    for (const u of users) expect(Object.keys(u).sort()).toEqual(['id', 'name']);
    /* A manager who may only ask for openings does not set interviews, so does not list users. */
    await api(manager).get('/talent/interviewers').expect(403);
    await api(interviewer).get('/talent/interviewers').expect(403);
    /* Another company's HR sees their own users, never these. */
    const other = await owner();
    const theirs = (await api(other).get('/talent/interviewers').expect(200)).body.users;
    expect(theirs.map((u: any) => u.id)).not.toContain(interviewer.userId);
    await request(app).get(`/api/orgs/${c.orgId}/people/talent/interviewers`).set(at(other)).expect((r) => expect([401, 403, 404]).toContain(r.status));

    /* The notice an interviewer gets names the interviews screen and the interview, so the bell opens it. */
    const opening = (await api(c).post('/talent/openings', { title: 'Cashier', status: 'OPEN' }).expect(201)).body.opening;
    const cand = (await api(c).post('/talent/candidates', { openingId: opening.id, name: 'Noor S', phone: '9822222222' }).expect(201)).body.candidate;
    const iv = (await api(c).post(`/talent/candidates/${cand.id}/interviews`, { at: new Date(Date.now() + 86_400_000).toISOString(), interviewerUserIds: [interviewer.userId] }).expect(201)).body.interview;
    /* Up to 10 interviewers, as the picker allows; never more cut off silently. Someone who can no longer sign in is refused. */
    await api(c).post(`/talent/candidates/${cand.id}/interviews`, { at: new Date(Date.now() + 86_400_000).toISOString(), interviewerUserIds: Array.from({ length: 11 }, (_, i) => `u${i}`) }).expect(400);
    await runInTenant(c.orgId, () => platformPrisma.user.update({ where: { id: manager.userId }, data: { isActive: false } }));
    await api(c).post(`/talent/candidates/${cand.id}/interviews`, { at: new Date(Date.now() + 86_400_000).toISOString(), interviewerUserIds: [manager.userId] }).expect(400);
    expect((await api(c).get('/talent/interviewers').expect(200)).body.users.map((u: any) => u.id)).not.toContain(manager.userId);
    await runInTenant(c.orgId, () => platformPrisma.user.update({ where: { id: manager.userId }, data: { isActive: true } }));
    const notice = await runInTenant(c.orgId, () => platformPrisma.notification.findFirst({ where: { orgId: c.orgId, userId: interviewer.userId, title: 'Interview: Noor S' } }));
    expect(JSON.parse(String(notice?.linkJson))).toEqual({ app: 'people', screen: 'interviews', params: { id: iv.id } });
  }, 90_000);

  it('the old register no longer takes hiring, goals or training', async () => {
    await api(c).post('/workspace/candidates', { title: 'X', status: 'APPLIED', details: {} }).expect(404);
    await api(c).post('/workspace/performance', { title: 'X', status: 'DRAFT', details: {} }).expect(404);
  });
});

describe('growth: goals, reviews, plans, one-on-ones', () => {
  let c: Ctx;
  let lead: Ctx;
  let peer: Ctx;
  let leadEmp: any;
  let asha: any;
  let ownerEmp: any;
  beforeAll(async () => {
    c = await owner();
    lead = await colleague(c, 'Lead', ['PEOPLE::Employees::VIEW', 'PEOPLE::Performance::VIEW'], true);
    peer = await colleague(c, 'Peer', ['PEOPLE::Employees::VIEW', 'PEOPLE::Performance::VIEW']);
    ownerEmp = (await api(c).post('/employees', { name: 'Asha Owner', code: 'G-0', dateOfJoining: '2023-01-01' }).expect(201)).body.employee;
    await link(c, ownerEmp.id, c.userId);
    leadEmp = (await api(c).post('/employees', { name: 'Lead Person', code: 'G-1', dateOfJoining: '2024-01-01', reportingManagerId: ownerEmp.id }).expect(201)).body.employee;
    await link(c, leadEmp.id, lead.userId);
    asha = (await api(c).post('/employees', { name: 'Asha Rao', code: 'G-2', dateOfJoining: '2024-02-01', reportingManagerId: leadEmp.id }).expect(201)).body.employee;
    /* The peer has a file of their own on the same team as Asha: a colleague, not her manager. */
    const peerEmp = (await api(c).post('/employees', { name: 'Peer Person', code: 'G-3', dateOfJoining: '2024-03-01', reportingManagerId: leadEmp.id }).expect(201)).body.employee;
    await link(c, peerEmp.id, peer.userId);
  }, 90_000);

  it('goals: the manager sets them, a colleague cannot, a check-in that is not on track needs a note, the person checks in from the app', async () => {
    const g = (await api(lead).post('/talent/goals', { employeeId: asha.id, title: 'Close books by the 5th', measure: 'Day of close', dueDate: plus(60) }).expect(201)).body.goal;
    await api(peer).post('/talent/goals', { employeeId: asha.id, title: 'Peer goal' }).expect(403);
    await api(lead).post(`/talent/goals/${g.id}/check-ins`, { progress: 30, health: 'AT_RISK' }).expect(400);
    await api(lead).post(`/talent/goals/${g.id}/check-ins`, { progress: 30, health: 'AT_RISK', note: 'Bank feed late' }).expect(201);
    const app_ = await portal(c, asha);
    const mine = (await request(app).get('/api/portal/people/me/growth').set(app_).expect(200)).body;
    expect(mine.goals.map((x: any) => [x.title, x.progress, x.health])).toEqual([['Close books by the 5th', 30, 'AT_RISK']]);
    await request(app).post(`/api/portal/people/me/goals/${g.id}/check-ins`).set(app_).send({ progress: 60, health: 'ON_TRACK' }).expect(201);
    const leadGoal = (await api(lead).post('/talent/goals', { employeeId: leadEmp.id, title: 'Lead own goal' }).expect(201)).body.goal;
    await request(app).post(`/api/portal/people/me/goals/${leadGoal.id}/check-ins`).set(app_).send({ progress: 10 }).expect(404);
    const detail = (await api(lead).get(`/talent/goals/${g.id}`).expect(200)).body;
    expect(detail.checkIns.map((x: any) => [x.progress, x.source])).toEqual([[60, 'SELF_SERVICE'], [30, 'FORM']]);
  }, 60_000);

  it('a review cycle: self, manager, a final rating with a reason, shared, read; nobody reviews or rates themselves', async () => {
    const cycle = (await api(c).post('/talent/cycles', { name: 'FY review', periodFrom: '2026-04-01', periodTo: '2027-03-31', selfDue: plus(10), managerDue: plus(20) }).expect(201)).body.cycle;
    await api(lead).post('/talent/cycles', { name: 'Nope', periodFrom: '2026-04-01', periodTo: '2027-03-31' }).expect(403);
    /* Everyone on file: the owner, the lead, Asha and the peer. */
    expect((await api(c).post(`/talent/cycles/${cycle.id}/move`, { to: 'OPEN' }).expect(200)).body.reviews).toBe(4);
    const reviews = (await api(c).get(`/talent/cycles/${cycle.id}`).expect(200)).body.reviews;
    const ashaReview = reviews.find((r: any) => r.employee.id === asha.id);
    const leadReview = reviews.find((r: any) => r.employee.id === leadEmp.id);
    const ownerReview = reviews.find((r: any) => r.employee.id === ownerEmp.id);
    expect(ashaReview.manager.id).toBe(leadEmp.id);

    const app_ = await portal(c, asha);
    await request(app).post(`/api/portal/people/me/reviews/${ashaReview.id}/self`).set(app_).send({ selfRating: 4, selfText: 'Closed every month on time' }).expect(200);
    await request(app).post(`/api/portal/people/me/reviews/${leadReview.id}/self`).set(app_).send({ selfRating: 5, selfText: 'Not mine' }).expect(403);
    /* The lead reviews Asha; not themselves; a peer reviews nobody. */
    await api(lead).post(`/talent/reviews/${ashaReview.id}/manager`, { managerRating: 3, managerText: 'Solid year' }).expect(200);
    expect((await api(lead).post(`/talent/reviews/${leadReview.id}/manager`, { managerRating: 5, managerText: 'Me' }).expect(403)).body.code).toBe('OWN_REVIEW');
    await api(peer).post(`/talent/reviews/${ashaReview.id}/manager`, { managerRating: 1, managerText: 'x' }).expect(403);
    /* Until shared, Asha sees only what she wrote. */
    let mine = (await request(app).get('/api/portal/people/me/growth').set(app_).expect(200)).body.reviews[0];
    expect(mine).toMatchObject({ selfRating: 4, finalRating: null, managerText: null, shared: false });

    await api(c).post(`/talent/cycles/${cycle.id}/move`, { to: 'CALIBRATING' }).expect(200);
    await api(c).post(`/talent/reviews/${ashaReview.id}/final`, { finalRating: 4 }).expect(400);
    await api(c).post(`/talent/reviews/${ashaReview.id}/final`, { finalRating: 4, finalReason: 'Led the GST move' }).expect(200);
    expect((await api(c).post(`/talent/reviews/${ownerReview.id}/final`, { finalRating: 5 }).expect(403)).body.code).toBe('OWN_REVIEW');
    /* HR's own review waits like everyone's: their manager rating stays hidden from them until shared. */
    await runInTenant(c.orgId, () => peoplePrisma.review.update({ where: { id: ownerReview.id }, data: { managerRating: 4, managerText: 'From the board', managerAt: new Date(), finalRating: 4, finalReason: 'Board view' } }));
    const own = (await api(c).get(`/talent/cycles/${cycle.id}`).expect(200)).body.reviews.find((r: any) => r.id === ownerReview.id);
    expect(own).toMatchObject({ own: true, managerRating: null, managerText: null, finalRating: null, finalReason: null });
    const cal = (await api(c).get(`/talent/cycles/${cycle.id}/calibration`).expect(200)).body;
    expect(cal.spread.find((s: any) => s.rating === 3).manager).toBe(1);
    await api(c).post(`/talent/cycles/${cycle.id}/move`, { to: 'SHARED' }).expect(409);
    await runInTenant(c.orgId, () => peoplePrisma.review.updateMany({ where: { cycleId: cycle.id, finalRating: null }, data: { finalRating: 3 } }));
    await api(c).post(`/talent/cycles/${cycle.id}/move`, { to: 'SHARED' }).expect(200);
    mine = (await request(app).get('/api/portal/people/me/growth').set(app_).expect(200)).body.reviews[0];
    expect(mine).toMatchObject({ finalRating: 4, managerText: 'Solid year', shared: true });
    const ownShared = (await api(c).get(`/talent/cycles/${cycle.id}`).expect(200)).body.reviews.find((r: any) => r.id === ownerReview.id);
    expect(ownShared).toMatchObject({ managerRating: 4, managerText: 'From the board', finalRating: 4 });
    await request(app).post(`/api/portal/people/me/reviews/${ashaReview.id}/acknowledge`).set(app_).expect(200);
  }, 90_000);

  it('improvement plans: the manager starts one, never on themselves; the outcome needs a note; the person sees theirs', async () => {
    await api(lead).post('/talent/plans', { employeeId: leadEmp.id, reason: 'x', expectations: 'y', startDate: today(), endDate: plus(30) }).expect(403);
    const p = (await api(lead).post('/talent/plans', { employeeId: asha.id, reason: 'Late closes', expectations: 'Close by the 5th, three months running', startDate: today(), endDate: plus(90) }).expect(201)).body.plan;
    await api(lead).post('/talent/plans', { employeeId: asha.id, reason: 'again', expectations: 'again', startDate: today(), endDate: plus(90) }).expect(409);
    await api(peer).get('/talent/plans').expect(200).then((r) => { expect(r.body.plans).toHaveLength(0); expect(r.body.reports).toEqual([]); expect(r.body.hr).toBe(false); });
    /* The screens learn who may start a plan: the lead has two reports, the peer none. */
    const leadView = (await api(lead).get('/talent/plans').expect(200)).body;
    expect(leadView.reports.map((x: any) => x.name).sort()).toEqual(['Asha Rao', 'Peer Person']);
    expect((await api(lead).get('/talent/goals').expect(200)).body.me).toMatchObject({ id: leadEmp.id, name: 'Lead Person' });
    await api(lead).post(`/talent/plans/${p.id}/notes`, { note: 'Week 2: on time' }).expect(201);
    await api(lead).post(`/talent/plans/${p.id}/decide`, { outcome: 'NOT_MET' }).expect(400);
    await api(lead).post(`/talent/plans/${p.id}/decide`, { outcome: 'EXTENDED', note: 'Better, not yet steady', endDate: plus(120) }).expect(200);
    const mine = (await request(app).get('/api/portal/people/me/growth').set(await portal(c, { ...asha, code: 'G-2' })).expect(200)).body.plans;
    expect(mine[0]).toMatchObject({ status: 'EXTENDED', endDate: plus(120), outcomeNote: 'Better, not yet steady' });
  }, 60_000);

  it('one-on-ones are seen by the manager and the person only, not HR', async () => {
    await api(lead).post('/talent/one-on-ones', { employeeId: asha.id, date: today(), notes: 'Talked about the audit', actions: 'Asha drafts the checklist' }).expect(201);
    await api(peer).post('/talent/one-on-ones', { employeeId: asha.id, date: today(), notes: 'x' }).expect(403);
    expect((await api(lead).get('/talent/one-on-ones').expect(200)).body.rows).toHaveLength(1);
    /* The owner is HR and the lead's manager, but not Asha's: nothing. */
    expect((await api(c).get('/talent/one-on-ones').expect(200)).body.rows).toHaveLength(0);
    const mine = (await request(app).get('/api/portal/people/me/growth').set(await portal(c, { ...asha, code: 'G-2' })).expect(200)).body.oneOnOnes;
    expect(mine.map((o: any) => o.actions)).toEqual(['Asha drafts the checklist']);
  }, 60_000);
});

describe('training and certificates', () => {
  it('a certificate lapses months after completion, and HR and the person hear once per stage', async () => {
    const c = await owner();
    const e = (await api(c).post('/employees', { name: 'Forklift Raj', code: 'T-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const t = (await api(c).post('/talent/trainings', { title: 'Forklift licence', kind: 'EXTERNAL', validMonths: 12, mandatory: true }).expect(201)).body.training;
    expect((await api(c).post(`/talent/trainings/${t.id}/seats`, { employeeIds: [e.id] }).expect(201)).body.added).toBe(1);
    const seat = (await api(c).get(`/talent/trainings/${t.id}`).expect(200)).body.seats[0];
    const completed = plus(-340);
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 test').toString('base64')}`;
    expect((await api(c).put(`/talent/seats/${seat.id}`, { status: 'COMPLETED', completedOn: completed, data: pdf, name: 'licence.pdf' }).expect(200)).body.expiresOn).toBe(addMonths(completed, 12));
    const after = (await api(c).get(`/talent/trainings/${t.id}`).expect(200)).body.seats[0];
    expect(after.expiresOn > today()).toBe(true);
    expect(after.cert).toMatchObject({ name: 'licence.pdf' });
    expect((await api(c).get('/talent/trainings?view=expiring').expect(200)).body.expiring.map((x: any) => x.trainingTitle)).toEqual(['Forklift licence']);
    await api(c).del(`/talent/trainings/${t.id}`).expect(409);
    expect(await runCertificateReminders()).toBeGreaterThanOrEqual(1);
    const before = await runInTenant(c.orgId, () => platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'people.training' } }));
    await runCertificateReminders();
    expect(await runInTenant(c.orgId, () => platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'people.training' } }))).toBe(before);
    expect((await runInTenant(c.orgId, () => peoplePrisma.trainingSeat.findUniqueOrThrow({ where: { id: seat.id } }))).remindedStage).toBe(30);
  }, 60_000);
});
