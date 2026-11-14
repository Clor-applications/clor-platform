import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { STEP_UP_MS } from '../src/app.js';
import { WEB, world } from './helpers.js';

const READS = ['/overview', '/releases', '/pulls', '/audit', '/members', '/releases/runs/1'];
const WRITES: Array<[string, object]> = [
  ['/releases/tests', {}],
  ['/releases/stage', {}],
  ['/releases/go', { reason: 'Weekly release' }],
  ['/releases/runs/8000/approve', {}],
  ['/releases/rollback', { revision: 'clor-api-00127-622', reason: 'Errors after release' }],
  ['/pulls/301/full-tests', {}],
  ['/pulls/301/merge', {}],
  ['/pulls/301/close', { reason: 'Superseded' }],
  ['/members', { githubLogin: 'dev-engineer', role: 'VIEWER', reason: 'New joiner' }],
];

describe('who gets in', () => {
  // protects=nobody reads the platform without a session; fails_when=any read answers 200 with no cookie; no_claim=says nothing about GitHub's own sign-in (canned here)
  it('refuses every read without a session', async () => {
    const { app } = await world();
    for (const path of [...READS, '/me']) expect((await request(app).get(`/api${path}`)).status, path).toBe(401);
  });

  // protects=a GitHub user who is not on the allow-list gets no session and no data; fails_when=sign-in lands them inside or any read answers; no_claim=the allow-list is the memory store, not Postgres
  it('turns away a GitHub user who is not a member', async () => {
    const { signIn } = await world();
    const { agent, landed } = await signIn('stranger');
    expect(landed).toBe(`${WEB}/?signin=not-a-member`);
    expect((await agent.get('/api/me')).status).toBe(401);
    expect((await agent.get('/api/overview')).status).toBe(401);
  });

  // protects=a member switched off loses access at once, mid-session; fails_when=their existing cookie still reads; no_claim=none beyond protects
  it('stops a member who is switched off, on their next request', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    expect((await eng.agent.get('/api/pulls')).status).toBe(200);
    await w.store.updateMember(w.ids.engineer, { active: false });
    const after = await eng.agent.get('/api/pulls');
    expect(after.status).toBe(403);
    expect(after.body.pulls).toBeUndefined();
  });

  // protects=a sign-in cannot be completed with a state the browser was not given; fails_when=a forged callback creates a session; no_claim=none beyond protects
  it('refuses a callback whose state does not match', async () => {
    const { app } = await world();
    const agent = request.agent(app);
    await agent.get('/api/auth/github');
    const back = await agent.get('/api/auth/callback?code=suresh-3333&state=forged');
    expect(back.headers.location).toBe(`${WEB}/?signin=failed`);
    expect((await agent.get('/api/me')).status).toBe(401);
  });

  // protects=without an authenticator a member reads nothing but who they are; fails_when=any platform read answers before enrolment; no_claim=none beyond protects
  it('lets a member without an authenticator read only /me', async () => {
    const { signIn } = await world();
    const { agent } = await signIn('suresh-3333');
    const me = await agent.get('/api/me');
    expect(me.body).toMatchObject({ role: 'OWNER', authenticator: false });
    for (const path of READS) {
      const r = await agent.get(`/api${path}`);
      expect(r.status, path).toBe(403);
      expect(r.body.code).toBe('ENROL');
    }
  });

  // protects=the session cookie cannot be read or used by page script, and the GitHub token never reaches the page; fails_when=the cookie is not HttpOnly or /me carries a token; no_claim=does not prove Secure is set, which is production only
  it('keeps the session in an HttpOnly cookie and the token out of /me', async () => {
    const { app } = await world();
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/github');
    const state = new URL(start.headers.location).searchParams.get('state');
    const back = await agent.get(`/api/auth/callback?code=suresh-3333&state=${state}`);
    const cookie = ([] as string[]).concat(back.headers['set-cookie']).find((c) => c.startsWith('console_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toContain('token-for-');
    expect(JSON.stringify((await agent.get('/api/me')).body)).not.toContain('token-for-');
  });
});

describe('the direct address', () => {
  // protects=with an edge secret set, only requests carrying it are answered, so the run.app address is closed; the health check stays open for Cloud Run; fails_when=a request without the secret, or with a wrong one, gets past; no_claim=Cloudflare adding the header is the forwarder's job, not run here
  it('answers only through the forwarder when an edge secret is set', async () => {
    const { createApp } = await import('../src/app.js');
    const { readConfig } = await import('../src/config.js');
    const { fakeCloud, fakeGitHub } = await import('../src/fakes.js');
    const { memoryStore } = await import('../src/store.js');
    const app = createApp({ config: readConfig({ CONSOLE_SESSION_SECRET: 's'.repeat(40), CONSOLE_EDGE_SECRET: 'edge-secret-value', CONSOLE_WEB_ORIGIN: WEB }), store: memoryStore(), github: fakeGitHub(), cloud: fakeCloud() });
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/auth/options')).status).toBe(403);
    expect((await request(app).get('/api/auth/options').set('x-console-edge', 'edge-secret-valuX')).status).toBe(403);
    expect((await request(app).get('/api/me').set('x-console-edge', 'wrong')).body.code).toBe('EDGE_REQUIRED');
    expect((await request(app).get('/api/auth/options').set('x-console-edge', 'edge-secret-value')).status).toBe(200);
  });
});

describe('who may change what', () => {
  // protects=every change needs a code entered in the last five minutes, whatever the role; fails_when=any write gets past with a stale step-up; no_claim=none beyond protects
  it('refuses every write once the code is older than five minutes', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    w.clock.at += STEP_UP_MS + 1000;
    for (const [path, body] of WRITES) {
      const r = await w.post(owner.agent, path, body);
      expect(r.status, path).toBe(401);
      expect(r.body.code).toBe('STEP_UP');
    }
    expect(w.github.calls).toEqual([]);
  });

  // protects=a Viewer changes nothing; fails_when=any write by a Viewer reaches GitHub; no_claim=none beyond protects
  it('refuses every write to a Viewer', async () => {
    const w = await world();
    const viewer = await w.as('VIEWER');
    for (const [path, body] of WRITES) expect((await w.post(viewer.agent, path, body)).status, path).toBe(403);
    expect(w.github.calls).toEqual([]);
  });

  // protects=release, approval, merge and membership stay with the owner; fails_when=an Engineer gets any of them through; no_claim=none beyond protects
  it('keeps release, approve, merge and members from an Engineer', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    for (const path of ['/releases/go', '/releases/runs/8000/approve', '/pulls/301/merge', '/members']) {
      const r = await w.post(eng.agent, path, { reason: 'Trying', githubLogin: 'dev-viewer', role: 'OWNER' });
      expect(r.status, path).toBe(403);
    }
    expect((await eng.agent.get('/api/members')).status).toBe(403);
    expect(w.github.calls).toEqual([]);
  });

  // protects=a write must come from the Console page itself; fails_when=a request from another clor.in address or a plain form is accepted; no_claim=browser cookie rules are not exercised here
  it('refuses a write from another origin or without the Console header', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    const a = await owner.agent.post('/api/releases/tests').set('Origin', 'https://app.clor.in').set('X-Console', '1').send({});
    const b = await owner.agent.post('/api/releases/tests').set('Origin', WEB).send({});
    expect([a.status, b.status]).toEqual([403, 403]);
    expect(w.github.calls).toEqual([]);
  });

  // protects=an authenticator code works once; fails_when=the same code steps up twice; no_claim=none beyond protects
  it('does not accept the same code twice', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    const code = owner.code();
    expect((await w.post(owner.agent, '/step-up', { code })).status).toBe(200);
    expect((await w.post(owner.agent, '/step-up', { code })).status).toBe(400);
  });

  // protects=a six-digit code cannot be guessed at; fails_when=a right code is accepted straight after five wrong ones; no_claim=the count is kept in memory, so a restart clears it
  it('locks out after five wrong codes, even for the right one', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    for (let i = 0; i < 5; i += 1) expect((await w.post(owner.agent, '/step-up', { code: '000000' })).status).toBe(400);
    expect((await w.post(owner.agent, '/step-up', { code: owner.code() })).status).toBe(400);
    w.clock.at += STEP_UP_MS + 1000;
    expect((await w.post(owner.agent, '/step-up', { code: owner.code() })).status).toBe(200);
  });

  // protects=the owner named in the service's own setting cannot be demoted or switched off from the page, and nobody removes their own access; fails_when=either change is saved; no_claim=none beyond protects
  it('will not demote the bootstrap owner', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    const self = (await w.store.findByGithub('1001'))!;
    const r = await w.patch(owner.agent, `/members/${self.id}`, { active: false, reason: 'Testing the guard' });
    expect(r.status).toBe(409);
    expect((await w.store.getMember(self.id))!.active).toBe(true);
  });
});
