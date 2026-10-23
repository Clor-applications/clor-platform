import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { decryptSecret, encryptSecret } from '../services/mailer.js';
import { callbackUrl, samlAcsUrl, samlEntityId } from './sso.js';
import { VERIFY_PREFIX, checkDomains, domainProblem, domainsOf, keptVerified, newDomainToken, verificationSkipped } from '../services/ssoDomains.js';
import { newScimToken } from './scim.js';
import { hashToken } from './publicApi.js';
import { codeLimiter } from '../middleware/rateLimit.js';
import { hashRecovery, newSecret, otpauthUri, recoveryCodes, verifyCode } from '../services/totp.js';
import { STEP_UP_MINUTES, issueStepUp } from '../services/stepUp.js';
import {
  clientIp,
  recordAuthEvent,
  revokeAllSessions,
  listSessions,
} from '../services/auth.js';
import { getAuthPolicy, describePasswordRules, validatePassword } from '../services/policy.js';

/**
 * Security administration: the policy an organisation enforces, the sign-in
 * methods it accepts, plus a user's own sessions and password.
 *
 * Configuration lives here rather than in environment variables because each
 * organisation needs its own — one tenant's lockout rule cannot be another's,
 * and an identity provider is per-customer by definition.
 */
export const securityRouter = Router();
securityRouter.use(requireAuth, requireTenantContext);

const VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Users');
const EDIT = requirePermission('SETTINGS', PermissionAction.EDIT, 'Users');

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const policySchema = z.object({
  maxFailedLogins: z.number().int().min(3).max(50),
  lockoutMinutes: z.number().int().min(1).max(1440),
  sessionDays: z.number().int().min(1).max(365),
  accessTokenMinutes: z.number().int().min(5).max(1440),
  passwordMinLength: z.number().int().min(8).max(64),
  passwordRequireMixedCase: z.boolean(),
  passwordRequireNumber: z.boolean(),
  passwordRequireSymbol: z.boolean(),
  requireVerifiedEmail: z.boolean(),
  allowedEmailDomains: z.string().max(500).optional().nullable(),
  requirePayrollStepUp: z.boolean().optional(),
  requireAdminTwoFactor: z.boolean().optional(),
});

securityRouter.get('/orgs/:orgId/security/policy', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const policy = await getAuthPolicy(req.tenant!.accountId, req.tenant!.orgId);
  res.json({ policy, passwordRules: describePasswordRules(policy) });
});

securityRouter.put('/orgs/:orgId/security/policy', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = policySchema.parse(req.body);

  /*
   * Turning on 'two-factor for owners and admins' while the person doing it has
   * no authenticator would lock them out of their own company on the next
   * request. Ask them to set theirs up first.
   */
  if (body.requireAdminTwoFactor) {
    const me = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { totpEnabledAt: true } });
    if (!me?.totpEnabledAt) {
      return res.status(400).json({ error: 'Set up your own authenticator app first (My profile → Security), then require it for owners and admins.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
    }
  }

  const saved = await platformPrisma.authPolicy.upsert({
    where: { orgId },
    update: { ...body, allowedEmailDomains: body.allowedEmailDomains ?? null, updatedByUserId: req.auth!.userId },
    create: {
      accountId,
      orgId,
      ...body,
      allowedEmailDomains: body.allowedEmailDomains ?? null,
      updatedByUserId: req.auth!.userId,
    },
  });

  await recordAuthEvent({
    accountId,
    userId: req.auth!.userId,
    eventType: 'POLICY_CHANGED',
    ip: clientIp(req),
    detail: `Lockout ${saved.maxFailedLogins}/${saved.lockoutMinutes}m, session ${saved.sessionDays}d`,
  });

  res.json({ policy: saved, passwordRules: describePasswordRules(saved) });
});

// ---------------------------------------------------------------------------
// Sign-in methods
// ---------------------------------------------------------------------------

const providerSchema = z.object({
  kind: z.enum(['OIDC', 'SAML']),
  name: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  issuer: z.string().max(300).optional().nullable(),
  clientId: z.string().max(300).optional().nullable(),
  clientSecret: z.string().max(500).optional(),
  discoveryUrl: z.string().max(500).optional().nullable(),
  scopes: z.string().max(200).optional().nullable(),
  entryPoint: z.string().max(500).optional().nullable(),
  entityId: z.string().max(300).optional().nullable(),
  certificate: z.string().max(8000).optional().nullable(),
  emailDomains: z.string().max(300).optional().nullable(),
  autoProvision: z.boolean().optional(),
  defaultRoleId: z.string().optional().nullable(),
});

/** Secrets are never returned, only whether one is stored. */
const publicProvider = (p: any) => ({
  id: p.id,
  kind: p.kind,
  name: p.name,
  enabled: p.enabled,
  issuer: p.issuer,
  clientId: p.clientId,
  hasClientSecret: Boolean(p.clientSecretEnc),
  discoveryUrl: p.discoveryUrl,
  scopes: p.scopes,
  entryPoint: p.entryPoint,
  entityId: p.entityId,
  hasCertificate: Boolean(p.certificate),
  emailDomains: p.emailDomains,
  autoProvision: p.autoProvision,
  defaultRoleId: p.defaultRoleId,
  lastUsedAt: p.lastUsedAt,
  lastError: p.lastError,
  /* Proof of each domain: the TXT record to publish, and which are proven. */
  domainVerification: {
    record: p.domainVerifyToken ? `${VERIFY_PREFIX}${p.domainVerifyToken}` : null,
    domains: domainsOf(p.emailDomains).map((d) => ({ domain: d, verified: domainsOf(p.verifiedDomains).includes(d) })),
  },
  // Both kinds sign people in (routes/sso.ts).
  status: p.enabled ? ('ACTIVE' as const) : ('DISABLED' as const),
  // SAML: what the administrator enters at the identity provider for CLOR.
  ...(p.kind === 'SAML' ? { saml: { acsUrl: samlAcsUrl(p.id), spEntityId: samlEntityId(p.id), metadataUrl: samlEntityId(p.id) } } : {}),
});

/* ------------------------------------------------------------ SCIM tokens */

const scimBase = () => `${process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || 'https://api.clor.in'}/scim/v2`;
const publicScim = (t: { id: string; tokenPrefix: string; defaultRoleId: string | null; lastUsedAt: Date | null; lastError: string | null; createdAt: Date }) => ({ id: t.id, tokenPrefix: t.tokenPrefix, defaultRoleId: t.defaultRoleId, lastUsedAt: t.lastUsedAt, lastError: t.lastError, createdAt: t.createdAt });

/** Directory sync: the SCIM address and the tokens made for it. */
securityRouter.get('/orgs/:orgId/security/scim', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const rows = await platformPrisma.scimToken.findMany({ where: { accountId: req.tenant!.accountId, orgId: req.tenant!.orgId }, orderBy: { createdAt: 'asc' } });
  res.json({ baseUrl: scimBase(), tokens: rows.map(publicScim) });
});

/** A new token, shown once. */
securityRouter.post('/orgs/:orgId/security/scim', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const defaultRoleId = req.body?.defaultRoleId ? String(req.body.defaultRoleId) : null;
  const role = defaultRoleId ? await platformPrisma.role.findFirst({ where: { id: defaultRoleId, orgId }, select: { roleType: true } }) : null;
  if (defaultRoleId && !role) return res.status(400).json({ error: 'That role is not in this organisation.' });
  if (role?.roleType === 'ADMIN') return res.status(400).json({ error: 'People from the directory cannot be given an administrator role automatically; assign it by hand.' });
  if ((await platformPrisma.scimToken.count({ where: { orgId } })) >= 5) return res.status(400).json({ error: 'Five tokens is the most; revoke one first.' });
  const token = newScimToken();
  const row = await platformPrisma.scimToken.create({ data: { accountId, orgId, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), defaultRoleId, createdByUserId: req.auth!.userId } });
  res.status(201).json({ token, scim: publicScim(row), baseUrl: scimBase() });
});

securityRouter.delete('/orgs/:orgId/security/scim/:id', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const row = await platformPrisma.scimToken.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId } });
  if (!row) return res.status(404).json({ error: 'No such token.' });
  await platformPrisma.scimToken.delete({ where: { id: row.id } });
  res.json({ ok: true });
});

securityRouter.get('/orgs/:orgId/security/providers', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const rows = await platformPrisma.authProvider.findMany({
    where: { accountId: req.tenant!.accountId, orgId: req.tenant!.orgId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({
    providers: rows.map(publicProvider),
    // LOCAL is implicit and always available, so it is described rather than stored.
    local: { kind: 'LOCAL', name: 'Email and password', enabled: true, status: 'ACTIVE' },
    // What the administrator registers at the provider as the allowed redirect.
    redirectUri: callbackUrl(),
  });
});

/** Rejects a configuration that could not possibly work. */
function validateProvider(body: z.infer<typeof providerSchema>, hasStoredSecret: boolean, hasStoredCert = false) {
  if (body.kind === 'OIDC') {
    if (!body.issuer && !body.discoveryUrl) return 'An OIDC provider needs an issuer or a discovery URL';
    if (!body.clientId) return 'Client ID is required';
    if (!body.clientSecret && !hasStoredSecret) return 'Client secret is required';
  }
  if (body.kind === 'SAML') {
    if (!body.entryPoint) return 'Sign-in URL is required';
    if (!body.entityId) return 'Entity ID is required';
    if (!body.certificate && !hasStoredCert) return 'The identity provider certificate is required';
  }
  return null;
}

securityRouter.post('/orgs/:orgId/security/providers', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = providerSchema.parse(req.body);

  const problem = validateProvider(body, false) || (await domainProblem(accountId, body.emailDomains));
  if (problem) return res.status(400).json({ error: problem });
  /* Switched on only once its domains are proven (verify-domains below). */
  if (body.enabled && !verificationSkipped()) return res.status(400).json({ error: 'Add it switched off, publish the TXT record on each domain, choose Verify, then switch it on.' });

  try {
    const created = await platformPrisma.authProvider.create({
      data: {
        accountId,
        orgId,
        kind: body.kind,
        name: body.name.trim(),
        enabled: body.enabled ?? false,
        issuer: body.issuer ?? null,
        clientId: body.clientId ?? null,
        clientSecretEnc: body.clientSecret ? encryptSecret(body.clientSecret) : null,
        discoveryUrl: body.discoveryUrl ?? null,
        scopes: body.scopes ?? 'openid email profile',
        entryPoint: body.entryPoint ?? null,
        entityId: body.entityId ?? null,
        certificate: body.certificate ?? null,
        emailDomains: body.emailDomains ?? null,
        domainVerifyToken: newDomainToken(),
        verifiedDomains: verificationSkipped() ? domainsOf(body.emailDomains).join(',') || null : null,
        autoProvision: body.autoProvision ?? false,
        defaultRoleId: body.defaultRoleId ?? null,
        createdByUserId: req.auth!.userId,
      },
    });
    await recordAuthEvent({
      accountId,
      userId: req.auth!.userId,
      eventType: 'PROVIDER_ADDED',
      detail: `${created.kind} ${created.name}`,
      ip: clientIp(req),
    });
    res.status(201).json({ provider: publicProvider(created) });
  } catch (err: any) {
    if (String(err?.code || '') === 'P2002') {
      return res.status(409).json({ error: 'A sign-in method with that name already exists' });
    }
    throw err;
  }
});

securityRouter.patch('/orgs/:orgId/security/providers/:providerId', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await platformPrisma.authProvider.findFirst({
    where: { id: String(req.params.providerId), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Sign-in method not found' });

  const body = providerSchema.parse({ ...req.body, kind: req.body.kind || existing.kind });
  const problem = validateProvider(body, Boolean(existing.clientSecretEnc), Boolean(existing.certificate));
  if (problem) return res.status(400).json({ error: problem });
  const domainIssue = await domainProblem(accountId, body.emailDomains ?? existing.emailDomains);
  if (domainIssue) return res.status(400).json({ error: domainIssue });
  const nextDomains = body.emailDomains ?? null;
  const nextVerified = verificationSkipped() ? domainsOf(nextDomains).join(',') || null : keptVerified(existing.verifiedDomains, nextDomains);
  const wantsOn = body.enabled ?? existing.enabled;
  if (wantsOn && domainsOf(nextDomains).some((d) => !domainsOf(nextVerified).includes(d))) {
    return res.status(400).json({ error: 'Every domain must be verified before this sign-in method is switched on. Publish the TXT record and choose Verify.' });
  }

  const updated = await platformPrisma.authProvider.update({
    where: { id: existing.id },
    data: {
      name: body.name.trim(),
      enabled: body.enabled ?? existing.enabled,
      issuer: body.issuer ?? null,
      clientId: body.clientId ?? null,
      // Absent means keep the stored secret; empty string clears it.
      ...(body.clientSecret === undefined
        ? {}
        : { clientSecretEnc: body.clientSecret ? encryptSecret(body.clientSecret) : null }),
      discoveryUrl: body.discoveryUrl ?? null,
      scopes: body.scopes ?? existing.scopes,
      entryPoint: body.entryPoint ?? null,
      entityId: body.entityId ?? null,
      certificate: body.certificate ?? existing.certificate,
      emailDomains: nextDomains,
      verifiedDomains: nextVerified,
      domainVerifyToken: existing.domainVerifyToken || newDomainToken(),
      autoProvision: body.autoProvision ?? existing.autoProvision,
      defaultRoleId: body.defaultRoleId ?? null,
    },
  });

  res.json({ provider: publicProvider(updated) });
});

/** Look for the TXT record on each of the provider's domains and keep the ones proven. */
securityRouter.post('/orgs/:orgId/security/providers/:providerId/verify-domains', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const p = await platformPrisma.authProvider.findFirst({ where: { id: String(req.params.providerId), accountId, orgId } });
  if (!p) return res.status(404).json({ error: 'Sign-in method not found' });
  const token = p.domainVerifyToken || newDomainToken();
  const results = await checkDomains(accountId, token, p.emailDomains);
  const verified = results.filter((r) => r.verified).map((r) => r.domain).join(',') || null;
  const updated = await platformPrisma.authProvider.update({ where: { id: p.id }, data: { domainVerifyToken: token, verifiedDomains: verified } });
  res.json({ provider: publicProvider(updated), results, record: `${VERIFY_PREFIX}${token}` });
});

securityRouter.delete('/orgs/:orgId/security/providers/:providerId', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await platformPrisma.authProvider.findFirst({
    where: { id: String(req.params.providerId), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Sign-in method not found' });
  await platformPrisma.authProvider.delete({ where: { id: existing.id } });
  await recordAuthEvent({
    accountId,
    userId: req.auth!.userId,
    eventType: 'PROVIDER_REMOVED',
    detail: `${existing.kind} ${existing.name}`,
    ip: clientIp(req),
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The signed-in user's own security
// ---------------------------------------------------------------------------

securityRouter.get('/orgs/:orgId/security/my-sessions', async (req, res) => {
  if (!orgOk(req, res)) return;
  const sessions = await listSessions(req.tenant!.accountId, req.auth!.userId);
  res.json({ sessions });
});

securityRouter.post('/orgs/:orgId/security/my-sessions/revoke-all', async (req, res) => {
  if (!orgOk(req, res)) return;
  const result = await revokeAllSessions(req.auth!.userId, 'USER_REVOKED_ALL', req.auth!.sessionId);
  await recordAuthEvent({
    accountId: req.tenant!.accountId,
    userId: req.auth!.userId,
    eventType: 'SESSION_REVOKED',
    detail: 'User signed out everywhere',
    ip: clientIp(req),
  });
  res.json({ ok: true, revoked: result.count });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

securityRouter.post('/orgs/:orgId/security/change-password', async (req, res) => {
  if (!orgOk(req, res)) return;
  const body = changePasswordSchema.parse(req.body);

  const user = await platformPrisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!ok) {
    await recordAuthEvent({
      accountId: req.tenant!.accountId,
      userId: user.id,
      eventType: 'PASSWORD_CHANGE_FAILED',
      ip: clientIp(req),
    });
    return res.status(400).json({ error: 'Your current password is not correct' });
  }

  const policy = await getAuthPolicy(req.tenant!.accountId, req.tenant!.orgId);
  const problem = validatePassword(body.newPassword, policy);
  if (problem) return res.status(400).json({ error: problem });

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  await platformPrisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, rounds) },
  });

  // Other devices are signed out; this one keeps its session.
  await revokeAllSessions(user.id, 'PASSWORD_CHANGED', req.auth!.sessionId);
  await recordAuthEvent({
    accountId: req.tenant!.accountId,
    userId: user.id,
    eventType: 'PASSWORD_CHANGED',
    ip: clientIp(req),
    detail: 'All sessions revoked',
  });

  res.json({ ok: true, message: 'Password changed. Other devices were signed out.' });
});

// ---------------------------------------------------------------------------
// Authenticator app (TOTP) and step-up — services/totp.ts, services/stepUp.ts
// ---------------------------------------------------------------------------

const me2fa = (req: any) =>
  platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, email: true, passwordHash: true, totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true, totpRecoveryJson: true } });

securityRouter.get('/orgs/:orgId/security/two-factor', async (req, res) => {
  if (!orgOk(req, res)) return;
  const [u, policy] = await Promise.all([me2fa(req), platformPrisma.authPolicy.findUnique({ where: { orgId: req.tenant!.orgId }, select: { requirePayrollStepUp: true } })]);
  const left = u?.totpRecoveryJson ? (JSON.parse(u.totpRecoveryJson) as string[]).length : 0;
  res.json({ enabled: !!u?.totpEnabledAt, enabledAt: u?.totpEnabledAt || null, recoveryCodesLeft: left, payrollStepUp: !!policy?.requirePayrollStepUp, stepUpMinutes: STEP_UP_MINUTES });
});

/** A new secret, not yet in force: it is switched on only by a code from it. */
securityRouter.post('/orgs/:orgId/security/two-factor/setup', async (req, res) => {
  if (!orgOk(req, res)) return;
  const u = await me2fa(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (u.totpEnabledAt) return res.status(409).json({ error: 'An authenticator is already set up. Turn it off first to set up another.', code: 'ALREADY_ENABLED' });
  const secret = newSecret();
  await platformPrisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: encryptSecret(secret), totpLastStep: null } });
  res.json({ secret, uri: otpauthUri(secret, u.email) });
});

securityRouter.post('/orgs/:orgId/security/two-factor/enable', ...codeLimiter, async (req, res) => {
  if (!orgOk(req, res)) return;
  const u = await me2fa(req);
  if (!u?.totpSecretEnc) return res.status(400).json({ error: 'Start the set-up first.' });
  if (u.totpEnabledAt) return res.status(409).json({ error: 'Already set up.', code: 'ALREADY_ENABLED' });
  const step = verifyCode(decryptSecret(u.totpSecretEnc), String(req.body?.code || ''), null);
  if (step == null) return res.status(400).json({ error: 'That code is not right. Check the time on your phone and try the newest code.', code: 'BAD_CODE' });
  const { codes, hashes } = recoveryCodes();
  await platformPrisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, totpRecoveryJson: JSON.stringify(hashes) } });
  await recordAuthEvent({ accountId: req.tenant!.accountId, userId: u.id, eventType: 'TWO_FACTOR_ENABLED', ip: clientIp(req) });
  res.json({ enabled: true, recoveryCodes: codes });
});

/**
 * Spends one authenticator code or one recovery code; null when neither is
 * good. A code works once, however many requests race with it.
 */
async function useSecondFactor(u: { id: string; totpSecretEnc: string | null; totpLastStep: number | null; totpRecoveryJson: string | null }, raw: string): Promise<'CODE' | 'RECOVERY' | null> {
  const code = raw.trim();
  if (!u.totpSecretEnc) return null;
  const step = verifyCode(decryptSecret(u.totpSecretEnc), code, u.totpLastStep);
  if (step != null) {
    const won = await platformPrisma.user.updateMany({ where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return won.count ? 'CODE' : null;
  }
  if (/^[A-Z2-7]{4}-?[A-Z2-7]{4}$/i.test(code)) {
    const hashes = JSON.parse(u.totpRecoveryJson || '[]') as string[];
    const h = hashRecovery(code);
    if (hashes.includes(h)) {
      await platformPrisma.user.update({ where: { id: u.id }, data: { totpRecoveryJson: JSON.stringify(hashes.filter((x) => x !== h)) } });
      return 'RECOVERY';
    }
  }
  return null;
}

securityRouter.post('/orgs/:orgId/security/two-factor/disable', ...codeLimiter, async (req, res) => {
  if (!orgOk(req, res)) return;
  const u = await me2fa(req);
  if (!u?.totpEnabledAt) return res.status(400).json({ error: 'No authenticator is set up.' });
  if (!(await bcrypt.compare(String(req.body?.password || ''), u.passwordHash))) return res.status(400).json({ error: 'Your password is not correct.', code: 'BAD_PASSWORD' });
  /*
   * A-10: the password alone was enough, so whoever learned it could take the
   * second factor off and leave the account with one. Turning it off now needs
   * the factor itself: a current code, or a recovery code if the phone is lost.
   */
  if (!(await useSecondFactor(u, String(req.body?.code || '')))) {
    return res.status(400).json({ error: 'Enter a current code from your authenticator app, or one of your recovery codes.', code: 'BAD_CODE' });
  }
  await platformPrisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryJson: null } });
  await recordAuthEvent({ accountId: req.tenant!.accountId, userId: u.id, eventType: 'TWO_FACTOR_DISABLED', ip: clientIp(req) });
  res.json({ enabled: false });
});

/** A code (or a recovery code) for fifteen minutes of money-moving payroll actions. */
securityRouter.post('/orgs/:orgId/security/step-up', ...codeLimiter, async (req, res) => {
  if (!orgOk(req, res)) return;
  const u = await me2fa(req);
  if (!u?.totpEnabledAt || !u.totpSecretEnc) return res.status(400).json({ error: 'Set up an authenticator app first.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
  const used = await useSecondFactor(u, String(req.body?.code || ''));
  if (!used) {
    await recordAuthEvent({ accountId: req.tenant!.accountId, userId: u.id, eventType: 'STEP_UP_FAILED', ip: clientIp(req) });
    return res.status(400).json({ error: 'That code is not right, or has been used. Wait for the next one.', code: 'BAD_CODE' });
  }
  await recordAuthEvent({ accountId: req.tenant!.accountId, userId: u.id, eventType: 'STEP_UP', ip: clientIp(req), detail: used === 'RECOVERY' ? 'With a recovery code' : undefined });
  res.json(issueStepUp(u.id, req.auth!.sessionId));
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

securityRouter.get('/orgs/:orgId/security/events', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const events = await platformPrisma.authEvent.findMany({
    where: {
      accountId: req.tenant!.accountId,
      ...(req.query.userId ? { userId: String(req.query.userId) } : {}),
      ...(req.query.type ? { eventType: String(req.query.type) } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Number(req.query.limit || 100)),
  });

  const userIds = Array.from(new Set(events.map((e) => e.userId).filter(Boolean))) as string[];
  const users = userIds.length
    ? await platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  res.json({
    events: events.map((e) => ({
      ...e,
      userName: e.userId ? byId.get(e.userId)?.fullName || null : null,
      userEmail: e.userId ? byId.get(e.userId)?.email || e.email : e.email,
    })),
  });
});
