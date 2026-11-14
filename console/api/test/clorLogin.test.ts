import { createHmac, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import request from 'supertest';

import { OWNER_SETUP_CODE, WEB, world } from './helpers.js';

const OWNER = { id: 'clor-user-owner', email: 'owner@clor.in', name: 'Owner' };

/** A world where an owner has added owner@clor.in as a Viewer by address. */
async function withInvite(role: 'VIEWER' | 'ENGINEER' | 'OWNER' = 'VIEWER') {
  const w = await world();
  const invited = await w.store.createMember({ name: OWNER.email, role, githubUserId: null, githubLogin: null, clorUserId: null, clorEmail: OWNER.email, addedBy: null });
  /** Signs in with CLOR as far as the callback; the session has not entered a code yet. */
  async function clorSignIn(who = OWNER) {
    const { agent, state } = await w.startClor();
    const landed = await w.finishClor(agent, w.pass(state, who), state);
    return { agent, landed };
  }
  return { ...w, invited, clorSignIn };
}

describe('signing in with a CLOR login', () => {
  // protects=the browser is sent to the operator console with a fresh attempt id, and a good pass for a member added by address signs them in and binds their CLOR user id; fails_when=it goes elsewhere, the session is not made, or the id is not bound; no_claim=the customer API issuing the pass is tested in server/, not here
  it('signs in a member added by address and binds their CLOR id', async () => {
    const w = await withInvite();
    const start = await w.startClor();
    expect(start.sentTo).toBe('https://ops.clor.in/');
    expect(start.state).toMatch(/^[0-9a-f]{32}$/);
    expect(await w.finishClor(start.agent, w.pass(start.state, OWNER), start.state)).toBe(`${WEB}/`);
    expect((await start.agent.get('/api/me')).body).toMatchObject({ via: 'clor', role: 'VIEWER', authenticator: false, github: { connected: false, linked: false }, clor: { linked: true } });
    expect((await w.store.getMember(w.invited.id))!.clorUserId).toBe(OWNER.id);
  });

  // protects=once bound, the id decides, not the address: another CLOR account that later holds the same address does not get in, and the member still does after their address changes; fails_when=the second account is signed in; no_claim=none beyond protects
  it('goes by the CLOR user id once bound, not the address', async () => {
    const w = await withInvite();
    expect((await w.clorSignIn()).landed).toBe(`${WEB}/`);
    expect((await w.clorSignIn({ id: 'someone-else', email: OWNER.email, name: 'Impostor' })).landed).toBe(`${WEB}/?signin=not-a-member`);
    expect((await w.clorSignIn({ ...OWNER, email: 'renamed@clor.in' })).landed).toBe(`${WEB}/`);
  });

  // protects=a CLOR staff member who is not a Console member gets no session; fails_when=they land inside or /me answers; no_claim=none beyond protects
  it('turns away CLOR staff who are not members', async () => {
    const w = await withInvite();
    const { agent, landed } = await w.clorSignIn({ id: 'stranger', email: 'stranger@clor.in', name: 'Stranger' });
    expect(landed).toBe(`${WEB}/?signin=not-a-member`);
    expect((await agent.get('/api/me')).status).toBe(401);
  });

  // protects=only a pass signed by the customer API's key, for this Console, for this attempt, still in date, and not used before, is accepted; fails_when=any forged, bent or replayed pass makes a session; no_claim=the key pair is made in the test; production key handling is SETUP.md's
  it('refuses a forged, bent or replayed pass', async () => {
    const w = await withInvite();
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const claims = (state: string) => ({ iss: 'clor-api', aud: 'clor-console', sub: OWNER.id, email: OWNER.email, state, jti: 'x', iat: Math.floor(w.clock.at / 1000), exp: Math.floor(w.clock.at / 1000) + 60 });
    const bad: Array<[string, (state: string) => string]> = [
      ['another key', (s) => w.pass(s, OWNER, {}, other)],
      ['no signature, alg none', (s) => `${b64({ alg: 'none' })}.${b64(claims(s))}.`],
      ['HMAC under the public key', (s) => { const h = `${b64({ alg: 'HS256' })}.${b64(claims(s))}`; return `${h}.${createHmac('sha256', w.publicKeyPem).update(h).digest('base64url')}`; }],
      ['another audience', (s) => w.pass(s, OWNER, { aud: 'accounting-web' })],
      ['another issuer', (s) => w.pass(s, OWNER, { iss: 'someone' })],
      ['another attempt', (s) => w.pass(`${s}x`, OWNER)],
      ['out of date', (s) => w.pass(s, OWNER, { exp: Math.floor(w.clock.at / 1000) - 1 })],
      ['good for a day', (s) => w.pass(s, OWNER, { exp: Math.floor(w.clock.at / 1000) + 86400 })],
      ['no person', (s) => w.pass(s, OWNER, { sub: '' })],
      ['not a pass', () => 'garbage'],
    ];
    for (const [what, make] of bad) {
      const { agent, state } = await w.startClor();
      expect(await w.finishClor(agent, make(state), state), what).toBe(`${WEB}/?signin=failed`);
      expect((await agent.get('/api/me')).status, what).toBe(401);
    }
  });

  // protects=a pass is accepted once even for the attempt it was made for; fails_when=the same pass and the same attempt cookie sign in a second time; no_claim=the used list is in memory, per instance
  it('accepts a pass only once', async () => {
    const w = await withInvite();
    const replay = await w.startClor();
    const grant2 = w.pass(replay.state, OWNER, { jti: 'fixed-jti' });
    expect(await w.finishClor(replay.agent, grant2, replay.state)).toBe(`${WEB}/`);
    const replay2 = await w.startClor();
    const grant3 = w.pass(replay2.state, OWNER, { jti: 'fixed-jti' });
    expect(await w.finishClor(replay2.agent, grant3, replay2.state)).toBe(`${WEB}/?signin=failed`);
  });

  // protects=a CLOR session reads nothing until the Console's own authenticator code is entered, so the customer API alone cannot open the Console; fails_when=any platform read answers before the code; no_claim=none beyond protects
  it('reads nothing until the Console authenticator code is entered', async () => {
    const w = await withInvite();
    const first = await w.clorSignIn();
    const { code } = await w.enrol(first.agent);
    /* A new CLOR sign-in for the same, now enrolled, member. */
    const { agent } = await w.clorSignIn();
    expect((await agent.get('/api/me')).body).toMatchObject({ needsCode: true, authenticator: true });
    for (const path of ['/overview', '/releases', '/pulls', '/audit']) {
      const r = await agent.get(`/api${path}`);
      expect(r.status, path).toBe(401);
      expect(r.body.code).toBe('SIGN_IN_CODE');
      expect(r.body.rows || r.body.pulls || r.body.events).toBeUndefined();
    }
    expect((await w.post(agent, '/step-up', { code: code() })).status).toBe(200);
    expect((await agent.get('/api/overview')).status).toBe(200);
    expect((await agent.get('/api/me')).body.needsCode).toBe(false);
  });

  // protects=a CLOR session changes nothing on GitHub until the person connects their own GitHub account; fails_when=a release, rollback or merge goes out without a GitHub token; no_claim=none beyond protects
  it('cannot change anything on GitHub before GitHub is connected', async () => {
    const w = await withInvite('OWNER');
    const { agent } = await w.clorSignIn();
    await w.enrol(agent);
    for (const [path, body] of [['/releases/tests', {}], ['/releases/stage', {}], ['/releases/go', { reason: 'Weekly release' }], ['/releases/rollback', { revision: 'clor-api-00127-622', reason: 'Errors' }], ['/pulls/301/merge', {}], ['/pulls/301/close', { reason: 'Superseded' }]] as const) {
      const r = await w.post(agent, path, body);
      expect(r.status, path).toBe(401);
      expect(r.body.code).toBe('CONNECT_GITHUB');
    }
    expect(w.github.calls).toEqual([]);
  });

  // protects=connecting GitHub needs a fresh code, links the account to the member the first time, is logged, and then lets them act; fails_when=it links without a code, or the change still fails after; no_claim=GitHub's own sign-in is canned
  it('connects GitHub, links it once, and then can act', async () => {
    const w = await withInvite('OWNER');
    w.github.state.users['owner-gh'] = '5001';
    const { agent } = await w.clorSignIn();
    const { code } = await w.enrol(agent);

    w.clock.at += 6 * 60_000;
    expect((await agent.get('/api/auth/github?connect=1')).headers.location).toBe(`${WEB}/?signin=code-first`);
    await w.post(agent, '/step-up', { code: code() });
    const start = await agent.get('/api/auth/github?connect=1');
    const state = new URL(start.headers.location).searchParams.get('state');
    expect((await agent.get(`/api/auth/callback?code=owner-gh&state=${state}`)).headers.location).toBe(`${WEB}/`);

    expect((await w.store.getMember(w.invited.id))!.githubUserId).toBe('5001');
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'GITHUB_LINKED', target: 'owner-gh', memberId: w.invited.id });
    expect((await agent.get('/api/me')).body).toMatchObject({ via: 'clor', github: { connected: true, linked: true, login: 'owner-gh' } });
    expect((await w.post(agent, '/releases/stage')).status).toBe(202);
    expect(w.github.calls).toHaveLength(1);
  });

  // protects=a member can connect only their own linked GitHub account, and never one that belongs to another member; fails_when=another account's token lands in the session or a second member takes a linked account; no_claim=none beyond protects
  it('refuses to connect a GitHub account that is not theirs', async () => {
    const w = await withInvite('OWNER');
    w.github.state.users['owner-gh'] = '5001';
    w.github.state.users['other-gh'] = '5002';
    await w.store.updateMember(w.invited.id, { githubUserId: '5001', githubLogin: 'owner-gh' });
    const { agent } = await w.clorSignIn();
    await w.enrol(agent);
    const connect = async (login: string) => {
      const start = await agent.get('/api/auth/github?connect=1');
      const state = new URL(start.headers.location).searchParams.get('state');
      return (await agent.get(`/api/auth/callback?code=${login}&state=${state}`)).headers.location;
    };
    expect(await connect('other-gh')).toBe(`${WEB}/?signin=other-github`);
    expect((await agent.get('/api/me')).body.github.connected).toBe(false);

    /* A member with no GitHub account yet cannot take the engineer's. */
    await w.store.updateMember(w.invited.id, { githubUserId: null, githubLogin: null });
    expect(await connect('dev-engineer')).toBe(`${WEB}/?signin=github-taken`);
    expect((await w.store.getMember(w.invited.id))!.githubUserId).toBeNull();
    expect((await w.post(agent, '/releases/stage')).body.code).toBe('CONNECT_GITHUB');
  });

  // protects=a member signed in with GitHub adds their CLOR login with a fresh code, once, logged; a CLOR login that is another member's is refused; fails_when=it links without a code, or two members share a CLOR login; no_claim=none beyond protects
  it('links a CLOR login to a member signed in with GitHub', async () => {
    const w = await withInvite();
    await w.clorSignIn(); // binds OWNER.id to the invited member
    const eng = await w.as('ENGINEER');

    const taken = await w.startClor(eng.agent, true);
    expect(await w.finishClor(eng.agent, w.pass(taken.state, OWNER), taken.state)).toBe(`${WEB}/?signin=clor-taken`);

    const mine = { id: 'clor-user-eng', email: 'eng@clor.in', name: 'Engineer' };
    const link = await w.startClor(eng.agent, true);
    expect(await w.finishClor(eng.agent, w.pass(link.state, mine), link.state)).toBe(`${WEB}/`);
    expect(await w.store.getMember(w.ids.engineer)).toMatchObject({ clorUserId: mine.id, clorEmail: mine.email, githubUserId: '1002' });
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'CLOR_LOGIN_LINKED', target: mine.email });

    w.clock.at += 6 * 60_000;
    expect((await w.startClor(eng.agent, true)).landed).toBe(`${WEB}/?signin=code-first`);

    /* And now the engineer can come in with CLOR. */
    const { agent, state } = await w.startClor();
    expect(await w.finishClor(agent, w.pass(state, mine), state)).toBe(`${WEB}/`);
    expect((await agent.get('/api/me')).body).toMatchObject({ via: 'clor', role: 'ENGINEER', needsCode: true });
  });

  // protects=an owner adds a member by CLOR login address, by GitHub username, or both, and never by neither or by an address already used; fails_when=an empty or duplicate member is saved; no_claim=whether the address is a real CLOR login is only known at their first sign-in
  it('adds members by CLOR address', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    expect((await w.post(owner.agent, '/members', { role: 'VIEWER', reason: 'New joiner' })).status).toBe(400);
    const added = await w.post(owner.agent, '/members', { clorEmail: 'Finance@Clor.in', role: 'VIEWER', reason: 'Wants to see releases' });
    expect(added.status).toBe(201);
    expect(added.body.member).toMatchObject({ name: 'finance@clor.in', clorEmail: 'finance@clor.in', clorSignedIn: false, githubLogin: null });
    expect((await w.post(owner.agent, '/members', { clorEmail: 'finance@clor.in', role: 'VIEWER', reason: 'Again' })).status).toBe(409);
    expect(JSON.stringify(added.body)).not.toContain('clorUserId');
  });

  // protects=with no public key set, sign-in with CLOR is off everywhere; fails_when=a pass is accepted or a member is added by address while it is off; no_claim=none beyond protects
  it('is off entirely until the public key is set', async () => {
    const w = await world({ clor: false });
    expect((await w.startClor()).landed).toBe(`${WEB}/?signin=clor-off`);
    const agent = (await w.signIn('suresh-3333')).agent;
    expect(await w.finishClor(agent, w.pass('anything', OWNER), 'anything')).toBe(`${WEB}/?signin=failed`);
    const owner = await w.as('OWNER');
    expect((await w.post(owner.agent, '/members', { clorEmail: 'finance@clor.in', role: 'VIEWER', reason: 'Wants to see releases' })).status).toBe(409);
    expect((await owner.agent.get('/api/auth/options')).body).toMatchObject({ github: true, clor: false });
  });

  // protects=a CLOR login named in the service's settings is an owner from its first sign-in, bound to its CLOR user id, and joins the member that address already has by password instead of making a second; another CLOR account is not; fails_when=an unnamed login becomes an owner, two members result, or a later account with the same address gets in; no_claim=the customer API vouching for the address is server/src/__tests__/consoleGrant.test.ts
  it('makes the named CLOR login an owner, once, on the member it already has', async () => {
    const w = await world({ ownerClor: 'Owner@Clor.in' });
    const first = await w.startClor();
    expect(await w.finishClor(first.agent, w.pass(first.state, { id: 'stranger', email: 'stranger@clor.in' }), first.state)).toBe(`${WEB}/?signin=not-a-member`);

    /* The owner already set a password under the same address. */
    const byPassword = request.agent(w.app);
    await w.post(byPassword, '/auth/password/setup', { email: OWNER.email, code: OWNER_SETUP_CODE, password: 'a long enough password' }).expect(200);
    const before = (await w.store.findByEmail(OWNER.email))!;

    const { agent, state } = await w.startClor();
    expect(await w.finishClor(agent, w.pass(state, OWNER), state)).toBe(`${WEB}/`);
    expect((await agent.get('/api/me')).body).toMatchObject({ via: 'clor', role: 'OWNER' });
    const after = (await w.store.findByClor(OWNER.id))!;
    expect(after.id).toBe(before.id);
    expect((await w.store.listMembers()).filter((m) => m.email === OWNER.email || m.clorEmail === OWNER.email)).toHaveLength(1);
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'CLOR_LOGIN_LINKED', detail: { firstOwner: true } });

    const other = await w.startClor();
    expect(await w.finishClor(other.agent, w.pass(other.state, { id: 'someone-else', email: OWNER.email }), other.state)).toBe(`${WEB}/?signin=not-a-member`);
  });
});
