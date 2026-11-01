import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * SCIM 2.0 provisioning: an identity provider (Entra / Okta shapes) with a
 * token made under Settings → Single sign-on creates, looks up, patches,
 * deactivates and removes people of one organisation, and nothing else.
 */

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { parseFilter } = await import('../routes/scim.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await platformPrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `scim.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'SCIM owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `SCIM Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: signup.body.user?.id || '' };
}
const sec = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/security${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/security${p}`).set(at(c)),
});
const idp = (token: string) => ({
  get: (p: string) => request(app).get(`/scim/v2${p}`).set('Authorization', `Bearer ${token}`),
  post: (p: string, b: unknown) => request(app).post(`/scim/v2${p}`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/scim+json').send(JSON.stringify(b)),
  put: (p: string, b: unknown) => request(app).put(`/scim/v2${p}`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/scim+json').send(JSON.stringify(b)),
  patch: (p: string, b: unknown) => request(app).patch(`/scim/v2${p}`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/scim+json').send(JSON.stringify(b)),
  del: (p: string) => request(app).delete(`/scim/v2${p}`).set('Authorization', `Bearer ${token}`),
});

describe('directory sync tokens', () => {
  it('are made once, listed by prefix, and revoked', async () => {
    const c = await makeOwner();
    const empty = await sec(c).get('/scim').expect(200);
    expect(empty.body.baseUrl).toMatch(/\/scim\/v2$/);
    expect(empty.body.tokens).toEqual([]);
    const made = await sec(c).post('/scim').expect(201);
    expect(made.body.token).toMatch(/^clors_/);
    const listed = await sec(c).get('/scim').expect(200);
    expect(listed.body.tokens).toHaveLength(1);
    expect(listed.body.tokens[0].tokenPrefix).toBe(made.body.token.slice(0, 12));
    expect(JSON.stringify(listed.body)).not.toContain(made.body.token);
    await sec(c).post('/scim', { defaultRoleId: 'nope' }).expect(400);
    await sec(c).del(`/scim/${listed.body.tokens[0].id}`).expect(200);
    await idp(made.body.token).get('/Users').expect(401);
  });
});

describe('an identity provider provisioning users', () => {
  it('discovers the service, creates, finds, patches, deactivates and removes a person', async () => {
    const c = await makeOwner();
    const token = (await sec(c).post('/scim').expect(201)).body.token;
    const p = idp(token);

    await request(app).get('/scim/v2/Users').expect(401);
    await request(app).get('/scim/v2/Users').set('Authorization', 'Bearer clors_' + 'x'.repeat(32)).expect(401);
    const cfg = await p.get('/ServiceProviderConfig').expect(200);
    expect(cfg.type).toBe('application/scim+json');
    expect(cfg.body.patch.supported).toBe(true);
    expect((await p.get('/ResourceTypes').expect(200)).body.Resources[0].endpoint).toBe('/Users');
    expect((await p.get('/Schemas').expect(200)).body.Resources[0].id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');

    /* The owner is already a member: listed, and found by userName. */
    const all = await p.get('/Users').expect(200);
    expect(all.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
    expect(all.body.totalResults).toBe(1);
    const owner = all.body.Resources[0];
    expect(owner.userName).toMatch(/^scim\./);
    expect((await p.get(`/Users?filter=${encodeURIComponent(`userName eq "${owner.userName}"`)}`).expect(200)).body.totalResults).toBe(1);
    expect((await p.get(`/Users?filter=${encodeURIComponent('userName eq "nobody@example.com"')}`).expect(200)).body.totalResults).toBe(0);
    expect((await p.get(`/Users?filter=${encodeURIComponent('externalId eq "abc"')}`).expect(200)).body.totalResults).toBe(0);
    expect((await p.get(`/Users?filter=${encodeURIComponent('title co "x"')}`).expect(400)).body.scimType).toBe('invalidFilter');

    /* Entra's create. */
    const email = `asha.${rnd()}@example.com`;
    const created = await p.post('/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], externalId: 'ext-1', userName: email, name: { givenName: 'Asha', familyName: 'Rao' }, displayName: 'Asha Rao', emails: [{ primary: true, value: email, type: 'work' }], active: true }).expect(201);
    expect(created.headers.location).toMatch(new RegExp(`/scim/v2/Users/${created.body.id}$`));
    expect(created.body).toMatchObject({ userName: email, name: { givenName: 'Asha', familyName: 'Rao', formatted: 'Asha Rao' }, active: true, meta: { resourceType: 'User' } });
    const u = await platformPrisma.user.findUnique({ where: { id: created.body.id } });
    expect(u?.fullName).toBe('Asha Rao');
    expect(await platformPrisma.userOrgMembership.count({ where: { orgId: c.orgId, userId: created.body.id } })).toBe(1);
    /* Again: a uniqueness conflict, not a second user. */
    expect((await p.post('/Users', { userName: email, name: { givenName: 'Asha' } }).expect(409)).body.scimType).toBe('uniqueness');
    expect((await p.post('/Users', { userName: 'not-an-email' }).expect(400)).body.scimType).toBe('invalidValue');

    /* Entra's patch: path + string value. */
    const patched = await p.patch(`/Users/${created.body.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'name.familyName', value: 'Rao-Iyer' }, { op: 'Replace', path: 'active', value: 'False' }] }).expect(200);
    expect(patched.body).toMatchObject({ active: false, name: { formatted: 'Asha Rao-Iyer' } });
    expect((await platformPrisma.user.findUnique({ where: { id: created.body.id } }))?.isActive).toBe(false);
    /* Okta's patch: value object, no path. */
    await p.patch(`/Users/${created.body.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: true } }] }).expect(200);
    expect((await platformPrisma.user.findUnique({ where: { id: created.body.id } }))?.isActive).toBe(true);
    expect((await p.patch(`/Users/${created.body.id}`, { Operations: 'nope' }).expect(400)).body.scimType).toBe('invalidSyntax');

    /* A full replace renames and changes the e-mail. */
    const email2 = `asha2.${rnd()}@example.com`;
    const put = await p.put(`/Users/${created.body.id}`, { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: email2, name: { givenName: 'Asha', familyName: 'R' }, active: true }).expect(200);
    expect(put.body).toMatchObject({ userName: email2, name: { formatted: 'Asha R' } });
    expect((await p.put(`/Users/${created.body.id}`, { userName: owner.userName, name: { givenName: 'X' } }).expect(409)).body.scimType).toBe('uniqueness');

    /* Removal: out of the organisation, and switched off since there is nowhere else to go. */
    await p.del(`/Users/${created.body.id}`).expect(204);
    await p.get(`/Users/${created.body.id}`).expect(404);
    expect(await platformPrisma.userOrgMembership.count({ where: { orgId: c.orgId, userId: created.body.id } })).toBe(0);
    expect((await platformPrisma.user.findUnique({ where: { id: created.body.id } }))?.isActive).toBe(false);

    expect((await p.get('/Groups').expect(501)).body.detail).toMatch(/Groups are not provisioned/);
  });

  it('gives new people the token’s role, and never reaches another organisation', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const roleId = (await request(app).get(`/api/orgs/${a.orgId}/roles`).set(at(a)).expect(200)).body.roles?.[0]?.id;
    const tokenA = (await sec(a).post('/scim', roleId ? { defaultRoleId: roleId } : {}).expect(201)).body.token;
    const tokenB = (await sec(b).post('/scim').expect(201)).body.token;
    const email = `ravi.${rnd()}@example.com`;
    const made = await idp(tokenA).post('/Users', { userName: email, name: { givenName: 'Ravi', familyName: 'K' } }).expect(201);
    if (roleId) expect(await platformPrisma.userRoleAssignment.count({ where: { orgId: a.orgId, userId: made.body.id, roleId } })).toBe(1);
    /* B's provider cannot see, change or remove A's person. */
    await idp(tokenB).get(`/Users/${made.body.id}`).expect(404);
    await idp(tokenB).patch(`/Users/${made.body.id}`, { Operations: [{ op: 'replace', path: 'active', value: false }] }).expect(404);
    await idp(tokenB).del(`/Users/${made.body.id}`).expect(404);
    expect((await idp(tokenB).get(`/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`).expect(200)).body.totalResults).toBe(0);
    /* B naming A's person is refused outright: not attached to B, not described, no id handed over. */
    const refused = await idp(tokenB).post('/Users', { userName: email, name: { givenName: 'Ravi' } }).expect(409);
    expect(refused.body.scimType).toBe('uniqueness');
    expect(JSON.stringify(refused.body)).not.toContain(made.body.id);
    expect(await platformPrisma.userOrgMembership.count({ where: { orgId: b.orgId, userId: made.body.id } })).toBe(0);
    /* Even if A's person were a member of B (invited by hand), B's provider may not change who they are. */
    await platformPrisma.userOrgMembership.create({ data: { accountId: (await platformPrisma.org.findUniqueOrThrow({ where: { id: b.orgId } })).accountId, orgId: b.orgId, userId: made.body.id } });
    for (const op of [{ path: 'userName', value: `taken.${rnd()}@evil.example` }, { path: 'name.formatted', value: 'Someone Else' }, { path: 'active', value: false }]) {
      expect((await idp(tokenB).patch(`/Users/${made.body.id}`, { Operations: [{ op: 'replace', ...op }] }).expect(403)).body.detail).toMatch(/another account/);
    }
    expect((await idp(tokenB).put(`/Users/${made.body.id}`, { userName: `taken.${rnd()}@evil.example`, name: { givenName: 'X' } }).expect(403)).body.detail).toMatch(/another account/);
    expect((await platformPrisma.user.findUnique({ where: { id: made.body.id } }))?.email).toBe(email);
    /* B removing them leaves A's membership and their login alone. */
    await idp(tokenB).del(`/Users/${made.body.id}`).expect(204);
    expect(await platformPrisma.userOrgMembership.count({ where: { orgId: a.orgId, userId: made.body.id } })).toBe(1);
    expect((await platformPrisma.user.findUnique({ where: { id: made.body.id } }))?.isActive).toBe(true);
  });

  it('reads the filters providers send', () => {
    expect(parseFilter('userName eq "a@b.com"')).toEqual({ attr: 'username', value: 'a@b.com' });
    expect(parseFilter('emails.value eq "a@b.com"')).toEqual({ attr: 'emails.value', value: 'a@b.com' });
    expect(parseFilter('userName co "a"')).toBeNull();
    expect(parseFilter(undefined)).toBeNull();
  });
});
