import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { checkDigit, isDisplayCode, newDisplayCode } from '../services/displayCodes.js';

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
/** Letters-only word, so test names never change the prefix by accident. */
const word = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

describe('the numbers', () => {
  it('are ten digits, never a leading 0, with a check digit that catches a typo', () => {
    for (let i = 0; i < 500; i++) {
      const c = newDisplayCode();
      expect(c).toMatch(/^[1-9][0-9]{9}$/);
      expect(isDisplayCode(c)).toBe(true);
      /* One digit changed, or two neighbours swapped, fails the check (Luhn). */
      const wrong = c.slice(0, 4) + String((Number(c[4]) + 1) % 10) + c.slice(5);
      expect(isDisplayCode(wrong)).toBe(false);
    }
    expect(checkDigit('7992739871')).toBe(3); // the textbook Luhn example, 79927398713
    expect(isDisplayCode('KAVE-C100')).toBe(false);
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

  it('gives two companies with the same name unrelated numbers', async () => {
    const letters = word();
    const a = await owner(`${letters} Solutions`);
    const b = await owner(`${letters} Solutions`);
    const ca = companyCode((await me(a.token)).body, a.orgId);
    const cb = companyCode((await me(b.token)).body, b.orgId);
    expect(isDisplayCode(ca)).toBe(true);
    expect(isDisplayCode(cb)).toBe(true);
    expect(ca).not.toBe(cb);
  });

  it('uses the first company code as the account code, and gives the owner a user ID of their own', async () => {
    const a = await owner(`${word()} Traders`);
    const body = (await me(a.token)).body;
    const code = companyCode(body, a.orgId);
    expect(isDisplayCode(code)).toBe(true);
    expect(body.user.accountCode).toBe(code);
    expect(isDisplayCode(body.user.code)).toBe(true);
    expect(body.user.code).not.toBe(code);
  });

  it('still finds a company by the code it had before the numbers', async () => {
    const a = await owner(`${word()} Mills`);
    const old = `ZZ${rnd().toUpperCase()}-C100`;
    await platformPrisma.org.update({ where: { id: a.orgId }, data: { legacyCode: old } });
    const { orgByCode } = await import('../services/displayCodes.js');
    expect(((await orgByCode(old.toLowerCase(), { id: true })) as any)?.id).toBe(a.orgId);
    const body = (await me(a.token)).body;
    expect(body.orgs.find((x: any) => x.orgId === a.orgId).org.legacyCode).toBe(old);
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
    expect(isDisplayCode(other)).toBe(true);
    expect(other).not.toBe(first);
    expect(body.user.accountCode).toBe(first);
  });

  it('gives each person added to a company their own ID and shows it in the user list', async () => {
    const a = await owner(`${word()} Industries`);
    for (const n of [2, 3]) {
      await request(app)
        .post(`/api/users`)
        .set(headers(a))
        .send({ email: `staff${n}.${rnd()}@example.com`, fullName: `Staff ${n}`, password: 'Passw0rd!23', orgIds: [a.orgId] })
        .expect((r) => { if (r.status >= 300) throw new Error(`add user ${r.status} ${JSON.stringify(r.body)}`); });
    }
    const list = await request(app).get(`/api/orgs/${a.orgId}/users`).set(headers(a)).expect(200);
    const codes = list.body.users.map((u: any) => u.code);
    expect(codes).toHaveLength(3);
    expect(codes.every(isDisplayCode)).toBe(true);
    expect(new Set(codes).size).toBe(3);
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
