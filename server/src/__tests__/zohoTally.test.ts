import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';

/**
 * Zoho People as an HR tool (token from a refresh token, punches as
 * check-ins/outs, people read back), against a fake Zoho here; and the Tally
 * import XML a payroll entry becomes.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { enqueuePunches, flushOutbox, pullEmployees } = await import('../services/hr/sync.js');
const { zohoRecords } = await import('../services/hr/adapters.js');
const { tallyJournalXml, tallyDate } = await import('../services/payroll/tally.js');

const app = buildApp().listen(0);
let prevAllow: string | undefined;
beforeAll(() => {
  prevAllow = process.env.INTEGRATIONS_ALLOW_PRIVATE;
  process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
});
afterAll(async () => {
  process.env.INTEGRATIONS_ALLOW_PRIVATE = prevAllow;
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `zoho.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Zoho Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

/** A fake Zoho: accounts (token) and people (bulk import, employee form) on one host. */
function fakeZoho() {
  const calls: Array<{ path: string; auth: string; body: string }> = [];
  const imports: any[][] = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const path = String(req.url);
      calls.push({ path, auth: String(req.headers.authorization || ''), body: data });
      const json = (status: number, o: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
      if (path.startsWith('/oauth/v2/token')) {
        const p = new URLSearchParams(data);
        if (p.get('refresh_token') !== 'rt-good' || p.get('grant_type') !== 'refresh_token') return json(200, { error: 'invalid_code' });
        return json(200, { access_token: 'at-1', expires_in: 3600, token_type: 'Bearer' });
      }
      if (req.headers.authorization !== 'Zoho-oauthtoken at-1') return json(401, { response: { message: 'Invalid OAuth token', status: 1 } });
      if (path.startsWith('/people/api/attendance/bulkImport')) {
        const p = new URLSearchParams(data);
        const rows = JSON.parse(p.get('data') || '[]');
        imports.push(rows);
        const skipped = rows.filter((r: any) => r.empId === 'GHOST').map((r: any) => r.empId);
        return json(200, skipped.length ? { skippedEmpInfo: skipped, response: 'success' } : { response: 'success' });
      }
      if (path.startsWith('/people/api/forms/employee/getRecords')) {
        return json(200, {
          response: {
            result: [
              { '7001': [{ EmployeeID: 'Z100', EmailID: 'z100@example.com', FirstName: 'Zara', LastName: 'Khan', Department: 'Sales', Employeestatus: 'Active' }] },
              { '7002': [{ EmployeeID: 'Z200', EmailID: 'z200@example.com', FirstName: 'Old', LastName: 'Timer', Department: 'Ops', Employeestatus: 'Inactive' }] },
            ],
            message: 'Data fetched successfully',
            status: 0,
          },
        });
      }
      json(404, { response: { message: 'no such api', status: 1 } });
    });
  });
  return {
    calls,
    imports,
    start: () => new Promise<string>((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as any).port}`))),
    stop: () => new Promise((ok) => server.close(ok)),
  };
}

describe('Zoho People', () => {
  it('is offered with its fields, and the token, punches and people round-trip against a fake Zoho', async () => {
    const c = await makeOwner();
    const adapters = (await api(c).get('/integrations/hr/adapters').expect(200)).body.adapters;
    const z = adapters.find((a: any) => a.id === 'ZOHO_PEOPLE');
    expect(z).toMatchObject({ capabilities: ['pushPunches', 'pullEmployees'] });
    expect(z.fields.filter((f: any) => f.secret).map((f: any) => f.key)).toEqual(['clientSecret', 'refreshToken']);

    const zoho = fakeZoho();
    const base = await zoho.start();
    try {
      const bad = await api(c).post('/integrations/hr', { adapter: 'ZOHO_PEOPLE', name: 'Zoho', enabled: true, pullEmployees: true, createEmployees: true, fields: { dc: 'in', clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt-bad', apiBase: base } }).expect(201);
      expect((await api(c).post(`/integrations/hr/${bad.body.connection.id}/test`).expect(200)).body).toMatchObject({ ok: false, message: expect.stringMatching(/refused the refresh token/) });

      const made = await api(c).post('/integrations/hr', { adapter: 'ZOHO_PEOPLE', name: 'Zoho good', enabled: true, pullEmployees: true, createEmployees: true, fields: { dc: 'in', clientId: 'cid2', clientSecret: 'cs', refreshToken: 'rt-good', apiBase: base } }).expect(201);
      const id = made.body.connection.id;
      expect(JSON.stringify(made.body)).not.toContain('rt-good');
      expect((await api(c).post(`/integrations/hr/${id}/test`).expect(200)).body.ok).toBe(true);
      /* Moving the connection to another host needs the secrets again; a made-up data centre is refused. */
      expect((await request(app).put(`/api/orgs/${c.orgId}/attendance/integrations/hr/${id}`).set(at(c)).send({ fields: { dc: 'com' } }).expect(400)).body.error).toMatch(/enter the secrets again/);
      expect((await request(app).put(`/api/orgs/${c.orgId}/attendance/integrations/hr/${id}`).set(at(c)).send({ fields: { dc: 'evil.example' } }).expect(400)).body.error).toMatch(/data centre/);

      /* Punches: one in, one out, one for somebody Zoho does not know. */
      const p = await person(c, { name: 'Zed', code: 'Z100' });
      const g = await person(c, { name: 'Ghost', code: 'GHOST' });
      const punches = [
        { employeeId: p.id, code: 'Z100', readerId: 'MAIN', time: '2026-10-17 09:01:00', direction: 'IN', verifyMode: 1 },
        { employeeId: p.id, code: 'Z100', readerId: 'MAIN', time: '2026-10-17 18:02:00', direction: 'OUT', verifyMode: 15 },
        { employeeId: g.id, code: 'GHOST', readerId: 'MAIN', time: '2026-10-17 09:05:00', direction: null, verifyMode: 1 },
      ];
      expect(zohoRecords(punches as any)).toEqual([{ empId: 'Z100', checkIn: '2026-10-17 09:01:00' }, { empId: 'Z100', checkOut: '2026-10-17 18:02:00' }, { empId: 'GHOST', checkIn: '2026-10-17 09:05:00' }]);
      await enqueuePunches(c.orgId, punches as any);
      await flushOutbox();
      const rows = await peoplePrisma.hrOutbox.findMany({ where: { connectionId: id }, orderBy: { key: 'asc' } });
      expect(rows.map((r) => r.status).sort()).toEqual(['FAILED', 'OK', 'OK']);
      expect(rows.find((r) => r.status === 'FAILED')?.lastError).toMatch(/no employee GHOST/);
      const imp = zoho.calls.find((x) => x.path.startsWith('/people/api/attendance/bulkImport'))!;
      expect(imp.auth).toBe('Zoho-oauthtoken at-1');
      expect(new URLSearchParams(imp.body).get('dateFormat')).toBe('yyyy-MM-dd HH:mm:ss');
      expect(zoho.imports[0]).toHaveLength(3);
      /* One token for the whole conversation. */
      expect(zoho.calls.filter((x) => x.path.startsWith('/oauth/v2/token') && new URLSearchParams(x.body).get('refresh_token') === 'rt-good')).toHaveLength(1);

      /* People: the active one CLOR lacks is added; the inactive one is not. */
      const conn = await peoplePrisma.hrConnection.findUniqueOrThrow({ where: { id } });
      const r = await pullEmployees(conn as any);
      expect(r).toMatchObject({ pulled: 2, matched: 1, created: 0 });
      const emps = await peoplePrisma.employee.findMany({ where: { orgId: c.orgId }, select: { code: true, name: true } });
      expect(emps.map((e) => e.code).sort()).toEqual(['GHOST', 'Z100']);
    } finally {
      await zoho.stop();
    }
  });
});

describe('Tally import XML', () => {
  it('writes a balanced journal voucher the way Tally reads one', () => {
    const xml = tallyJournalXml({
      date: '2026-10-31',
      voucherNumber: 'PAY-Oct-2026',
      narration: 'Payroll October 2026 <CLOR>',
      lines: [
        { ledgerName: 'Salaries & Wages', debit: 250000, credit: 0 },
        { ledgerName: 'PF Payable', debit: 0, credit: 30000 },
        { ledgerName: 'Salaries Payable', debit: 0, credit: 220000 },
        { ledgerName: 'Nothing', debit: 0, credit: 0 },
      ],
    });
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
    expect(xml).toContain('<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">');
    expect(xml).toContain('<DATE>20261031</DATE>');
    expect(xml).toContain('<NARRATION>Payroll October 2026 &lt;CLOR&gt;</NARRATION>');
    expect(xml).toContain('<LEDGERNAME>Salaries &amp; Wages</LEDGERNAME>\n        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n        <AMOUNT>-250000.00</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>PF Payable</LEDGERNAME>\n        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n        <AMOUNT>30000.00</AMOUNT>');
    expect(xml).not.toContain('Nothing');
    expect((xml.match(/<ALLLEDGERENTRIES.LIST>/g) || []).length).toBe(3);
    expect(tallyDate('2026-04-01')).toBe('20260401');
  });

  it('is refused for a run that does not exist', async () => {
    const c = await makeOwner();
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
    await request(app).get(`/api/orgs/${c.orgId}/payroll/runs/nope/tally`).set(at(c)).expect(404);
  });
});
