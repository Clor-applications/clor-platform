import { randomBytes, timingSafeEqual } from 'node:crypto';

import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import QRCode from 'qrcode';
import { z } from 'zod';

import type { Cloud } from './cloud.js';
import { cloudflareOn, githubOn, passwordOn, type Config } from './config.js';
import { GitHubError, type GitHub, type Run } from './github.js';
import { verifyGrant, type Grant } from './grant.js';
import { blocksConsoleMerge, marksFor, writtenBy } from './marks.js';
import { checkPassword, hashPassword, hashSetupCode, MIN_PASSWORD, newSetupCode, sameHash } from './password.js';
import { seal, unseal } from './seal.js';
import { atLeast, type Member, type Role, type Store } from './store.js';
import { newSecret, otpauthUri, verifyCode } from './totp.js';

export interface Deps {
  config: Config;
  store: Store;
  github: GitHub;
  cloud: Cloud;
  now?: () => number;
}

interface Session {
  /** The member. */
  mid: string;
  /** How they came in. Only a GitHub sign-in carries a GitHub token; the others connect GitHub when they need one. */
  via: 'github' | 'clor' | 'password';
  /** The person's own GitHub token. Sealed inside the cookie; never sent to the page. */
  tok: string;
  exp: number;
  stepUpAt: number;
}

const COOKIE = 'console_session';
const STATE_COOKIE = 'console_state';
export const STEP_UP_MS = 5 * 60_000;
const FULL_EVENTS = new Set(['schedule', 'workflow_dispatch']);

const reason = z.string().trim().min(3, 'Say why, in a few words.').max(500);
const code = z.string().trim().regex(/^\d{6}$/, 'Six digits.');

type Checked<T> = { ok: true; value: T; checkedAt: number } | { ok: false; value: T | null; checkedAt: number | null };

export function createApp({ config, store, github, cloud, now = Date.now }: Deps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.use(express.json({ limit: '32kb' }));

  /* Only through Cloudflare (console/web/functions/api): the direct run.app address answers nothing but its health check. */
  app.use((req, res, next) => {
    if (!config.edgeSecret || req.path === '/api/health') return next();
    const given = Buffer.from(String(req.headers['x-console-edge'] || ''));
    const want = Buffer.from(config.edgeSecret);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return res.status(403).json({ error: 'Open the Console at its own address.', code: 'EDGE_REQUIRED' });
    next();
  });

  /* The page lives on another address (console.clor.in), so it is named here and nobody else is. */
  app.use((req, res, next) => {
    res.setHeader('Vary', 'Origin');
    if (req.headers.origin === config.webOrigin) {
      res.setHeader('Access-Control-Allow-Origin', config.webOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-console');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  /*
   * A change must come from the Console's own page. The cookie is SameSite=Lax,
   * which still lets every other clor.in address send it, so a write also has
   * to carry the page's origin and a header a plain form cannot set.
   */
  app.use((req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();
    if (req.headers.origin !== config.webOrigin || req.headers['x-console'] !== '1') return res.status(403).json({ error: 'This did not come from the Console.' });
    next();
  });

  // --- last good answers --------------------------------------------------
  /* An outside source that cannot be reached is reported as such, with the
     last good answer and its time. Never a stale answer dressed as fresh. */
  const lastGood = new Map<string, { value: unknown; at: number }>();
  const fresh = new Map<string, { value: unknown; at: number }>();
  async function checked<T>(key: string, load: () => Promise<T>, maxAgeMs = 20_000): Promise<Checked<T>> {
    const hit = fresh.get(key);
    if (hit && now() - hit.at < maxAgeMs) return { ok: true, value: hit.value as T, checkedAt: hit.at };
    try {
      const value = await load();
      const entry = { value, at: now() };
      fresh.set(key, entry);
      lastGood.set(key, entry);
      return { ok: true, value, checkedAt: entry.at };
    } catch {
      const old = lastGood.get(key);
      return { ok: false, value: old ? (old.value as T) : null, checkedAt: old ? old.at : null };
    }
  }
  const forget = (...keys: string[]) => keys.forEach((k) => fresh.delete(k));

  // --- session ------------------------------------------------------------
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/api' };
  const setSession = (res: Response, s: Session) => res.cookie(COOKIE, seal(config.sessionSecret, 'session', s), { ...cookieOptions, expires: new Date(s.exp) });
  const readSession = (req: Request): Session | null => {
    const raw = req.cookies?.[COOKIE];
    const s = raw ? unseal<Session>(config.sessionSecret, 'session', raw) : null;
    return s && s.exp > now() ? s : null;
  };
  /* Each way of signing in, and each outside service, is on when its own settings are present. None is assumed. */
  const clorOn = Boolean(config.clor.grantPublicKey);
  const ghOn = githubOn(config);
  const pwOn = passwordOn(config);
  const cfOn = cloudflareOn(config) || config.devFakes;
  const ownerEmail = (email: string | null) => Boolean(pwOn && email && config.ownerEmails.includes(email.toLowerCase()));
  const ownerClor = (email: string | null) => Boolean(clorOn && email && config.ownerClorEmails.includes(email.toLowerCase()));
  const isBootstrap = (m: Member) => Boolean(m.githubUserId && config.ownerGithubIds.includes(m.githubUserId)) || ownerEmail(m.email) || (Boolean(m.clorUserId) && ownerClor(m.clorEmail));
  /** A bootstrap owner is an owner whatever their row says, and cannot be switched off from the page. */
  const effective = (m: Member): Member => (isBootstrap(m) ? { ...m, role: 'OWNER', active: true } : m);
  const SESSION_MS = 8 * 3600_000;
  const logLine = (m: Member, req: Request, action: string, target: string, detail: Record<string, unknown> = {}, why: string | null = null) =>
    store.addAudit({ memberId: m.id, actor: m.name, action, target, reason: why, detail, ip: req.ip || null });

  /** The member behind a GitHub account, if there is one. The first owner is made here, from the service's own setting. */
  async function memberForGithub(who: { id: string; login: string }) {
    let m = await store.findByGithub(who.id);
    if (!m && config.ownerGithubIds.includes(who.id)) m = await store.createMember({ name: who.login, role: 'OWNER', githubUserId: who.id, githubLogin: who.login, clorUserId: null, clorEmail: null, addedBy: null });
    if (m && m.githubLogin !== who.login) m = await store.updateMember(m.id, { githubLogin: who.login });
    return m && effective(m).active ? m : null;
  }

  /**
   * The member behind a CLOR login. Known by the CLOR user id once they have
   * signed in; before that, by the address an owner added them with, which is
   * bound to the id here and never decides access again.
   */
  async function memberForClor(g: Grant) {
    let m = await store.findByClor(g.clorUserId);
    if (!m) {
      const waiting = await store.findWaitingByClorEmail(g.email);
      if (waiting) m = await store.updateMember(waiting.id, { clorUserId: g.clorUserId, clorEmail: g.email });
    }
    /*
     * A first owner by CLOR login, named in the service's settings. If the same
     * person already has a member here by password under that address, the CLOR
     * login is added to that member rather than making a second one.
     */
    /* Once: after the address is bound to a CLOR user id, no other CLOR account may claim it. */
    const claimed = !m && ownerClor(g.email) && (await store.listMembers()).some((x) => x.clorUserId && (x.clorEmail || '').toLowerCase() === g.email);
    if (!m && ownerClor(g.email) && !claimed) {
      const same = await store.findByEmail(g.email);
      m = same && !same.clorUserId
        ? await store.updateMember(same.id, { clorUserId: g.clorUserId, clorEmail: g.email })
        : await store.createMember({ name: g.name, role: 'OWNER', githubUserId: null, githubLogin: null, clorUserId: g.clorUserId, clorEmail: g.email, addedBy: null });
      await store.addAudit({ memberId: m.id, actor: m.name, action: 'CLOR_LOGIN_LINKED', target: g.email, reason: null, detail: { clorUserId: g.clorUserId, firstOwner: true }, ip: null });
    }
    return m && effective(m).active ? m : null;
  }

  /* A pass is used once. Kept in memory: it lives a minute, and is tied to one browser's sign-in attempt besides. */
  const usedGrants = new Map<string, number>();
  const useOnce = (jti: string) => {
    for (const [k, until] of usedGrants) if (until < now()) usedGrants.delete(k);
    if (usedGrants.has(jti)) return false;
    usedGrants.set(jti, now() + 180_000);
    return true;
  };

  type Intent = 'sign-in' | 'connect' | 'link';
  const startState = (res: Response, intent: Intent, mid: string | null) => {
    const state = randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, seal(config.sessionSecret, 'state', { state, intent, mid, exp: now() + 600_000 }), { ...cookieOptions, maxAge: 600_000 });
    return state;
  };
  const takeState = (req: Request, res: Response) => {
    const kept = unseal<{ state: string; intent: Intent; mid: string | null; exp: number }>(config.sessionSecret, 'state', String(req.cookies?.[STATE_COOKIE] || ''));
    res.clearCookie(STATE_COOKIE, cookieOptions);
    return kept && kept.exp >= now() && kept.state === req.query.state ? kept : null;
  };
  const back = (res: Response, note?: string) => res.redirect(`${config.webOrigin}/${note ? `?signin=${note}` : ''}`);
  /** Adding a way to sign in is a change: the session must be this member's, with a code entered in the last five minutes. */
  const steppedUpSession = (req: Request) => {
    const s = readSession(req);
    return s && now() - s.stepUpAt < STEP_UP_MS ? s : null;
  };

  const r = express.Router();

  r.get('/health', (_req, res) => res.json({ ok: true }));
  r.get('/auth/options', (_req, res) => res.json({ github: ghOn, clor: clorOn, password: pwOn }));

  /*
   * GitHub. Three uses of the same round trip:
   *   sign-in   no session yet
   *   connect   a session that came in with CLOR needs the person's own GitHub
   *             token before it can change anything on GitHub
   * Connecting also links the GitHub account to the member the first time.
   */
  r.get('/auth/github', (req, res) => {
    if (!ghOn) return back(res, 'github-off');
    if (req.query.connect === '1') {
      const s = steppedUpSession(req);
      if (!s) return back(res, 'code-first');
      return res.redirect(github.authorizeUrl(startState(res, 'connect', s.mid)));
    }
    res.redirect(github.authorizeUrl(startState(res, 'sign-in', null)));
  });

  r.get('/auth/callback', async (req, res) => {
    const kept = takeState(req, res);
    if (!ghOn || !kept || typeof req.query.code !== 'string') return back(res, 'failed');
    try {
      const { token, expiresAt } = await github.exchangeCode(req.query.code);
      const who = await github.whoAmI(token);
      if (kept.intent === 'connect') {
        const s = steppedUpSession(req);
        const m = s && s.mid === kept.mid ? await store.getMember(s.mid) : null;
        if (!s || !m || !effective(m).active) return back(res, 'failed');
        if (m.githubUserId && m.githubUserId !== who.id) return back(res, 'other-github');
        if (!m.githubUserId) {
          if (await store.findByGithub(who.id)) return back(res, 'github-taken');
          await logLine(m, req, 'GITHUB_LINKED', who.login, { githubUserId: who.id });
          await store.updateMember(m.id, { githubUserId: who.id, githubLogin: who.login });
        }
        setSession(res, { ...s, tok: token, exp: Math.min(s.exp, expiresAt) });
        return back(res);
      }
      const m = await memberForGithub(who);
      if (!m) return back(res, 'not-a-member');
      setSession(res, { mid: m.id, via: 'github', tok: token, exp: Math.min(expiresAt, now() + SESSION_MS), stepUpAt: 0 });
      back(res);
    } catch {
      back(res, 'failed');
    }
  });

  /*
   * CLOR staff login. The browser goes to the operator console, which asks the
   * customer API for a one-minute pass for this attempt and sends the browser
   * back here with it (grant.ts). `link=1` adds the CLOR login to a member who
   * is already signed in with GitHub.
   */
  r.get('/auth/clor', (req, res) => {
    if (!clorOn) return back(res, 'clor-off');
    let state: string;
    if (req.query.link === '1') {
      const s = steppedUpSession(req);
      if (!s) return back(res, 'code-first');
      state = startState(res, 'link', s.mid);
    } else state = startState(res, 'sign-in', null);
    res.redirect(`${config.clor.opsOrigin}/?console_grant=${state}`);
  });

  async function clorCallback(req: Request, res: Response, g: Grant | null, kept: ReturnType<typeof takeState>) {
    if (!kept || !g || !useOnce(g.jti)) return back(res, 'failed');
    if (kept.intent === 'link') {
      const s = steppedUpSession(req);
      const m = s && s.mid === kept.mid ? await store.getMember(s.mid) : null;
      if (!s || !m || !effective(m).active) return back(res, 'failed');
      if (m.clorUserId && m.clorUserId !== g.clorUserId) return back(res, 'other-clor');
      if (!m.clorUserId) {
        if (await store.findByClor(g.clorUserId)) return back(res, 'clor-taken');
        await logLine(m, req, 'CLOR_LOGIN_LINKED', g.email, { clorUserId: g.clorUserId });
        await store.updateMember(m.id, { clorUserId: g.clorUserId, clorEmail: g.email });
      }
      return back(res);
    }
    const m = await memberForClor(g);
    if (!m) return back(res, 'not-a-member');
    /* No GitHub token and no code yet: this session reads nothing until the Console's own authenticator code is entered. */
    setSession(res, { mid: m.id, via: 'clor', tok: '', exp: now() + SESSION_MS, stepUpAt: 0 });
    back(res);
  }

  r.get('/auth/clor/callback', (req, res, next) => {
    const kept = takeState(req, res);
    const g = clorOn && kept && typeof req.query.grant === 'string' ? verifyGrant(req.query.grant, config.clor.grantPublicKey, kept.state, now()) : null;
    clorCallback(req, res, g, kept).catch(next);
  });

  /* Local preview only (CONSOLE_DEV_FAKES=1, refused in production by index.ts). */
  if (config.devFakes && !config.production) {
    r.get('/auth/dev', async (req, res) => {
      if (req.query.via === 'clor') {
        const m = await memberForClor({ clorUserId: String(req.query.id || 'clor-owner'), email: String(req.query.email || 'owner@clor.in'), name: 'Owner', jti: randomBytes(8).toString('hex') });
        if (!m) return back(res, 'not-a-member');
        setSession(res, { mid: m.id, via: 'clor', tok: '', exp: now() + SESSION_MS, stepUpAt: 0 });
        return back(res);
      }
      const m = await memberForGithub({ id: String(req.query.id || config.ownerGithubIds[0] || '1'), login: String(req.query.login || 'owner') });
      if (!m) return back(res, 'not-a-member');
      setSession(res, { mid: m.id, via: 'github', tok: 'dev-token', exp: now() + SESSION_MS, stepUpAt: 0 });
      back(res);
    });
  }

  r.post('/auth/sign-out', (_req, res) => {
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  // --- who may do what ----------------------------------------------------
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

  /*
   * Email and password: the Console's own sign-in, needing no outside service.
   * The password gets a session that can read nothing; the Console's
   * authenticator code is asked next, as for a CLOR sign-in.
   *
   * A password is chosen with a one-time setup code: the first owners use the
   * one in the service's settings, everybody else the one an owner is shown
   * when adding them or resetting their password.
   */
  const tries = new Map<string, { count: number; until: number }>();
  const LOCK_MS = 15 * 60_000;
  const locked = (key: string) => {
    const t = tries.get(key);
    return Boolean(t && t.count >= 5 && t.until > now());
  };
  const miss = (key: string) => {
    const t = tries.get(key);
    tries.set(key, { count: t && t.until > now() ? t.count + 1 : 1, until: now() + LOCK_MS });
  };
  const emailField = z.string().trim().toLowerCase().email().max(200);

  r.post('/auth/password', wrap(async (req, res) => {
    const parsed = z.object({ email: emailField, password: z.string().min(1).max(500) }).safeParse(req.body);
    if (!pwOn || !parsed.success) return res.status(400).json({ error: 'An email address and a password.' });
    const key = `in:${parsed.data.email}`;
    if (locked(key)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
    const m = await store.findByEmail(parsed.data.email);
    const ok = await checkPassword(parsed.data.password, m?.passwordHash ?? null);
    if (!m || !ok || !effective(m).active) {
      miss(key);
      return res.status(401).json({ error: 'That email address or password is not right.' });
    }
    tries.delete(key);
    setSession(res, { mid: m.id, via: 'password', tok: '', exp: now() + SESSION_MS, stepUpAt: 0 });
    res.json({ ok: true });
  }));

  r.post('/auth/password/setup', wrap(async (req, res) => {
    const parsed = z.object({ email: emailField, code: z.string().trim().min(1).max(100), password: z.string().max(500) }).safeParse(req.body);
    if (!pwOn || !parsed.success) return res.status(400).json({ error: 'An email address, your setup code and a new password.' });
    /* Said before anything is checked or counted: a short code is a mix-up (an authenticator code, a PIN), not a guess. */
    if (parsed.data.code.replace(/[\s-]/g, '').length < 16) return res.status(400).json({ error: 'That is too short to be a setup code. A setup code is a long one-time code (20 characters or more), not an authenticator code.' });
    if (parsed.data.password.length < MIN_PASSWORD) return res.status(400).json({ error: `Use ${MIN_PASSWORD} characters or more for the password.` });
    const { email } = parsed.data;
    const key = `setup:${email}`;
    if (locked(key)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
    const given = hashSetupCode(parsed.data.code);
    let m = await store.findByEmail(email);
    /* A first owner, named in the service's settings: its setup code works until they have a password. */
    const asOwner = ownerEmail(email) && !m?.passwordHash && sameHash(given, hashSetupCode(config.ownerSetupCode));
    const asMember = Boolean(m?.setupCodeHash && m.setupExpiresAt && m.setupExpiresAt.getTime() > now() && sameHash(given, m.setupCodeHash));
    if ((!asOwner && !asMember) || (m && !effective(m).active)) {
      miss(key);
      return res.status(401).json({ error: 'That setup code is not right for this address, or it has run out. Ask an owner for a new one.' });
    }
    tries.delete(key);
    if (!m) m = await store.createMember({ name: email, role: 'OWNER', githubUserId: null, githubLogin: null, clorUserId: null, clorEmail: null, addedBy: null, email });
    await logLine(m, req, 'PASSWORD_SET', m.name, { firstOwner: asOwner });
    await store.updateMember(m.id, { passwordHash: await hashPassword(parsed.data.password), setupCodeHash: null, setupExpiresAt: null });
    setSession(res, { mid: m.id, via: 'password', tok: '', exp: now() + SESSION_MS, stepUpAt: 0 });
    res.json({ ok: true });
  }));

  const requireMember = (req: Request, res: Response, next: NextFunction) =>
    (async () => {
      const s = readSession(req);
      if (!s) return res.status(401).json({ error: 'Sign in.', code: 'SIGN_IN' });
      const row = await store.getMember(s.mid);
      if (!row || !effective(row).active) return res.status(403).json({ error: 'You are not a member of the Console.', code: 'NOT_A_MEMBER' });
      res.locals.session = s;
      res.locals.member = effective(row);
      next();
    })().catch(next);
  const requireEnrolled = (_req: Request, res: Response, next: NextFunction) =>
    (res.locals.member as Member).totpEnabledAt ? next() : res.status(403).json({ error: 'Set up your authenticator first.', code: 'ENROL' });
  /*
   * A session that came in with a CLOR login or a password has proved who the
   * person is and nothing else. Before it reads anything it must also pass this
   * Console's own authenticator, once. So a fault in the customer API, or its
   * signing key in the wrong hands, does not open the Console by itself.
   */
  const requireSignInCode = (_req: Request, res: Response, next: NextFunction) => {
    const s = res.locals.session as Session;
    return s.via === 'github' || s.stepUpAt > 0 ? next() : res.status(401).json({ error: 'Enter a code from your authenticator.', code: 'SIGN_IN_CODE' });
  };
  const requireRole = (need: Role) => (_req: Request, res: Response, next: NextFunction) =>
    atLeast((res.locals.member as Member).role, need) ? next() : res.status(403).json({ error: need === 'OWNER' ? 'Only an owner can do this.' : 'Your role only reads.', code: 'ROLE' });
  const requireStepUp = (_req: Request, res: Response, next: NextFunction) =>
    now() - (res.locals.session as Session).stepUpAt < STEP_UP_MS ? next() : res.status(401).json({ error: 'Enter a code from your authenticator.', code: 'STEP_UP' });
  /* A change on GitHub is made with the person's own GitHub token, so GitHub's record names them. */
  const requireGitHub = (_req: Request, res: Response, next: NextFunction) => {
    if (!ghOn) return res.status(409).json({ error: 'GitHub is not connected to the Console yet, so this cannot be done from here.', code: 'GITHUB_OFF' });
    return (res.locals.session as Session).tok ? next() : res.status(401).json({ error: 'Connect your GitHub account to make changes.', code: 'CONNECT_GITHUB' });
  };

  const me = (res: Response) => res.locals.member as Member;
  const sess = (res: Response) => res.locals.session as Session;
  const publicMember = (m: Member) => ({ id: m.id, name: m.name, email: m.email, passwordSet: Boolean(m.passwordHash), setupWaiting: Boolean(m.setupCodeHash && m.setupExpiresAt && m.setupExpiresAt.getTime() > now()), githubLogin: m.githubLogin, clorEmail: m.clorEmail, clorSignedIn: Boolean(m.clorUserId), role: effective(m).role, active: effective(m).active, authenticator: Boolean(m.totpEnabledAt), bootstrap: isBootstrap(m), since: m.createdAt });

  /**
   * One change: written to the log first, so nothing happens unrecorded, then
   * done. If it fails, a second line says so. A change that worked leaves
   * exactly one line.
   */
  async function act(req: Request, res: Response, what: { action: string; target: string; reason?: string; detail?: Record<string, unknown> }, run: () => Promise<void>) {
    await logLine(me(res), req, what.action, what.target, what.detail, what.reason || null);
    try {
      await run();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'It did not work.';
      await logLine(me(res), req, `${what.action}_FAILED`, what.target, { error: message });
      const status = e instanceof GitHubError && [403, 404, 409, 422].includes(e.status) ? 409 : 502;
      res.status(status).json({ error: message });
      return false;
    }
    return true;
  }

  // --- me and the authenticator -------------------------------------------
  r.get('/me', requireMember, (_req, res) => {
    const m = me(res);
    const s = sess(res);
    res.json({ name: m.name, role: m.role, via: s.via, authenticator: Boolean(m.totpEnabledAt), needsCode: Boolean(m.totpEnabledAt) && s.via !== 'github' && !s.stepUpAt, github: { available: ghOn, connected: Boolean(s.tok), linked: Boolean(m.githubUserId), login: m.githubLogin }, password: { available: pwOn, set: Boolean(m.passwordHash), email: m.email }, clor: { available: clorOn, linked: Boolean(m.clorUserId), email: m.clorEmail }, steppedUpUntil: s.stepUpAt ? s.stepUpAt + STEP_UP_MS : null });
  });

  r.post('/two-factor/setup', requireMember, wrap(async (_req, res) => {
    const m = me(res);
    if (m.totpEnabledAt) return res.status(409).json({ error: 'Your authenticator is already set up. An owner can reset it.' });
    const secret = newSecret();
    await store.setTotp(m.id, { secretEnc: seal(config.sessionSecret, 'totp', secret), enabledAt: null, lastStep: null });
    const uri = otpauthUri(secret, m.name);
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  }));

  /* Five wrong codes and the member waits five minutes: a six-digit code is not to be guessed at. */
  const wrong = new Map<string, { count: number; until: number }>();
  const checkCode = async (m: Member, given: string) => {
    const w = wrong.get(m.id);
    if (w && w.count >= 5 && w.until > now()) return false;
    const ok = await checkCodeOnce(m, given);
    if (ok) wrong.delete(m.id);
    else wrong.set(m.id, { count: w && w.until > now() ? w.count + 1 : 1, until: now() + STEP_UP_MS });
    return ok;
  };
  const checkCodeOnce = async (m: Member, given: string) => {
    const secret = m.totpSecretEnc ? unseal<string>(config.sessionSecret, 'totp', m.totpSecretEnc) : null;
    const step = secret ? verifyCode(secret, given, m.totpLastStep, now()) : null;
    if (step == null) return false;
    await store.setTotpLastStep(m.id, step);
    return true;
  };

  r.post('/two-factor/enable', requireMember, wrap(async (req, res) => {
    const m = me(res);
    const parsed = code.safeParse(req.body?.code);
    if (m.totpEnabledAt) return res.status(409).json({ error: 'Your authenticator is already set up.' });
    if (!parsed.success || !(await checkCode(m, parsed.data))) return res.status(400).json({ error: 'That code is not right. Try the next one.' });
    await store.setTotp(m.id, { secretEnc: m.totpSecretEnc, enabledAt: new Date(now()), lastStep: (await store.getMember(m.id))!.totpLastStep });
    await logLine(m, req, 'AUTHENTICATOR_SET_UP', m.name, { via: sess(res).via });
    setSession(res, { ...sess(res), stepUpAt: now() });
    res.json({ ok: true });
  }));

  r.post('/step-up', requireMember, requireEnrolled, wrap(async (req, res) => {
    const parsed = code.safeParse(req.body?.code);
    if (!parsed.success || !(await checkCode(me(res), parsed.data))) return res.status(400).json({ error: 'That code is not right. Try the next one.' });
    setSession(res, { ...sess(res), stepUpAt: now() });
    res.json({ steppedUpUntil: now() + STEP_UP_MS });
  }));

  /* Everything below reads or changes the platform: a member with an authenticator. */
  const guarded = express.Router();
  guarded.use(requireMember, requireEnrolled, requireSignInCode);
  const change = (need: Role) => [requireRole(need), requireStepUp];
  /* A change that is made on GitHub: also needs the person's own GitHub token. */
  const onGitHub = (need: Role) => [...change(need), requireGitHub];

  // --- shared reads -------------------------------------------------------
  const head = () => checked('head', () => github.mainHead());
  const tags = () => checked('tags', () => github.releaseTags(), 60_000);
  const ciRuns = () => checked('ci', () => github.runs(config.workflows.ci, { branch: 'main', perPage: 30 }));
  const apiService = () => checked('service', () => cloud.service(config.gcp.service));
  const pulls = () => checked('pulls', () => github.openPulls(), 30_000);
  const releaseRuns = () =>
    checked('releaseRuns', async () => {
      const [a, b] = await Promise.all([github.runs(config.workflows.release, { perPage: 15 }), github.runs(config.workflows.rollback, { perPage: 10 })]);
      return [...a, ...b].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
    });
  const waiting = async () => {
    const t = await tags();
    const last = t.value?.[0]?.name ?? null;
    return checked(`waiting:${last}`, () => github.waitingSince(last), 60_000);
  };
  const sha7 = (sha: string) => sha.slice(0, 7);
  const fullRunFor = (runs: Run[] | null, sha: string | undefined) => (runs || []).find((x) => FULL_EVENTS.has(x.event) && x.headSha === sha) || null;

  // --- overview -----------------------------------------------------------
  guarded.get('/overview', wrap(async (_req, res) => {
    const [h, t, ci, svc, ready, backup, migration, web, site, staging, open, wait, security] = await Promise.all([
      head(),
      tags(),
      ciRuns(),
      apiService(),
      checked('ready', () => cloud.ready()),
      checked('backup', () => cloud.lastBackup(), 300_000),
      checked('migration', () => cloud.lastMigration(), 60_000),
      checked('pages:web', () => cloud.pages(config.cloudflare.webProject), 60_000),
      checked('pages:site', () => cloud.pages(config.cloudflare.siteProject), 60_000),
      checked('staging', () => cloud.service(config.gcp.stagingService), 60_000),
      pulls(),
      waiting(),
      checked('security', () => github.runs('security.yml', { branch: 'main', perPage: 5 }), 120_000),
    ]);

    type Tone = 'ok' | 'warn' | 'bad' | 'none';
    const row = (key: string, name: string, c: Checked<unknown>, tone: Tone, state: string, fact: string, link?: string) => ({
      key,
      name,
      tone: c.ok ? tone : 'none',
      state: c.ok ? state : 'Could not check',
      fact: c.ok ? fact : c.value == null ? 'No answer yet from the source.' : `Last good answer: ${fact}`,
      checkedAt: c.checkedAt,
      link: link || null,
    });
    const ago = (iso: string | undefined | null) => iso || null;
    /* A service that is not set up is not a fault: it is said as such, without a tone. */
    const notConnected = <R extends ReturnType<typeof row>>(r: R, on: boolean, what: string) => (on ? r : { ...r, tone: 'none' as Tone, state: 'Not connected', fact: `${what} is not connected to the Console yet.`, checkedAt: null, link: null, since: null });

    const serving = svc.value?.serving[0];
    const servingRev = svc.value?.revisions.find((x) => x.name === serving?.revision);
    const relTag = servingRev?.tags.find((x) => x.startsWith('rel-')) || (servingRev?.image.split(':').pop() ? `rel-${servingRev.image.split(':').pop()}` : '');
    const headRun = (ci.value || []).find((x) => x.headSha === h.value?.sha) || null;
    const nightly = (ci.value || []).find((x) => x.event === 'schedule' && x.status === 'completed') || null;
    const sec = (security.value || []).find((x) => x.status === 'completed') || null;
    const red = (open.value || []).filter((p) => p.checks === 'RED').length;
    const stagingRev = staging.value?.revisions.find((x) => x.name === staging.value?.serving[0]?.revision);
    const gcpConsole = `https://console.cloud.google.com/run/detail/${config.gcp.region}/${config.gcp.service}/revisions?project=${config.gcp.project}`;
    const actions = `https://github.com/${config.github.owner}/${config.github.repo}/actions`;

    res.json({
      rows: [
        row('api', 'API', svc.ok && ready.ok ? svc : svc.ok ? ready : svc, ready.value?.ok ? 'ok' : 'bad', ready.value?.ok ? 'Working' : 'Not answering', serving ? `${relTag || serving.revision} is serving${serving.percent < 100 ? ` ${serving.percent}%` : ''}` : 'No revision is serving', gcpConsole),
        notConnected({ ...row('web', 'Web app', web, 'ok', 'Published', web.value ? `Commit ${sha7(web.value.commit)}` : 'No deployment found'), since: ago(web.value?.createdAt) }, cfOn, 'Cloudflare'),
        notConnected({ ...row('site', 'Website', site, 'ok', 'Published', site.value ? `Commit ${sha7(site.value.commit)}` : 'No deployment found'), since: ago(site.value?.createdAt) }, cfOn, 'Cloudflare'),
        { ...row('backup', 'Database backup', backup, backup.value?.status === 'SUCCESSFUL' ? 'ok' : 'bad', backup.value?.status === 'SUCCESSFUL' ? 'Backed up' : 'Last backup failed', backup.value ? 'Latest backup' : 'No backup found'), since: ago(backup.value?.endedAt) },
        { ...row('migration', 'Database changes', migration, migration.value?.ok === false ? 'bad' : 'ok', migration.value?.ok === false ? 'Last run failed' : 'Applied', migration.value ? 'Latest migration run' : 'No run yet'), since: ago(migration.value?.endedAt) },
        notConnected({ ...row('tests', 'Tests', ci.ok ? h : ci, !headRun ? 'warn' : headRun.status !== 'completed' ? 'warn' : headRun.conclusion === 'success' ? 'ok' : 'bad', !headRun ? 'Not run' : headRun.status !== 'completed' ? 'Running' : headRun.conclusion === 'success' ? 'Passing' : 'Failing', `main at ${h.value ? sha7(h.value.sha) : 'unknown'}${nightly ? `; last nightly run ${nightly.conclusion === 'success' ? 'passed' : 'failed'}` : ''}`, headRun?.url || actions), since: ago(headRun?.updatedAt) }, ghOn, 'GitHub'),
        notConnected({ ...row('security', 'Security checks', security, !sec ? 'warn' : sec.conclusion === 'success' ? 'ok' : 'bad', !sec ? 'Not run' : sec.conclusion === 'success' ? 'Passing' : 'Failing', 'Dependency audit and secret scan', sec?.url || actions), since: ago(sec?.updatedAt) }, ghOn, 'GitHub'),
        notConnected(row('waiting', 'Waiting to release', wait.ok ? t : wait, wait.value?.pulls.length ? 'warn' : 'ok', wait.value?.pulls.length ? `${wait.value.pulls.length} waiting` : 'Nothing waiting', t.value?.[0] ? `Since ${t.value[0].name}` : 'No release recorded yet'), ghOn, 'GitHub'),
        notConnected(row('pulls', 'Open pull requests', open, red ? 'bad' : 'ok', `${open.value?.length ?? 0} open`, red ? `${red} with failing checks` : 'None failing'), ghOn, 'GitHub'),
        { ...row('staging', 'Staging', staging, 'ok', 'Running', staging.value?.serving[0] ? staging.value.serving[0].revision : 'No revision is serving'), since: ago(stagingRev?.createdAt) },
      ],
    });
  }));

  // --- releases -----------------------------------------------------------
  async function releaseState(userToken?: string) {
    const [h, t, ci, svc, runs, wait] = await Promise.all([head(), tags(), ciRuns(), apiService(), releaseRuns(), waiting()]);
    const sha = h.value?.sha;
    const full = fullRunFor(ci.value, sha);
    const testsGreen = Boolean(full && full.status === 'completed' && full.conclusion === 'success');
    const tag = sha ? `rel-${sha7(sha)}` : '';
    const stagedRev = svc.value?.revisions.find((x) => x.tags.includes(tag)) || null;
    const serving = svc.value?.serving[0]?.revision || null;
    const released = Boolean(stagedRev && stagedRev.name === serving) || Boolean(t.value?.some((x) => x.sha === sha));
    const busy = (runs.value || []).find((x) => x.status !== 'completed') || null;
    let pending: Array<{ runId: number; environment: string; canApprove: boolean }> = [];
    if (busy && busy.status === 'waiting' && userToken) {
      try {
        pending = (await github.pendingDeployments(busy.id, userToken)).map((p) => ({ runId: busy.id, environment: p.environment, canApprove: p.canApprove }));
      } catch {
        pending = [];
      }
    }
    const reachable = h.ok && ci.ok && svc.ok && runs.ok && t.ok;
    const next: 'UNKNOWN' | 'BUSY' | 'NOTHING' | 'TESTS' | 'TESTS_RUNNING' | 'STAGE' | 'RELEASE' =
      !reachable ? 'UNKNOWN' : busy ? 'BUSY' : released ? 'NOTHING' : full && full.status !== 'completed' ? 'TESTS_RUNNING' : !testsGreen ? 'TESTS' : !stagedRev ? 'STAGE' : 'RELEASE';
    return { h, t, ci, svc, runs, wait, sha, full, testsGreen, tag, stagedRev, serving, released, busy, pending, next };
  }

  guarded.get('/releases', wrap(async (_req, res) => {
    const s = await releaseState(sess(res).tok);
    res.json({
      github: ghOn,
      reachable: s.next !== 'UNKNOWN',
      next: s.next,
      head: s.h.value ? { sha: s.h.value.sha, short: sha7(s.h.value.sha), message: s.h.value.message, date: s.h.value.date } : null,
      tests: s.full ? { status: s.full.status, conclusion: s.full.conclusion, url: s.full.url, at: s.full.updatedAt } : null,
      staged: s.stagedRev ? { revision: s.stagedRev.name, tag: s.tag, createdAt: s.stagedRev.createdAt } : null,
      serving: s.serving,
      waiting: s.wait.value ? { pulls: s.wait.value.pulls, commits: s.wait.value.commits, marks: marksFor(s.wait.value.files), since: s.t.value?.[0]?.name || null, complete: !s.wait.value.filesTruncated } : null,
      revisions: (s.svc.value?.revisions || []).map((x) => ({ name: x.name, createdAt: x.createdAt, tag: x.tags.find((y) => y.startsWith('rel-')) || null, serving: x.name === s.serving })),
      runs: (s.runs.value || []).slice(0, 12).map((x) => ({ id: x.id, kind: x.workflow === config.workflows.rollback ? 'Roll back' : 'Release', title: x.title, status: x.status, conclusion: x.conclusion, actor: x.actor, at: x.createdAt, url: x.url })),
      pending: s.pending,
      history: (s.t.value || []).map((x) => ({ tag: x.name, short: sha7(x.sha), by: x.by, at: x.date, message: x.message })),
    });
  }));

  guarded.get('/releases/runs/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'Not a run.' });
    const steps = await checked(`steps:${id}`, () => github.runSteps(id), 5000);
    res.json({ reachable: steps.ok, steps: (steps.value || []).filter((x) => !/^(Set up job|Complete job|Post )/.test(x.name)) });
  }));

  guarded.post('/releases/tests', ...onGitHub('ENGINEER'), wrap(async (req, res) => {
    const s = await releaseState();
    if (!s.sha) return res.status(503).json({ error: 'GitHub could not be reached. Nothing was started.' });
    if (await act(req, res, { action: 'FULL_TESTS_STARTED', target: sha7(s.sha) }, () => github.dispatch(sess(res).tok, config.workflows.ci, {}))) {
      forget('ci');
      res.status(202).json({ ok: true });
    }
  }));

  const startRelease = (mode: 'stage' | 'go', need: Role) =>
    guarded.post(`/releases/${mode}`, ...onGitHub(need), wrap(async (req, res) => {
      const why = mode === 'go' ? reason.safeParse(req.body?.reason) : null;
      if (why && !why.success) return res.status(400).json({ error: 'Say what this release is, in a few words.' });
      const s = await releaseState();
      if (s.next === 'UNKNOWN' || !s.sha) return res.status(503).json({ error: 'GitHub or Google Cloud could not be reached. Nothing was started.' });
      if (s.busy) return res.status(409).json({ error: 'A release is already running. Wait for it to finish.' });
      if (!s.testsGreen) return res.status(409).json({ error: 'The full tests have not passed on this commit. Run them first.' });
      if (mode === 'go' && !s.stagedRev) return res.status(409).json({ error: 'This commit is not staged yet. Stage it first.' });
      const what = { action: mode === 'go' ? 'RELEASE_STARTED' : 'RELEASE_STAGED', target: sha7(s.sha), reason: why?.data, detail: { sha: s.sha, serving: s.serving } };
      if (await act(req, res, what, () => github.dispatch(sess(res).tok, config.workflows.release, { mode, sha: s.sha! }))) {
        forget('releaseRuns');
        res.status(202).json({ ok: true });
      }
    }));
  startRelease('stage', 'ENGINEER');
  startRelease('go', 'OWNER');

  guarded.post('/releases/runs/:id/approve', ...onGitHub('OWNER'), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const runs = await releaseRuns();
    const run = (runs.value || []).find((x) => x.id === id);
    if (!run) return res.status(404).json({ error: 'That run is not a release.' });
    const pending = await github.pendingDeployments(id, sess(res).tok);
    const mine = pending.filter((p) => p.canApprove);
    if (!mine.length) return res.status(409).json({ error: 'Nothing on this run is waiting for your approval.' });
    if (await act(req, res, { action: 'RELEASE_APPROVED', target: `run ${id}`, detail: { title: run.title, environments: mine.map((p) => p.environment) } }, () => github.approveRun(sess(res).tok, id, mine.map((p) => p.environmentId), `Approved in the Console by ${me(res).name}.`))) {
      forget('releaseRuns');
      res.json({ ok: true });
    }
  }));

  guarded.post('/releases/rollback', ...onGitHub('ENGINEER'), wrap(async (req, res) => {
    const parsed = z.object({ revision: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), reason }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Pick a revision and say why.' });
    const svc = await apiService();
    if (!svc.ok || !svc.value) return res.status(503).json({ error: 'Google Cloud could not be reached. Nothing was started.' });
    if (!svc.value.revisions.some((x) => x.name === parsed.data.revision)) return res.status(404).json({ error: 'That revision does not exist.' });
    if (svc.value.serving[0]?.revision === parsed.data.revision && svc.value.serving[0].percent === 100) return res.status(409).json({ error: 'That revision is the one serving now.' });
    const what = { action: 'ROLLED_BACK', target: parsed.data.revision, reason: parsed.data.reason, detail: { from: svc.value.serving[0]?.revision || null } };
    if (await act(req, res, what, () => github.dispatch(sess(res).tok, config.workflows.rollback, { revision: parsed.data.revision, reason: parsed.data.reason }))) {
      forget('releaseRuns', 'service');
      res.status(202).json({ ok: true });
    }
  }));

  // --- pull requests ------------------------------------------------------
  const describe = (p: Awaited<ReturnType<GitHub['openPulls']>>[number]) => {
    const marks = marksFor(p.files);
    const cannot = p.draft
      ? 'It is still a draft.'
      : p.filesTruncated
        ? 'It changes more files than the Console can read. Review this one on GitHub.'
        : blocksConsoleMerge(marks)
          ? 'It changes how releases or sign-in work. Review this one on GitHub.'
          : p.checks !== 'GREEN'
            ? p.checks === 'RED' ? 'Its checks are failing.' : p.checks === 'RUNNING' ? 'Its checks are still running.' : 'No checks have run on it.'
            : null;
    return { number: p.number, title: p.title, url: p.url, body: p.body, draft: p.draft, branch: p.branch, author: p.author, writtenBy: writtenBy(p.branch, p.author, p.authorIsBot), checks: p.checks, fullTests: p.labels.includes('full-tests'), additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles, files: p.files, filesTruncated: p.filesTruncated, marks, createdAt: p.createdAt, pushedAt: p.pushedAt, cannotMerge: cannot };
  };

  guarded.get('/pulls', wrap(async (_req, res) => {
    const open = await pulls();
    res.json({ github: ghOn, reachable: open.ok, checkedAt: open.checkedAt, pulls: (open.value || []).map(describe) });
  }));

  async function findPull(req: Request, res: Response) {
    const n = Number(req.params.n);
    forget('pulls');
    const open = await pulls();
    if (!open.ok) {
      res.status(503).json({ error: 'GitHub could not be reached. Nothing was changed.' });
      return null;
    }
    const p = (open.value || []).find((x) => x.number === n);
    if (!p) res.status(404).json({ error: 'That pull request is not open.' });
    return p || null;
  }

  guarded.post('/pulls/:n/full-tests', ...onGitHub('ENGINEER'), wrap(async (req, res) => {
    const p = await findPull(req, res);
    if (!p) return;
    if (await act(req, res, { action: 'PR_FULL_TESTS', target: `#${p.number}`, detail: { title: p.title, sha: p.headSha } }, () => github.addLabel(sess(res).tok, p.number, 'full-tests'))) {
      forget('pulls');
      res.json({ ok: true });
    }
  }));

  guarded.post('/pulls/:n/merge', ...onGitHub('OWNER'), wrap(async (req, res) => {
    const p = await findPull(req, res);
    if (!p) return;
    const d = describe(p);
    if (d.cannotMerge) return res.status(409).json({ error: d.cannotMerge });
    if (await act(req, res, { action: 'PR_MERGED', target: `#${p.number}`, detail: { title: p.title, sha: p.headSha, marks: d.marks } }, () => github.merge(sess(res).tok, p.number, p.headSha))) {
      forget('pulls', 'head');
      res.json({ ok: true });
    }
  }));

  guarded.post('/pulls/:n/close', ...onGitHub('ENGINEER'), wrap(async (req, res) => {
    const why = reason.safeParse(req.body?.reason);
    if (!why.success) return res.status(400).json({ error: 'Say why it is being closed.' });
    const p = await findPull(req, res);
    if (!p) return;
    if (await act(req, res, { action: 'PR_CLOSED', target: `#${p.number}`, reason: why.data, detail: { title: p.title } }, () => github.close(sess(res).tok, p.number, `Closed from the Console by ${me(res).name}: ${why.data}`))) {
      forget('pulls');
      res.json({ ok: true });
    }
  }));

  // --- audit and members --------------------------------------------------
  guarded.get('/audit', wrap(async (req, res) => {
    const events = await store.listAudit({ action: typeof req.query.action === 'string' && req.query.action ? req.query.action : undefined, memberId: typeof req.query.who === 'string' && req.query.who ? req.query.who : undefined, limit: 200 });
    res.json({ events: events.map((e) => ({ id: e.id, at: e.at, who: e.actor, action: e.action, target: e.target, reason: e.reason, detail: e.detail })) });
  }));

  guarded.get('/members', requireRole('OWNER'), wrap(async (_req, res) => {
    res.json({ members: (await store.listMembers()).map(publicMember), clor: clorOn, github: ghOn, password: pwOn });
  }));

  const newMember = z.object({
    email: emailField.optional(),
    githubLogin: z.string().trim().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
    clorEmail: z.string().trim().toLowerCase().email().max(200).optional(),
    role: z.enum(['OWNER', 'ENGINEER', 'VIEWER']),
    reason,
  });

  guarded.post('/members', ...change('OWNER'), wrap(async (req, res) => {
    const parsed = newMember.safeParse(req.body);
    if (!parsed.success || (!parsed.data.email && !parsed.data.githubLogin && !parsed.data.clorEmail)) return res.status(400).json({ error: 'A way to sign in (an email address, a GitHub username or a CLOR login address), a role and a reason.' });
    const { email, githubLogin, clorEmail, role } = parsed.data;
    if (email && !pwOn) return res.status(409).json({ error: 'Sign-in with an email address and password is not set up for the Console.' });
    if (githubLogin && !ghOn) return res.status(409).json({ error: 'GitHub is not connected to the Console yet. Add them by email address.' });
    if (clorEmail && !clorOn) return res.status(409).json({ error: 'Sign-in with CLOR is not set up yet. Add them another way.' });
    const who = githubLogin ? await github.userByLogin(githubLogin) : null;
    if (githubLogin && !who) return res.status(404).json({ error: 'GitHub has no person with that username.' });
    const all = await store.listMembers();
    if (email && all.some((m) => (m.email || '').toLowerCase() === email)) return res.status(409).json({ error: 'That email address is already a member.' });
    if (who && all.some((m) => m.githubUserId === who.id)) return res.status(409).json({ error: 'That GitHub account is already a member.' });
    if (clorEmail && all.some((m) => (m.clorEmail || '').toLowerCase() === clorEmail)) return res.status(409).json({ error: 'That CLOR login is already a member.' });
    const name = email || who?.login || clorEmail!;
    /* Shown once, here; only its hash is kept. Good for three days. */
    const setupCode = email ? newSetupCode() : null;
    await logLine(me(res), req, 'MEMBER_ADDED', name, { email: email || null, githubUserId: who?.id || null, clorEmail: clorEmail || null, role }, parsed.data.reason);
    const row = await store.createMember({ name, role, githubUserId: who?.id || null, githubLogin: who?.login || null, clorUserId: null, clorEmail: clorEmail || null, addedBy: me(res).id, email: email || null, setupCodeHash: setupCode ? hashSetupCode(setupCode) : null, setupExpiresAt: setupCode ? new Date(now() + 3 * 86_400_000) : null });
    res.status(201).json({ member: publicMember(row), setupCode });
  }));

  guarded.patch('/members/:id', ...change('OWNER'), wrap(async (req, res) => {
    const parsed = z.object({ role: z.enum(['OWNER', 'ENGINEER', 'VIEWER']).optional(), active: z.boolean().optional(), resetAuthenticator: z.literal(true).optional(), resetPassword: z.literal(true).optional(), reason }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A change and a reason.' });
    const was = await store.getMember(String(req.params.id));
    if (!was) return res.status(404).json({ error: 'No such member.' });
    const { role, active, resetAuthenticator, resetPassword } = parsed.data;
    if (resetPassword && (!pwOn || !was.email)) return res.status(409).json({ error: 'This member does not sign in with a password.' });
    if (isBootstrap(was) && (role || active === false)) return res.status(409).json({ error: 'This owner is set in the Console service itself and cannot be changed here.' });
    if (was.id === me(res).id && (active === false || (role && role !== 'OWNER'))) return res.status(409).json({ error: 'You cannot remove your own access.' });
    await logLine(me(res), req, 'MEMBER_CHANGED', was.name, { before: { role: was.role, active: was.active }, after: { role: role ?? was.role, active: active ?? was.active }, resetAuthenticator: Boolean(resetAuthenticator), resetPassword: Boolean(resetPassword) }, parsed.data.reason);
    /* A password reset ends the old password at once and hands back a fresh one-time code, shown once. */
    const setupCode = resetPassword ? newSetupCode() : null;
    const row = await store.updateMember(was.id, { role: role ?? was.role, active: active ?? was.active, ...(setupCode ? { passwordHash: null, setupCodeHash: hashSetupCode(setupCode), setupExpiresAt: new Date(now() + 3 * 86_400_000) } : {}) });
    if (resetAuthenticator) await store.setTotp(was.id, { secretEnc: null, enabledAt: null, lastStep: null });
    res.json({ member: publicMember({ ...row, totpEnabledAt: resetAuthenticator ? null : row.totpEnabledAt }), setupCode });
  }));

  r.use(guarded);
  app.use('/api', r);

  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: 'Something went wrong in the Console.' });
  });
  return app;
}
