import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The approval engine's state changes under concurrency (docs/state-machines.md, P1):
 * a decision looks at the request again under its lock, so an ALL step never
 * completes past a slot that asked for more; withdraw and a decision leave one
 * outcome; a request whose every step said yes is not withdrawn while it is
 * being applied; and a leaver's requests close through the same locked claim.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { finishStalled } = await import('../services/people/approvals/engine.js');
const { closeOutFor } = await import('../services/people/lifecycle/closeOut.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `race.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Race Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.userId = me.body.user.id;
  ctx.accountId = me.body.orgs.find((o: any) => o.orgId === ctx.orgId).accountId;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, accountId: boss.accountId };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const APPROVER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];

let hr: Ctx;
let ravi: Ctx;
let meena: Ctx;
let priya: Ctx;
let tara: any;
beforeAll(async () => {
  hr = await owner();
  ravi = await colleague(hr, 'Ravi', APPROVER);
  meena = await colleague(hr, 'Meena', APPROVER);
  priya = await colleague(hr, 'Priya', APPROVER);
  tara = (await people(hr).post('/employees', { name: 'Tara Singh', code: 'R-1' }).expect(201)).body.employee;
  await people(hr).post('/approval-rules', { name: 'Race', requestType: 'LETTER_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }], due: { workingDays: 2 } }] }).expect(201);
}, 120_000);

const rule = (body: Record<string, unknown>) => people(hr).post('/approval-rules', { name: 'Race', ...body }).expect(201);
const ask = async (c: Ctx, requestType: string) =>
  (await people(c).post('/requests', { requestType, subjectEmployeeId: tara.id, title: `${requestType} ${rnd()}`, payload: { employeeId: tara.id } }).expect(201)).body.request;
const row = (id: string) => runInTenant(hr.orgId, () => peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id }, include: { steps: true } }));

describe('the approval engine under concurrency', () => {
  it('ALL: one slot asking for more while the other approves never opens the next step', async () => {
    await rule({ requestType: 'DOCUMENT_REQUEST', steps: [{ approvers: [{ kind: 'USER', id: meena.userId }, { kind: 'USER', id: priya.userId }], mode: 'ALL', due: { workingDays: 2 } }, { approvers: [{ kind: 'HR' }], due: { workingDays: 2 } }] });
    for (let i = 0; i < 8; i++) {
      const r = await ask(ravi, 'DOCUMENT_REQUEST');
      const both = await Promise.all([
        people(meena).post(`/requests/${r.id}/more-info`, { comment: 'Which year?' }),
        people(priya).post(`/requests/${r.id}/approve`, {}),
      ]);
      expect(both[0].status).toBe(200);
      expect([200, 409]).toContain(both[1].status);
      const now = await row(r.id);
      /* Whichever landed first, Meena's question stands: nobody at step 2 is asked, and the request waits on Ravi's answer. */
      expect(now.status).toBe('MORE_INFO');
      expect(now.steps.filter((s) => s.order === 2)).toHaveLength(0);
    }
  });

  it('withdraw racing an approval leaves exactly one outcome', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await ask(ravi, 'LETTER_REQUEST');
      const [w, a] = await Promise.all([people(ravi).post(`/requests/${r.id}/withdraw`), people(meena).post(`/requests/${r.id}/approve`, {})]);
      expect([w.status, a.status].sort()).toEqual([200, 409]);
      const now = await row(r.id);
      expect(now.status).toBe(w.status === 200 ? 'WITHDRAWN' : 'APPROVED');
    }
  });

  it('a request whose every step said yes is not withdrawn while it is applied, and is then finished', async () => {
    const r = await ask(ravi, 'LETTER_REQUEST');
    /* The last step's decision committed and approveFinal has not written yet: the state finishStalled exists for. */
    await runInTenant(hr.orgId, () => peoplePrisma.approvalStep.updateMany({ where: { requestId: r.id, status: 'WAITING' }, data: { status: 'APPROVED', decidedByUserId: meena.userId, decidedAt: new Date() } }));
    const refused = await people(ravi).post(`/requests/${r.id}/withdraw`).expect(409);
    expect(refused.body.error).toMatch(/being applied/);
    expect((await row(r.id)).status).toBe('WAITING');
    await runInTenant(hr.orgId, async () => finishStalled([await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id }, include: { steps: true } }) as any]));
    expect((await row(r.id)).status).toBe('APPROVED');
  });

  it('a leaver’s open requests are withdrawn through the locked claim; one being applied is left to finish', async () => {
    const open = await ask(ravi, 'LETTER_REQUEST');
    const finishing = await ask(ravi, 'LETTER_REQUEST');
    await runInTenant(hr.orgId, () => peoplePrisma.approvalStep.updateMany({ where: { requestId: finishing.id, status: 'WAITING' }, data: { status: 'APPROVED', decidedByUserId: meena.userId, decidedAt: new Date() } }));
    const actor = { accountId: hr.accountId, orgId: hr.orgId, userId: hr.userId, source: 'FORM' as const, correlationId: `leave-${rnd()}` };
    const out = await runInTenant(hr.orgId, () => closeOutFor(actor, tara.id));
    expect(out.withdrawn).toBeGreaterThanOrEqual(1);
    const o = await row(open.id);
    expect(o.status).toBe('WITHDRAWN');
    expect(o.steps.find((s) => s.status === 'WITHDRAWN')?.comment).toBe('Tara Singh left');
    expect((await row(finishing.id)).status).toBe('WAITING');
  });
});
