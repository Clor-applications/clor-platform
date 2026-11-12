import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Staff and roles (operator console, Team): only the owner manages staff; an
 * invite by email becomes an operator the first time that confirmed address
 * opens the console; a removed operator is shut out at once; read-only
 * changes nothing anywhere.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { opsKit, bearer, lastAudit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);

describe('staff and roles', () => {
  it('lets only the owner see and change staff', async () => {
    for (const role of ['SALES', 'SUPPORT', 'BILLING'] as const) {
      const s = await staff(role);
      expect((await request(app).get('/api/ops/operators').set(s.h).expect(403)).body.code).toBe('OPERATOR_ROLE');
      await request(app).post('/api/ops/operators').set(s.h).send({ email: 'x@example.com', role: 'SALES' }).expect(403);
    }
    const reader = await staff('READ_ONLY');
    await request(app).get('/api/ops/operators').set(reader.h).expect(403);
    expect((await request(app).get('/api/ops/me').set(reader.h).expect(200)).body.role).toBe('READ_ONLY');
  }, 120_000);

  it('invites somebody with no login; they become staff when their confirmed address opens the console', async () => {
    const owner = await staff('SUPER_ADMIN');
    const email = `new.staff.${Date.now()}@example.com`;
    const r = (await request(app).post('/api/ops/operators').set(owner.h).send({ email, role: 'SALES', reason: 'New sales hire' }).expect(201)).body;
    expect(r.invite).toMatchObject({ email, role: 'SALES' });
    expect((await request(app).get('/api/ops/operators').set(owner.h).expect(200)).body.invites.map((i: any) => i.email)).toContain(email);
    expect(await platformPrisma.emailOutbox.findFirst({ where: { toEmail: email, templateKey: 'ops.staff_invited' } })).not.toBeNull();
    expect((await lastAudit(owner.userId, 'OPERATOR_INVITED'))?.detail).toMatchObject({ email, role: 'SALES', reason: 'New sales hire' });

    /* They sign up with that address. Unconfirmed, it proves nothing. */
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'New Staff' }).expect(200);
    const me = { Authorization: `Bearer ${signup.body.token}` };
    expect((await request(app).get('/api/ops/me').set(me).expect(403)).body.code).toBe('OPERATOR_ONLY');
    await platformPrisma.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    /* Confirmed: they are staff, and asked for an authenticator before anything opens. */
    expect((await request(app).get('/api/ops/me').set(me).expect(403)).body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    const user = await platformPrisma.user.findFirstOrThrow({ where: { email } });
    expect(await platformPrisma.platformOperator.findUnique({ where: { userId: user.id } })).toMatchObject({ role: 'SALES', active: true });
    expect((await request(app).get('/api/ops/operators').set(owner.h).expect(200)).body.invites.map((i: any) => i.email)).not.toContain(email);
  }, 90_000);

  it('adds an existing login at once, changes the role, and removes them so the console closes', async () => {
    const owner = await staff('SUPER_ADMIN');
    const sup = await staff('SUPPORT');
    const other = await company('later');
    await request(app).post('/api/ops/operators').set(owner.h).send({ email: other.email, role: 'READ_ONLY', reason: 'Auditor' }).expect(201);
    expect((await request(app).get('/api/ops/me').set(bearer(other)).expect(403)).body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');

    await request(app).patch(`/api/ops/operators/${sup.userId}`).set(owner.h).send({ role: 'BILLING', reason: 'Moved to finance' }).expect(200);
    expect((await request(app).get('/api/ops/me').set(sup.h).expect(200)).body.role).toBe('BILLING');
    expect((await lastAudit(owner.userId, 'OPERATOR_CHANGED'))?.detail).toMatchObject({ before: { role: 'SUPPORT' }, after: { role: 'BILLING' }, reason: 'Moved to finance' });

    await request(app).delete(`/api/ops/operators/${owner.userId}`).set(owner.h).send({ reason: 'Me' }).expect(409);
    await request(app).delete(`/api/ops/operators/${sup.userId}`).set(owner.h).send({ reason: 'Left CLOR' }).expect(200);
    expect((await request(app).get('/api/ops/me').set(sup.h).expect(403)).body.code).toBe('OPERATOR_ONLY');
    expect((await lastAudit(owner.userId, 'OPERATOR_REMOVED'))?.detail).toMatchObject({ role: 'BILLING', reason: 'Left CLOR' });
  }, 120_000);

  it('withdraws an invitation nobody has taken up', async () => {
    const owner = await staff('SUPER_ADMIN');
    const email = `maybe.${Date.now()}@example.com`;
    const { invite } = (await request(app).post('/api/ops/operators').set(owner.h).send({ email, role: 'SUPPORT', reason: 'Trial week' }).expect(201)).body;
    await request(app).delete(`/api/ops/operators/invites/${invite.id}`).set(owner.h).send({ reason: 'Did not join' }).expect(200);
    await request(app).delete(`/api/ops/operators/invites/${invite.id}`).set(owner.h).send({ reason: 'Again' }).expect(404);
    expect(await lastAudit(owner.userId, 'OPERATOR_INVITE_REVOKED')).not.toBeNull();
  }, 60_000);
});
