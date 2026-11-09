import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcrypt';

import { platformPrisma } from '../utils/platformPrisma.js';
import { prisma } from '../utils/prisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { SELLABLE_APP_CODES } from '../constants/appCatalog.js';
import { EDGE_HEADER } from '../middleware/edgeGuard.js';
import { bootstrapOwnerRole, createAccountWithOwner, createCompany } from './accountProvisioning.js';
import { ensureAccountMembership } from './accountMembership.js';
import { assignUserCode } from './displayCodes.js';
import { createSession, revokeSession, signAccessToken } from './auth.js';

/**
 * The sample company behind Explore (roadmap item 6): one shared, made-up
 * business that a visitor with an Explore pass opens read-only.
 *
 * Sample Traders Pvt Ltd, Pune. Everything in it is invented: the people, the
 * customers, the GSTINs and PANs (built on 0000-style serials so nobody can
 * mistake them for real ones; the parties API checks the GSTIN checksum, so
 * the check digit is right). The addresses use the reserved `.example` domain.
 *
 * Three logins, none of which anybody can sign in with (random passwords,
 * never shown): the owner, who writes the sample through the real HTTP API;
 * the approver, a second director who approves what the owner prepared (the
 * pay run: maker-checker wants a second person); and the viewer, the one user
 * every Explore session runs as. The viewer holds the company's full role so
 * every screen draws; what stops it changing anything is the server
 * (middleware/exploreReadOnly.ts), not the role.
 *
 * Idempotent. `ensureSampleCompany()` makes what is missing and leaves what is
 * there; the data is filled once per FILL_VERSION (a marker in the company's
 * profile) and every step of the fill looks before it writes, so a second run,
 * or a run that stopped halfway, tops up rather than doubling.
 */

export const SAMPLE = {
  company: 'Sample Traders Pvt Ltd',
  state: 'Maharashtra',
  city: 'Pune',
  /* A sample GSTIN: Maharashtra (27), PAN AAACS0000S, the check digit computed. */
  gstin: '27AAACS0000S1ZF',
  owner: { email: 'owner@sample-traders.example', name: 'Rohan Kulkarni' },
  approver: { email: 'director@sample-traders.example', name: 'Anita Kulkarni' },
  viewer: { email: 'explore@sample-traders.example', name: 'Visitor' },
} as const;

/** Bump when the sample data changes shape; the next ensure fills it again (each step only adds what is missing). */
export const FILL_VERSION = 1;

export type SampleCompany = { accountId: string; orgId: string; branchId: string; ownerUserId: string; approverUserId: string; viewerUserId: string };

type Call = {
  get: (path: string) => Promise<{ status: number; body: any }>;
  post: (path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  put: (path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  patch: (path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  del: (path: string) => Promise<{ status: number; body: any }>;
};

/** What the fill writes through: the real HTTP API, signed in as the sample owner (or, for approvals, the approver), with the company's headers. */
export type SampleApi = Call & {
  orgId: string;
  branchId: string;
  approver: Call;
  log: (msg: string) => void;
};

const unusablePassword = async () => bcrypt.hash(randomBytes(32).toString('base64url'), Number(process.env.BCRYPT_ROUNDS || 12));

let cachedViewer: string | null = null;

/** The viewer's user id, once known in this process: middleware/exploreReadOnly.ts treats it as read-only whatever its token says. */
export const sampleViewerId = () => cachedViewer;

/** Looked up without making anything (for the read-only guard's second check). */
export async function findSampleViewerId(): Promise<string | null> {
  if (cachedViewer) return cachedViewer;
  const u = await outsideTenant('explore: find the sample viewer', () => platformPrisma.user.findFirst({ where: { email: SAMPLE.viewer.email }, select: { id: true } }));
  if (u) cachedViewer = u.id;
  return cachedViewer;
}

/** The account, company, owner, approver and viewer, made if missing. Fast: no sample data. */
async function ensureSkeleton(): Promise<SampleCompany> {
  return outsideTenant('explore: the shared sample company', async () => {
    let owner = await platformPrisma.user.findFirst({ where: { email: SAMPLE.owner.email }, select: { id: true, accountId: true } });
    if (!owner) {
      const made = await createAccountWithOwner({
        email: SAMPLE.owner.email,
        name: SAMPLE.owner.name,
        accountName: SAMPLE.company,
        passwordHash: await unusablePassword(),
        plan: { apps: SELLABLE_APP_CODES, status: 'active' },
      });
      owner = { id: made.user.id, accountId: made.account.id };
      await platformPrisma.user.update({ where: { id: owner.id }, data: { emailVerifiedAt: new Date() } });
    }
    const accountId = owner.accountId;

    let org = await platformPrisma.org.findFirst({ where: { accountId, name: SAMPLE.company }, select: { id: true } });
    if (!org) {
      const made = await createCompany({
        accountId,
        userId: owner.id,
        companyName: SAMPLE.company,
        state: SAMPLE.state,
        gstin: SAMPLE.gstin,
        profile: { city: SAMPLE.city, sample: { explore: true }, source: 'explore-sample' },
      });
      org = { id: made.org.id };
      await platformPrisma.branch.update({ where: { id: made.branch.id }, data: { city: SAMPLE.city, addressLine1: '14 Sample Road, Hadapsar, Pune 411028' } }).catch(() => undefined);
    }
    const orgId = org.id;
    const branch = await platformPrisma.branch.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!branch) throw new Error('The sample company has no branch.');

    /* A login of the account, seated in the company with its full role. A member of the account, not an owner or admin: the Workspace offers it no billing or people to manage. */
    const seat = async (who: { email: string; name: string }, label: string) => {
      let user = await platformPrisma.user.findFirst({ where: { email: who.email }, select: { id: true, accountId: true } });
      if (user && user.accountId !== accountId) throw new Error(`The sample ${label} belongs to another account; refusing to use it.`);
      if (!user) {
        user = await platformPrisma.user.create({
          data: { accountId, email: who.email, username: null, fullName: who.name, passwordHash: await unusablePassword(), isActive: true, emailVerifiedAt: new Date() },
          select: { id: true, accountId: true },
        });
      }
      await ensureAccountMembership(accountId, user.id, 'MEMBER');
      if (!(await platformPrisma.userOrgMembership.findFirst({ where: { orgId, userId: user.id }, select: { id: true } }))) {
        await platformPrisma.userOrgMembership.create({ data: { accountId, orgId, userId: user.id } });
        await assignUserCode(user.id, orgId);
      }
      const branches = await platformPrisma.branch.findMany({ where: { orgId }, select: { id: true } });
      for (const b of branches) {
        if (!(await platformPrisma.userBranchMembership.findFirst({ where: { orgId, branchId: b.id, userId: user.id }, select: { id: true } }))) {
          await platformPrisma.userBranchMembership.create({ data: { accountId, orgId, branchId: b.id, userId: user.id } });
        }
      }
      const warehouses = await prisma.warehouse.findMany({ where: { orgId }, select: { id: true, branchId: true } });
      for (const w of warehouses) {
        if (!(await platformPrisma.userWarehouseAccess.findFirst({ where: { orgId, warehouseId: w.id, userId: user.id }, select: { id: true } }))) {
          await platformPrisma.userWarehouseAccess.create({ data: { accountId, orgId, branchId: w.branchId, warehouseId: w.id, userId: user.id } });
        }
      }
      /* Once: its unique key has a null branch, which Postgres never counts as a duplicate, so a second call added a second row. */
      if (!(await platformPrisma.userRoleAssignment.findFirst({ where: { orgId, userId: user.id }, select: { id: true } }))) {
        await bootstrapOwnerRole(accountId, orgId, user.id);
      }
      return user;
    };
    const approver = await seat(SAMPLE.approver, 'approver');
    /* The full role, so every screen draws; the server refuses its writes. */
    const viewer = await seat(SAMPLE.viewer, 'Explore viewer');
    cachedViewer = viewer.id;
    return { accountId, orgId, branchId: branch.id, ownerUserId: owner.id, approverUserId: approver.id, viewerUserId: viewer.id };
  });
}

const profileOf = async (orgId: string) => {
  const row = await outsideTenant('explore: the sample company profile', () => platformPrisma.org.findUnique({ where: { id: orgId }, select: { profileJson: true } }));
  try {
    return JSON.parse(String(row?.profileJson || '{}')) as Record<string, any>;
  } catch {
    return {};
  }
};
const markFilled = async (orgId: string) => {
  const profile = await profileOf(orgId);
  profile.sample = { ...(profile.sample || {}), explore: true, filledVersion: FILL_VERSION, filledAt: new Date().toISOString() };
  await outsideTenant('explore: mark the sample filled', () => platformPrisma.org.update({ where: { id: orgId }, data: { profileJson: JSON.stringify(profile) } }));
};

/**
 * Fill the sample through the real HTTP API, as the sample owner. The app is
 * listened on 127.0.0.1 for the length of the fill, so every record passes the
 * validation, numbering and posting rules a person's would (the way
 * scripts/seedUiQa.ts and the server's tests write).
 */
async function fill(c: SampleCompany, log: (msg: string) => void) {
  const { buildApp } = await import('../app.js');
  const { fillSampleData } = await import('./sampleCompanyData.js');
  const server = buildApp().listen(0, '127.0.0.1');
  await new Promise<void>((ok) => server.once('listening', () => ok()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  /* A session each for the owner, who writes, and the approver, who approves what the owner prepared. */
  const signIn = async (userId: string) => {
    const { session, refreshToken } = await outsideTenant('explore: a sample login writes the sample', () => createSession({ accountId: c.accountId, userId, userAgent: 'clor-sample-fill', days: 1 }));
    return { refreshToken, token: signAccessToken({ userId, accountId: c.accountId, sid: session.id }, 120) };
  };
  const owner = await signIn(c.ownerUserId);
  const approver = await signIn(c.approverUserId);
  const edge: Record<string, string> = process.env.EDGE_SECRET ? { [EDGE_HEADER]: String(process.env.EDGE_SECRET) } : {};
  const caller = (token: string) => {
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId, ...edge },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: r.status, body: parsed };
    };
    return {
      get: (p: string) => call('GET', p),
      post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
      put: (p: string, b?: unknown) => call('PUT', p, b ?? {}),
      patch: (p: string, b?: unknown) => call('PATCH', p, b ?? {}),
      del: (p: string) => call('DELETE', p),
    };
  };
  const api: SampleApi = { orgId: c.orgId, branchId: c.branchId, ...caller(owner.token), approver: caller(approver.token), log };
  try {
    await fillSampleData(api);
  } finally {
    for (const t of [owner.refreshToken, approver.refreshToken]) await outsideTenant('explore: end the fill session', () => revokeSession(t, 'LOGOUT')).catch(() => undefined);
    await new Promise<void>((done) => server.close(() => done()));
  }
}

let inflight: Promise<SampleCompany> | null = null;
/* Once made and filled, this process remembers it for a while: every Explore visit asks. */
let ready: { at: number; company: SampleCompany } | null = null;
const READY_FOR_MS = 10 * 60_000;

/**
 * The sample company, made and filled if it is not yet. Shared by every caller
 * in this process while it runs. `force` fills again (each step still adds
 * only what is missing). `fill: false` (tests, and every visitor while
 * EXPLORE_SAMPLE_FILL=off) makes only the account, company and logins.
 */
export function ensureSampleCompany(opts: { fill?: boolean; force?: boolean; log?: (msg: string) => void } = {}): Promise<SampleCompany> {
  const wantFill = opts.fill ?? String(process.env.EXPLORE_SAMPLE_FILL || 'on').toLowerCase() !== 'off';
  if (!opts.force && wantFill && ready && Date.now() - ready.at < READY_FOR_MS) return Promise.resolve(ready.company);
  if (inflight) return inflight;
  inflight = (async () => {
    const c = await ensureSkeleton();
    if (wantFill) {
      const profile = await profileOf(c.orgId);
      if (opts.force || Number(profile.sample?.filledVersion || 0) < FILL_VERSION) {
        await fill(c, opts.log || (() => undefined));
        await markFilled(c.orgId);
      }
      ready = { at: Date.now(), company: c };
    }
    return c;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
