import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Explore (roadmap item 6): a demo request mails a 14-day link to the shared
 * sample company; the link is traded for a session that may read and may not
 * change anything — refused on the server for every route, not hidden in the
 * app. The sample's data fill is left out here (EXPLORE_SAMPLE_FILL=off): it
 * goes through the same API and is exercised by `npm run seed:sample`.
 */
process.env.EXPLORE_SAMPLE_FILL = 'off';

const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { signAccessToken } = await import('../services/auth.js');
const { ensureSampleCompany, SAMPLE } = await import('../services/sampleCompany.js');
const { exploreReadOnly, EXPLORE_ALLOWED_WRITES } = await import('../middleware/exploreReadOnly.js');
const { withoutLinkTokens } = await import('../services/mailer.js');
const { resendExplorePass } = await import('../services/explore.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const SENTENCE = 'This is a sample company, so changes are off.';
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function company(): Promise<Ctx> {
  const email = `explore.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Own Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string; accountId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, accountId: claims.accountId };
}
async function operator() {
  const op = await company();
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${op.orgId}/security${p}`).set(at(op)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  process.env.CLOR_OPERATOR_USER_IDS = op.userId;
  const stepUp = (await request(app).post('/api/ops/step-up').set(bearer(op.token)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
  return { ...bearer(op.token), 'x-step-up': stepUp };
}

const demo = (over: Record<string, unknown> = {}) => ({
  name: 'Kiran Desai',
  company: `Desai Traders ${rnd()}`,
  email: `kiran.${Date.now()}.${rnd()}@desaitraders.in`,
  phone: '98220 12345',
  city: 'Pune',
  companySize: '11-20',
  users: 2,
  apps: ['payroll', 'books'],
  ...over,
});
/** A demo request, and the token from the link its thank-you answers with. */
async function asked(over: Record<string, unknown> = {}) {
  const body = demo(over);
  const r = await request(app).post('/api/public/demo-requests').send(body).expect(201);
  const url = new URL(r.body.explore.url);
  const row = await platformPrisma.demoRequest.findFirstOrThrow({ where: { email: body.email } });
  return { body, url, token: String(url.searchParams.get('t')), request: row };
}
/** The token traded for a session: the access token and the refresh cookie. */
async function opened(token: string) {
  const r = await request(app).post('/api/explore/exchange').send({ token }).expect(200);
  const cookie = String((r.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('neev_rt=')) || '').split(';')[0];
  return { access: r.body.token as string, orgId: r.body.activeOrgId as string, cookie, body: r.body };
}

let sample: Awaited<ReturnType<typeof ensureSampleCompany>>;
let visit: Awaited<ReturnType<typeof opened>>;
const as = (token = visit.access) => ({ ...bearer(token), 'x-org-id': sample.orgId, 'x-branch-id': sample.branchId });

beforeAll(async () => {
  const a = await asked();
  visit = await opened(a.token);
  sample = await ensureSampleCompany({ fill: false });
}, 120_000);

describe('the pass', () => {
  it('is mailed with the demo request, for 14 days, opening the app they asked for; the sent mail keeps no token', async () => {
    const { body, url, token, request: row } = await asked({ apps: ['people', 'payroll'] });
    expect(url.pathname).toBe('/explore');
    expect(url.searchParams.get('app')).toBe('people');
    expect(token.length).toBeGreaterThanOrEqual(40);
    const pass = await platformPrisma.explorePass.findFirstOrThrow({ where: { demoRequestId: row.id } });
    expect(pass.email).toBe(body.email);
    expect(pass.tokenHash).not.toContain(token);
    expect(Math.round((pass.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(14);
    expect(pass.sentAt).toBeTruthy();
    const mail = await platformPrisma.emailOutbox.findFirstOrThrow({ where: { templateKey: 'explore.pass', relatedId: pass.id } });
    expect(mail.toEmail).toBe(body.email);
    expect(mail.bodyText).toContain('Sample Traders Pvt Ltd');
    expect(mail.bodyText).toContain('People, Payroll');
    if (mail.status === 'SENT') expect(mail.bodyText).not.toContain(token);
    expect(withoutLinkTokens(`https://app.clor.in/explore?t=${token}&app=people`)).toBe('https://app.clor.in/explore?t=[removed-after-sending]&app=people');
  });

  it('opens a session as the sample company viewer, which /auth/me marks as Explore and shows nothing else', async () => {
    const claims = jwt.decode(visit.access) as any;
    expect(claims.xp).toBeTruthy();
    expect(claims.userId).toBe(sample.viewerUserId);
    expect(visit.cookie).toMatch(/^neev_rt=.{20,}/);
    expect(visit.orgId).toBe(sample.orgId);
    const me = (await request(app).get('/api/auth/me').set(as()).expect(200)).body;
    expect(me.explore).toMatchObject({ daysLeft: 14, app: 'payroll', state: 'active' });
    expect(me.orgs.map((o: any) => o.org.name)).toEqual([SAMPLE.company]);
    expect(me.accounts.map((a: any) => a.id)).toEqual([sample.accountId]);
    expect(me.accountRole).toBe('MEMBER');
  });

  it('answers the same for a link that is unknown, has run out or was ended', async () => {
    for (const token of ['', 'short', 'x'.repeat(43)]) {
      const r = await request(app).post('/api/explore/exchange').send({ token }).expect(410);
      expect(r.body).toEqual({ error: 'This link has ended.', code: 'EXPLORE_ENDED' });
    }
    const late = await asked();
    await platformPrisma.explorePass.updateMany({ where: { demoRequestId: late.request.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/api/explore/exchange').send({ token: late.token }).expect(410)).body.code).toBe('EXPLORE_ENDED');
  });

  it('counts each use', async () => {
    const a = await asked();
    await opened(a.token);
    await opened(a.token);
    const pass = await platformPrisma.explorePass.findFirstOrThrow({ where: { demoRequestId: a.request.id } });
    expect(pass.useCount).toBe(2);
    expect(pass.lastUsedAt).toBeTruthy();
  });
});

describe('read-only, on the server', () => {
  it('reads the sample company', async () => {
    await request(app).get(`/api/orgs/${sample.orgId}/customers`).set(as()).expect(200);
    await request(app).get(`/api/orgs/${sample.orgId}/features`).set(as()).expect(200);
  });

  it('refuses a write with the one sentence, and a normal user makes the same write', async () => {
    const r = await request(app).post(`/api/orgs/${sample.orgId}/customers`).set(as()).send({ name: 'Should not exist' }).expect(403);
    expect(r.body).toEqual({ error: SENTENCE, code: 'EXPLORE_READ_ONLY' });
    const mine = await company();
    await request(app).post(`/api/orgs/${mine.orgId}/customers`).set(at(mine)).send({ name: `Real customer ${rnd()}` }).expect(201);
  });

  it('refuses every write on every mounted route (the route manifest), and lets only refresh and sign-out through', async () => {
    const script = join(resolve(__dirname, '..', '..', '..'), 'tenant-platform-upgrade-2026-10-23', 'scripts', 'inventory-routes.mjs');
    const { buildManifest } = (await import(pathToFileURL(script).href)) as { buildManifest: (o: { serverDir: string }) => { routes: Array<{ method: string; path: string }> } };
    const routes = buildManifest({ serverDir: resolve(__dirname, '..', '..') }).routes;
    /* A route on every method (ALL: the reader and push doors) is tried as a POST. */
    const writes = routes.filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)).map((r) => ({ ...r, method: r.method === 'ALL' ? 'POST' : r.method }));
    expect(writes.length).toBeGreaterThan(500);
    const fill = (p: string) => p.replace(/:orgId/g, sample.orgId).replace(/:[A-Za-z_]+\??/g, 'x1').replace(/\*/g, 'x1');
    const allowed = (m: string, p: string) => EXPLORE_ALLOWED_WRITES.some(([am, re]) => am === m && re.test(p));
    const leaks: string[] = [];
    for (const r of writes) {
      const path = fill(r.path);
      if (allowed(r.method, path)) continue;
      const res = await (request(app) as any)[r.method.toLowerCase()](path).set(as()).send({});
      if (res.status !== 403 || res.body?.code !== 'EXPLORE_READ_ONLY') leaks.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);

    /* For anybody else the guard is not there: every one of the same routes goes on to its router. */
    const normal = signAccessToken({ userId: 'someone-else', accountId: 'their-account' });
    const blocked: string[] = [];
    for (const r of routes) {
      let passed = false;
      const req: any = { method: r.method === 'ALL' ? 'POST' : r.method, path: fill(r.path), headers: { authorization: `Bearer ${normal}` } };
      const res: any = { status: () => res, json: () => res };
      await exploreReadOnly(req, res, () => {
        passed = true;
      });
      if (!passed) blocked.push(`${r.method} ${r.path}`);
    }
    expect(blocked).toEqual([]);
  }, 300_000);

  it('closes the operator console, the employee portal, exports and the device list even to reads', async () => {
    for (const p of ['/api/ops/me', '/api/ops/demo-requests', '/api/portal/me', '/api/auth/me/export', '/api/auth/sessions', `/api/orgs/${sample.orgId}/export`, '/v1/employees']) {
      const r = await request(app).get(p).set(as());
      expect([p, r.status, r.body?.code]).toEqual([p, 403, 'EXPLORE_READ_ONLY']);
    }
  });

  it('refuses the viewer even with a token that does not say Explore', async () => {
    const plain = signAccessToken({ userId: sample.viewerUserId, accountId: sample.accountId });
    const r = await request(app).post(`/api/orgs/${sample.orgId}/customers`).set(as(plain)).send({ name: 'Nope' }).expect(403);
    expect(r.body.code).toBe('EXPLORE_READ_ONLY');
  });

  it('does not open another company', async () => {
    const other = await company();
    const r = await request(app).get(`/api/orgs/${other.orgId}/customers`).set({ ...bearer(visit.access), 'x-org-id': other.orgId, 'x-branch-id': other.branchId });
    expect([403, 404]).toContain(r.status);
  });

  it('keeps Explore through a refresh, and signs out', async () => {
    const v = await opened((await asked()).token);
    const r = await request(app).post('/api/auth/refresh').set('Cookie', v.cookie).expect(200);
    expect((jwt.decode(r.body.token) as any).xp).toBe((jwt.decode(v.access) as any).xp);
    expect((await request(app).post(`/api/orgs/${sample.orgId}/items`).set(as(r.body.token)).send({ name: 'x' }).expect(403)).body.code).toBe('EXPLORE_READ_ONLY');
    const next = String((r.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('neev_rt=')) || '').split(';')[0];
    await request(app).post('/api/auth/logout').set(as(r.body.token)).set('Cookie', next).expect(200);
    await request(app).post('/api/auth/refresh').set('Cookie', next).expect(401);
  });
});

describe('the operator console', () => {
  it('shows the pass, ends access (link and sessions), and resends a new link that opens it again', async () => {
    const h = await operator();
    const a = await asked();
    const v = await opened(a.token);
    const detail = (await request(app).get(`/api/ops/demo-requests/${a.request.id}`).set(h).expect(200)).body;
    expect(detail.explore).toMatchObject({ email: a.body.email, state: 'active', useCount: 1, sendCount: 1, app: 'payroll' });

    /* Step-up and a role: a plain operator token is not enough. */
    await request(app).post(`/api/ops/demo-requests/${a.request.id}/explore/end`).set({ Authorization: h.Authorization }).expect(403);
    const ended = (await request(app).post(`/api/ops/demo-requests/${a.request.id}/explore/end`).set(h).expect(200)).body;
    expect(ended.explore.state).toBe('ended');
    expect(ended.sessionsEnded).toBe(1);
    expect((await request(app).post('/api/explore/exchange').send({ token: a.token }).expect(410)).body.code).toBe('EXPLORE_ENDED');
    expect((await request(app).get('/api/auth/me').set(as(v.access)).expect(401)).body.code).toBe('session_ended');
    await request(app).post('/api/auth/refresh').set('Cookie', v.cookie).expect(401);

    const resent = (await request(app).post(`/api/ops/demo-requests/${a.request.id}/explore/resend`).set(h).expect(200)).body;
    expect(resent.explore).toMatchObject({ state: 'active', sendCount: 2 });
    const mails = await platformPrisma.emailOutbox.findMany({ where: { templateKey: 'explore.pass', toEmail: a.body.email }, orderBy: { createdAt: 'asc' } });
    expect(mails).toHaveLength(2);
    /* The old link stays ended; a new one opens it again. */
    expect((await request(app).post('/api/explore/exchange').send({ token: a.token }).expect(410)).body.code).toBe('EXPLORE_ENDED');
    const again = await resendExplorePass(resent.explore.id, a.body.name, a.body.apps as string[]);
    await opened(String(new URL(again!.url).searchParams.get('t')));

    const audit = await platformPrisma.operatorAuditEvent.findMany({ where: { detail: { path: ['demoRequestId'], equals: a.request.id } }, orderBy: { at: 'asc' } });
    expect(audit.map((e) => e.action)).toEqual(['EXPLORE_ENDED', 'EXPLORE_RESENT']);
  });

  it('is for operators only', async () => {
    const a = await asked();
    const owner = await company();
    expect((await request(app).post(`/api/ops/demo-requests/${a.request.id}/explore/end`).set(bearer(owner.token)).expect(403)).body.code).toBe('OPERATOR_ONLY');
  });
});
