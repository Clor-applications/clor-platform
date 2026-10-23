import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { codePrefix } from '../services/displayCodes.js';

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
/** Letters-only word, so test names never change the prefix by accident. */
const word = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

describe('codePrefix', () => {
  it('takes the first four letters of the first word', () => {
    expect(codePrefix('Indus Solutions Pvt Ltd')).toBe('INDU');
    expect(codePrefix('Clor Pvt Ltd')).toBe('CLOR');
    expect(codePrefix('Meridian')).toBe('MERI');
  });
  it('keeps a three-letter first word as it is', () => {
    expect(codePrefix('ABC Traders')).toBe('ABC');
  });
  it('uses letters from the whole name when the first word is too short', () => {
    expect(codePrefix('A1 Traders')).toBe('ATRA');
    expect(codePrefix('M & S Exports')).toBe('MSEX');
  });
  it('never produces a code shaped like a document number', () => {
    for (const name of ['Invent Ltd', 'INV Traders', 'Expo Exports', 'PO Box Co', 'Journal Media']) {
      expect(`${codePrefix(name)}-C100`).not.toMatch(/^(INV|BILL|EXP|RCP|PAY|JE|EST|PO|SO|CN|DN|TRF|DC)-\d/);
    }
  });
  it('falls back to CLOR when there are not enough letters', () => {
    expect(codePrefix('')).toBe('CLOR');
    expect(codePrefix('12 34')).toBe('CLOR');
  });
});

describe('company, account and user codes', () => {
  const owner = async (companyName: string) => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email: `dc.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'Person Name' })
      .expect(200);
    const token = signup.body.token as string;
    const setup = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName, state: 'Karnataka' })
      .expect(200);
    return { token, orgId: String(setup.body.company.orgId), branchId: String(setup.body.branch.id) };
  };
  const me = (token: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  const headers = (o: { token: string; orgId: string; branchId: string }) => ({
    Authorization: `Bearer ${o.token}`, 'x-org-id': o.orgId, 'x-branch-id': o.branchId,
  });
  const companyCode = (body: any, orgId: string) => body.orgs.find((x: any) => x.orgId === orgId)?.org.code;
  const num = (c: string) => Number(c.split('-C')[1]);

  it('gives the first company C100 for its letters and the next number when the letters clash', async () => {
    const letters = word();
    const prefix = codePrefix(letters);
    const a = await owner(`${letters} Solutions`);
    const b = await owner(`${letters} Labs`);
    const ca = companyCode((await me(a.token)).body, a.orgId);
    const cb = companyCode((await me(b.token)).body, b.orgId);
    expect(ca).toBe(`${prefix}-C100`);
    expect(cb).toBe(`${prefix}-C101`);
  });

  it('uses the first company code as the account code and numbers the owner U01', async () => {
    const letters = word();
    const a = await owner(`${letters} Traders`);
    const body = (await me(a.token)).body;
    const code = companyCode(body, a.orgId);
    expect(code).toMatch(/^[A-Z]{3,4}-C\d{3,}$/);
    expect(body.user.accountCode).toBe(code);
    expect(body.user.code).toBe(`${code}-U01`);
  });

  it('gives a second company in the same account its own code, account code unchanged', async () => {
    const a = await owner(`${word()} Group`);
    const second = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ companyName: `${word()} Retail`, state: 'Kerala' })
      .expect(200);
    const body = (await me(a.token)).body;
    const first = companyCode(body, a.orgId);
    const other = companyCode(body, String(second.body.company.orgId));
    expect(other).toMatch(/^[A-Z]{3,4}-C\d{3,}$/);
    expect(other).not.toBe(first);
    expect(body.user.accountCode).toBe(first);
    expect(body.user.code).toBe(`${first}-U01`); // the owner keeps one ID
  });

  it('numbers people added to a company U02, U03 and shows the ID in the user list', async () => {
    const a = await owner(`${word()} Industries`);
    const code = companyCode((await me(a.token)).body, a.orgId);
    for (const n of [2, 3]) {
      await request(app)
        .post(`/api/users`)
        .set(headers(a))
        .send({ email: `staff${n}.${rnd()}@example.com`, fullName: `Staff ${n}`, password: 'Passw0rd!23', orgIds: [a.orgId] })
        .expect((r) => { if (r.status >= 300) throw new Error(`add user ${r.status} ${JSON.stringify(r.body)}`); });
    }
    const list = await request(app).get(`/api/orgs/${a.orgId}/users`).set(headers(a)).expect(200);
    const codes = list.body.users.map((u: any) => u.code).sort();
    expect(codes).toEqual([`${code}-U01`, `${code}-U02`, `${code}-U03`]);
  });

  it('lets one person (a CA) work in several companies with one ID', async () => {
    const ca = await owner(`${word()} Associates`);
    const caBody = (await me(ca.token)).body;
    const caCode = caBody.user.code;
    const caEmail = caBody.user.email;
    const client = await owner(`${word()} Exports`);
    /* The CA has confirmed their address; an unconfirmed login from another account is not attached (A-02). */
    await platformPrisma.user.updateMany({ where: { email: caEmail }, data: { emailVerifiedAt: new Date() } });
    await request(app)
      .post(`/api/users`)
      .set(headers(client))
      .send({ email: caEmail, fullName: 'Our CA', password: 'Passw0rd!23', orgIds: [client.orgId] })
      .expect((r) => { if (r.status >= 300) throw new Error(`invite ${r.status} ${JSON.stringify(r.body)}`); });
    const list = await request(app).get(`/api/orgs/${client.orgId}/users`).set(headers(client)).expect(200);
    const listed = list.body.users.find((u: any) => u.email === caEmail);
    expect(listed.code).toBe(caCode); // same ID in the client's company
    const after = (await me(ca.token)).body;
    expect(after.user.code).toBe(caCode);
    expect(after.orgs.map((o: any) => o.orgId)).toEqual(expect.arrayContaining([ca.orgId, client.orgId]));
  });

  it('shows the client ID on the account overview', async () => {
    const a = await owner(`${word()} Foods`);
    const body = (await me(a.token)).body;
    const res = await request(app).get('/api/account/overview').set(headers(a)).expect(200);
    expect(res.body.account.code).toBe(body.user.accountCode);
  });
});
