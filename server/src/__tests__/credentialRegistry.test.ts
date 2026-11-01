import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * GAP-004 (Batch 5), U1: one registry of the credentials CLOR issues to
 * machines and links, and one rule for whether a token is honoured.
 *
 * Before this, a credential's state lived only in the table that issued it:
 * no suspend, no expiry for most kinds, no record of who changed what, and
 * no single answer to "is this token good right now?".
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { beginRequestScope, outsideTenant, runInTenant } = await import('../utils/tenantScope.js');
const { deleteCompanyData } = await import('../services/companyClosure.js');
const creds = await import('../services/credentials.js');
const { hashToken, issueCredential, verifyCredential, suspendCredential, resumeCredential, revokeCredential, extendCredential, rotateCredential, touchLastUsed, __resetLastUsedGate } = creds;

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 10);
const DAY = 864e5;

type Ctx = { orgId: string; accountId: string; userId: string };
async function company(): Promise<Ctx> {
  const email = `cr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'CR owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `CR Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { orgId: setup.body.company.orgId, accountId: claims.accountId, userId: claims.userId };
}

/** The issuing table, as a test controls it. */
const owners = new Map<string, { enabled: boolean; hash?: string | null } | null>();
const legacy = new Map<string, { ownerId: string; accountId: string; orgId: string; tokenPrefix: string }>();
const opts = {
  legacy: async (hash: string) => legacy.get(hash) ?? null,
  owner: async (ownerId: string) => (owners.has(ownerId) ? owners.get(ownerId)! : { enabled: true }),
};

const user = (c: Ctx) => ({ type: 'USER' as const, id: c.userId, ip: '10.0.0.1', userAgent: 'vitest' });
const newToken = () => `clor_${rnd()}${rnd()}${rnd()}`;

async function issue(c: Ctx, kind: 'API_KEY' | 'SCIM' = 'API_KEY', extra: Partial<{ expiresAt: Date | null; ownerId: string }> = {}) {
  const token = newToken();
  const ownerId = extra.ownerId ?? `owner_${rnd()}`;
  const row = await issueCredential(
    { kind, accountId: c.accountId, orgId: c.orgId, ownerId, token, tokenPrefix: token.slice(0, 12), expiresAt: extra.expiresAt ?? null, createdByUserId: c.userId },
    user(c)
  );
  return { token, row, ownerId };
}

const events = (c: Ctx, credentialId: string) =>
  runInTenant(c.orgId, () => platformPrisma.credentialEvent.findMany({ where: { credentialId }, orderBy: { createdAt: 'asc' } }));

let c: Ctx;
beforeAll(async () => {
  c = await company();
}, 60_000);

describe('issuing and checking', () => {
  it('honours an issued token for its own kind only', async () => {
    const { token, row } = await issue(c);
    const ok = await verifyCredential('API_KEY', token, opts);
    expect(ok.ok && ok.orgId).toBe(c.orgId);
    expect(ok.ok && ok.credential.id).toBe(row.id);
    expect((await verifyCredential('SCIM', token, opts)).ok).toBe(false);
    expect((await verifyCredential('API_KEY', newToken(), opts)).ok).toBe(false);
  });

  it('keeps only the hash, and records who issued it', async () => {
    const { token, row } = await issue(c);
    expect(row.tokenHash).toBe(hashToken(token));
    const ev = await events(c, row.id);
    expect(ev.map((e) => e.eventType)).toEqual(['issued']);
    expect(ev[0]).toMatchObject({ actorType: 'USER', actorId: c.userId, ip: '10.0.0.1' });
    expect(ev[0].actorLabel).toMatch(/@example\.com/);
  });
});

describe('suspend, resume, revoke', () => {
  it('a suspended token is refused, and works again once resumed', async () => {
    const { token, row } = await issue(c);
    await suspendCredential(row.id, c.orgId, user(c), 'checking a leak');
    const r = await verifyCredential('API_KEY', token, opts);
    expect(!r.ok && r.block).toBe('SUSPENDED');
    await resumeCredential(row.id, c.orgId, user(c));
    expect((await verifyCredential('API_KEY', token, opts)).ok).toBe(true);
    expect((await events(c, row.id)).map((e) => [e.eventType, e.reason])).toEqual([
      ['issued', null],
      ['suspended', 'checking a leak'],
      ['resumed', null],
    ]);
  });

  it('a revoked token is refused for good: it cannot be resumed or rotated', async () => {
    const { token, row } = await issue(c);
    await revokeCredential(row.id, c.orgId, user(c), 'leaked');
    expect((await verifyCredential('API_KEY', token, opts)).ok).toBe(false);
    await expect(resumeCredential(row.id, c.orgId, user(c))).rejects.toMatchObject({ status: 409 });
    await expect(rotateCredential(row.id, c.orgId, { token: newToken(), tokenPrefix: 'x' }, user(c))).rejects.toMatchObject({ status: 409 });
  });
});

describe('expiry', () => {
  it('an expired token is refused; it cannot be resumed, but it can be extended up to a year from today', async () => {
    const { token, row } = await issue(c, 'API_KEY', { expiresAt: new Date(Date.now() - 1000) });
    const r = await verifyCredential('API_KEY', token, opts);
    expect(!r.ok && r.block).toBe('EXPIRED');
    await suspendCredential(row.id, c.orgId, user(c));
    await expect(resumeCredential(row.id, c.orgId, user(c))).rejects.toMatchObject({ code: 'CREDENTIAL_EXPIRED' });
    await expect(extendCredential(row.id, c.orgId, new Date(Date.now() + 2 * 365 * DAY), user(c))).rejects.toMatchObject({ code: 'EXPIRY_TOO_FAR' });
    await extendCredential(row.id, c.orgId, new Date(Date.now() + 180 * DAY), user(c));
    await resumeCredential(row.id, c.orgId, user(c));
    expect((await verifyCredential('API_KEY', token, opts)).ok).toBe(true);
  });

  it('caps an extension at today plus one year, not one year past the current expiry', async () => {
    const { row } = await issue(c, 'API_KEY', { expiresAt: new Date(Date.now() + 300 * DAY) });
    await expect(extendCredential(row.id, c.orgId, new Date(Date.now() + 600 * DAY), user(c))).rejects.toMatchObject({ code: 'EXPIRY_TOO_FAR' });
  });

  it('new API keys and stand-alone SCIM tokens default to a year; agents, readers and links to none', () => {
    const now = new Date('2026-10-24T00:00:00Z');
    expect(creds.defaultExpiry('API_KEY', {}, now)?.toISOString()).toBe('2027-10-24T00:00:00.000Z');
    expect(creds.defaultExpiry('SCIM', { standalone: true }, now)).not.toBeNull();
    expect(creds.defaultExpiry('SCIM', { standalone: false }, now)).toBeNull();
    for (const k of ['AGENT', 'DEVICE_PUSH', 'PAY_LINK', 'SHARE_LINK'] as const) expect(creds.defaultExpiry(k, {}, now)).toBeNull();
  });
});

describe('rotation', () => {
  it('the new token works and the old one stops at once', async () => {
    const { token, row } = await issue(c);
    const next = newToken();
    const successor = await rotateCredential(row.id, c.orgId, { token: next, tokenPrefix: next.slice(0, 12) }, user(c), 'routine');
    expect((await verifyCredential('API_KEY', next, opts)).ok).toBe(true);
    const old = await verifyCredential('API_KEY', token, opts);
    expect(!old.ok && old.block).toBe('REVOKED');
    expect(successor.rotatedFromId).toBe(row.id);
    expect((await events(c, row.id)).map((e) => e.eventType)).toContain('rotated');
    expect((await events(c, successor.id)).map((e) => e.eventType)).toEqual(['issued']);
  });

  it('a suspended token can be rotated; its successor is active', async () => {
    const { row } = await issue(c);
    await suspendCredential(row.id, c.orgId, user(c));
    const next = newToken();
    const successor = await rotateCredential(row.id, c.orgId, { token: next, tokenPrefix: 'x' }, user(c), 'compromised');
    expect(successor.status).toBe('ACTIVE');
  });

  it('two rotations at once leave exactly one successor', async () => {
    const { row } = await issue(c);
    const results = await Promise.allSettled([
      rotateCredential(row.id, c.orgId, { token: newToken(), tokenPrefix: 'a' }, user(c)),
      rotateCredential(row.id, c.orgId, { token: newToken(), tokenPrefix: 'b' }, user(c)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await runInTenant(c.orgId, () => platformPrisma.credential.count({ where: { rotatedFromId: row.id } }))).toBe(1);
  });
});

describe('the issuing table has the last word (most restrictive wins)', () => {
  it('a token switched off in its own table is refused although the registry says active', async () => {
    const { token, ownerId } = await issue(c);
    owners.set(ownerId, { enabled: false });
    const r = await verifyCredential('API_KEY', token, opts);
    expect(!r.ok && r.block).toBe('OWNER_OFF');
  });

  it('a token re-issued in its own table (older code rotating in place) is refused', async () => {
    const { token, ownerId } = await issue(c);
    owners.set(ownerId, { enabled: true, hash: hashToken(newToken()) });
    const r = await verifyCredential('API_KEY', token, opts);
    expect(!r.ok && r.block).toBe('SUPERSEDED');
  });

  it('a token whose owner cannot be found is refused, and nothing is stamped', async () => {
    const { token, row, ownerId } = await issue(c);
    owners.set(ownerId, null);
    const r = await verifyCredential('API_KEY', token, opts);
    expect(!r.ok && r.block).toBe('OWNER_MISSING');
    const after = await runInTenant(c.orgId, () => platformPrisma.credential.findUniqueOrThrow({ where: { id: row.id } }));
    expect(after.status).toBe('ACTIVE');
  });
});

describe('tokens issued before the registry', () => {
  it('are registered on first use, once, with a migrated event', async () => {
    const token = newToken();
    const ownerId = `legacy_${rnd()}`;
    legacy.set(hashToken(token), { ownerId, accountId: c.accountId, orgId: c.orgId, tokenPrefix: token.slice(0, 12) });
    const [a, b] = await Promise.all([verifyCredential('API_KEY', token, opts), verifyCredential('API_KEY', token, opts)]);
    expect(a.ok && b.ok).toBe(true);
    const rows = await runInTenant(c.orgId, () => platformPrisma.credential.findMany({ where: { ownerId } }));
    expect(rows).toHaveLength(1);
    expect((await events(c, rows[0].id)).map((e) => e.eventType)).toEqual(['migrated']);
  });
});

describe('the company', () => {
  it('a closing company refuses every token; cancelling the closure brings them back', async () => {
    const d = await company();
    const { token } = await issue(d, 'SCIM');
    expect((await verifyCredential('SCIM', token, opts)).ok).toBe(true);
    await outsideTenant('test: schedule closure', () =>
      platformPrisma.orgClosure.create({
        data: { accountId: d.accountId, orgId: d.orgId, orgName: 'CR', status: 'SCHEDULED', requestedByUserId: d.userId, requestedAt: new Date(), deleteAfter: new Date(Date.now() + 30 * DAY) },
      })
    );
    const r = await verifyCredential('SCIM', token, opts);
    expect(!r.ok && r.block).toBe('COMPANY_CLOSING');
    await outsideTenant('test: cancel closure', () => platformPrisma.orgClosure.update({ where: { orgId: d.orgId }, data: { status: 'CANCELLED', cancelledAt: new Date() } }));
    expect((await verifyCredential('SCIM', token, opts)).ok).toBe(true);
  });

  it('closure purge removes the company’s credentials and their history, and nobody else’s', async () => {
    const d = await company();
    const mine = await issue(d);
    const theirs = await issue(c);
    await deleteCompanyData(d.orgId);
    const left = await outsideTenant('test: what is left', async () => ({
      mine: await platformPrisma.credential.count({ where: { orgId: d.orgId } }),
      mineEvents: await platformPrisma.credentialEvent.count({ where: { orgId: d.orgId } }),
      theirs: await platformPrisma.credential.count({ where: { id: theirs.row.id } }),
    }));
    expect(left).toEqual({ mine: 0, mineEvents: 0, theirs: 1 });
    expect(mine.row.orgId).toBe(d.orgId);
  }, 60_000);
});

describe('what is never written down', () => {
  it('no event holds the token or its hash', async () => {
    const { token, row } = await issue(c);
    await suspendCredential(row.id, c.orgId, user(c), 'x');
    await rotateCredential(row.id, c.orgId, { token: newToken(), tokenPrefix: 'p' }, user(c));
    const all = JSON.stringify(await runInTenant(c.orgId, () => platformPrisma.credentialEvent.findMany({ where: { orgId: c.orgId } })));
    expect(all).not.toContain(token);
    expect(all).not.toContain(hashToken(token));
  });
});

describe('row-level security', () => {
  it('both tables are forced and fail closed', async () => {
    const rows = await platformPrisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('Credential', 'CredentialEvent') ORDER BY relname`;
    expect(rows).toEqual([
      { relname: 'Credential', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'CredentialEvent', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const inRequest = <T,>(fn: () => Promise<T>) => new Promise<T>((done, fail) => beginRequestScope(null, null, () => fn().then(done, fail)));
    expect(await inRequest(() => platformPrisma.credential.count({ where: { orgId: c.orgId } }))).toBe(0);
    expect(await inRequest(() => runInTenant(c.orgId, () => platformPrisma.credential.count({ where: { orgId: c.orgId } })))).toBeGreaterThan(0);
  });
});

describe('last used', () => {
  it('is written at most once in five minutes', async () => {
    __resetLastUsedGate();
    const { row } = await issue(c);
    const t0 = new Date();
    touchLastUsed(row, '1.1.1.1', t0);
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 1; i <= 9; i += 1) touchLastUsed(row, '2.2.2.2', new Date(t0.getTime() + i * 1000));
    await new Promise((r) => setTimeout(r, 300));
    const after = await runInTenant(c.orgId, () => platformPrisma.credential.findUniqueOrThrow({ where: { id: row.id } }));
    expect(after.lastUsedAt?.getTime()).toBe(t0.getTime());
    expect(after.lastUsedIp).toBe('1.1.1.1');
  });
});
