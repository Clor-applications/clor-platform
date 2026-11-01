import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * Role administration cannot be turned against the organisation.
 *
 * Two families of guard. Nobody hands out more than they hold: a person who
 * may edit roles cannot write the whole catalogue onto their own role, and a
 * person who may edit users cannot hand themselves Administrator. And the
 * organisation always keeps an administrator: the last one cannot be removed,
 * deactivated or demoted, and an Administrator role cannot be stripped of the
 * permissions needed to administer.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string; userId: string; roleId?: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const uid = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

async function makeOwner(): Promise<Ctx> {
  const email = `guard.${uid()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Guard owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Guard Co ${uid()}`, state: 'Karnataka' })
    .expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  return {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    userId: String(me.body.user?.id || me.body.id),
  };
}

/** A member holding one CUSTOM role with exactly these permissions. */
async function makeMember(keys: string[], label: string, roleExtra: Record<string, unknown> = {}): Promise<Ctx> {
  const role = await request(app)
    .post(`/api/orgs/${owner.orgId}/roles`)
    .set(auth(owner))
    .send({ name: `${label} ${uid()}`, roleType: 'CUSTOM', permissions: keys, ...roleExtra })
    .expect(201);
  const roleId = role.body.role.id;

  const email = `member.${uid()}@example.com`;
  const user = await request(app)
    .post('/api/users')
    .set(auth(owner))
    .send({
      email,
      fullName: label,
      password: 'Passw0rd!23',
      orgIds: [owner.orgId],
      branchIdsByOrg: { [owner.orgId]: [owner.branchId] },
    })
    .expect(201);

  await request(app)
    .post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/roles`)
    .set(auth(owner))
    .send({ roleId, branchId: null })
    .expect(201);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ emailOrUsername: email, password: 'Passw0rd!23' })
    .expect(200);

  return { token: login.body.token, orgId: owner.orgId, branchId: owner.branchId, userId: user.body.user.id, roleId };
}

/** A fresh organisation, for tests that need to be its only administrator. */
const makeOwnerLike = () => makeOwner();

const ROLE_ADMIN_KEYS = [
  'SETTINGS::Roles::VIEW',
  'SETTINGS::Roles::CREATE',
  'SETTINGS::Roles::EDIT',
  'SETTINGS::Roles::DELETE',
  'SETTINGS::Users::VIEW',
  'SETTINGS::Users::EDIT',
  'SETTINGS::Users::DELETE',
];

async function adminRoleId() {
  const roles = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
  const admin = roles.body.roles.find((r: any) => r.roleType === 'ADMIN' && r.name === 'Administrator');
  return String(admin.id);
}

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('nobody hands out more than they hold', () => {
  let clerk: Ctx;
  beforeAll(async () => {
    clerk = await makeMember(ROLE_ADMIN_KEYS, 'Role clerk');
  });

  it('refuses to write an unheld permission onto a role through the matrix', async () => {
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${clerk.roleId}/permissions`)
      .set(auth(clerk))
      .send({ permissions: [...ROLE_ADMIN_KEYS, 'SALES::Invoices::DELETE'] })
      .expect(403);
    expect(res.body.code).toBe('cannot_grant_unheld');
    expect(res.body.permissions).toEqual(['SALES::Invoices::DELETE']);

    // And nothing changed on the way to being refused.
    const after = await request(app)
      .get(`/api/orgs/${owner.orgId}/roles/${clerk.roleId}/permissions`)
      .set(auth(clerk))
      .expect(200);
    expect(after.body.permissions).not.toContain('SALES::Invoices::DELETE');
  });

  it('refuses it on the role form too, on create and on edit', async () => {
    await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(clerk))
      .send({ name: `Sneaky ${uid()}`, permissions: ['ACCOUNTING::Ledger::VIEW'] })
      .expect(403);

    const ok = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(clerk))
      .send({ name: `Honest ${uid()}`, permissions: ['SETTINGS::Users::VIEW'] })
      .expect(201);

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/roles/${ok.body.role.id}`)
      .set(auth(clerk))
      .send({ permissions: ['SETTINGS::Users::VIEW', 'ACCOUNTING::Ledger::VIEW'] })
      .expect(403);
  });

  it('lets a role be trimmed by someone who could not have granted it', async () => {
    // The owner grants the clerk's role something the clerk does not hold...
    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${clerk.roleId}/permissions`)
      .set(auth(owner))
      .send({ permissions: [...ROLE_ADMIN_KEYS, 'REPORTS::Sales Reports::VIEW'] })
      .expect(200);
    // ...and the clerk may still take it back off, since removing is not granting.
    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${clerk.roleId}/permissions`)
      .set(auth(clerk))
      .send({ permissions: ROLE_ADMIN_KEYS })
      .expect(200);
  });

  it('rejects a permission the catalogue does not know, on the role form', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Bogus ${uid()}`, permissions: ['SALES::Invoices::VIEW', 'NOPE::Thing::VIEW'] })
      .expect(400);
    expect(res.body.error).toMatch(/Unknown permission/);
  });

  it('keeps ADMIN-type roles for administrators only', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(clerk))
      .send({ name: `Self admin ${uid()}`, roleType: 'ADMIN', permissions: [] })
      .expect(403);
    expect(res.body.code).toBe('admin_only');

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/roles/${clerk.roleId}`)
      .set(auth(clerk))
      .send({ roleType: 'ADMIN' })
      .expect(403);

    const admin = await adminRoleId();
    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${admin}/permissions`)
      .set(auth(clerk))
      .send({ permissions: ROLE_ADMIN_KEYS })
      .expect(403);
    await request(app).delete(`/api/orgs/${owner.orgId}/roles/${admin}`).set(auth(clerk)).expect(403);
  });

  it('does not let a user administrator hand out Administrator, to themselves or anyone', async () => {
    const admin = await adminRoleId();
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${clerk.userId}/role`)
      .set(auth(clerk))
      .send({ roleId: admin })
      .expect(403);
    expect(res.body.code).toBe('admin_only');

    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${clerk.userId}/roles`)
      .set(auth(clerk))
      .send({ roleId: admin, branchId: null })
      .expect(403);
  });

  it('does not let a user administrator assign a role that grants more than they hold', async () => {
    const accountant = (await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200)).body.roles.find(
      (r: any) => r.name === 'Accountant'
    );
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${clerk.userId}/role`)
      .set(auth(clerk))
      .send({ roleId: accountant.id })
      .expect(403);
    expect(res.body.code).toBe('cannot_grant_unheld');
  });

  it('does not let a profile smuggle an Administrator role past the same rule', async () => {
    const admin = await adminRoleId();
    const profile = await request(app)
      .post(`/api/orgs/${owner.orgId}/role-profiles`)
      .set(auth(owner))
      .send({ name: `Everything ${uid()}`, roleIds: [admin] })
      .expect(201);
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${clerk.userId}/role-profiles`)
      .set(auth(clerk))
      .send({ profileIds: [profile.body.profile.id] })
      .expect(403);
    expect(res.body.code).toBe('admin_only');
  });

  it('only assigns roles to people who are already members', async () => {
    const stranger = await makeOwner();
    const viewer = (await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200)).body.roles.find(
      (r: any) => r.name === 'Viewer'
    );
    await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${stranger.userId}/role`)
      .set(auth(owner))
      .send({ roleId: viewer.id })
      .expect(404);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${stranger.userId}/roles`)
      .set(auth(owner))
      .send({ roleId: viewer.id, branchId: null })
      .expect(404);
    expect(
      await platformPrisma.userOrgMembership.count({ where: { orgId: owner.orgId, userId: stranger.userId } })
    ).toBe(0);
  });

  it('tells the client whether it is an administrator', async () => {
    const me = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(owner)).expect(200);
    expect(me.body.isAdmin).toBe(true);
    const them = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(clerk)).expect(200);
    expect(them.body.isAdmin).toBe(false);
  });
});

describe('the organisation always keeps an administrator', () => {
  it('refuses to clear, remove or deactivate the last administrator', async () => {
    const cleared = await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${owner.userId}/role`)
      .set(auth(owner))
      .send({ roleId: null })
      .expect(409);
    expect(cleared.body.code).toBe('last_admin');

    await request(app).delete(`/api/orgs/${owner.orgId}/users/${owner.userId}`).set(auth(owner)).expect(409);

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/users/${owner.userId}`)
      .set(auth(owner))
      .send({ isActive: false })
      .expect(409);

    // Still an administrator, still signed in.
    await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
  });

  it('allows it once somebody else is an administrator', async () => {
    const admin = await adminRoleId();
    const second = await makeMember(['SETTINGS::Users::VIEW'], 'Second admin');
    await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${second.userId}/role`)
      .set(auth(owner))
      .send({ roleId: admin })
      .expect(200);

    // Now the second admin can demote the owner (and reinstate them).
    const viewer = (await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(second)).expect(200)).body.roles.find(
      (r: any) => r.name === 'Viewer'
    );
    await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${owner.userId}/role`)
      .set(auth(second))
      .send({ roleId: viewer.id })
      .expect(200);
    // ...but not themselves, now that they are the only one left.
    await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${second.userId}/role`)
      .set(auth(second))
      .send({ roleId: viewer.id })
      .expect(409);
    await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${owner.userId}/role`)
      .set(auth(second))
      .send({ roleId: admin })
      .expect(200);
  });

  it('keeps the Administrator role able to administer', async () => {
    const admin = await adminRoleId();
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${admin}/permissions`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::VIEW'] })
      .expect(400);
    expect(res.body.code).toBe('admin_lockout');
    expect(res.body.permissions).toContain('SETTINGS::Roles::EDIT');

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/roles/${admin}`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::VIEW'] })
      .expect(400);
  });

  it('will not demote the only Administrator role to a custom one', async () => {
    const admin = await adminRoleId();
    const res = await request(app)
      .patch(`/api/orgs/${owner.orgId}/roles/${admin}`)
      .set(auth(owner))
      .send({ roleType: 'CUSTOM' })
      .expect(409);
    expect(res.body.code).toBe('last_admin');
  });
});

describe('administrators who hold the role through a profile', () => {
  it('count as administrators, so a direct admin can step down once one exists', async () => {
    const org = await makeOwnerLike();
    const admin = (await request(app).get(`/api/orgs/${org.orgId}/roles`).set(auth(org)).expect(200)).body.roles.find(
      (r: any) => r.name === 'Administrator'
    );
    const viewer = (await request(app).get(`/api/orgs/${org.orgId}/roles`).set(auth(org)).expect(200)).body.roles.find(
      (r: any) => r.name === 'Viewer'
    );

    // Alone, the owner may not step down.
    await request(app).put(`/api/orgs/${org.orgId}/users/${org.userId}/role`).set(auth(org)).send({ roleId: viewer.id }).expect(409);

    // A second person made administrator only through a profile.
    const profile = await request(app)
      .post(`/api/orgs/${org.orgId}/role-profiles`)
      .set(auth(org))
      .send({ name: `Admins ${uid()}`, roleIds: [admin.id] })
      .expect(201);
    const email = `padmin.${uid()}@example.com`;
    const user = await request(app)
      .post('/api/users')
      .set(auth(org))
      .send({ email, fullName: 'Profile admin', password: 'Passw0rd!23', orgIds: [org.orgId], branchIdsByOrg: { [org.orgId]: [org.branchId] } })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${org.orgId}/users/${user.body.user.id}/role-profiles`)
      .set(auth(org))
      .send({ profileIds: [profile.body.profile.id] })
      .expect(200);

    // Now the owner may, because an administrator remains.
    await request(app).put(`/api/orgs/${org.orgId}/users/${org.userId}/role`).set(auth(org)).send({ roleId: viewer.id }).expect(200);

    // And the profile can no longer be emptied or deleted, or taken off its
    // holder, since that would leave nobody.
    const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
    const padmin = { ...org, token: login.body.token };
    await request(app)
      .put(`/api/orgs/${org.orgId}/role-profiles/${profile.body.profile.id}`)
      .set(auth(padmin))
      .send({ name: 'Admins', roleIds: [] })
      .expect(409);
    await request(app).delete(`/api/orgs/${org.orgId}/role-profiles/${profile.body.profile.id}`).set(auth(padmin)).expect(409);
    await request(app)
      .post(`/api/orgs/${org.orgId}/users/${user.body.user.id}/role-profiles`)
      .set(auth(padmin))
      .send({ profileIds: [] })
      .expect(409);
  });

  it('does not hand a creator who stepped down their Owner role back on the next request', async () => {
    const org = await makeOwnerLike();
    const admin = (await request(app).get(`/api/orgs/${org.orgId}/roles`).set(auth(org)).expect(200)).body.roles.find(
      (r: any) => r.name === 'Administrator'
    );
    const email = `successor.${uid()}@example.com`;
    const user = await request(app)
      .post('/api/users')
      .set(auth(org))
      .send({ email, fullName: 'Successor', password: 'Passw0rd!23', orgIds: [org.orgId], branchIdsByOrg: { [org.orgId]: [org.branchId] } })
      .expect(201);
    await request(app).put(`/api/orgs/${org.orgId}/users/${user.body.user.id}/role`).set(auth(org)).send({ roleId: admin.id }).expect(200);

    // The creator hands over and keeps no role.
    await request(app).put(`/api/orgs/${org.orgId}/users/${org.userId}/role`).set(auth(org)).send({ roleId: null }).expect(200);

    // Their next request is refused, and refusing it wrote nothing.
    await request(app).get(`/api/orgs/${org.orgId}/roles`).set(auth(org)).expect(403);
    expect(await platformPrisma.userRoleAssignment.count({ where: { orgId: org.orgId, userId: org.userId } })).toBe(0);
  });

  it('cannot be created by putting an Administrator role into a profile somebody already holds', async () => {
    const clerk = await makeMember(ROLE_ADMIN_KEYS, 'Profile editor');
    const viewerRole = (await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200)).body.roles.find(
      (r: any) => r.name === 'Viewer'
    );
    const profile = await request(app)
      .post(`/api/orgs/${owner.orgId}/role-profiles`)
      .set(auth(owner))
      .send({ name: `Ordinary ${uid()}`, roleIds: [] })
      .expect(201);
    const admin = await adminRoleId();
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/role-profiles/${profile.body.profile.id}`)
      .set(auth(clerk))
      .send({ name: 'Ordinary', roleIds: [admin] })
      .expect(403);
    expect(res.body.code).toBe('admin_only');
    // Nor a role holding more than the editor holds.
    const more = await request(app)
      .put(`/api/orgs/${owner.orgId}/role-profiles/${profile.body.profile.id}`)
      .set(auth(clerk))
      .send({ name: 'Ordinary', roleIds: [viewerRole.id] })
      .expect(403);
    expect(more.body.code).toBe('cannot_grant_unheld');
  });

  it('are cleared with the person when they are removed from the company', async () => {
    const member = await makeMember(['SALES::Invoices::VIEW'], 'Leaver');
    const profile = await request(app)
      .post(`/api/orgs/${owner.orgId}/role-profiles`)
      .set(auth(owner))
      .send({ name: `Leaver profile ${uid()}`, roleIds: [member.roleId] })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${member.userId}/role-profiles`)
      .set(auth(owner))
      .send({ profileIds: [profile.body.profile.id] })
      .expect(200);
    await request(app).delete(`/api/orgs/${owner.orgId}/users/${member.userId}`).set(auth(owner)).expect(200);
    expect(await platformPrisma.userRoleProfile.count({ where: { orgId: owner.orgId, userId: member.userId } })).toBe(0);
  });
});

describe('deleting a role', () => {
  it('deletes an unused role and cleans up its profile links', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Disposable ${uid()}`, permissions: ['SALES::Invoices::VIEW'] })
      .expect(201);
    const profile = await request(app)
      .post(`/api/orgs/${owner.orgId}/role-profiles`)
      .set(auth(owner))
      .send({ name: `Holds disposable ${uid()}`, roleIds: [role.body.role.id] })
      .expect(201);

    await request(app).delete(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}`).set(auth(owner)).expect(200);

    expect(await platformPrisma.role.count({ where: { id: role.body.role.id } })).toBe(0);
    expect(await platformPrisma.roleProfileRole.count({ where: { profileId: profile.body.profile.id } })).toBe(0);
    await request(app).delete(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}`).set(auth(owner)).expect(404);
  });

  it('does not re-seed a standard role that was deleted on purpose', async () => {
    const before = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const reports = before.body.roles.find((r: any) => r.name === 'Reports Only');
    await request(app).delete(`/api/orgs/${owner.orgId}/roles/${reports.id}`).set(auth(owner)).expect(200);
    const after = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    expect(after.body.roles.map((r: any) => r.name)).not.toContain('Reports Only');
  });

  it('refuses while somebody still holds it', async () => {
    const member = await makeMember(['SALES::Invoices::VIEW'], 'Holder');
    const res = await request(app).delete(`/api/orgs/${owner.orgId}/roles/${member.roleId}`).set(auth(owner)).expect(409);
    expect(res.body.code).toBe('role_in_use');
    expect(res.body.assignedUsersCount).toBe(1);
  });

  it('refuses while an approval rule names it as the approver', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Approver ${uid()}`, permissions: ['SALES::Credit Notes::APPROVE'] })
      .expect(201);
    const rule = await request(app)
      .post(`/api/orgs/${owner.orgId}/approval-rules`)
      .set(auth(owner))
      .send({ docType: 'INVOICE', name: `Big ones ${uid()}`, minAmount: 100000, approverRoleId: role.body.role.id });
    expect(`${rule.status} ${JSON.stringify(rule.body)}`).toMatch(/^201/);
    const res = await request(app).delete(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}`).set(auth(owner)).expect(409);
    expect(res.body.approvalRulesCount).toBe(1);
  });
});

describe('roles holding keys the catalogue has retired', () => {
  it('drops them on save instead of refusing the whole role, and still refuses new ones', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Legacy ${uid()}`, permissions: ['SALES::Invoices::VIEW'] })
      .expect(201);
    const id = role.body.role.id;

    // What the old Roles screen wrote: a key no route checks.
    const legacy =
      (await platformPrisma.permission.findFirst({ where: { module: 'PAYMENTS', subModule: 'Receipts', action: 'VIEW' } })) ||
      (await platformPrisma.permission.create({ data: { module: 'PAYMENTS', subModule: 'Receipts', action: 'VIEW' } }));
    await platformPrisma.rolePermission.create({
      data: { accountId: role.body.role.accountId, orgId: owner.orgId, roleId: id, permissionId: legacy.id, allowed: true },
    });

    // The Roles form sends everything it loaded back.
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/roles/${id}`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE', 'PAYMENTS::Receipts::VIEW'] })
      .expect(200);
    const after = await request(app).get(`/api/orgs/${owner.orgId}/roles/${id}/permissions`).set(auth(owner)).expect(200);
    expect(after.body.permissions.sort()).toEqual(['SALES::Invoices::CREATE', 'SALES::Invoices::VIEW']);

    // Now that it is gone, it is new again, and refused.
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/roles/${id}`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::VIEW', 'PAYMENTS::Receipts::VIEW'] })
      .expect(400);
  });
});

describe('editing a role on the Roles screen', () => {
  it('keeps the field levels the matrix set on permissions the role retains', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Levelled ${uid()}`, permissions: ['SALES::Invoices::CREATE', 'SALES::Invoices::VIEW'] })
      .expect(201);
    const id = role.body.role.id;

    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${id}/permissions`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::CREATE', 'SALES::Invoices::VIEW'], levels: { 'SALES::Invoices::CREATE': 1 } })
      .expect(200);

    // The Roles form resends the whole set, minus one.
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/roles/${id}`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::CREATE'] })
      .expect(200);

    const after = await request(app).get(`/api/orgs/${owner.orgId}/roles/${id}/permissions`).set(auth(owner)).expect(200);
    expect(after.body.permissions).toEqual(['SALES::Invoices::CREATE']);
    expect(after.body.levels['SALES::Invoices::CREATE']).toBe(1);
  });
});

describe('payments ask for permission', () => {
  let bankId: string;
  let ownersReceipt: string;

  const receipt = (c: Ctx, amount = 500) =>
    request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(c))
      .send({ direction: 'RECEIPT', date: '2026-09-29', partyType: 'CUSTOMER', partyName: 'Acme', ledgerAccountId: bankId, amount });

  beforeAll(async () => {
    const opened = await request(app)
      .post(`/api/orgs/${owner.orgId}/ledger/accounts`)
      .set(auth(owner))
      .send({ name: `Bank ${uid()}`, accountType: 'ASSET', controlKind: 'BANK' })
      .expect(201);
    bankId = opened.body.account.id;
    ownersReceipt = (await receipt(owner).expect(201)).body.payment.id;
  });

  it('refuses to list, reverse or reconcile without the rights, where it used to ask for nothing', async () => {
    const outsider = await makeMember(['PAYROLL::Payroll Runs::VIEW'], 'Payroll clerk');
    await request(app).get(`/api/orgs/${owner.orgId}/payments?direction=RECEIPT`).set(auth(outsider)).expect(403);
    await request(app).get(`/api/orgs/${owner.orgId}/payments?direction=PAYMENT`).set(auth(outsider)).expect(403);
    await request(app).post(`/api/orgs/${owner.orgId}/payments/${ownersReceipt}/reverse`).set(auth(outsider)).expect(403);
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/payments/${ownersReceipt}/reconcile`)
      .set(auth(outsider))
      .send({ reconciled: true })
      .expect(403);
    const still = await prisma.payment.findUnique({ where: { id: ownersReceipt } });
    expect(still!.status).not.toBe('REVERSED');
  });

  it('lets someone who records receipts see them, but reversing needs DELETE', async () => {
    const cashier = await makeMember(['SALES::Receipts::VIEW', 'SALES::Receipts::CREATE', 'SALES::Receipts::EDIT'], 'Cashier');
    const list = await request(app).get(`/api/orgs/${owner.orgId}/payments?direction=RECEIPT`).set(auth(cashier)).expect(200);
    expect(list.body.payments.map((p: any) => p.id)).toContain(ownersReceipt);
    await request(app).get(`/api/orgs/${owner.orgId}/payments?direction=PAYMENT`).set(auth(cashier)).expect(403);
    await request(app).post(`/api/orgs/${owner.orgId}/payments/${ownersReceipt}/reverse`).set(auth(cashier)).expect(403);
  });

  it('applies own-documents-only to payments, which it silently did not', async () => {
    const rep = await makeMember(
      ['SALES::Receipts::VIEW', 'SALES::Receipts::CREATE', 'SALES::Receipts::DELETE'],
      'Own receipts',
      { ownDocumentsOnly: true }
    );
    const mine = (await receipt(rep, 700).expect(201)).body.payment.id;

    const list = await request(app).get(`/api/orgs/${owner.orgId}/payments?direction=RECEIPT`).set(auth(rep)).expect(200);
    const ids = list.body.payments.map((p: any) => p.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(ownersReceipt);

    await request(app).post(`/api/orgs/${owner.orgId}/payments/${ownersReceipt}/reverse`).set(auth(rep)).expect(404);
    await request(app).post(`/api/orgs/${owner.orgId}/payments/${mine}/reverse`).set(auth(rep)).expect(200);
  });
});

describe('the approvals inbox', () => {
  it('shows a request to its approvers and its raiser, and to nobody else', async () => {
    const approverRole = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Inbox approver ${uid()}`, permissions: ['SALES::Invoices::VIEW'] })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/approval-rules`)
      .set(auth(owner))
      .send({ docType: 'INVOICE', name: `Inbox ${uid()}`, minAmount: 50000, approverRoleId: approverRole.body.role.id })
      .expect(201);

    const raiser = await makeMember(['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'], 'Raiser');
    const big = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(raiser))
      .send({
        date: '2026-09-29',
        customerName: 'Big customer',
        subtotal: 90000,
        gstTotal: 0,
        total: 90000,
        items: [{ description: 'Big', quantity: 1, rate: 90000, gstRate: 0 }],
      })
      .expect(201);
    expect(big.body.approval?.required).toBe(true);
    const docId = big.body.invoice.id;

    const approver = await makeMember(['SALES::Invoices::VIEW'], 'Approver');
    await request(app)
      .put(`/api/orgs/${owner.orgId}/users/${approver.userId}/role`)
      .set(auth(owner))
      .send({ roleId: approverRole.body.role.id })
      .expect(200);
    const bystander = await makeMember(['SALES::Invoices::VIEW'], 'Bystander');

    const sees = async (c: Ctx) =>
      (await request(app).get(`/api/orgs/${owner.orgId}/approvals`).set(auth(c)).expect(200)).body.requests.some(
        (r: any) => r.docId === docId
      );
    expect(await sees(raiser)).toBe(true);
    expect(await sees(approver)).toBe(true);
    expect(await sees(owner)).toBe(true);
    expect(await sees(bystander)).toBe(false);
  });
});
