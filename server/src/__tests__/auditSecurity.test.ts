import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Security findings of the 17 Nov 2026 audit, each held shut by a test:
 * a user limited to their own documents and other people's invoices; where a
 * pay link sends the customer's money; CLOR's invoices to the account;
 * addresses a customer types that the server then contacts; a mailed report
 * that opens in a spreadsheet; the database role the walls depend on.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { etoFetchPunches } = await import('../services/attendance/etimeoffice.js');
const { assertPublicHost } = await import('../services/outbound.js');
const { reportCsv } = await import('../services/attendance/reportSchedules.js');
const { roleProblem, checkDatabaseRole } = await import('../services/databaseRoleCheck.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `sec.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Sec Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId };
}
const invoiceOf = async (c: Ctx, total: number) => {
  const inv = (await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send({ date: '2026-10-10', customerName: 'Asha Traders', subtotal: total, gstTotal: 0, total, status: 'Unpaid', items: [{ description: 'Work', quantity: 1, rate: total, gstRate: 0 }] }).expect(201)).body.invoice;
  if (inv.status === 'Draft') await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'Unpaid' } });
  return inv;
};
const SALES = ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE', 'SALES::Invoices::EDIT', 'SALES::Receipts::VIEW', 'SALES::Receipts::CREATE', 'SALES::Receipts::EDIT'];

let owner: Ctx;
beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('a user limited to their own documents', () => {
  it('does not reach the pay links, share link or e-invoice details of somebody else’s invoice', async () => {
    const theirs = await invoiceOf(owner, 1000);
    await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(at(owner)).send({ docId: theirs.id, payeeVpa: 'company@okhdfc', payeeName: 'Company' }).expect(201);
    const own = await colleague(owner, 'Ravi', SALES, true);

    expect((await request(app).get(`/api/orgs/${owner.orgId}/pay-requests`).set(at(own)).expect(200)).body.requests).toEqual([]);
    await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(at(own)).send({ docId: theirs.id, payeeVpa: 'company@okhdfc', payeeName: 'Company' }).expect(404);
    await request(app).post(`/api/orgs/${owner.orgId}/invoices/${theirs.id}/share`).set(at(own)).expect(404);
    await request(app).get(`/api/orgs/${owner.orgId}/invoices/${theirs.id}/einvoice`).set(at(own)).expect(404);
    await request(app).get(`/api/orgs/${owner.orgId}/invoices/${theirs.id}/einvoice/payload`).set(at(own)).expect(404);

    /* Their own invoice works as before. */
    const mine = await invoiceOf(own, 500);
    await request(app).post(`/api/orgs/${owner.orgId}/invoices/${mine.id}/share`).set(at(own)).expect(201);
    await request(app).get(`/api/orgs/${owner.orgId}/invoices/${mine.id}/einvoice`).set(at(own)).expect(200);
    /* And the owner still sees everything. */
    expect((await request(app).get(`/api/orgs/${owner.orgId}/pay-requests`).set(at(owner)).expect(200)).body.requests.length).toBe(1);
  }, 120_000);
});

describe('where a pay link sends the money', () => {
  it('a UPI ID new to the company takes someone who may edit the company profile; a known one does not', async () => {
    const boss = await makeOwner();
    const clerk = await colleague(boss, 'Meena', SALES);
    const a = await invoiceOf(clerk, 700);
    const refused = await request(app).post(`/api/orgs/${boss.orgId}/pay-requests`).set(at(clerk)).send({ docId: a.id, payeeVpa: 'meena.personal@okaxis', payeeName: 'Meena' }).expect(403);
    expect(refused.body.code).toBe('NEW_UPI_ID');
    expect(await prisma.paymentRequest.count({ where: { orgId: boss.orgId } })).toBe(0);

    const b = await invoiceOf(boss, 900);
    await request(app).post(`/api/orgs/${boss.orgId}/pay-requests`).set(at(boss)).send({ docId: b.id, payeeVpa: 'shop@okhdfc', payeeName: 'Shop' }).expect(201);
    await request(app).post(`/api/orgs/${boss.orgId}/pay-requests`).set(at(clerk)).send({ docId: a.id, payeeVpa: 'SHOP@okhdfc', payeeName: 'Shop' }).expect(201);
  }, 120_000);
});

describe('CLOR’s invoices to the account', () => {
  it('are for the account’s owner, administrators and billing administrators, not anyone who sees one company’s profile', async () => {
    const boss = await makeOwner();
    const manager = await colleague(boss, 'Kiran', ['SETTINGS::Company Profile::VIEW', 'SETTINGS::Company Profile::EDIT']);
    await request(app).get('/api/billing/invoices').set(at(manager)).expect(403);
    await request(app).get('/api/billing/invoices').set(at(boss)).expect(200);
  }, 120_000);
});

describe('addresses a customer types', () => {
  it('e-Time Office is never asked at a metadata or private address', async () => {
    const was = process.env.INTEGRATIONS_ALLOW_PRIVATE;
    process.env.INTEGRATIONS_ALLOW_PRIVATE = 'false';
    try {
      for (const apiUrl of ['http://169.254.169.254/latest/', 'http://127.0.0.1:1/api/', 'http://10.0.0.5/api/']) {
        const r = await etoFetchPunches({ apiUrl, username: 'u', password: 'p' }, new Date('2026-11-17T00:00:00Z'), new Date('2026-11-17T06:00:00Z'));
        expect(r.ok, apiUrl).toBe(false);
        expect(r.message, apiUrl).toMatch(/link-local|metadata|private|loopback/i);
      }
      expect((await etoFetchPunches({ apiUrl: 'ftp://example.com/', username: 'u', password: 'p' }, new Date(), new Date())).message).toMatch(/http/);
    } finally {
      process.env.INTEGRATIONS_ALLOW_PRIVATE = was;
    }
  });

  it('a sign-on or mail server host that is private, loopback or metadata is refused', async () => {
    const was = process.env.INTEGRATIONS_ALLOW_PRIVATE;
    process.env.INTEGRATIONS_ALLOW_PRIVATE = 'false';
    try {
      await expect(assertPublicHost('169.254.169.254')).rejects.toThrow(/cannot be used/);
      await expect(assertPublicHost('127.0.0.1')).rejects.toThrow(/cannot be used/);
      await expect(assertPublicHost('192.168.1.10')).rejects.toThrow(/cannot be used/);
      await expect(assertPublicHost('localhost')).rejects.toThrow(/cannot be used/);
      await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
      await expect(assertPublicHost('')).rejects.toThrow();
    } finally {
      process.env.INTEGRATIONS_ALLOW_PRIVATE = was;
    }
  });
});

describe('a mailed report that opens in a spreadsheet', () => {
  it('shows a cell that starts like a formula as text, and leaves numbers alone', () => {
    const csv = reportCsv({
      columns: [{ key: 'name', label: 'Name' }, { key: 'hours', label: 'Hours' }, { key: 'note', label: 'Note' }],
      rows: [{ name: '=HYPERLINK("http://x","y")', hours: -1.5, note: '@SUM(A1)' }, { name: 'Asha', hours: 8, note: '+91 98450 00000' }, { name: '-Ravi', hours: '+2', note: '' }],
    });
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"",""y"")",-1.5,'@SUM(A1)`);
    expect(lines[2]).toBe(`Asha,8,'+91 98450 00000`);
    expect(lines[3]).toBe(`'-Ravi,+2,`);
  });
});

describe('the database role the company walls depend on', () => {
  it('is named as a problem when it is a superuser or bypasses row-level security', async () => {
    expect(roleProblem({ role: 'clor_app', superuser: false, bypassRls: false })).toBeNull();
    expect(roleProblem(null)).toBeNull();
    expect(roleProblem({ role: 'clor_app', superuser: true, bypassRls: false })).toMatch(/superuser.*NOSUPERUSER NOBYPASSRLS/);
    expect(roleProblem({ role: 'clor_app', superuser: false, bypassRls: true })).toMatch(/BYPASSRLS/);
    /* Outside production it stays quiet: a developer's own role is often a superuser. */
    const said: string[] = [];
    expect(await checkDatabaseRole((l) => said.push(l))).toBeNull();
    expect(said).toEqual([]);
  });
});
