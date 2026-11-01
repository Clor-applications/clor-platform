import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * People who leave are marked as left, not deleted (services/leavers.ts);
 * companies that stop are archived, read-only and reversible
 * (services/companyArchive.ts).
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { forgetArchived } = await import('../services/companyArchive.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(): Promise<Ctx> {
  const email = `leave.${Date.now()}.${rnd()}@example.com`;
  const s = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const c = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${s.body.token}`).send({ companyName: `Leave Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(s.body.token) as { userId: string; accountId: string };
  return { token: s.body.token, orgId: c.body.company.orgId, branchId: c.body.branch.id, userId: claims.userId, accountId: claims.accountId, email };
}

async function staff(o: Ctx, label: string) {
  const email = `${label}.${Date.now()}.${rnd()}@example.com`;
  const u = await request(app).post('/api/users').set(at(o)).send({ email, fullName: label, password: 'Passw0rd!23', orgIds: [o.orgId], branchIdsByOrg: { [o.orgId]: [o.branchId] } }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { id: u.body.user.id as string, email, token: login.body.token as string };
}

describe('marking somebody as left', () => {
  it('stops their sign-in at once, keeps the reason, frees the seat and can be undone', async () => {
    const o = await owner();
    const leaver = await staff(o, 'Leaver');
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${leaver.token}`).expect(200);

    const before = await request(app).get(`/api/orgs/${o.orgId}/users/${leaver.id}/leaving`).set(at(o)).expect(200);
    expect(before.body.reasons.map((r: any) => r.key)).toContain('RESIGNED');

    await request(app).post(`/api/orgs/${o.orgId}/users/${leaver.id}/leave`).set(at(o)).send({ reason: 'RESIGNED', lastWorkingDay: '2026-10-31' }).expect(200);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${leaver.token}`).expect(401);
    await request(app).post('/api/auth/login').send({ emailOrUsername: leaver.email, password: 'Passw0rd!23' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));

    const list = await request(app).get(`/api/orgs/${o.orgId}/users`).set(at(o)).expect(200);
    const row = list.body.users.find((u: any) => u.id === leaver.id);
    expect(row.isActive).toBe(false);
    expect(row.left).toMatchObject({ reason: 'RESIGNED', lastWorkingDay: '2026-10-31' });

    const audit = await platformPrisma.auditLog.findFirst({ where: { entityId: leaver.id, action: 'LEFT' } });
    expect(audit?.message).toMatch(/Resigned/);

    await request(app).post(`/api/orgs/${o.orgId}/users/${leaver.id}/leave`).set(at(o)).send({ reason: 'RESIGNED', lastWorkingDay: '2026-10-31' }).expect(409);
    await request(app).post(`/api/orgs/${o.orgId}/users/${leaver.id}/reactivate`).set(at(o)).expect(200);
    await request(app).post('/api/auth/login').send({ emailOrUsername: leaver.email, password: 'Passw0rd!23' }).expect(200);
  }, 60_000);

  it('needs a reason and a date, and refuses yourself and the last administrator', async () => {
    const o = await owner();
    const s = await staff(o, 'Someone');
    await request(app).post(`/api/orgs/${o.orgId}/users/${s.id}/leave`).set(at(o)).send({ lastWorkingDay: '2026-10-31' }).expect(400);
    await request(app).post(`/api/orgs/${o.orgId}/users/${s.id}/leave`).set(at(o)).send({ reason: 'RESIGNED' }).expect(400);
    const self = await request(app).post(`/api/orgs/${o.orgId}/users/${o.userId}/leave`).set(at(o)).send({ reason: 'RESIGNED', lastWorkingDay: '2026-10-31' });
    expect([400, 409]).toContain(self.status);
  }, 60_000);

  it('hands waiting work to the person named, and releases a shared address for a successor', async () => {
    const o = await owner();
    const leaver = await staff(o, 'Approver');
    const next = await staff(o, 'Successor');
    const reqId = `req-${rnd()}`;
    await runInTenant(o.orgId, async () => {
      await peoplePrisma.attendanceExceptionState.create({ data: { accountId: o.accountId, orgId: o.orgId, key: `MISSING_OUT:${rnd()}`, kind: 'MISSING_OUT', assigneeUserId: leaver.id } });
      await peoplePrisma.approvalRequest.create({ data: { id: reqId, accountId: o.accountId, orgId: o.orgId, requestType: 'LEAVE', requesterUserId: o.userId, ruleId: 'r', ruleVersion: 1, title: 'Leave', payload: {} } });
      await peoplePrisma.approvalStep.create({ data: { accountId: o.accountId, orgId: o.orgId, requestId: reqId, order: 1, candidateUserIds: [leaver.id], approverUserId: leaver.id, dueAt: new Date(Date.now() + 86_400_000) } });
    });

    const pending = await request(app).get(`/api/orgs/${o.orgId}/users/${leaver.id}/leaving`).set(at(o)).expect(200);
    expect(pending.body.pending).toMatchObject({ approvals: 1, exceptions: 1 });

    const out = await request(app).post(`/api/orgs/${o.orgId}/users/${leaver.id}/leave`).set(at(o)).send({ reason: 'TERMINATED', lastWorkingDay: '2026-10-26', handoverUserId: next.id, releaseEmail: true }).expect(200);
    expect(out.body.handover).toMatchObject({ approvals: 1, exceptions: 1, companies: 1 });
    expect(out.body.releasedEmail).toBe(leaver.email.toLowerCase());

    await runInTenant(o.orgId, async () => {
      const step = await peoplePrisma.approvalStep.findFirst({ where: { requestId: reqId } });
      expect(step?.approverUserId).toBe(next.id);
      expect(step?.standInForUserId).toBe(leaver.id);
      expect(step?.candidateUserIds).toEqual([next.id]);
      const ex = await peoplePrisma.attendanceExceptionState.findFirst({ where: { orgId: o.orgId, assigneeUserId: next.id } });
      expect(ex).not.toBeNull();
    });

    /* The address is free: a new person can be added with it. */
    await request(app).post('/api/users').set(at(o)).send({ email: leaver.email, fullName: 'New hire', password: 'Passw0rd!23', orgIds: [o.orgId] }).expect(201);
    /* Reactivating the leaver keeps the new person's address and says so. */
    const back = await request(app).post(`/api/orgs/${o.orgId}/users/${leaver.id}/reactivate`).set(at(o)).expect(200);
    expect(back.body.emailRestored).toBe(false);
  }, 60_000);

  it('refuses a handover to someone outside the company', async () => {
    const o = await owner();
    const other = await owner();
    const leaver = await staff(o, 'Leaver2');
    await request(app).post(`/api/orgs/${o.orgId}/users/${leaver.id}/leave`).set(at(o)).send({ reason: 'RESIGNED', lastWorkingDay: '2026-10-31', handoverUserId: other.userId }).expect(400);
  }, 60_000);
});

describe('archiving a company', () => {
  it('makes it read-only, takes it off the plan count, and can be reactivated', async () => {
    const o = await owner();
    const second = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${o.token}`).send({ companyName: `Old Co ${rnd()}`, state: 'Kerala' }).expect(200);
    const old = { ...o, orgId: second.body.company.orgId, branchId: second.body.branch.id };
    await request(app).post(`/api/orgs/${old.orgId}/items`).set(at(old)).send({ name: 'Before archive' }).expect(201);

    await request(app).post(`/api/account/companies/${old.orgId}/archive`).set(at(o)).send({}).expect(400);
    await request(app).post(`/api/account/companies/${old.orgId}/archive`).set(at(o)).send({ reason: 'STOPPED_TRADING', note: 'Closed shop in Sept' }).expect(200);
    forgetArchived();

    await request(app).get(`/api/orgs/${old.orgId}/items`).set(at(old)).expect(200);
    const blocked = await request(app).post(`/api/orgs/${old.orgId}/items`).set(at(old)).send({ name: 'After archive' }).expect(403);
    expect(blocked.body.code).toBe('COMPANY_ARCHIVED');

    const overview = await request(app).get('/api/account/overview').set(at(o)).expect(200);
    const row = overview.body.companies.find((c: any) => c.orgId === old.orgId);
    expect(row.archived).toMatchObject({ reason: 'STOPPED_TRADING' });

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${o.token}`).expect(200);
    expect(me.body.orgs.find((m: any) => m.orgId === old.orgId).org.archivedAt).toBeTruthy();

    const events = await platformPrisma.accountAuditEvent.findMany({ where: { accountId: o.accountId, action: { in: ['COMPANY_ARCHIVED', 'COMPANY_REACTIVATED'] } } });
    expect(events.map((e) => e.action)).toContain('COMPANY_ARCHIVED');

    /* Reactivating works even from inside the archived company. */
    await request(app).post(`/api/account/companies/${old.orgId}/reactivate`).set(at(old)).expect(200);
    forgetArchived();
    await request(app).post(`/api/orgs/${old.orgId}/items`).set(at(old)).send({ name: 'After reactivate' }).expect(201);
  }, 60_000);

  it('will not archive the only active company, and another account cannot archive yours', async () => {
    const o = await owner();
    const r = await request(app).post(`/api/account/companies/${o.orgId}/archive`).set(at(o)).send({ reason: 'NOT_NEEDED' }).expect(409);
    expect(r.body.code).toBe('LAST_ACTIVE_COMPANY');
    const other = await owner();
    const x = await request(app).post(`/api/account/companies/${o.orgId}/archive`).set(at(other)).send({ reason: 'NOT_NEEDED' });
    expect([403, 404]).toContain(x.status);
  }, 60_000);
});
