import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { platformPrisma } from '../utils/platformPrisma.js';
import { RoleType } from '../constants/enums.js';
import { clearRefreshCookie, refreshTokenFrom, setRefreshCookie } from '../utils/refreshCookie.js';
import { codeLimiter, loginLimiter, refreshLimiter, resetLimiter, signupLimiter } from '../middleware/rateLimit.js';
import {
  AuthError,
  clearFailedLogins,
  clientIp,
  consumePasswordResetToken,
  peekPasswordResetToken,
  createSession,
  issuePasswordResetToken,
  listSessions,
  lockoutRemainingMs,
  recordAuthEvent,
  registerFailedLogin,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  signAccessToken,
  issueEmailVerificationToken,
  consumeEmailVerificationToken,
} from '../services/auth.js';
import { decryptSecret, sendTemplate } from '../services/mailer.js';
import { hashRecovery, verifyCode } from '../services/totp.js';
import { adminTwoFactorMissing } from '../services/twoFactorPolicy.js';
import { DEFAULT_POLICY, policyForUser, sessionPolicyFor, validatePassword, getAuthPolicy } from '../services/policy.js';
import { type EntryRefusal, resendChallengeFor, resendChallengeUser, signInEntry } from '../services/signInRules.js';
import { validateGstinOrThrow, deriveStateCodeFromInput } from '../utils/gstin.js';
import { isDevOrTest } from '../utils/devMode.js';
import { requireAuth as requireLiveAuth } from '../middleware/auth.js';
import { ProvisionError, SIGNUP_APPS, createAccountWithOwner, createCompany } from '../services/accountProvisioning.js';
import { trialOffer } from '../services/trialPlan.js';
import { ACCOUNT_ADMINS, accountRoleOf } from '../services/accountMembership.js';
import { QuotaBusyError } from '../services/quotaLock.js';
import { acrossCompanies, outsideTenant } from '../utils/tenantScope.js';
import { closedForOutsider } from '../services/outsideAccess.js';
import { exploreInfo } from '../services/explore.js';

/* Compared against when no such user exists, so a miss costs a real bcrypt check (SX-14). */
const LOGIN_DUMMY_HASH = bcrypt.hashSync('not-a-password-0', Number(process.env.BCRYPT_ROUNDS || 12));

export const authRouter = Router();
/* Signing up, signing in and choosing a company happen before — and across — any one company (A-35). */
authRouter.use(acrossCompanies('auth: a person and their companies, before one is chosen'));

const LOCKOUT_NOTICE = Number(process.env.LOCKOUT_MINUTES || 15);

function getJwtSecret() {
  return process.env.JWT_SECRET || (isDevOrTest() ? 'dev-secret' : '');
}

authRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const parsed = z
    .union([
      z.object({ emailOrUsername: z.string().min(1), password: z.string().min(1) }),
      z.object({ email: z.string().min(1), password: z.string().min(1) }),
    ])
    .safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: 'Invalid login payload' });

  const body = parsed.data;
  const rawIdentity = 'emailOrUsername' in body ? body.emailOrUsername : body.email;
  const identity = rawIdentity.trim().toLowerCase();
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] as string | undefined;

  const user = await platformPrisma.user.findFirst({
    where: { OR: [{ email: identity }, { username: rawIdentity.trim() }] },
    select: {
      id: true,
      accountId: true,
      passwordHash: true,
      isActive: true,
      fullName: true,
      email: true,
      lockedUntil: true,
      totpEnabledAt: true,
      totpSecretEnc: true,
      emailVerifiedAt: true,
    },
  });

  // One message for "no such user" and "wrong password": distinguishing them
  // turns the login form into an account-existence oracle.
  const invalid = () => res.status(401).json({ error: 'Invalid credentials' });

  if (!user || !user.isActive) {
    /* Spend the same bcrypt time as a real check, so how long the answer takes
       does not tell which emails have accounts (SX-14). */
    await bcrypt.compare(body.password, LOGIN_DUMMY_HASH);
    await recordAuthEvent({ email: identity, eventType: 'LOGIN_FAILED', ip, userAgent, detail: 'No such active user' });
    return invalid();
  }

  const lockedFor = lockoutRemainingMs(user.lockedUntil);
  if (lockedFor > 0) {
    await recordAuthEvent({ accountId: user.accountId, userId: user.id, email: identity, eventType: 'LOCKED_OUT', ip, userAgent });
    return res.status(429).json({
      error: `Too many failed attempts. Try again in ${Math.ceil(lockedFor / 60000)} minute(s).`,
    });
  }

  const policy = await policyForUser(user.accountId, user.id);

  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) {
    const result = await registerFailedLogin(user.id, policy.maxFailedLogins, policy.lockoutMinutes);
    await recordAuthEvent({
      accountId: user.accountId,
      userId: user.id,
      email: identity,
      eventType: result.locked ? 'LOCKED_OUT' : 'LOGIN_FAILED',
      ip,
      userAgent,
    });
    if (result.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${policy.lockoutMinutes} minute(s).` });
    }
    return invalid();
  }

  /*
   * Two-factor sign-in (SX-09). Someone with an authenticator gets no session
   * for a password alone: a short-lived challenge comes back instead, and
   * POST /login/two-factor finishes the sign-in with a code from the app (or
   * a recovery code). The failed-login counter is cleared only then, so codes
   * guessed after a correct password still count towards the lockout.
   */
  if (user.totpEnabledAt && user.totpSecretEnc) {
    /* #4: refused by every company's rules — said now, before asking for a code that would not help. */
    const entry = await signInEntry(user.id, user);
    if (entry.refusal) return refuseEntry(res, user, entry.refusal, identity, ip, userAgent);
    const challenge = jwt.sign({ typ: 'login2fa', uid: user.id }, getJwtSecret(), { expiresIn: LOGIN_2FA_TTL_S, audience: LOGIN_2FA_AUDIENCE });
    return res.json({ twoFactorRequired: true, challenge, expiresIn: LOGIN_2FA_TTL_S });
  }

  return completeLogin(req, res, user, identity, ip, userAgent);
});

const LOGIN_2FA_TTL_S = 5 * 60;
const LOGIN_2FA_AUDIENCE = 'clor-login-2fa';

type LoginUser = { id: string; accountId: string; email: string | null; fullName: string | null; emailVerifiedAt: Date | null };

/**
 * #4: the right password, but none of the person's companies lets them in
 * (an address not confirmed, or outside the allowed domains). No session is
 * made. An unconfirmed address gets a way to ask for a new link.
 */
async function refuseEntry(res: Response, user: { id: string; accountId: string }, refusal: EntryRefusal, identity: string, ip: ReturnType<typeof clientIp>, userAgent: string | undefined) {
  await recordAuthEvent({ accountId: user.accountId, userId: user.id, email: identity, eventType: 'LOGIN_REFUSED', ip, userAgent, detail: refusal.code });
  return res.status(refusal.status).json({
    error: refusal.error,
    code: refusal.code,
    ...(refusal.code === 'EMAIL_NOT_CONFIRMED' ? { resendChallenge: resendChallengeFor(user.id) } : {}),
  });
}

/** Everything after the person is known to be who they say: session, token, companies. */
async function completeLogin(req: Request, res: Response, user: LoginUser, identity: string, ip: ReturnType<typeof clientIp>, userAgent: string | undefined) {
  const entry = await signInEntry(user.id, user);
  if (entry.refusal) return refuseEntry(res, user, entry.refusal, identity, ip, userAgent);
  await clearFailedLogins(user.id);
  /* #4: how long this sign-in lasts, and each access token, are the companies' rules (the strictest of them). */
  const policy = await sessionPolicyFor(user.id);
  const { session, refreshToken } = await createSession({
    accountId: user.accountId,
    userId: user.id,
    ip,
    userAgent,
    days: policy.sessionDays,
  });
  await recordAuthEvent({ accountId: user.accountId, userId: user.id, email: identity, eventType: 'LOGIN_SUCCESS', ip, userAgent });

  const token = signAccessToken({ userId: user.id, accountId: user.accountId, sid: session.id }, policy.accessTokenMinutes);

  /*
   * Every company this person can open, not only the ones their own account
   * owns.
   *
   * A membership row carries the accountId of the company it grants — which is
   * the INVITING account when somebody is invited into a company they do not
   * own. Filtering by the signed-in user's own accountId therefore hid exactly
   * the case the product is sold on: a CA firm inviting an accountant who
   * already has a login of their own. The membership existed, the middleware
   * would have authorised it, and the company simply never appeared in their
   * switcher.
   *
   * A membership is already unique per (account, org, user), so org + user
   * identifies it without the account. The owning account goes out with each
   * company because the client needs to know which account a company belongs
   * to once they are not all the same.
   */
  const memberships = await platformPrisma.userOrgMembership.findMany({
    where: { userId: user.id },
    select: { orgId: true, accountId: true, org: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  /* GAP-006: a company from another account whose engagement is not live is not offered. */
  const closedHere = await closedForOutsider(user.id, user.accountId, memberships);
  const companies = memberships.filter((m) => !closedHere.has(m.orgId) && !entry.closed.has(m.orgId)).map((m) => ({
    orgId: m.orgId,
    id: m.org?.id ?? m.orgId,
    name: m.org?.name ?? '',
    accountId: m.accountId,
  }));

  const firstOrgId = companies[0]?.orgId ?? null;
  // The account that owns the company being opened, which is not necessarily
  // the account that owns the person.
  const firstAccountId = companies[0]?.accountId ?? user.accountId;

  const branches = firstOrgId
    ? await platformPrisma.userBranchMembership.findMany({
        where: { accountId: firstAccountId, orgId: firstOrgId, userId: user.id },
        select: { branchId: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  /*
   * The refresh token goes in an HttpOnly cookie and NOT in this response.
   *
   * Returning it as well would leave it readable by any script on the page,
   * which is the thing the cookie exists to prevent — the browser can hold a
   * credential the page itself cannot see, and that is the whole point.
   */
  setRefreshCookie(res, refreshToken, session.expiresAt);

  /* Any company that requires an authenticator of this owner or admin, who has none yet: the app opens on the set-up. */
  let twoFactorSetupRequired = false;
  for (const c of companies) {
    if (await adminTwoFactorMissing(user.id, c.orgId)) {
      twoFactorSetupRequired = true;
      break;
    }
  }

  return res.json({
    token,
    twoFactorSetupRequired,
    expiresIn: `${policy.accessTokenMinutes}m`,
    user: { id: user.id, email: user.email, fullName: user.fullName, accountId: user.accountId },
    companies,
    activeOrgId: firstOrgId,
    activeBranchId: branches[0]?.branchId ?? null,
  });
}

/**
 * The second half of a two-factor sign-in: the challenge from /login plus a
 * code from the authenticator app, or one of the recovery codes (each works
 * once). A wrong code counts as a failed sign-in, towards the same lockout.
 */
authRouter.post('/login/two-factor', ...codeLimiter, async (req: Request, res: Response) => {
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] as string | undefined;
  let claims: any;
  try {
    claims = jwt.verify(String(req.body?.challenge || ''), getJwtSecret(), { audience: LOGIN_2FA_AUDIENCE, algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'That sign-in took too long. Enter your password again.', code: 'CHALLENGE_EXPIRED' });
  }
  if (claims?.typ !== 'login2fa' || !claims.uid) return res.status(401).json({ error: 'Enter your password again.', code: 'CHALLENGE_EXPIRED' });

  const user = await platformPrisma.user.findUnique({
    where: { id: String(claims.uid) },
    select: { id: true, accountId: true, email: true, fullName: true, isActive: true, lockedUntil: true, totpEnabledAt: true, totpSecretEnc: true, totpLastStep: true, totpRecoveryJson: true, emailVerifiedAt: true },
  });
  if (!user || !user.isActive || !user.totpEnabledAt || !user.totpSecretEnc) return res.status(401).json({ error: 'Enter your password again.', code: 'CHALLENGE_EXPIRED' });
  const identity = String(user.email || '').toLowerCase();

  const lockedFor = lockoutRemainingMs(user.lockedUntil);
  if (lockedFor > 0) {
    await recordAuthEvent({ accountId: user.accountId, userId: user.id, email: identity, eventType: 'LOCKED_OUT', ip, userAgent });
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(lockedFor / 60000)} minute(s).` });
  }

  const code = String(req.body?.code || '').trim();
  let used: 'CODE' | 'RECOVERY' | null = null;
  const step = verifyCode(decryptSecret(user.totpSecretEnc), code, user.totpLastStep);
  if (step != null) {
    /* A code works once: only if no other request used this step in the meantime. */
    const won = await platformPrisma.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    if (won.count) used = 'CODE';
  } else if (/^[A-Z2-7]{4}-?[A-Z2-7]{4}$/i.test(code)) {
    const hashes = JSON.parse(user.totpRecoveryJson || '[]') as string[];
    const h = hashRecovery(code);
    if (hashes.includes(h)) {
      await platformPrisma.user.update({ where: { id: user.id }, data: { totpRecoveryJson: JSON.stringify(hashes.filter((x) => x !== h)) } });
      used = 'RECOVERY';
    }
  }

  if (!used) {
    const policy = await policyForUser(user.accountId, user.id);
    const result = await registerFailedLogin(user.id, policy.maxFailedLogins, policy.lockoutMinutes);
    await recordAuthEvent({ accountId: user.accountId, userId: user.id, email: identity, eventType: result.locked ? 'LOCKED_OUT' : 'LOGIN_FAILED', ip, userAgent, detail: 'Wrong authenticator code' });
    if (result.locked) return res.status(429).json({ error: `Too many failed attempts. Try again in ${policy.lockoutMinutes} minute(s).` });
    return res.status(400).json({ error: 'That code is not right, or has been used. Wait for the next one.', code: 'BAD_CODE' });
  }
  if (used === 'RECOVERY') {
    await recordAuthEvent({ accountId: user.accountId, userId: user.id, email: identity, eventType: 'LOGIN_SUCCESS', ip, userAgent, detail: 'With a recovery code' });
  }
  return completeLogin(req, res, user, identity, ip, userAgent);
});

/** Exchange a refresh token for a new pair. The old one is retired. */
authRouter.post('/refresh', refreshLimiter, async (req: Request, res: Response) => {
  const presented = refreshTokenFrom(req);
  if (presented.length < 10) return res.status(400).json({ error: 'Missing refresh token' });

  try {
    const rotated = await rotateSession(presented, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });
    await recordAuthEvent({
      accountId: rotated.session.accountId,
      userId: rotated.session.userId,
      eventType: 'TOKEN_REFRESHED',
      ip: clientIp(req),
    });
    // The rotated token replaces the cookie and, again, is not in the body.
    setRefreshCookie(res, rotated.refreshToken, rotated.session.expiresAt);
    return res.json({ token: rotated.accessToken });
  } catch (e: any) {
    /*
     * A refused refresh means this browser's session is over, so the cookie
     * should go with it — otherwise a stale or replayed token sits there being
     * re-sent on every attempt.
     */
    /* Lost a race with another tab: the winner's response has just set the new cookie, so this one must not clear it. */
    if (e instanceof AuthError && e.code === 'refresh_raced') return res.status(409).json({ error: e.message, code: e.code });
    clearRefreshCookie(res);
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    throw e;
  }
});

/** Real logout: the session is revoked server-side, not just forgotten locally. */
authRouter.post('/logout', async (req: Request, res: Response) => {
  const refreshToken = refreshTokenFrom(req) || undefined;
  // Cleared whatever happens next: a logout that leaves the credential in the
  // browser is not a logout.
  clearRefreshCookie(res);

  if (refreshToken) {
    const revoked = await revokeSession(refreshToken, 'LOGOUT', { ip: clientIp(req), userAgent: req.headers['user-agent'] as string | undefined });
    if (revoked) {
      await recordAuthEvent({
        accountId: revoked.accountId,
        userId: revoked.userId,
        eventType: 'LOGOUT',
        ip: clientIp(req),
      });
    }
  }
  return res.json({ ok: true });
});

/** Devices currently signed in, and a way to end them. */
authRouter.get('/sessions', requireLiveAuth, async (req: Request, res: Response) => {
  const auth = req.auth!;
  const sessions = await listSessions(auth.accountId, auth.userId);
  return res.json({ sessions });
});

authRouter.post('/sessions/revoke-all', requireLiveAuth, async (req: Request, res: Response) => {
  const auth = req.auth!;
  const result = await revokeAllSessions(auth.userId, 'USER_REVOKED_ALL', auth.sessionId);
  await recordAuthEvent({ accountId: auth.accountId, userId: auth.userId, eventType: 'SESSION_REVOKED', detail: 'User revoked all sessions' });
  return res.json({ ok: true, revoked: result.count });
});

authRouter.get('/me', requireLiveAuth, async (req: Request, res: Response) => {
  const auth = req.auth!;

  const activeOrgId = String(req.headers['x-org-id'] || '').trim();

  const user = await platformPrisma.user.findFirst({
    where: { id: auth.userId, accountId: auth.accountId, isActive: true },
    select: {
      id: true,
      email: true,
      username: true,
      fullName: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      accountId: true,
      code: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
    },
  });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const ownAccount = await platformPrisma.account.findUnique({ where: { id: user.accountId }, select: { code: true } });

  /* Same rule as login: every company this person can open. */
  const everyMembership = await platformPrisma.userOrgMembership.findMany({
    where: { userId: auth.userId },
    select: {
      orgId: true,
      accountId: true,
      /*
       * The company master, not only its name.
       *
       * A browser that has never seen this account has no company record at
       * all, and there was no route that would give it one — so signing in on
       * a new machine showed a placeholder called "Company" with no GSTIN and
       * no state, and offered to set the company up again. The books were
       * safe on the server the whole time; the browser simply had no way to
       * ask what company it was looking at.
       */
      org: { select: { id: true, name: true, slug: true, code: true, legacyCode: true, archivedAt: true, profileJson: true, createdByUserId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  /* GAP-006: and only those whose engagement, for a company of another account, is live. */
  const closedForMe = await closedForOutsider(auth.userId, user.accountId, everyMembership);
  const entryClosed = (await signInEntry(auth.userId, user)).closed;
  const orgMemberships = everyMembership.filter((m) => !closedForMe.has(m.orgId) && !entryClosed.has(m.orgId));

  let isOrgAdmin = false;
  let allowedBranchIds: string[] = [];

  /*
   * The account is taken from the membership for the company being opened, not
   * from the token.
   *
   * The token says which account owns the PERSON. Roles and branches belong to
   * the account that owns the COMPANY, and for an invited user those differ —
   * so reading them from the token returned no roles and no branches, which
   * reads as a user with no permissions rather than as a lookup against the
   * wrong account. This is the same correction already made in the tenant
   * middleware.
   */
  const activeMembership = activeOrgId
    ? orgMemberships.find((m) => m.orgId === activeOrgId) || null
    : null;
  const activeAccountId = activeMembership?.accountId || auth.accountId;

  if (activeOrgId) {
    const assignments = await platformPrisma.userRoleAssignment.findMany({
      where: { accountId: activeAccountId, orgId: activeOrgId, userId: auth.userId },
      select: { role: { select: { roleType: true, name: true } } },
    });
    // Legacy organisations may predate the explicit ADMIN role assignment.
    // The tenant and RBAC middleware already recognise the organisation creator
    // as its administrator, so the session context must report the same rule.
    isOrgAdmin =
      activeMembership?.org?.createdByUserId === auth.userId ||
      assignments.some((a) => String(a?.role?.roleType || '') === RoleType.ADMIN);

    if (isOrgAdmin) {
      const branches = await platformPrisma.branch.findMany({
        where: { accountId: activeAccountId, orgId: activeOrgId },
        select: { id: true },
        orderBy: { branchName: 'asc' },
      });
      allowedBranchIds = branches.map((b) => b.id);
    } else {
      const memberships = await platformPrisma.userBranchMembership.findMany({
        where: { accountId: activeAccountId, orgId: activeOrgId, userId: auth.userId },
        select: { branchId: true },
        orderBy: { createdAt: 'asc' },
      });
      allowedBranchIds = memberships.map((m) => m.branchId);
    }
  }

  /** The stored master, as an object — the browser should not parse JSON. */
  const orgProfile = (raw: string | null | undefined) => {
    try {
      const parsed = JSON.parse(String(raw || '{}'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      // A profile that cannot be parsed still has a name and an id, and
      // returning those beats failing the whole session.
      return {};
    }
  };

  /*
   * The branch each company opens in.
   *
   * Every tenant-scoped route requires an `x-branch-id`, including the route
   * that lists branches — so a client holding only a token could establish
   * context for the company it logged into and for no other. Switching company
   * was therefore impossible from a cold start: the header it needed could
   * only be learnt from a call that already needed the header.
   *
   * The platform shell is the thing that owns tenant context, so the platform
   * answers it: one branch per company, the first the user is a member of.
   */
  const branchMemberships = await platformPrisma.userBranchMembership.findMany({
    where: { userId: auth.userId, orgId: { in: orgMemberships.map((m) => m.orgId) } },
    select: { orgId: true, branchId: true },
    orderBy: { createdAt: 'asc' },
  });

  const defaultBranchByOrg: Record<string, string> = {};
  for (const m of branchMemberships) {
    if (!defaultBranchByOrg[m.orgId]) defaultBranchByOrg[m.orgId] = m.branchId;
  }

  /*
   * An org's creator has access to every branch in it but may hold no
   * membership row yet — the middleware writes one on first use. Without a
   * fallback their own company would come back with no branch at all.
   */
  const missing = orgMemberships.filter((m) => !defaultBranchByOrg[m.orgId]).map((m) => m.orgId);
  if (missing.length) {
    const firstBranches = await platformPrisma.branch.findMany({
      where: { orgId: { in: missing } },
      select: { id: true, orgId: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const b of firstBranches) {
      if (!defaultBranchByOrg[b.orgId]) defaultBranchByOrg[b.orgId] = b.id;
    }
  }

  /* SX-09: a company here requires an authenticator of this owner or admin, who has none. */
  let twoFactorSetupRequired = false;
  for (const m of orgMemberships) {
    if (await adminTwoFactorMissing(user.id, m.orgId)) {
      twoFactorSetupRequired = true;
      break;
    }
  }

  /*
   * W-2.1: every account this person can reach, for the account switcher —
   * their own (home) account and any reached through outside access — with
   * their account role in each (null where they have none, e.g. an outside
   * accountant). Shown, not trusted: each request is checked again.
   */
  const accountIds = [...new Set([user.accountId, ...orgMemberships.map((m) => m.accountId)])];
  const accountRows = await outsideTenant('auth/me: the accounts this person reaches', () =>
    platformPrisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, code: true } })
  );
  const accounts = await Promise.all(
    accountRows.map(async (a) => ({ id: a.id, name: a.name, code: a.code || null, home: a.id === user.accountId, role: await accountRoleOf(a.id, user.id) }))
  );
  accounts.sort((x, y) => Number(y.home) - Number(x.home) || String(x.name).localeCompare(String(y.name)));

  return res.json({
    /*
     * GAP-011 (ADR-003): `user.accountId` is the person's HOME account — where
     * they signed up, what their token carries. It is kept for older clients
     * and named plainly as `homeAccountId`. The account whose data is being
     * worked in is `activeAccountId`: the one that owns the active company,
     * which for an invited accountant is somebody else's.
     */
    user: { ...user, homeAccountId: user.accountId, accountCode: ownAccount?.code || null },
    activeAccountId: activeMembership ? activeMembership.accountId : null,
    orgs: orgMemberships.map((m) => ({
      orgId: m.orgId,
      accountId: m.accountId,
      branchId: defaultBranchByOrg[m.orgId] || null,
      org: {
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug || null,
        code: m.org.code || null,
        /* The code it had before the numbers (KAVE-C100): the shell still opens old links with it. */
        legacyCode: m.org.legacyCode || null,
        /* Archived: read-only; the shell lists it apart and says so. */
        archivedAt: m.org.archivedAt || null,
        profile: orgProfile(m.org.profileJson),
      },
    })),
    /* Only a company this person is in: the header is an echo, not a fact (A-10). */
    activeOrgId: activeMembership ? activeOrgId : null,
    /* W-1: the person's role in the account being worked in (OWNER / ADMIN / BILLING_ADMIN / MEMBER), or null. Shown, not trusted: every route checks it again. */
    accountRole: activeMembership ? await accountRoleOf(activeMembership.accountId, user.id) : await accountRoleOf(user.accountId, user.id),
    isOrgAdmin,
    accounts,
    allowedBranchIds,
    twoFactorSetupRequired,
    /* Explore: this session is the read-only sample company (services/explore.ts); the shell says so, with the days left. */
    explore: auth.explorePassId ? await exploreInfo(auth.explorePassId) : null,
  });
});

authRouter.post('/signup', signupLimiter, async (req: Request, res: Response) => {
  const body = z
    .object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      /** The privacy notice and terms version shown on the sign-up form. */
      noticeVersion: z.string().trim().max(40).optional(),
    })
    .parse(req.body);

  /* A new person belongs to no company yet, so the product's own rules apply (SX-13). */
  const weak = validatePassword(body.password, DEFAULT_POLICY);
  if (weak) return res.status(400).json({ error: weak, code: 'WEAK_PASSWORD' });

  const email = body.email.trim().toLowerCase();
  const existing = await platformPrisma.user.findFirst({ where: { email }, select: { id: true } });
  if (existing) return res.status(409).json({ error: 'User already exists. Please login.' });

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(body.password, rounds);

  /*
   * Provision identity and commercial access atomically, through the one
   * account-making path (services/accountProvisioning.ts). New accounts never
   * rely on the legacy fail-open rule: every available app they receive is an
   * explicit subscription item.
   */
  /* A trial, like the one clor.in starts (routes/signup.ts): the same length from the published
     price book, ending on a date. It used to be every app free and open-ended, which let anyone
     skip the trial by opening /signup (platform audit, 11 Nov 2026). */
  const offer = await trialOffer();
  const plan = { ...SIGNUP_APPS, status: 'trialing' as const, trialEndsAt: new Date(Date.now() + offer.trialDays * 86_400_000) };
  const { user } = await createAccountWithOwner({ email, name: body.name, passwordHash, noticeVersion: body.noticeVersion, plan });

  const { session, refreshToken } = await createSession({
    accountId: user.accountId,
    userId: user.id,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] as string | undefined,
  });
  await recordAuthEvent({ accountId: user.accountId, userId: user.id, email, eventType: 'LOGIN_SUCCESS', ip: clientIp(req), detail: 'Signup' });

  const token = signAccessToken({ userId: user.id, accountId: user.accountId, sid: session.id });

  // Verification is sent but does not block sign-in: a new user should be able
  // to look around while the message is in flight.
  const verifyToken = await issueEmailVerificationToken({ id: user.id, accountId: user.accountId, email: user.email });
  await sendTemplate({
    templateKey: 'auth.verify_email',
    to: user.email,
    toName: user.fullName,
    accountId: user.accountId,
    data: {
      userName: user.fullName,
      email: user.email,
      verifyUrl: `${process.env.APP_URL || 'http://localhost:5173'}/?verify=${verifyToken}`,
    },
    relatedType: 'User',
    relatedId: user.id,
    transactional: true,
  });

  setRefreshCookie(res, refreshToken, session.expiresAt);

  return res.json({
    token,
    user,
    emailVerificationSent: true,
    ...(isDevOrTest() ? { devVerifyToken: verifyToken } : {}),
  });
});

authRouter.post('/setup-company', requireLiveAuth, async (req: Request, res: Response) => {
  const auth = req.auth!;

  const body = z
    .object({
      companyName: z.string().min(1),
      /*
       * The state of the head office, and the single most consequential thing
       * asked at signup. It decides whether every invoice this business ever
       * raises splits into CGST + SGST or lands as IGST, and it used to be
       * hard-coded to Karnataka for every tenant on earth — so a business in
       * Maharashtra billing a customer in Maharashtra was charged IGST, and
       * nothing on the screen said why.
       */
      state: z.string().min(1),
      gstin: z.string().trim().toUpperCase().optional().nullable(),
      /*
       * The rest of the company master. Optional so an older client that sends
       * only a name and a state still works, and unvalidated beyond its shape
       * because nothing branches on it — it is read back onto one screen.
       */
      profile: z.record(z.string(), z.any()).optional(),
    })
    .parse(req.body);

  const stateName = String(body.state || '').trim();
  if (!deriveStateCodeFromInput(stateName)) {
    return res.status(400).json({ error: `Unknown state: ${stateName}` });
  }

  const gstin = String(body.gstin || '').trim().toUpperCase();
  // Throws a 400 on a bad format, a bad checksum, or a GSTIN whose own state
  // code disagrees with the state that was chosen.
  validateGstinOrThrow(gstin, stateName);

  /*
   * A-04 / W-1.4: whoever creates a company becomes its Administrator, so
   * creating one is an account-level act. Allowed for the account's very first
   * company (signup) and, after that, for an owner or administrator of the
   * account (AccountMembership). It used to be "an administrator of any of its
   * companies" — the migration made exactly those people account admins.
   */
  const accountOrgs = await platformPrisma.org.findMany({ where: { accountId: auth.accountId }, select: { id: true } });
  if (accountOrgs.length) {
    const role = await accountRoleOf(auth.accountId, auth.userId);
    if (!role || !ACCOUNT_ADMINS.includes(role)) {
      return res.status(403).json({
        error: 'Only an owner or administrator of this account can add a company. Ask your administrator.',
        code: 'NOT_ACCOUNT_ADMIN',
      });
    }
  }

  /* Everything a new company needs, in the one account-making path (services/accountProvisioning.ts). */
  let made;
  try {
    made = await createCompany({ accountId: auth.accountId, userId: auth.userId, companyName: body.companyName, state: stateName, gstin, profile: body.profile });
  } catch (e) {
    if (e instanceof QuotaBusyError || e instanceof ProvisionError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
  const { org, branch } = made;

  // Frontend expects { company: { id, name, orgId }, branch: { id } }
  return res.json({
    company: { id: org.id, name: org.name, orgId: org.id, slug: org.slug },
    branch: { id: branch.id },
  });
});

authRouter.post('/forgot-password', resetLimiter, async (req: Request, res: Response) => {
  const body = z.object({ email: z.string().email() }).parse(req.body);
  const email = body.email.trim().toLowerCase();
  const ip = clientIp(req);

  const user = await platformPrisma.user.findFirst({
    where: { email },
    select: { id: true, accountId: true, isActive: true },
  });

  // Always the same answer, so this endpoint cannot be used to discover which
  // addresses have accounts.
  const generic = { message: 'If an account exists, a reset link has been sent to your email.' };

  if (!user || !user.isActive) {
    await recordAuthEvent({ email, eventType: 'PASSWORD_RESET_REQUESTED', ip, detail: 'No such active user' });
    return res.json(generic);
  }

  const token = await issuePasswordResetToken({ id: user.id, accountId: user.accountId }, ip);
  await recordAuthEvent({ accountId: user.accountId, userId: user.id, email, eventType: 'PASSWORD_RESET_REQUESTED', ip });

  await sendTemplate({
    templateKey: 'auth.password_reset',
    to: email,
    accountId: user.accountId,
    data: {
      userName: email,
      resetUrl: `${process.env.APP_URL || 'http://localhost:5173'}/?reset=${token}`,
    },
    relatedType: 'User',
    relatedId: user.id,
    transactional: true,
  });

  // Until SMTP is wired the token is returned outside production so the flow is
  // testable. It is a cryptographically random, single-use, 30-minute token
  // stored only as a hash.
  return res.json({
    ...generic,
    devToken: isDevOrTest() ? token : undefined,
  });
});

authRouter.post('/reset-password', resetLimiter, async (req: Request, res: Response) => {
  const body = z.object({ token: z.string().min(10), password: z.string().min(8) }).parse(req.body);

  /* The person's companies' password rules, checked before the link is used up,
     so a refused password leaves the link working for a second try (SX-13). */
  const pending = await peekPasswordResetToken(body.token);
  if (pending) {
    const weak = validatePassword(body.password, await policyForUser(pending.accountId, pending.userId));
    if (weak) return res.status(400).json({ error: weak, code: 'WEAK_PASSWORD' });
  }

  let record;
  try {
    record = await consumePasswordResetToken(body.token);
  } catch (e: any) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(body.password, rounds);

  await platformPrisma.user.update({
    where: { id: record.userId },
    data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
  });

  // Changing the password ends every existing session: if the reset was because
  // the account was compromised, leaving the attacker signed in defeats it.
  await revokeAllSessions(record.userId, 'PASSWORD_RESET');
  await recordAuthEvent({
    accountId: record.accountId,
    userId: record.userId,
    eventType: 'PASSWORD_RESET',
    ip: clientIp(req),
    detail: 'All sessions revoked',
  });

  return res.json({ message: 'Password reset successfully. Please sign in again.' });
});

/** Confirms an address from the emailed link. */
authRouter.post('/verify-email', async (req: Request, res: Response) => {
  const body = z.object({ token: z.string().min(10) }).parse(req.body);
  try {
    const row = await consumeEmailVerificationToken(body.token);
    await recordAuthEvent({
      accountId: row.accountId,
      userId: row.userId,
      email: row.email,
      eventType: 'EMAIL_VERIFIED',
      ip: clientIp(req),
    });
    return res.json({ ok: true, email: row.email });
  } catch (e: any) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** Sends a fresh link. Rate limited, and silent about whether it applied. */
authRouter.post('/resend-verification', resetLimiter, requireLiveAuth, async (req: Request, res: Response) => {
  const auth = req.auth!;

  const user = await platformPrisma.user.findFirst({
    where: { id: auth.userId, accountId: auth.accountId },
    select: { id: true, accountId: true, email: true, fullName: true, emailVerifiedAt: true },
  });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.emailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });

  const token = await issueEmailVerificationToken(user);
  await sendTemplate({
    templateKey: 'auth.verify_email',
    to: user.email,
    toName: user.fullName,
    accountId: user.accountId,
    data: {
      userName: user.fullName,
      email: user.email,
      verifyUrl: `${process.env.APP_URL || 'http://localhost:5173'}/?verify=${token}`,
    },
    relatedType: 'User',
    relatedId: user.id,
    transactional: true,
  });

  return res.json({
    ok: true,
    ...(isDevOrTest() ? { devVerifyToken: token } : {}),
  });
});

/**
 * #4: a new link for someone whose sign-in was refused because their company
 * asks for a confirmed address. They have no session, so the refusal carried
 * a short-lived token (services/signInRules.ts) that only the right password
 * earned; it asks for the link and nothing else.
 */
authRouter.post('/resend-verification/sign-in', resetLimiter, async (req: Request, res: Response) => {
  const userId = resendChallengeUser(String(req.body?.challenge || ''));
  if (!userId) return res.status(400).json({ error: 'That took too long. Sign in again to ask for a new link.', code: 'CHALLENGE_EXPIRED' });
  const user = await platformPrisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true, accountId: true, email: true, fullName: true, emailVerifiedAt: true } });
  if (!user) return res.status(400).json({ error: 'That took too long. Sign in again to ask for a new link.', code: 'CHALLENGE_EXPIRED' });
  if (user.emailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });
  const token = await issueEmailVerificationToken(user);
  await sendTemplate({
    templateKey: 'auth.verify_email',
    to: user.email,
    toName: user.fullName,
    accountId: user.accountId,
    data: { userName: user.fullName, email: user.email, verifyUrl: `${process.env.APP_URL || 'http://localhost:5173'}/?verify=${token}` },
    relatedType: 'User',
    relatedId: user.id,
    transactional: true,
  });
  await recordAuthEvent({ accountId: user.accountId, userId: user.id, email: user.email, eventType: 'VERIFICATION_RESENT', ip: clientIp(req), detail: 'From a refused sign-in' });
  return res.json({ ok: true, ...(isDevOrTest() ? { devVerifyToken: token } : {}) });
});

/** Update your own name. Email changes go through verification separately. */
/**
 * Everything this service holds about the person signed in, as a download.
 *
 * Their own records: profile, the companies they belong to, their sign-in
 * sessions and sign-in history. Not the companies' books — those belong to the
 * business and leave through the company data export, under its own
 * permission. No password hash, token hash or secret is included.
 */
authRouter.get('/me/export', requireLiveAuth, async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const user = await platformPrisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      fullName: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      isActive: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const memberships = await platformPrisma.userOrgMembership.findMany({
    where: { userId },
    select: { createdAt: true, org: { select: { id: true, name: true } } },
  });
  const sessions = await platformPrisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, revokedReason: true, ip: true, userAgent: true },
  });
  const signIns = await platformPrisma.authEvent.findMany({
    where: { OR: [{ userId }, { email: user.email }] },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: { createdAt: true, eventType: true, ip: true, userAgent: true },
  });

  res.setHeader('Content-Disposition', `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    about:
      'Your personal data held by this service. The books of the companies you work in are the business’s records and are exported from the company, not here.',
    profile: user,
    companies: memberships.map((m) => ({ id: m.org.id, name: m.org.name, memberSince: m.createdAt })),
    sessions,
    signInHistory: signIns,
  });
});

authRouter.patch('/me', requireLiveAuth, async (req: Request, res: Response) => {
  const auth = req.auth!;

  /**
   * Everything here is optional, so a caller that only sends one field does not
   * blank the others. `fullName` stays the display source: when first or last
   * name is sent it is recomposed from them, because two writers for one
   * displayed string is how they end up disagreeing.
   *
   * The avatar is a data URL the client has already resized. The cap is on the
   * encoded string rather than the decoded image: it is the thing actually
   * being stored, and a row is cheap to read only while it stays small.
   */
  const AVATAR_MAX = 96 * 1024;

  const body = z
    .object({
      fullName: z.string().min(1).max(120).optional(),
      firstName: z.string().max(60).optional(),
      lastName: z.string().max(60).optional(),
      username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/).optional().or(z.literal('')),
      phone: z.string().max(20).optional().or(z.literal('')),
      avatarUrl: z
        .string()
        .max(AVATAR_MAX, 'That image is too large. Pick one under about 70 KB.')
        .refine((v) => v === '' || /^data:image\/(png|jpeg|webp);base64,/.test(v), 'Unsupported image format.')
        .optional(),
    })
    .parse(req.body);

  const data: Record<string, string | null> = {};

  if (body.firstName !== undefined) data.firstName = body.firstName.trim() || null;
  if (body.lastName !== undefined) data.lastName = body.lastName.trim() || null;
  if (body.phone !== undefined) data.phone = body.phone.trim() || null;
  if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl || null;

  if (body.username !== undefined) {
    const next = body.username.trim();
    if (next) {
      // Usernames are a login credential, so a collision has to be refused
      // rather than left for the unique index to turn into a 500.
      const taken = await platformPrisma.user.findFirst({
        where: { username: next, NOT: { id: auth.userId } },
        select: { id: true },
      });
      if (taken) return res.status(409).json({ error: 'That username is already taken.' });
      data.username = next;
    } else {
      data.username = null;
    }
  }

  const composed = [
    body.firstName !== undefined ? body.firstName.trim() : undefined,
    body.lastName !== undefined ? body.lastName.trim() : undefined,
  ];
  if (composed.some((v) => v !== undefined)) {
    const existing = await platformPrisma.user.findUnique({
      where: { id: auth.userId },
      select: { firstName: true, lastName: true, fullName: true },
    });
    const first = composed[0] !== undefined ? composed[0] : existing?.firstName || '';
    const last = composed[1] !== undefined ? composed[1] : existing?.lastName || '';
    const joined = [first, last].filter(Boolean).join(' ').trim();
    if (joined) data.fullName = joined;
  }
  if (body.fullName !== undefined) data.fullName = body.fullName.trim();

  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update.' });

  const user = await platformPrisma.user.update({
    where: { id: auth.userId },
    data,
    select: {
      id: true,
      email: true,
      username: true,
      fullName: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      accountId: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
    },
  });

  return res.json({ user });
});
