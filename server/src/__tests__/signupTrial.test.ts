import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Platform audit, 11 Nov 2026 (P0 2): /signup gave every app free and open-ended,
 * so anyone could skip the clor.in trial by opening it. It now starts the same
 * dated trial: status trialing, ending after the published trial length.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { trialOffer } = await import('../services/trialPlan.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));

describe('POST /api/auth/signup', () => {
  it('starts a trial with an end date, not a free open-ended plan', async () => {
    const email = `trial.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
    const res = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Trial owner' }).expect(200);
    const accountId = (jwt.decode(res.body.token) as { accountId: string }).accountId;
    const sub = await outsideTenant('test: read the new subscription', () =>
      platformPrisma.subscription.findFirst({ where: { accountId }, select: { status: true, trialEndsAt: true } }),
    );
    expect(sub?.status).toBe('trialing');
    const days = (sub!.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    const { trialDays } = await trialOffer();
    expect(days).toBeGreaterThan(trialDays - 1);
    expect(days).toBeLessThanOrEqual(trialDays);
  });
});
