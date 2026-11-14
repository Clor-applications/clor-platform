import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

import request from 'supertest';

import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { fakeCloud, fakeGitHub } from '../src/fakes.js';
import { memoryStore, type Role } from '../src/store.js';
import { codeAt, stepNow } from '../src/totp.js';

export const WEB = 'https://console.clor.in';
const LOGIN: Record<Role, string> = { OWNER: 'suresh-3333', ENGINEER: 'dev-engineer', VIEWER: 'dev-viewer' };

/** A Console with a memory store, canned GitHub and cloud, and a clock the test moves. */
export async function world(opts: { clor?: boolean } = {}) {
  const clock = { at: Date.parse('2026-11-14T10:00:00Z') };
  const now = () => clock.at;
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const config = readConfig({ NODE_ENV: 'test', CONSOLE_WEB_ORIGIN: WEB, CONSOLE_SESSION_SECRET: 'a-test-secret-that-is-long-enough-000', CONSOLE_OWNER_GITHUB_IDS: '1001', CONSOLE_CLOR_GRANT_PUBLIC_KEY: opts.clor === false ? '' : keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() });
  const store = memoryStore(now);
  const github = fakeGitHub();
  const cloud = fakeCloud();
  const engineer = await store.createMember({ name: 'dev-engineer', role: 'ENGINEER', githubUserId: '1002', githubLogin: 'dev-engineer', clorUserId: null, clorEmail: null, addedBy: null });
  const viewer = await store.createMember({ name: 'dev-viewer', role: 'VIEWER', githubUserId: '1003', githubLogin: 'dev-viewer', clorUserId: null, clorEmail: null, addedBy: null });
  const app = createApp({ config, store, github, cloud, now });

  /** Signs in through the real GitHub round trip (canned GitHub answers). */
  async function signIn(login: string) {
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/github');
    const state = new URL(start.headers.location).searchParams.get('state');
    const back = await agent.get(`/api/auth/callback?code=${login}&state=${state}`);
    return { agent, landed: back.headers.location as string };
  }
  const post = (agent: ReturnType<typeof request.agent>, path: string, body: object = {}) => agent.post(`/api${path}`).set('Origin', WEB).set('X-Console', '1').send(body);
  const patch = (agent: ReturnType<typeof request.agent>, path: string, body: object = {}) => agent.patch(`/api${path}`).set('Origin', WEB).set('X-Console', '1').send(body);

  /** A signed-in member with an authenticator, stepped up just now. `code()` gives the next unused code. */
  async function as(role: Role) {
    const { agent } = await signIn(LOGIN[role]);
    return enrol(agent);
  }
  /** Sets up an authenticator on a signed-in session; leaves it stepped up. */
  async function enrol(agent: ReturnType<typeof request.agent>) {
    const setup = await post(agent, '/two-factor/setup');
    const secret = setup.body.secret as string;
    const code = () => {
      clock.at += 31_000;
      return codeAt(secret, stepNow(clock.at));
    };
    await post(agent, '/two-factor/enable', { code: code() }).expect(200);
    return { agent, code, secret };
  }


  /** A CLOR sign-in pass as the customer API would make it; `over` bends one claim, `key` signs with another key. */
  function pass(state: string, who: { id: string; email: string; name?: string }, over: Record<string, unknown> = {}, key = keys.privateKey, alg = 'ES256') {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const iat = Math.floor(clock.at / 1000);
    const head = `${b64({ alg, typ: 'JWT' })}.${b64({ iss: 'clor-api', aud: 'clor-console', sub: who.id, email: who.email, name: who.name || who.email, state, jti: randomUUID(), iat, exp: iat + 60, ...over })}`;
    return `${head}.${createSign('SHA256').update(head).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  /** Starts a CLOR sign-in (or, with an agent that is signed in, a link) and returns the state the browser was given. */
  async function startClor(agent = request.agent(app), link = false) {
    const start = await agent.get(`/api/auth/clor${link ? '?link=1' : ''}`);
    const to = new URL(start.headers.location);
    return { agent, state: to.searchParams.get('console_grant') || '', sentTo: `${to.origin}${to.pathname}`, landed: start.headers.location as string };
  }
  const finishClor = async (agent: ReturnType<typeof request.agent>, grant: string, state: string) => (await agent.get(`/api/auth/clor/callback?grant=${grant}&state=${state}`)).headers.location as string;

  return { app, clock, store, github, cloud, config, signIn, as, enrol, post, patch, pass, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), startClor, finishClor, ids: { engineer: engineer.id, viewer: viewer.id } };
}
