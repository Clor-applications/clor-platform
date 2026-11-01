import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/*
 * A-42: an upload's type was whatever the upload said it was. A page of HTML
 * sent as `data:image/png;base64,…` was stored, and served back, as a PNG.
 * The file's own first bytes decide now; the claim only has to agree.
 */
const { buildApp } = await import('../app.js');
const { sniffMime } = await import('../services/fileType.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const asData = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`;

describe('what a file is', () => {
  it('is read from its bytes', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('plain words\n'))).toBe('text/plain');
    expect(sniffMime(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // a Windows program
  });
});

describe('an employee document upload', () => {
  async function setup() {
    const email = `us.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'US owner' }).expect(200);
    const s = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `US Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
    const at = { Authorization: `Bearer ${signup.body.token}`, 'x-org-id': s.body.company.orgId, 'x-branch-id': s.body.branch.id };
    const orgId = s.body.company.orgId;
    await request(app).put(`/api/orgs/${orgId}/features`).set(at).send({ features: { people: true } }).expect(200);
    const emp = (await request(app).post(`/api/orgs/${orgId}/people/employees`).set(at).send({ name: 'Asha Rao', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    return (data: string) => request(app).post(`/api/orgs/${orgId}/people/employees/${emp.id}/documents`).set(at).send({ kind: 'ID_PROOF', title: 'Proof', data });
  }

  it('refuses a page of HTML sent as a PNG', async () => {
    const up = await setup();
    const res = await up(asData('image/png', Buffer.from('<html><script>alert(document.cookie)</script></html>')));
    expect(res.status).toBe(400);
  });

  it('refuses a PDF that is not one', async () => {
    const up = await setup();
    expect((await up(asData('application/pdf', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])))).status).toBe(400);
  });

  it('takes a real PNG and a real PDF', async () => {
    const up = await setup();
    expect((await up(asData('image/png', PNG))).status).toBe(201);
    expect((await up(asData('application/pdf', Buffer.from('%PDF-1.4 proof')))).status).toBe(201);
  });
});
