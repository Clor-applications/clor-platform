import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';

/*
 * Every API call from the web app is cross-origin (app.clor.in to api.clor.in),
 * so the browser asks first. Without Access-Control-Max-Age it asked again
 * before nearly every call: 394 extra round trips for one screen's polling.
 */
describe('CORS preflight', () => {
  it('lets the browser reuse an answer for two hours', async () => {
    const res = await request(buildApp())
      .options('/api/auth/me')
      .set('Origin', 'https://localhost')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,x-org-id');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-max-age']).toBe('7200');
  });
});
