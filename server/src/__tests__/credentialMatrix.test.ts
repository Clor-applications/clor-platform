import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * GAP-004 (Batch 5), U2: API keys, site agents and reader push URLs are
 * checked through the credential registry, and their own tables still have a
 * say. Before, each route asked only its own table: a key could not be
 * paused, a rotation of a revoked key brought it back, and nothing recorded
 * who changed what.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant, runInTenant } = await import('../utils/tenantScope.js');
const { hashToken, suspendCredential, revokeCredential, resumeCredential, extendCredential } = await import('../services/credentials.js');
const { backfillCredentials } = await import('../services/credentialBackfill.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
const DAY = 864e5;

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = (c: Ctx) => ({
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});

async function company(): Promise<Ctx> {
  const email = `cm.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'CM owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `CM Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId };
}

type Kind = 'API_KEY' | 'AGENT' | 'DEVICE_PUSH';
type Made = { token: string; ownerId: string; call: () => Promise<number>; switchOff: () => Promise<unknown> };

const KINDS: Record<string, { kind: Kind; make: (c: Ctx) => Promise<Made> }> = {
  'API key': {
    kind: 'API_KEY',
    make: async (c) => {
      const r = await api(c).post('/integrations/keys', { name: `Key ${rnd()}`, scopes: ['attendance:read'] }).expect(201);
      return {
        token: r.body.token,
        ownerId: r.body.key.id,
        call: async () => (await request(app).get('/v1/ping').set('Authorization', `Bearer ${r.body.token}`)).status,
        switchOff: () => outsideTenant('test: old code revokes in its own table', () => peoplePrisma.apiClient.update({ where: { id: r.body.key.id }, data: { isActive: false, revokedAt: new Date() } })),
      };
    },
  },
  'site agent': {
    kind: 'AGENT',
    make: async (c) => {
      const r = await api(c).post('/integrations/agents', { name: `Agent ${rnd()}`, tally: { host: '192.168.1.20', port: 9000, company: 'X' } }).expect(201);
      return {
        token: r.body.token,
        ownerId: r.body.agent.id,
        call: async () => (await request(app).get('/agent/v1/config').set('Authorization', `Bearer ${r.body.token}`)).status,
        switchOff: () => api(c).put(`/integrations/agents/${r.body.agent.id}`, { name: r.body.agent.name, isActive: false }).expect(200),
      };
    },
  },
  'HTTP push reader': {
    kind: 'DEVICE_PUSH',
    make: async (c) => {
      const r = await api(c).post('/devices', { vendor: 'HTTP_PUSH', name: `Gate ${rnd()}`, sourceTimezone: 'Asia/Kolkata' }).expect(201);
      return {
        token: r.body.pushToken,
        ownerId: r.body.device.id,
        call: async () => (await request(app).post(`/ingest/${r.body.pushToken}`).send({ hello: 1 })).status,
        switchOff: () => outsideTenant('test: reader switched off', () => peoplePrisma.attendanceDevice.update({ where: { id: r.body.device.id }, data: { isActive: false } })),
      };
    },
  },
  'Hikvision terminal': {
    kind: 'DEVICE_PUSH',
    make: async (c) => {
      const r = await api(c).post('/devices', { vendor: 'HIKVISION_PUSH', name: `Hik ${rnd()}`, sourceTimezone: 'Asia/Kolkata' }).expect(201);
      return {
        token: r.body.pushToken,
        ownerId: r.body.device.id,
        call: async () => (await request(app).post(`/hikvision/${r.body.pushToken}`).set('Content-Type', 'application/json').send('{}')).status,
        switchOff: () => outsideTenant('test: terminal switched off', () => peoplePrisma.attendanceDevice.update({ where: { id: r.body.device.id }, data: { isActive: false } })),
      };
    },
  },
};

const credentialOf = (c: Ctx, kind: Kind, token: string) =>
  outsideTenant('test: the registry row', () => platformPrisma.credential.findUnique({ where: { kind_tokenHash: { kind, tokenHash: hashToken(token) } } }));
const user = (c: Ctx) => ({ type: 'USER' as const, id: c.userId });
const works = (s: number) => s >= 200 && s < 300;

let c: Ctx;
beforeAll(async () => {
  c = await company();
}, 60_000);

describe.each(Object.entries(KINDS))('%s', (_name, k) => {
  it('is registered when made, and works', async () => {
    const m = await k.make(c);
    expect(works(await m.call())).toBe(true);
    const cred = await credentialOf(c, k.kind, m.token);
    expect(cred).toMatchObject({ orgId: c.orgId, ownerId: m.ownerId, status: 'ACTIVE' });
  });

  it('stops while suspended and works again when resumed', async () => {
    const m = await k.make(c);
    const cred = (await credentialOf(c, k.kind, m.token))!;
    await suspendCredential(cred.id, c.orgId, user(c));
    expect(works(await m.call())).toBe(false);
    await resumeCredential(cred.id, c.orgId, user(c));
    expect(works(await m.call())).toBe(true);
  });

  it('stops for good once revoked', async () => {
    const m = await k.make(c);
    const cred = (await credentialOf(c, k.kind, m.token))!;
    await revokeCredential(cred.id, c.orgId, user(c));
    expect(works(await m.call())).toBe(false);
  });

  it('stops once expired', async () => {
    const m = await k.make(c);
    const cred = (await credentialOf(c, k.kind, m.token))!;
    await runInTenant(c.orgId, () => platformPrisma.credential.update({ where: { id: cred.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    expect(works(await m.call())).toBe(false);
    await extendCredential(cred.id, c.orgId, new Date(Date.now() + 30 * DAY), user(c));
    expect(works(await m.call())).toBe(true);
  });

  it('stops when its own table says so, although the registry still says active', async () => {
    const m = await k.make(c);
    await m.switchOff();
    expect(works(await m.call())).toBe(false);
    expect((await credentialOf(c, k.kind, m.token))!.status).toBe('ACTIVE');
  });

  it('stops while the company is closing', async () => {
    const d = await company();
    const m = await k.make(d);
    await outsideTenant('test: schedule closure', () =>
      platformPrisma.orgClosure.create({
        data: { accountId: d.accountId, orgId: d.orgId, orgName: 'CM', status: 'SCHEDULED', requestedByUserId: d.userId, requestedAt: new Date(), deleteAfter: new Date(Date.now() + 30 * DAY) },
      })
    );
    expect(works(await m.call())).toBe(false);
  }, 60_000);

  it('a token issued before the registry still works, and is registered on first use', async () => {
    const m = await k.make(c);
    await outsideTenant('test: forget the registry row', () => platformPrisma.credential.deleteMany({ where: { kind: k.kind, tokenHash: hashToken(m.token) } }));
    expect(works(await m.call())).toBe(true);
    const cred = await credentialOf(c, k.kind, m.token);
    expect(cred?.status).toBe('ACTIVE');
    const ev = await outsideTenant('test', () => platformPrisma.credentialEvent.findMany({ where: { credentialId: cred!.id } }));
    expect(ev.map((e) => e.eventType)).toEqual(['migrated']);
  });
});

describe('API key rotation', () => {
  it('the new key works and the old one stops at once', async () => {
    const m = await KINDS['API key'].make(c);
    const r = await api(c).post(`/integrations/keys/${m.ownerId}/rotate`).expect(200);
    expect((await request(app).get('/v1/ping').set('Authorization', `Bearer ${r.body.token}`)).status).toBe(200);
    expect((await request(app).get('/v1/ping').set('Authorization', `Bearer ${m.token}`)).status).toBe(401);
  });

  it('a revoked key is not brought back by rotating it', async () => {
    const m = await KINDS['API key'].make(c);
    await api(c).post(`/integrations/keys/${m.ownerId}/revoke`).expect(200);
    const r = await api(c).post(`/integrations/keys/${m.ownerId}/rotate`);
    expect(r.status).toBe(409);
    expect((await request(app).get('/v1/ping').set('Authorization', `Bearer ${m.token}`)).status).toBe(401);
  });

  it('older code rotating a key in its own table (registry not told) leaves the old key refused', async () => {
    const m = await KINDS['API key'].make(c);
    await outsideTenant('test: old code re-hashes in place', () => peoplePrisma.apiClient.update({ where: { id: m.ownerId }, data: { tokenHash: hashToken(`clor_${rnd()}`) } }));
    expect((await request(app).get('/v1/ping').set('Authorization', `Bearer ${m.token}`)).status).toBe(401);
  });

  it('revoking writes the registry and the key row, and records who did it', async () => {
    const m = await KINDS['API key'].make(c);
    await api(c).post(`/integrations/keys/${m.ownerId}/revoke`, { reason: 'leaked in a log' }).expect(200);
    const cred = (await credentialOf(c, 'API_KEY', m.token))!;
    expect(cred.status).toBe('REVOKED');
    const ev = await outsideTenant('test', () => platformPrisma.credentialEvent.findMany({ where: { credentialId: cred.id, eventType: 'revoked' } }));
    expect(ev[0]).toMatchObject({ actorType: 'USER', actorId: c.userId, reason: 'leaked in a log' });
  });

  it('a new key has a one-year expiry, and the public API says so', async () => {
    const m = await KINDS['API key'].make(c);
    const cred = (await credentialOf(c, 'API_KEY', m.token))!;
    expect(cred.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 360 * DAY);
    const r = await request(app).get('/v1/ping').set('Authorization', `Bearer ${m.token}`).expect(200);
    expect(r.headers['x-clor-credential-expires']).toBe(cred.expiresAt!.toISOString());
  });
});

describe('agent and reader rotation', () => {
  it('a rotated agent token: the new one works, the old one stops', async () => {
    const m = await KINDS['site agent'].make(c);
    const r = await api(c).post(`/integrations/agents/${m.ownerId}/rotate`).expect(200);
    expect((await request(app).get('/agent/v1/config').set('Authorization', `Bearer ${r.body.token}`)).status).toBe(200);
    expect((await request(app).get('/agent/v1/config').set('Authorization', `Bearer ${m.token}`)).status).toBe(401);
  });

  it('switching an agent back on leaves a separately suspended agent token refused', async () => {
    const m = await KINDS['site agent'].make(c);
    const cred = (await credentialOf(c, 'AGENT', m.token))!;
    await suspendCredential(cred.id, c.orgId, user(c));
    await api(c).put(`/integrations/agents/${m.ownerId}`, { name: 'x', isActive: false }).expect(200);
    await api(c).put(`/integrations/agents/${m.ownerId}`, { name: 'x', isActive: true }).expect(200);
    expect(works(await m.call())).toBe(false);
  });

  it('a rotated reader URL: the new one works, the old one stops', async () => {
    const m = await KINDS['HTTP push reader'].make(c);
    const r = await api(c).post(`/devices/${m.ownerId}/rotate-token`).expect(200);
    expect(works((await request(app).post(`/ingest/${r.body.pushToken}`).send({ a: 1 })).status)).toBe(true);
    expect(works(await m.call())).toBe(false);
  });

  it('a reader URL is not accepted by another vendor’s route', async () => {
    const m = await KINDS['HTTP push reader'].make(c);
    expect(works((await request(app).post(`/hikvision/${m.token}`).set('Content-Type', 'application/json').send('{}')).status)).toBe(false);
  });
});

describe('backfill at deploy', () => {
  it('registers every live key, agent and reader once, however often it runs', async () => {
    const d = await company();
    const made = [await KINDS['API key'].make(d), await KINDS['site agent'].make(d), await KINDS['HTTP push reader'].make(d)];
    await outsideTenant('test: as if made before the registry', () => platformPrisma.credential.deleteMany({ where: { orgId: d.orgId } }));
    await Promise.all([backfillCredentials(), backfillCredentials()]);
    const rows = await outsideTenant('test', () => platformPrisma.credential.findMany({ where: { orgId: d.orgId } }));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.ownerId))).toEqual(new Set(made.map((m) => m.ownerId)));
  }, 90_000);
});
