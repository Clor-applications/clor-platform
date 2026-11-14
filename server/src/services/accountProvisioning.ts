import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { APP_CATALOG, isSellableApp } from '../constants/appCatalog.js';
import { RoleType } from '../constants/enums.js';
import { expandPreset, permKey } from '../constants/permissionCatalog.js';
import { appAccess } from './subscriptions.js';
import { assignOrgCode, assignUserCode } from './displayCodes.js';
import { companyLimitReason } from './entitlements.js';
import { ensureLedgerSetup } from './ledger.js';
import { ensurePermissionCatalog } from './permissionCatalogSeed.js';
import { lockQuota } from './quotaLock.js';
import { suggestSlug } from './slug.js';
import { track } from './productEvents.js';
import { issuePasswordResetToken, recordAuthEvent } from './auth.js';
import { sendTemplate } from './mailer.js';

/**
 * Making an account: the one code path.
 *
 * Self-serve sign-up (routes/auth.ts: /signup then /setup-company), an
 * operator's Create account from a demo request (routes/demoRequests.ts) and
 * a free trial started from clor.in (routes/signup.ts, provisionAccount) all
 * come through here, so an account made any way has the same owner,
 * subscription, company, branch, warehouse, roles and ledger.
 */

export class ProvisionError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export type AccountApps = {
  /** App codes; only sellable ones are kept. */
  apps: string[];
  /** 'active' (free, open-ended) or 'trialing' until trialEndsAt. */
  status: 'active' | 'trialing';
  trialEndsAt?: Date | null;
};

/** Every available app, free and open-ended: what a self-serve sign-up gets today. */
export const SIGNUP_APPS: AccountApps = { apps: APP_CATALOG.filter((a) => a.available).map((a) => a.code), status: 'active' };

/**
 * The account, its subscription, its owner's login and the owner membership,
 * in one transaction: no account is ever left without an owner or a plan.
 * `passwordHash` null makes a login nobody can sign in with until the owner
 * sets a password from the emailed link.
 */
export async function createAccountWithOwner(input: { email: string; name: string; accountName?: string; passwordHash: string | null; noticeVersion?: string; plan: AccountApps }) {
  const email = input.email.trim().toLowerCase();
  const passwordHash = input.passwordHash ?? (await bcrypt.hash(randomBytes(32).toString('base64url'), Number(process.env.BCRYPT_ROUNDS || 12)));
  const apps = APP_CATALOG.filter((a) => a.available && input.plan.apps.includes(a.code) && isSellableApp(a.code));
  return platformPrisma.$transaction(async (tx) => {
    const account = await tx.account.create({ data: { name: (input.accountName || input.name).trim() || email }, select: { id: true, name: true } });
    await tx.subscription.create({
      data: {
        accountId: account.id,
        status: input.plan.status,
        trialEndsAt: input.plan.status === 'trialing' ? input.plan.trialEndsAt ?? null : null,
        items: { create: apps.map((app) => ({ appCode: app.code, tier: app.defaultTier ?? null, priceModel: 'free' })) },
      },
    });
    const user = await tx.user.create({
      data: {
        accountId: account.id,
        email,
        username: null,
        fullName: input.name.trim(),
        passwordHash,
        isActive: true,
        ...(input.noticeVersion ? { noticeVersion: input.noticeVersion, noticeAcceptedAt: new Date() } : {}),
      },
      select: { id: true, accountId: true, email: true, fullName: true },
    });
    /* Whoever makes the account owns it (W-1.1), in the same transaction. */
    await tx.accountMembership.create({ data: { accountId: account.id, userId: user.id, role: 'OWNER' } });
    return { account, user };
  });
}

/** The owner's Owner role in a new company, with the whole Administrator preset. */
export async function bootstrapOwnerRole(accountId: string, orgId: string, userId: string) {
  await ensurePermissionCatalog();
  const roleName = 'Owner';
  const role =
    (await platformPrisma.role.findFirst({ where: { accountId, orgId, branchId: null, name: roleName }, select: { id: true } })) ||
    (await platformPrisma.role.create({
      data: { accountId, orgId, branchId: null, name: roleName, description: 'Full access. Created automatically for the account owner.', roleType: RoleType.ADMIN, createdByUserId: userId },
      select: { id: true },
    }));
  const wanted = new Set(expandPreset('ADMIN').map((r) => permKey(r.module, r.subModule, r.action)));
  const permissions = await platformPrisma.permission.findMany({ select: { id: true, module: true, subModule: true, action: true } });
  /* One insert for every permission, not one each: row by row this was the slowest part of setting up a company. */
  await platformPrisma.rolePermission.createMany({
    data: permissions.filter((p) => wanted.has(permKey(p.module, p.subModule, p.action))).map((p) => ({ accountId, orgId, roleId: role.id, permissionId: p.id, allowed: true })),
    skipDuplicates: true,
  });
  try {
    await platformPrisma.userRoleAssignment.create({ data: { accountId, orgId, branchId: null, userId, roleId: role.id, createdByUserId: userId }, select: { id: true } });
  } catch (err: any) {
    if (String(err?.code || '') !== 'P2002') throw err;
  }
}

/**
 * A company in an account, with everything its first day needs: head-office
 * branch, the creator's memberships, the account's apps switched on, simple
 * mode, a Main Store warehouse, the Owner role and the ledger. Who may create
 * it, and whether the state and GSTIN are valid, is the caller's to check.
 * Throws QuotaBusyError or ProvisionError(COMPANY_LIMIT).
 */
export async function createCompany(input: { accountId: string; userId: string; companyName: string; state: string; gstin?: string | null; profile?: Record<string, unknown>; apps?: string[] }) {
  const { accountId, userId } = input;
  const name = input.companyName.trim();
  const stateName = input.state.trim();
  const gstin = String(input.gstin || '').trim().toUpperCase();
  const slug = await suggestSlug(name);
  /*
   * The company master, kept: everything the sign-up wizard asks after the
   * name. State and GSTIN are stored here as well as on the head-office
   * branch; the branch is where tax is computed from.
   */
  const profileJson = JSON.stringify({ ...(input.profile && typeof input.profile === 'object' ? input.profile : {}), state: stateName, gstin: gstin || null });

  /* The plan's company allowance, checked and used under the account's quota lock (W-6.1). */
  const releaseQuota = await lockQuota(accountId, 'COMPANIES');
  let org: { id: string; name: string; slug: string | null };
  try {
    const overLimit = await companyLimitReason(accountId);
    if (overLimit) throw new ProvisionError(403, overLimit, 'COMPANY_LIMIT');
    org = await platformPrisma.org.create({ data: { accountId, name, legalName: name, slug, profileJson, createdByUserId: userId }, select: { id: true, name: true, slug: true } });
  } finally {
    await releaseQuota();
  }
  await assignOrgCode(accountId, org.id, name);
  await assignUserCode(userId, org.id);

  const branch = await platformPrisma.branch.create({
    data: {
      accountId,
      orgId: org.id,
      branchCode: 'HO',
      branchName: 'Head Office',
      addressLine1: '',
      city: '',
      state: stateName,
      country: 'India',
      // A business that gives a GSTIN is registered by definition.
      gstRegistrationType: gstin ? 'REGULAR' : 'UNREGISTERED',
      gstin: gstin || null,
      parentBranchId: null,
      shareHeadOfficeSettings: false,
      createdByUserId: userId,
      createdAt: new Date(),
    },
    select: { id: true },
  });
  await platformPrisma.userOrgMembership.create({ data: { accountId, orgId: org.id, userId } });
  await platformPrisma.userBranchMembership.create({ data: { accountId, orgId: org.id, branchId: branch.id, userId } });

  /*
   * A new company starts with the apps its account owns, switched on for it:
   * app switches follow subscription changes, and a company created under a
   * standing subscription never sees one. Failures cannot sink the company.
   *
   * `apps`, when given, is what the person picked on company setup, and only
   * those of the owned apps are switched on. A self-serve sign-up's trial owns
   * every app, so without this a company set up with Attendance alone also got
   * People, Payroll and the rest — and People on sends Attendance to People.
   * The trial still covers the others; they are one switch away (More apps).
   */
  try {
    const owned = (await appAccess(accountId)).ownedApps;
    const picked = Array.isArray(input.apps) ? new Set(input.apps.map(String)) : null;
    for (const app of APP_CATALOG.filter((a) => a.available && a.featureKey && owned.includes(a.code) && (!picked || picked.has(a.code)))) {
      await platformPrisma.featureSetting.upsert({
        where: { orgId_key: { orgId: org.id, key: app.featureKey! } },
        update: {},
        create: { accountId, orgId: org.id, key: app.featureKey!, enabled: true, updatedByUserId: 'subscription' },
      });
    }
  } catch {
    /* The org exists even if its switches could not be written. */
  }

  /* Simple mode (PRODUCT-VIEW §6), on for a new company; only ever written here, once. */
  try {
    await platformPrisma.featureSetting.upsert({
      where: { orgId_key: { orgId: org.id, key: 'peopleSimpleMode' } },
      update: {},
      create: { accountId, orgId: org.id, key: 'peopleSimpleMode', enabled: true, updatedByUserId: 'system' },
    });
    void track(org.id, userId, 'simple_mode_toggled', { on: true, trigger: 'company_created', app: 'people' });
  } catch {
    /* The full menus are the fallback. */
  }

  /* Every org gets a warehouse, for the same reason it gets a branch: an invoice needs one. */
  const mainWarehouse = await prisma.warehouse.create({ data: { accountId, orgId: org.id, branchId: branch.id, code: 'MAIN', name: 'Main Store', createdByUserId: userId } });
  await platformPrisma.userWarehouseAccess.create({ data: { accountId, orgId: org.id, branchId: branch.id, warehouseId: mainWarehouse.id, userId } });

  await bootstrapOwnerRole(accountId, org.id, userId);
  // A chart of accounts and journals up front, so the first invoice has somewhere to post.
  await ensureLedgerSetup(accountId, org.id, userId);

  return { org, branch };
}

/** How long the owner's set-password link from Create account works. */
export const SET_PASSWORD_DAYS = 7;

/**
 * An account made for somebody who has not signed up themselves (Create
 * account from a demo request; a later self-serve sign-up that asks only for
 * an email). Owner with no usable password, the account, a company with the
 * chosen apps, then an email with a link to set their password — the existing
 * reset link, valid for SET_PASSWORD_DAYS.
 *
 * `profile` lands in the company's profileJson; `requestedApp` there is the
 * app the owner asked for, for the shell to open first (roadmap item 5).
 */
export async function provisionAccount(input: { ownerName: string; ownerEmail: string; companyName: string; state: string; plan: AccountApps; profile?: Record<string, unknown>; ip?: string; actor?: string }) {
  const email = input.ownerEmail.trim().toLowerCase();
  const taken = await platformPrisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
  if (taken) throw new ProvisionError(409, 'Somebody already signs in to CLOR with this email. Ask them to sign in, or use another address.', 'EMAIL_TAKEN');

  const { account, user } = await createAccountWithOwner({ email, name: input.ownerName, accountName: input.companyName, passwordHash: null, plan: input.plan });
  const { org, branch } = await createCompany({ accountId: account.id, userId: user.id, companyName: input.companyName, state: input.state, profile: input.profile });

  const token = await issuePasswordResetToken({ id: user.id, accountId: account.id }, input.ip, SET_PASSWORD_DAYS * 86_400_000);
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  /* Only an app this company has, by the codes the shell knows. */
  const asked = String(input.profile?.requestedApp || '');
  const known = input.plan.apps.includes(asked) && ['accounting', 'payroll', 'people', 'attendance'].includes(asked) ? asked : '';
  /* People includes Attendance: a company on People is not shown Attendance apart, so its welcome link opens People. */
  const landing = known === 'attendance' && input.plan.apps.includes('people') ? 'people' : known;
  const apps = APP_CATALOG.filter((a) => input.plan.apps.includes(a.code)).map((a) => a.name);
  await sendTemplate({
    templateKey: 'account.welcome',
    to: email,
    toName: user.fullName,
    accountId: account.id,
    relatedType: 'User',
    relatedId: user.id,
    transactional: true,
    data: {
      userName: user.fullName,
      companyName: org.name,
      apps: apps.join(', ') || 'CLOR',
      trialNote: input.plan.status === 'trialing' && input.plan.trialEndsAt ? ` Your trial runs until ${input.plan.trialEndsAt.toISOString().slice(0, 10)}.` : '',
      /* ?app= opens the app they asked for once the password is set (shell appIntent.js), then the Workspace is one click away. */
      setPasswordUrl: `${appUrl}/?reset=${token}${landing ? `&app=${landing}` : ''}`,
      email,
      days: String(SET_PASSWORD_DAYS),
    },
  });
  await recordAuthEvent({ accountId: account.id, userId: user.id, email, eventType: 'ACCOUNT_PROVISIONED', ip: input.ip, detail: input.actor ? `By ${input.actor}` : undefined });
  return { account, user, org, branch, setPasswordToken: token };
}
