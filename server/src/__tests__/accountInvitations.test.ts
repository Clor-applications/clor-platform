import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Workspace W-3: an invitation instead of an administrator typing a password
 * for somebody else. Single-use, hashed, expiring, revocable; never an owner;
 * nobody grants more than they hold; accepting twice makes one membership.
 */

/* The link leaves only in the email, and the outbox forgets the token once sent: the test reads it on the way out. */
const sent: Array<{ to: string; url: string }> = [];
vi.mock('../services/mailer.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return {
    ...real,
    sendTemplate: async (opts: any) => {
      if (opts.templateKey === 'account.invited') sent.push({ to: opts.to, url: String(opts.data?.inviteUrl || '') });
      return real.sendTemplate(opts);
    },
  };
});

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Passw0rd!23';

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string; email: string };
const at = (c: { token: string; orgId: string; branchId: string }) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const mail = (label: string) => `inv.${label}.${Date.now()}.${rnd()}@example.com`;

async function owner(label: string): Promise<Ctx> {
  const email = mail(label);
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `INV ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId, email };
}

const invite = (by: Ctx, body: Record<string, unknown>) => request(app).post('/api/account/invitations').set(at(by)).send(body);
const tokenFor = (email: string) => {
  const hit = [...sent].reverse().find((m) => m.to === email);
  return hit ? new URL(hit.url).searchParams.get('token') || '' : '';
};
const accept = (token: string, extra: Record<string, unknown> = {}) => request(app).post('/api/invitations/accept').send({ token, fullName: 'New Person', password: PASSWORD, ...extra });
const preview = (token: string) => request(app).post('/api/invitations/preview').send({ token });

describe('invitations', () => {
  it('invites, previews and accepts: the person chooses their own password and joins as invited', async () => {
    const o = await owner('happy');
    const email = mail('new');
    const r = await invite(o, { email, accountRole: 'MEMBER', grants: [{ orgId: o.orgId }] }).expect(201);
    expect(r.body.invitation.status).toBe('PENDING');
    expect(JSON.stringify(r.body)).not.toMatch(/tokenHash/);
    const token = tokenFor(email);
    expect(token.length).toBeGreaterThan(20);

    const p = (await preview(token).expect(200)).body;
    expect(p).toMatchObject({ email, accountRole: 'MEMBER', hasLogin: false });
    expect(p.companies).toHaveLength(1);

    await accept(token).expect(200);
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    const me = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(200)).body;
    expect(me.orgs.map((x: any) => x.orgId)).toContain(o.orgId);
    expect(me.accounts[0]).toMatchObject({ id: o.accountId, role: 'MEMBER' });
  });

  it('works once: two accepts at the same moment make one person and one membership', async () => {
    const o = await owner('race');
    const email = mail('race');
    await invite(o, { email, grants: [{ orgId: o.orgId }] }).expect(201);
    const token = tokenFor(email);
    const [a, b] = await Promise.all([accept(token), accept(token)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const n = await outsideTenant('test', () => platformPrisma.user.count({ where: { email } }));
    expect(n).toBe(1);
    await accept(token).expect(409);
  });

  it('stops working when revoked, expired or replaced by a resend', async () => {
    const o = await owner('life');
    const e1 = mail('revoked');
    const r1 = await invite(o, { email: e1, grants: [{ orgId: o.orgId }] }).expect(201);
    await request(app).post(`/api/account/invitations/${r1.body.invitation.id}/revoke`).set(at(o)).expect(200);
    expect((await accept(tokenFor(e1)).expect(410)).body.code).toBe('REVOKED');

    const e2 = mail('expired');
    const r2 = await invite(o, { email: e2, grants: [{ orgId: o.orgId }] }).expect(201);
    await outsideTenant('test: let it lapse', () => platformPrisma.accountInvitation.update({ where: { id: r2.body.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    expect((await preview(tokenFor(e2)).expect(410)).body.code).toBe('EXPIRED');

    const e3 = mail('resent');
    const r3 = await invite(o, { email: e3, grants: [{ orgId: o.orgId }] }).expect(201);
    const old = tokenFor(e3);
    await request(app).post(`/api/account/invitations/${r3.body.invitation.id}/resend`).set(at(o)).expect(200);
    const fresh = tokenFor(e3);
    expect(fresh).not.toBe(old);
    expect((await preview(old).expect(404)).body.code).toBe('INVALID_TOKEN');
    await accept(fresh).expect(200);
  });

  it('never invites an owner, and only owners and administrators invite', async () => {
    const o = await owner('rules');
    expect((await invite(o, { email: mail('o'), accountRole: 'OWNER', grants: [{ orgId: o.orgId }] }).expect(400)).body.code).toBe('BAD_ROLE');
    const email = mail('member');
    await invite(o, { email, grants: [{ orgId: o.orgId }] }).expect(201);
    await accept(tokenFor(email)).expect(200);
    const token = (await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.token;
    const m = { token, orgId: o.orgId, branchId: o.branchId };
    expect((await request(app).post('/api/account/invitations').set(at(m)).send({ email: mail('x'), grants: [{ orgId: o.orgId }] }).expect(403)).body.code).toBe('ACCOUNT_ROLE_REQUIRED');
  });

  it('keeps grants inside the account and within the inviter’s authority', async () => {
    const o = await owner('scope');
    const other = await owner('other');
    expect((await invite(o, { email: mail('f'), grants: [{ orgId: other.orgId }] }).expect(400)).body.code).toBe('FOREIGN_COMPANY');

    /* An account administrator who administers no company cannot hand out a company role. */
    const email = mail('admin');
    await invite(o, { email, accountRole: 'ADMIN', grants: [{ orgId: o.orgId }] }).expect(201);
    await accept(tokenFor(email)).expect(200);
    const token = (await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.token;
    const a = { token, orgId: o.orgId, branchId: o.branchId };
    const role = await outsideTenant('test', () => platformPrisma.role.findFirst({ where: { orgId: o.orgId }, select: { id: true } }));
    const r = await request(app).post('/api/account/invitations').set(at(a)).send({ email: mail('g'), grants: [{ orgId: o.orgId, roleIds: [role!.id] }] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ABOVE_AUTHORITY');
    /* The owner, who administers the company they signed up with, can. */
    await invite(o, { email: mail('g2'), grants: [{ orgId: o.orgId, roleIds: [role!.id] }] }).expect(201);
  });

  it('sends a person of another account to Outside access, and refuses the wrong person', async () => {
    const o = await owner('people');
    const elsewhere = await owner('elsewhere');
    expect((await invite(o, { email: elsewhere.email, grants: [{ orgId: o.orgId }] }).expect(409)).body.code).toBe('OTHER_ACCOUNT');

    const email = mail('target');
    await invite(o, { email, grants: [{ orgId: o.orgId }] }).expect(201);
    const r = await request(app).post('/api/invitations/accept-signed-in').set('Authorization', `Bearer ${elsewhere.token}`).send({ token: tokenFor(email) });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('WRONG_PERSON');
  });

  it('records every step in the account’s audit', async () => {
    const o = await owner('audit');
    const email = mail('aud');
    const r = await invite(o, { email, grants: [{ orgId: o.orgId }] }).expect(201);
    await request(app).post(`/api/account/invitations/${r.body.invitation.id}/resend`).set(at(o)).expect(200);
    await accept(tokenFor(email)).expect(200);
    const actions = (await outsideTenant('test', () => platformPrisma.accountAuditEvent.findMany({ where: { accountId: o.accountId }, orderBy: { createdAt: 'asc' } }))).map((e) => e.action);
    expect(actions).toEqual(['INVITATION_SENT', 'INVITATION_RESENT', 'INVITATION_ACCEPTED']);
  });
});
