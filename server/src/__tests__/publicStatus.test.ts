import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { forgetPublicStatus, publicStatus } from '../routes/status.js';

describe('GET /api/public/status: is CLOR working, for anybody to ask', () => {
  beforeEach(() => forgetPublicStatus());

  it('answers without a sign-in, with each part by the name a customer uses and nothing about why', async () => {
    const res = await request(buildApp()).get('/api/public/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.parts.map((p: any) => p.name)).toEqual(['Sign-in and Workspace', 'Books', 'People and Attendance', 'Payroll']);
    expect(res.body.parts.every((p: any) => p.ok === true)).toBe(true);
    expect(Object.keys(res.body).sort()).toEqual(['checkedAt', 'ok', 'parts']);
    expect(Object.keys(res.body.parts[0]).sort()).toEqual(['key', 'name', 'ok']);
  });

  it('may be read from any website, and only read', async () => {
    const res = await request(buildApp()).get('/api/public/status').set('Origin', 'https://clor.in');
    expect(res.headers['access-control-allow-origin']).toBe('https://clor.in');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['cache-control']).toContain('max-age=20');
  });

  it('asks the stores once while the answer is fresh, and again after 20 seconds', async () => {
    const first = await publicStatus(1_000_000);
    const again = await publicStatus(1_000_000 + 19_000);
    expect(again.checkedAt).toBe(first.checkedAt);
    const later = await publicStatus(1_000_000 + 21_000);
    expect(later.checkedAt).not.toBe(first.checkedAt);
  });
});
