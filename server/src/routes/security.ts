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
  // Until the handshake ships, a configured provider cannot actually sign
  // anyone in. Saying so here keeps the UI from implying otherwise.
  status: 'CONFIGURED_NOT_ACTIVE' as const,
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
  });
});

/** Rejects a configuration that could not possibly work. */
function validateProvider(body: z.infer<typeof providerSchema>, hasStoredSecret: boolean) {
  if (body.kind === 'OIDC') {
    if (!body.issuer && !body.discoveryUrl) return 'An OIDC provider needs an issuer or a discovery URL';
    if (!body.clientId) return 'Client ID is required';
    if (!body.clientSecret && !hasStoredSecret) return 'Client secret is required';
  }
  if (body.kind === 'SAML') {
    if (!body.entryPoint) return 'Sign-in URL is required';
    if (!body.entityId) return 'Entity ID is required';
    if (!body.certificate) return 'The identity provider certificate is required';
  }
  return null;
}

securityRouter.post('/orgs/:orgId/security/providers', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = providerSchema.parse(req.body);

  const problem = validateProvider(body, false);
  if (problem) return res.status(400).json({ error: problem });

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
  const problem = validateProvider(body, Boolean(existing.clientSecretEnc));
  if (problem) return res.status(400).json({ error: problem });

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
      emailDomains: body.emailDomains ?? null,
      autoProvision: body.autoProvision ?? existing.autoProvision,
      defaultRoleId: body.defaultRoleId ?? null,
    },
  });

  res.json({ provider: publicProvider(updated) });
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

securityRouter.post('/orgs/:orgId/security/two-factor/disable', ...codeLimiter, async (req, res) => {
  if (!orgOk(req, res)) return;
  const u = await me2fa(req);
  if (!u?.totpEnabledAt) return res.status(400).json({ error: 'No authenticator is set up.' });
  if (!(await bcrypt.compare(String(req.body?.password || ''), u.passwordHash))) return res.status(400).json({ error: 'Your password is not correct.', code: 'BAD_PASSWORD' });
  await platformPrisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryJson: null } });
  await recordAuthEvent({ accountId: req.tenant!.accountId, userId: u.id, eventType: 'TWO_FACTOR_DISABLED', ip: clientIp(req) });
  res.json({ enabled: false });
});

/** A code (or a recovery code) for fifteen minutes of money-moving payroll actions. */
securityRouter.post('/orgs/:orgId/security/step-up', ...codeLimiter, async (req, res) => {
  if (!orgOk(req, res)) return;
  const u = await me2fa(req);
  if (!u?.totpEnabledAt || !u.totpSecretEnc) return res.status(400).json({ error: 'Set up an authenticator app first.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
  const code = String(req.body?.code || '').trim();
  let used: 'CODE' | 'RECOVERY' | null = null;
  const step = verifyCode(decryptSecret(u.totpSecretEnc), code, u.totpLastStep);
  if (step != null) {
    /* Only if no other request used this step in the meantime: a code works once. */
    const won = await platformPrisma.user.updateMany({ where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    if (won.count) used = 'CODE';
  } else if (/^[A-Z2-7]{4}-?[A-Z2-7]{4}$/i.test(code)) {
    const hashes = JSON.parse(u.totpRecoveryJson || '[]') as string[];
    const h = hashRecovery(code);
    if (hashes.includes(h)) {
      await platformPrisma.user.update({ where: { id: u.id }, data: { totpRecoveryJson: JSON.stringify(hashes.filter((x) => x !== h)) } });
      used = 'RECOVERY';
    }
  }
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
