import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * The ceiling on every /api call (FX-05). Lowered to 5 a minute here so the
 * test does not have to send 600; the limiter reads the number when the app
 * module loads, hence the dynamic import after setting it.
 */
const saved = { off: process.env.DISABLE_RATE_LIMIT, perMin: process.env.API_RATE_LIMIT_PER_MIN };
let app: any;

beforeAll(async () => {
  process.env.DISABLE_RATE_LIMIT = 'false';
  process.env.API_RATE_LIMIT_PER_MIN = '5';
  const { buildApp } = await import('../app.js');
  app = buildApp();
});

afterAll(() => {
  process.env.DISABLE_RATE_LIMIT = saved.off;
  if (saved.perMin === undefined) delete process.env.API_RATE_LIMIT_PER_MIN;
  else process.env.API_RATE_LIMIT_PER_MIN = saved.perMin;
});

describe('the API ceiling', () => {
  it('stops one session after its share, and leaves another session alone', async () => {
    const call = (token: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    const first = [];
    for (let i = 0; i < 5; i++) first.push((await call('session-one-aaaaaaaaaaaa')).status);
    expect(first.every((s) => s !== 429)).toBe(true);
    const sixth = await call('session-one-aaaaaaaaaaaa');
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toMatch(/Too many requests/);
    expect((await call('session-two-bbbbbbbbbbbb')).status).not.toBe(429);
  });

  /*
   * A-07: real access tokens are JWTs, and every one starts with the same
   * header. Keyed on the first 24 characters, all signed-in people shared one
   * bucket, so one busy office could lock everyone out.
   */
  it('gives every signed-in session its own bucket, though all JWTs share a header', async () => {
    const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const call = (token: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    for (let i = 0; i < 6; i++) await call(`${header}.payload-of-alice.sig-a`);
    expect((await call(`${header}.payload-of-alice.sig-a`)).status).toBe(429);
    expect((await call(`${header}.payload-of-bob.sig-b`)).status).not.toBe(429);
  });
});
