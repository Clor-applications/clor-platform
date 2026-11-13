import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Schemas at the edge of the employee portal (platform audit, 11 Nov 2026: 35 body reads and no schema).
 * A value of the wrong kind, far too long, or a date that is not one is refused with a 400 before the handler
 * runs; what a phone really sends goes through as before, extra keys and all; and the words a handler already
 * had for a missing or malformed field are still the words the phone gets.
 */
const { buildApp } = await import('../app.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

let token = '';
let companyCode = '';
let leaveTypeId = '';
beforeAll(async () => {
  const email = `pval.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Edge Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  const att = (m: 'get' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
  const e = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Farah Kulkarni', code: 'PV-1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  leaveTypeId = (await att('post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type.id;
  companyCode = (await att('get', '/portal-access').expect(200)).body.company.code;
  const code = (await att('post', '/portal-access/codes', { employeeIds: [e.id] }).expect(200)).body.codes[0].activationCode;
  token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'PV-1', activationCode: code, password: 'app pass 12', appVersion: '9.9' }).expect(200)).body.token;
}, 90_000);
const phone = (m: 'get' | 'post' | 'put' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any);
const refused = (r: any, field?: string) => {
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/^Validation error: /);
  if (field) expect(r.body.error).toContain(`"${field}"`);
};

describe('sign-in: malformed input is refused before anything is looked up', () => {
  it('refuses a password that is not text, and codes that are far too long', async () => {
    refused(await request(app).post('/api/portal/login').send({ company: companyCode, employeeCode: 'PV-1', password: { $gt: '' } }), 'password');
    refused(await request(app).post('/api/portal/login').send({ company: 'X'.repeat(500), employeeCode: 'PV-1', password: 'app pass 12' }), 'company');
    refused(await request(app).post('/api/portal/login').send({ company: companyCode, employeeCode: ['PV-1'], password: 'app pass 12' }), 'employeeCode');
    refused(await request(app).post('/api/portal/forgot').send({ company: companyCode, employeeCode: { a: 1 } }), 'employeeCode');
    refused(await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'PV-1', activationCode: 'A'.repeat(200), password: 'app pass 12' }), 'activationCode');
    refused(await request(app).post('/api/portal/login').send(['not', 'an', 'object']));
  });

  it('a right sign-in still works, with extra keys dropped, and a wrong one says what it always said', async () => {
    const ok = await request(app).post('/api/portal/login').send({ company: ` ${companyCode.toLowerCase()} `, employeeCode: 'pv-1', password: 'app pass 12', device: { model: 'Pixel' }, remember: true });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const wrong = await request(app).post('/api/portal/login').send({ company: companyCode, employeeCode: 'PV-1', password: 'not it' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('Company code, employee code or password is not right.');
    /* Nothing sent at all: the same answer as before, not a validation error. */
    expect((await request(app).post('/api/portal/login').send({})).status).toBe(401);
    expect((await request(app).post('/api/portal/forgot').send({ company: 'NOPE', employeeCode: 'X' })).body.ok).toBe(true);
    const weak = await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'PV-1', activationCode: 'ABCD-EFGH', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toBe('Use at least 8 characters.');
  });
});

describe('signed in: each route refuses what it cannot be', () => {
  it('query strings: a month, a day and a year must be one', async () => {
    refused(await phone('get', '/attendance?month=2026-1'), 'month');
    refused(await phone('get', '/attendance?month=2026-01&month=2026-02'), 'month');
    refused(await phone('get', '/requests?month=last'), 'month');
    refused(await phone('get', '/leave?year=2026&year=2027'), 'year');
    refused(await phone('get', `/holidays?year=${'9'.repeat(40)}`), 'year');
    /* A year that is not one still falls back to this year, as the app expects. */
    expect((await phone('get', '/holidays?year=abc')).status).toBe(200);
    refused(await phone('get', '/schedule?from=01-02-2026'), 'from');
    refused(await phone('get', '/schedule?from=2026-02-01&days=many'), 'days');
    refused(await phone('get', `/leave/explain?leaveTypeId=${'x'.repeat(200)}`), 'leaveTypeId');
    /* The handler's own words for a day that is not one are kept. */
    const day = await phone('get', '/attendance/explain?date=tomorrow');
    expect(day.status).toBe(400);
    expect(day.body.error).toBe('Which day? Dates are YYYY-MM-DD.');
    expect((await phone('get', '/attendance/explain')).body.error).toBe('Which day? Dates are YYYY-MM-DD.');
  });

  it('well-formed queries answer as before, an empty one reads as not asked, and unknown keys are ignored', async () => {
    const a = await phone('get', '/attendance?month=2026-03&utm=1');
    expect(a.status).toBe(200);
    expect(a.body.month).toBe('2026-03');
    expect((await phone('get', '/attendance?month=')).status).toBe(200);
    expect((await phone('get', '/leave?year=2026')).status).toBe(200);
    expect((await phone('get', '/holidays')).status).toBe(200);
    const s = await phone('get', '/schedule?from=2026-02-01&days=7');
    expect(s.status).toBe(200);
    expect(s.body.days).toHaveLength(7);
    expect((await phone('get', `/leave/explain?leaveTypeId=${leaveTypeId}&year=2026`)).status).toBe(200);
    expect((await phone('get', '/overtime?month=2026-03')).status).toBe(200);
    expect((await phone('get', '/month-review')).status).toBe(200);
  });

  it('bodies: wrong kinds and absurd lengths are refused', async () => {
    refused(await phone('post', '/punch', { latitude: '12.97', longitude: 77.59 }), 'latitude');
    refused(await phone('post', '/punch', { latitude: 12.97, longitude: 77.59, accuracy: -5 }), 'accuracy');
    refused(await phone('post', '/punch', { latitude: 12.97, longitude: 77.59, photo: { data: 'x' } }), 'photo');
    refused(await phone('post', '/phone-punch/ask', { note: 'n'.repeat(6000) }), 'note');
    refused(await phone('post', '/phone-punch/ask', { note: 42 }), 'note');
    refused(await phone('post', '/overtime', { date: '2026-03-01', kind: 'OVERTIME', reason: ['a'] }), 'reason');
    refused(await phone('post', '/data-requests', { type: 'ACCESS', details: { $ne: null } }), 'details');
    refused(await phone('post', '/consent/withdraw', { what: 7 }), 'what');
    refused(await phone('post', '/password', { current: 'app pass 12', next: 'x'.repeat(2000) }), 'next');
    refused(await phone('post', '/password', { current: ['app pass 12'], next: 'new pass 123' }), 'current');
    refused(await phone('post', '/approvals/leave/abc', { decision: 'approve', note: 5 }), 'note');
    refused(await phone('post', `/approvals/leave/${'i'.repeat(200)}`, { decision: 'approve' }), 'id');
    refused(await phone('post', '/holidays/restricted/abc', { picked: 'yes' }), 'picked');
    refused(await phone('post', '/month-review/2026-03/dispute', { note: { text: 'wrong' } }), 'note');
    refused(await phone('post', '/privacy-notice/read', { version: { v: 1 } }), 'version');
    /* A bare JSON string is refused by the strict JSON parser already; an array gets past it and is refused here. */
    expect((await (request(app) as any).post('/api/portal/leave').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/json').send('"just text"')).status).toBe(400);
    refused(await phone('post', '/leave', ['just text']));
    refused(await phone('post', '/requests', [1, 2]));
    refused(await phone('put', '/tax', [1]));
    refused(await phone('delete', `/sessions/${'s'.repeat(200)}`), 'id');
  });

  it('the words a handler already had are still the words', async () => {
    const say = async (r: Promise<any>, status: number, words: string | RegExp) => {
      const x = await r;
      expect(x.status).toBe(status);
      if (typeof words === 'string') expect(x.body.error).toBe(words);
      else expect(x.body.error).toMatch(words);
      return x;
    };
    await say(phone('post', '/overtime', { date: '1 March', kind: 'OVERTIME', reason: 'Stock count' }), 400, 'date must be YYYY-MM-DD.');
    await say(phone('post', '/overtime', {}), 400, 'date must be YYYY-MM-DD.');
    await say(phone('post', '/overtime', { date: '2026-03-01', kind: 'BONUS', reason: 'Stock count' }), 400, 'kind must be OVERTIME or COMP_OFF.');
    await say(phone('post', '/overtime', { date: '2026-03-01', kind: '', reason: 'x' }), 400, 'Say what the extra work was for.');
    await say(phone('post', '/data-requests', { type: 'PARTY', details: 'x' }), 400, 'Ask to see, correct or erase your data, name a nominee, or raise a grievance.');
    await say(phone('post', '/data-requests', { type: 'access' }), 400, 'Say what you are asking for.');
    await say(phone('post', '/consent/withdraw', {}), 400, 'Say what you are withdrawing.');
    await say(phone('post', '/approvals/party/abc', { decision: 'approve' }), 400, 'Unknown request type.');
    await say(phone('post', '/approvals/leave/abc', { decision: 'maybe' }), 400, 'decision must be approve or reject.');
    await say(phone('post', '/month-review/March/confirm'), 400, 'month must be YYYY-MM.');
    await say(phone('post', '/month-review/2026-03/dispute', { note: 'no' }), 400, 'Say what is wrong, so HR can check it.');
    await say(phone('post', '/password', { current: 'not mine', next: 'new pass 123' }), 400, 'Your current password is not right.');
    await say(phone('post', '/password', { current: 'app pass 12', next: 'short' }), 400, 'Use at least 8 characters.');
    await say(phone('post', '/leave/abc/shorten', { toDate: '2026-03-01' }), 404, /./);
    /* Leave and attendance requests keep their services' own schemas and words. */
    await say(phone('post', '/leave', { fromDate: '2026-03-02', toDate: '2026-03-02' }), 400, /./);
    await say(phone('post', '/leave', { leaveTypeId, fromDate: 'Monday', toDate: '2026-03-02' }), 400, 'Dates are YYYY-MM-DD.');
    /* A punch with no position is the service's refusal, with its code, as before. */
    const p = await phone('post', '/punch', { latitude: null, longitude: null });
    expect(p.body.code).toMatch(/NO_LOCATION|PHONE_OFF/);
  });

  it('well-formed writes go through, with keys the server does not know dropped', async () => {
    const ask = await phone('post', '/phone-punch/ask', { note: '  I work at client sites  ', appVersion: '2.1.0', device: { os: 'android' } });
    expect(ask.status).toBe(200);
    expect(ask.body.ok).toBe(true);
    const data = await phone('post', '/data-requests', { type: 'access', details: 'A copy of my attendance, please.', locale: 'en-IN' });
    expect(data.status).toBe(201);
    expect(data.body.request.type).toBe('ACCESS');
    expect(data.body.request.details).toBe('A copy of my attendance, please.');
    const leave = await phone('post', '/leave', { leaveTypeId, fromDate: '2026-12-21', toDate: '2026-12-21', reason: 'Family function' });
    expect([201, 400, 409]).toContain(leave.status);
    expect(String(leave.body.error || '')).not.toMatch(/^Validation error/);
    const notice = await phone('get', '/privacy-notice');
    expect(notice.status).toBe(200);
    const pw = await phone('post', '/password', { current: 'app pass 12', next: 'new pass 123', confirm: 'new pass 123' });
    expect(pw.status).toBe(200);
    expect(pw.body.token).toBeTruthy();
    token = pw.body.token;
    expect((await phone('post', '/signout', { everywhere: false })).status).toBe(200);
  });
});
