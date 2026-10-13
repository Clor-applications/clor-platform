import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

const app = buildApp();

describe('edgeGuard', () => {
  afterEach(() => {
    delete process.env.EDGE_SECRET;
  });

  it('is a no-op when EDGE_SECRET is unset', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).not.toBe(403);
  });

  it('refuses requests without the edge header', async () => {
    process.env.EDGE_SECRET = 'edge-test-secret';
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EDGE_REQUIRED');
  });

  it('refuses a wrong edge header', async () => {
    process.env.EDGE_SECRET = 'edge-test-secret';
    const res = await request(app).post('/api/auth/login').set('x-clor-edge', 'nope').send({});
    expect(res.status).toBe(403);
  });

  it('passes the matching edge header through', async () => {
    process.env.EDGE_SECRET = 'edge-test-secret';
    const res = await request(app).post('/api/auth/login').set('x-clor-edge', 'edge-test-secret').send({});
    expect(res.status).not.toBe(403);
  });

  it('keeps /health open', async () => {
    process.env.EDGE_SECRET = 'edge-test-secret';
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
