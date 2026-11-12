import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';

/**
 * Shared set-up for the operator console's route tests: a customer company,
 * and CLOR staff of any role with an authenticator already on and a fresh
 * step-up, so each test spends its time on what it checks.
 */
const { codeAt, newSecret, stepNow } = await import('../services/totp.js');
const { encryptSecret } = await import('../services/mailer.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

export const rnd = () => Math.random().toString(36).slice(2, 8);
export type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; email: string };
export const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
export const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });

export function opsKit(app: Server) {
  async function company(label = 'ops'): Promise<Ctx> {
    const email = `${label}.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Ops Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const claims = jwt.decode(signup.body.token) as { userId: string; accountId: string };
    return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, accountId: claims.accountId, email };
  }

  /** A CLOR staff member of this role, authenticator on; `h` carries a fresh step-up (none for read-only, who cannot take one). */
  async function staff(role: 'SUPER_ADMIN' | 'SALES' | 'SUPPORT' | 'BILLING' | 'READ_ONLY') {
    const c = await company(role.toLowerCase().replace('_', ''));
    const secret = newSecret();
    await platformPrisma.user.update({ where: { id: c.userId }, data: { totpSecretEnc: encryptSecret(secret), totpEnabledAt: new Date(), totpLastStep: null } });
    await platformPrisma.platformOperator.create({ data: { userId: c.userId, role } });
    let stepUp = '';
    if (role !== 'READ_ONLY') {
      stepUp = (await request(app).post('/api/ops/step-up').set(bearer(c)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token;
    }
    return { ...c, h: { ...bearer(c), ...(stepUp ? { 'x-step-up': stepUp } : {}) } };
  }

  return { company, staff };
}

export const lastAudit = (operatorUserId: string, action: string) =>
  platformPrisma.operatorAuditEvent.findFirst({ where: { operatorUserId, action }, orderBy: { at: 'desc' } });
