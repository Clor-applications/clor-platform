import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Round 53 picks that needed the server (hiring and goals): one interview question list rated 1 to 5,
 * an e-mail to the candidate on each step forward, a saved description per designation, screening
 * questions on the apply page, a reason for pausing a job, company goals over the Goals list, the
 * review score the goals give, goals open to the team with "Only me and my manager", and team goals.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { goalScore } = await import('../services/people/talent/growth.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(): Promise<Ctx> {
  const email = `picks53.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Picks Co ${rnd()}`, state: 'Karnataka' }).expect(200);
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
});
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
async function portal(c: Ctx, employee: { id: string; code: string }) {
  const company = (await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200)).body.company.code;
  const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company, employeeCode: employee.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
  return { Authorization: `Bearer ${token}` };
}
const mails = (orgId: string, templateKey: string, toEmail: string) => platformPrisma.emailOutbox.count({ where: { orgId, templateKey, toEmail } });

describe('round 53 hiring picks', () => {
  let c: Ctx;
  let interviewer: Ctx;
  beforeAll(async () => {
    c = await owner();
    interviewer = await colleague(c, 'Ira', ['PEOPLE::Employees::VIEW']);
  }, 90_000);

  it('one question list for every job: HR sets it, interviewers rate each 1 to 5, HR reads the ratings', async () => {
    await api(interviewer).put('/talent/interview-questions', { questions: ['x'] }).expect(403);
    const set = (await api(c).put('/talent/interview-questions', { questions: 'Communication\nProblem solving\n\ncommunication' }).expect(200)).body;
    expect(set.questions).toEqual(['Communication', 'Problem solving']);
    expect((await api(interviewer).get('/talent/interview-questions').expect(200)).body).toMatchObject({ questions: ['Communication', 'Problem solving'], canEdit: false });

    const opening = (await api(c).post('/talent/openings', { title: 'Analyst', status: 'OPEN' }).expect(201)).body.opening;
    const cand = (await api(c).post('/talent/candidates', { openingId: opening.id, name: 'Nila R', phone: '9800000011' }).expect(201)).body.candidate;
    await api(c).post(`/talent/candidates/${cand.id}/interviews`, { at: new Date(Date.now() - 3_600_000).toISOString(), interviewerUserIds: [interviewer.userId] }).expect(201);
    const interviewId = (await api(c).get(`/talent/candidates/${cand.id}`).expect(200)).body.interviews[0].id;
    await api(interviewer).post(`/talent/interviews/${interviewId}/feedback`, { recommendation: 'YES', answers: [{ question: 'Communication', rating: 7 }] }).expect(400);
    await api(interviewer).post(`/talent/interviews/${interviewId}/feedback`, { recommendation: 'YES', answers: [{ question: 'Communication', rating: 4 }, { question: 'Not ours', rating: 5 }] }).expect(200);
    const fb = (await api(c).get(`/talent/candidates/${cand.id}`).expect(200)).body.interviews[0].feedback[0];
    expect(fb.answers).toEqual([{ question: 'Communication', rating: 4 }, { question: 'Problem solving', rating: null }]);
  }, 60_000);

  it('the candidate hears of each step forward; a pause needs a reason', async () => {
    const opening = (await api(c).post('/talent/openings', { title: 'Cashier', status: 'OPEN' }).expect(201)).body.opening;
    const cand = (await api(c).post('/talent/candidates', { openingId: opening.id, name: 'Ravi M', email: `ravi.${rnd()}@example.com` }).expect(201)).body.candidate;
    await api(c).post(`/talent/candidates/${cand.id}/stage`, { stage: 'SCREENING' }).expect(200);
    await api(c).post(`/talent/candidates/${cand.id}/stage`, { stage: 'INTERVIEW' }).expect(200);
    expect(await mails(c.orgId, 'people.candidate_stage', cand.email)).toBe(2);
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId: c.orgId, templateKey: 'people.candidate_stage', toEmail: cand.email }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(mail)).toMatch(/would like to meet you/);
    await api(c).post(`/talent/candidates/${cand.id}/stage`, { stage: 'REJECTED', reason: 'Fewer hours wanted' }).expect(200);
    expect(await mails(c.orgId, 'people.candidate_stage', cand.email)).toBe(2);
    expect(await mails(c.orgId, 'people.candidate_not_taken', cand.email)).toBe(1);

    await api(c).post(`/talent/openings/${opening.id}/status`, { status: 'ON_HOLD' }).expect(400);
    const held = (await api(c).post(`/talent/openings/${opening.id}/status`, { status: 'ON_HOLD', reason: 'Budget review in March' }).expect(200)).body.opening;
    expect(held).toMatchObject({ status: 'ON_HOLD', heldReason: 'Budget review in March' });
    const reopened = (await api(c).post(`/talent/openings/${opening.id}/status`, { status: 'OPEN' }).expect(200)).body.opening;
    expect(reopened.heldReason).toBeNull();
  }, 60_000);

  it('a description saved for a designation comes back for the next opening', async () => {
    const desig = (await api(c).post('/structure/job-positions', { name: `Picker ${rnd()}` }).expect(201)).body.item;
    expect((await api(c).get(`/talent/job-descriptions/${desig.id}`).expect(200)).body.description).toBeNull();
    await api(c).post('/talent/openings', { title: 'Picker', jobPositionId: desig.id, description: 'Picks orders.\nNight shifts.', saveDescription: true }).expect(201);
    expect((await api(c).get(`/talent/job-descriptions/${desig.id}`).expect(200)).body).toMatchObject({ designation: desig.name, description: 'Picks orders.\nNight shifts.' });
    await api(c).get('/talent/job-descriptions/not-ours').expect(404);
  }, 60_000);

  it('screening questions on the apply page are asked and their answers kept on the card', async () => {
    await api(c).post('/talent/openings', { title: 'Too many', screeningQuestions: ['1', '2', '3', '4', '5', '6'] }).expect(400);
    const opening = (await api(c).post('/talent/openings', { title: 'Delivery rider', status: 'OPEN', screeningQuestions: ['Do you have a two-wheeler licence?', 'Notice period?'] }).expect(201)).body.opening;
    expect(opening.screeningQuestions).toHaveLength(2);
    const path = new URL((await api(c).post(`/talent/openings/${opening.id}/apply-link`, { on: true }).expect(200)).body.link).pathname;
    expect((await request(app).get(path).expect(200)).text).toMatch(/two-wheeler licence/);
    await request(app).post(path).type('form').send({ name: 'Kabir S', phone: '9811111112', answer0: 'Yes, since 2021', answer1: '' }).expect(200);
    const row = (await api(c).get(`/talent/candidates?openingId=${opening.id}`).expect(200)).body.rows[0];
    const card = (await api(c).get(`/talent/candidates/${row.id}`).expect(200)).body.candidate;
    expect(card.screeningAnswers).toEqual([{ question: 'Do you have a two-wheeler licence?', answer: 'Yes, since 2021' }, { question: 'Notice period?', answer: null }]);
  }, 60_000);
});

describe('round 53 goal picks', () => {
  let c: Ctx;
  let lead: Ctx;
  let peer: Ctx;
  let ownerEmp: any;
  let leadEmp: any;
  let asha: any;
  let peerEmp: any;
  beforeAll(async () => {
    c = await owner();
    lead = await colleague(c, 'Lead', ['PEOPLE::Employees::VIEW', 'PEOPLE::Performance::VIEW'], true);
    peer = await colleague(c, 'Peer', ['PEOPLE::Employees::VIEW', 'PEOPLE::Performance::VIEW'], true);
    ownerEmp = (await api(c).post('/employees', { name: 'Asha Owner', code: 'P-0', dateOfJoining: '2023-01-01' }).expect(201)).body.employee;
    await link(c, ownerEmp.id, c.userId);
    leadEmp = (await api(c).post('/employees', { name: 'Lead Person', code: 'P-1', dateOfJoining: '2024-01-01', reportingManagerId: ownerEmp.id }).expect(201)).body.employee;
    await link(c, leadEmp.id, lead.userId);
    asha = (await api(c).post('/employees', { name: 'Asha Rao', code: 'P-2', dateOfJoining: '2024-02-01', reportingManagerId: leadEmp.id }).expect(201)).body.employee;
    peerEmp = (await api(c).post('/employees', { name: 'Peer Person', code: 'P-3', dateOfJoining: '2024-03-01', reportingManagerId: leadEmp.id }).expect(201)).body.employee;
    await link(c, peerEmp.id, peer.userId);
  }, 90_000);

  it('company goals: HR sets them, everyone reads them, linked goals give the progress', async () => {
    await api(lead).post('/talent/company-goals', { title: 'Nope' }).expect(403);
    const cg = (await api(c).post('/talent/company-goals', { title: 'Grow revenue 20%', dueDate: '2027-03-31' }).expect(201)).body.goal;
    await api(lead).post('/talent/goals', { employeeId: asha.id, title: 'Ten new clients', companyGoalId: 'not-ours' }).expect(400);
    const g = (await api(lead).post('/talent/goals', { employeeId: asha.id, title: 'Ten new clients', companyGoalId: cg.id }).expect(201)).body.goal;
    await api(lead).post(`/talent/goals/${g.id}/check-ins`, { progress: 40, health: 'ON_TRACK' }).expect(201);
    const list = (await api(lead).get('/talent/company-goals').expect(200)).body;
    expect(list.canEdit).toBe(false);
    expect(list.goals.map((x: any) => [x.title, x.linkedGoals, x.progress])).toEqual([['Grow revenue 20%', 1, 40]]);
    const mine = (await request(app).get('/api/portal/people/me/growth').set(await portal(c, asha)).expect(200)).body;
    expect(mine.companyGoals.map((x: any) => x.title)).toEqual(['Grow revenue 20%']);
  }, 60_000);

  it('goals are open to the team unless "Only me and my manager"; team goals belong to a manager', async () => {
    const open = (await api(lead).post('/talent/goals', { employeeId: asha.id, title: 'Open goal' }).expect(201)).body.goal;
    expect(open.visibility).toBe('TEAM');
    const hidden = (await api(lead).post('/talent/goals', { employeeId: asha.id, title: 'Private goal', visibility: 'PRIVATE' }).expect(201)).body.goal;
    await api(lead).post('/talent/goals', { employeeId: asha.id, title: 'Asha team goal', forTeam: true }).expect(400);
    const team = (await api(lead).post('/talent/goals', { employeeId: leadEmp.id, title: 'Team closes on the 3rd', forTeam: true }).expect(201)).body.goal;
    await api(lead).post('/talent/goals', { employeeId: leadEmp.id, title: 'Lead private', visibility: 'PRIVATE' }).expect(201);

    /* The peer shares Asha's manager: sees her open goal and the lead's team goal, not the private ones. */
    const seen = (await api(peer).get('/talent/goals').expect(200)).body.goals;
    expect(seen.map((x: any) => x.title).sort()).toEqual(['Open goal', 'Team closes on the 3rd', 'Ten new clients']);
    expect(seen.every((x: any) => x.peer)).toBe(true);
    await api(peer).get(`/talent/goals/${open.id}`).expect(200);
    await api(peer).get(`/talent/goals/${hidden.id}`).expect(404);
    await api(peer).post(`/talent/goals/${open.id}/check-ins`, { progress: 90 }).expect(404);
    /* The manager and HR see both of Asha's. */
    const leadSees = (await api(lead).get(`/talent/goals?employeeId=${asha.id}`).expect(200)).body.goals.map((x: any) => x.title);
    expect(leadSees).toEqual(expect.arrayContaining(['Open goal', 'Private goal']));
    expect((await api(c).get(`/talent/goals?employeeId=${asha.id}`).expect(200)).body.goals.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Private goal']));
    /* In the employee app, the peer's team list shows the same two. */
    const app_ = await portal(c, peerEmp);
    const growthView = (await request(app).get('/api/portal/people/me/growth').set(app_).expect(200)).body;
    expect(growthView.teamGoals.map((x: any) => [x.title, x.forTeam]).sort()).toEqual([['Open goal', false], ['Team closes on the 3rd', true], ['Ten new clients', false]]);
    expect(team.forTeam).toBe(true);
  }, 60_000);

  it('the review shows the score the goals give, weighted', async () => {
    expect(goalScore([])).toBeNull();
    expect(goalScore([{ progress: 100, weight: 70 }, { progress: 0, weight: 30 }])).toMatchObject({ score: 3.8, progress: 70, weighted: true });
    expect(goalScore([{ progress: 50, weight: null }, { progress: 100, weight: null }])).toMatchObject({ score: 4, progress: 75, weighted: false });

    const year = new Date().getUTCFullYear();
    const cycle = (await api(c).post('/talent/cycles', { name: 'Score review', periodFrom: `${year - 1}-01-01`, periodTo: `${year + 1}-12-31` }).expect(201)).body.cycle;
    await api(c).post(`/talent/cycles/${cycle.id}/move`, { to: 'OPEN' }).expect(200);
    const forLead = (await api(lead).get(`/talent/cycles/${cycle.id}`).expect(200)).body.reviews;
    const ashaReview = forLead.find((r: any) => r.employee.id === asha.id);
    expect(ashaReview.goalScore).toMatchObject({ goals: expect.any(Number) });
    expect(ashaReview.goalScore.score).toBeGreaterThanOrEqual(1);
    /* Not on your own review. */
    expect(forLead.find((r: any) => r.employee.id === leadEmp.id).goalScore).toBeNull();
  }, 60_000);
});
