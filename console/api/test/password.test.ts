import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { checkPassword, hashPassword } from '../src/password.js';
import { codeAt, stepNow } from '../src/totp.js';
import { OWNER_SETUP_CODE, WEB, world } from './helpers.js';

const OWNER = 'owner@clor.in';
const GOOD = 'a long enough password';

/** A fresh browser that posts as the Console page does. */
function browser(w: Awaited<ReturnType<typeof world>>) {
  const agent = request.agent(w.app);
  return { agent, post: (path: string, body: object = {}) => w.post(agent, path, body) };
}

describe('signing in with an email address and password', () => {
  // protects=the first owner, named in the service's settings, chooses a password with the service's setup code, once; fails_when=a wrong code works, a short password is taken, or the code works again after a password is set; no_claim=how the setup code reaches the owner is SETUP.md's
  it('lets the first owner choose a password with the setup code, once', async () => {
    const w = await world();
    const b = browser(w);
    expect((await b.post('/auth/password/setup', { email: OWNER, code: 'WRONG-CODE-WRONG-CODE', password: GOOD })).status).toBe(401);
    expect((await b.post('/auth/password/setup', { email: OWNER, code: OWNER_SETUP_CODE, password: 'short' })).status).toBe(400);
    expect((await b.post('/auth/password/setup', { email: 'someone@else.in', code: OWNER_SETUP_CODE, password: GOOD })).status).toBe(401);
    expect(await w.store.findByEmail(OWNER)).toBeNull();

    expect((await b.post('/auth/password/setup', { email: 'Owner@CLOR.in', code: OWNER_SETUP_CODE, password: GOOD })).status).toBe(200);
    const m = (await w.store.findByEmail(OWNER))!;
    expect(m).toMatchObject({ role: 'OWNER', email: OWNER });
    expect(m.passwordHash).toMatch(/^scrypt\$/);
    expect(m.passwordHash).not.toContain(GOOD);
    expect((await b.agent.get('/api/me')).body).toMatchObject({ via: 'password', role: 'OWNER', authenticator: false });
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'PASSWORD_SET', detail: { firstOwner: true } });

    /* The same code cannot replace the password afterwards. */
    expect((await browser(w).post('/auth/password/setup', { email: OWNER, code: OWNER_SETUP_CODE, password: 'another long password' })).status).toBe(401);
    expect(await checkPassword(GOOD, (await w.store.findByEmail(OWNER))!.passwordHash)).toBe(true);
  });

  // protects=a password gets a session that reads nothing until the Console's authenticator code is entered; fails_when=a password alone reads the platform; no_claim=none beyond protects
  it('reads nothing on a password alone', async () => {
    const w = await world();
    const first = browser(w);
    await first.post('/auth/password/setup', { email: OWNER, code: OWNER_SETUP_CODE, password: GOOD });
    const { code } = await w.enrol(first.agent);

    const b = browser(w);
    expect((await b.post('/auth/password', { email: OWNER, password: GOOD })).status).toBe(200);
    expect((await b.agent.get('/api/me')).body).toMatchObject({ needsCode: true });
    for (const path of ['/overview', '/releases', '/pulls', '/audit', '/members']) expect((await b.agent.get(`/api${path}`)).body.code, path).toBe('SIGN_IN_CODE');
    expect((await b.post('/step-up', { code: code() })).status).toBe(200);
    expect((await b.agent.get('/api/overview')).status).toBe(200);
  });

  // protects=a wrong password and an unknown address get the same answer, and five wrong tries lock the address for fifteen minutes, even for the right password; fails_when=the answers differ, or guessing can go on; no_claim=the count is kept in memory, per instance
  it('gives nothing away and locks after five wrong tries', async () => {
    const w = await world();
    await browser(w).post('/auth/password/setup', { email: OWNER, code: OWNER_SETUP_CODE, password: GOOD });
    const b = browser(w);
    const wrong = await b.post('/auth/password', { email: OWNER, password: 'not the password' });
    const unknown = await b.post('/auth/password', { email: 'nobody@clor.in', password: 'not the password' });
    expect([wrong.status, wrong.body]).toEqual([unknown.status, unknown.body]);
    expect(wrong.status).toBe(401);
    for (let i = 0; i < 4; i += 1) await b.post('/auth/password', { email: OWNER, password: 'not the password' });
    expect((await b.post('/auth/password', { email: OWNER, password: GOOD })).status).toBe(429);
    w.clock.at += 16 * 60_000;
    expect((await b.post('/auth/password', { email: OWNER, password: GOOD })).status).toBe(200);
  });

  // protects=a password sign-in must come from the Console page; fails_when=a post from another origin is answered; no_claim=none beyond protects
  it('refuses a password posted from elsewhere', async () => {
    const w = await world();
    const r = await request(w.app).post('/api/auth/password').set('Origin', 'https://app.clor.in').set('X-Console', '1').send({ email: OWNER, password: GOOD });
    expect(r.status).toBe(403);
  });

  // protects=an owner adds a member by address and is shown a one-time setup code once; the member chooses a password with it within three days; a reset ends the old password at once; fails_when=the code is stored or shown again, works twice or late, or the old password survives a reset; no_claim=none beyond protects
  it('adds a member by address, with a one-time code, and resets a password', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    const added = await w.post(owner.agent, '/members', { email: 'Dev@Clor.in', role: 'ENGINEER', reason: 'New joiner' });
    expect(added.status).toBe(201);
    const code = added.body.setupCode as string;
    expect(code).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
    expect(added.body.member).toMatchObject({ email: 'dev@clor.in', passwordSet: false, setupWaiting: true });
    const row = (await w.store.findByEmail('dev@clor.in'))!;
    expect(JSON.stringify(row)).not.toContain(code);
    expect(JSON.stringify((await owner.agent.get('/api/members')).body)).not.toContain(code);
    expect((await w.post(owner.agent, '/members', { email: 'dev@clor.in', role: 'VIEWER', reason: 'Again' })).status).toBe(409);

    const dev = browser(w);
    expect((await dev.post('/auth/password/setup', { email: 'dev@clor.in', code, password: GOOD })).status).toBe(200);
    expect((await browser(w).post('/auth/password/setup', { email: 'dev@clor.in', code, password: 'second long password' })).status).toBe(401);
    expect((await dev.agent.get('/api/me')).body).toMatchObject({ role: 'ENGINEER', via: 'password' });

    await w.post(owner.agent, '/step-up', { code: owner.code() });
    const reset = await w.patch(owner.agent, `/members/${row.id}`, { resetPassword: true, reason: 'Forgot it' });
    expect(reset.status).toBe(200);
    expect(reset.body.setupCode).not.toBe(code);
    expect((await browser(w).post('/auth/password', { email: 'dev@clor.in', password: GOOD })).status).toBe(401);

    /* A code runs out after three days. */
    w.clock.at += 3 * 86_400_000 + 1000;
    expect((await browser(w).post('/auth/password/setup', { email: 'dev@clor.in', code: reset.body.setupCode, password: GOOD })).status).toBe(401);
  });

  // protects=stored passwords are salted scrypt hashes: the same password hashes differently each time and only the right one checks; fails_when=two hashes match or a wrong password checks; no_claim=none beyond protects
  it('stores salted hashes', async () => {
    const [a, b] = await Promise.all([hashPassword(GOOD), hashPassword(GOOD)]);
    expect(a).not.toBe(b);
    expect(await checkPassword(GOOD, a)).toBe(true);
    expect(await checkPassword(`${GOOD}x`, a)).toBe(false);
    expect(await checkPassword(GOOD, null)).toBe(false);
    expect(await checkPassword(GOOD, 'plain$text')).toBe(false);
  });
});

describe('with GitHub not connected', () => {
  // protects=the Console works without GitHub: password sign-in, the cloud rows and the log all work, GitHub rows say "Not connected" rather than failing, and GitHub actions are refused plainly; fails_when=it will not start a session, shows a GitHub row as broken, or lets a GitHub action through; no_claim=Cloudflare and Google Cloud are canned
  it('still signs in, reads the cloud, and says GitHub is not connected', async () => {
    const w = await world({ github: false });
    expect((await request(w.app).get('/api/auth/options')).body).toEqual({ github: false, clor: true, password: true });
    expect((await request(w.app).get('/api/auth/github')).headers.location).toBe(`${WEB}/?signin=github-off`);

    const b = browser(w);
    await b.post('/auth/password/setup', { email: OWNER, code: OWNER_SETUP_CODE, password: GOOD });
    const setup = await b.post('/two-factor/setup');
    w.clock.at += 31_000;
    await b.post('/two-factor/enable', { code: codeAt(setup.body.secret, stepNow(w.clock.at)) }).expect(200);

    const rows = (await b.agent.get('/api/overview')).body.rows as Array<{ key: string; state: string; tone: string }>;
    const state = (key: string) => rows.find((r) => r.key === key)!.state;
    expect([state('api'), state('backup'), state('web')]).toEqual(['Working', 'Backed up', 'Published']);
    for (const key of ['tests', 'security', 'waiting', 'pulls']) expect(rows.find((r) => r.key === key), key).toMatchObject({ state: 'Not connected', tone: 'none' });

    expect((await b.agent.get('/api/pulls')).body).toMatchObject({ github: false, pulls: [] });
    expect((await b.agent.get('/api/releases')).body).toMatchObject({ github: false, next: 'UNKNOWN' });
    for (const [path, body] of [['/releases/stage', {}], ['/releases/rollback', { revision: 'clor-api-00127-622', reason: 'Errors' }], ['/pulls/301/merge', {}]] as const) {
      const r = await b.post(path, body);
      expect([r.status, r.body.code], path).toEqual([409, 'GITHUB_OFF']);
    }
    expect((await b.post('/members', { githubLogin: 'dev-engineer', role: 'VIEWER', reason: 'Trying' })).status).toBe(409);
    expect((await b.post('/members', { email: 'dev@clor.in', role: 'VIEWER', reason: 'New joiner' })).status).toBe(201);
    expect((await b.agent.get('/api/audit')).status).toBe(200);
  });

  // protects=with password sign-in not set up, its routes do nothing; fails_when=a password or setup is accepted while it is off; no_claim=none beyond protects
  it('has no password sign-in unless it is set up', async () => {
    const w = await world({ password: false });
    const b = browser(w);
    expect((await request(w.app).get('/api/auth/options')).body.password).toBe(false);
    expect((await b.post('/auth/password/setup', { email: OWNER, code: OWNER_SETUP_CODE, password: GOOD })).status).toBe(400);
    expect((await b.post('/auth/password', { email: OWNER, password: GOOD })).status).toBe(400);
  });
});
