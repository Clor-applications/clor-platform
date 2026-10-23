import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * A company's own books, in a file its owner can keep.
 *
 * The one defect that would matter here is one company's export containing
 * another's — so most of what follows is about that, and about the export
 * carrying nothing it should not.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const makeOwner = async (label: string): Promise<Ctx> => {
  const email = `exp.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Exp ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
};

const raiseInvoice = async (c: Ctx, customerName: string) => {
  const res = await request(app)
    .post(`/api/orgs/${c.orgId}/invoices`)
    .set(auth(c))
    .send({
      number: `INV-${rnd()}`,
      date: '2026-09-09',
      customerName,
      subtotal: 1000,
      gstTotal: 180,
      total: 1180,
      status: 'Unpaid',
      items: [{ description: 'MS Angle', quantity: 1, rate: 1000, gstRate: 18, amount: 1000 }],
    })
    .expect(201);
  return res.body.invoice;
};

let mine: Ctx;
beforeAll(async () => {
  mine = await makeOwner('mine');
  await raiseInvoice(mine, 'My Customer');
}, 60_000);

describe('exporting a company', () => {
  it('returns the company’s own records', async () => {
    const res = await request(app).get(`/api/orgs/${mine.orgId}/export`).set(auth(mine)).expect(200);
    expect(res.body.export.format).toBe('clor/company-export');
    expect(res.body.export.company.id).toBe(mine.orgId);
    expect(res.body.data.invoices.length).toBeGreaterThan(0);
    expect(res.body.data.invoices[0].customerName).toBe('My Customer');
    // Branches are configuration, not data — and the default scope has both.
    expect(res.body.configuration.branches.length).toBeGreaterThan(0);
  });

  it('carries people, attendance and payroll too, with nothing that looks like a secret', async () => {
    const r = await request(app).get(`/api/orgs/${mine.orgId}/export?scope=data`).set(auth(mine)).expect(200);
    const keys = Object.keys(r.body.data);
    expect(keys.some((k) => k.startsWith('people.'))).toBe(true);
    expect(keys.some((k) => k.startsWith('payroll.'))).toBe(true);
    expect(keys).toContain('people.employee');
    expect(keys).not.toContain('people.devicePunch');
    /* The accounting rows keep their audit-chain hashes; the people and payroll rows carry no hash, token or secret. */
    for (const [name, rows] of Object.entries(r.body.data) as any[]) {
      if (!/^(people|payroll)\./.test(name)) continue;
      for (const row of rows) for (const k of Object.keys(row)) expect(k, `${name}.${k}`).not.toMatch(/hash|secret|token/i);
    }
  });

  it('says what it contains, so the file explains itself later', async () => {
    const res = await request(app).get(`/api/orgs/${mine.orgId}/export`).set(auth(mine)).expect(200);
    expect(res.body.export.counts.invoices).toBe(res.body.data.invoices.length);
    expect(res.body.export.takenAt).toBeTruthy();
    expect(res.body.export.company.name).toBeTruthy();
  });

  /* Money as numbers, not as the Decimal objects the client returns. */
  it('writes money as numbers a spreadsheet can read', async () => {
    const res = await request(app).get(`/api/orgs/${mine.orgId}/export`).set(auth(mine)).expect(200);
    expect(typeof res.body.data.invoices[0].total).toBe('number');
    expect(res.body.data.invoices[0].total).toBe(1180);
  });

  /*
   * The defect that would matter. A customer handed a file containing another
   * customer's books is the worst outcome this feature has.
   */
  it("contains no other company's data", async () => {
    const theirs = await makeOwner('theirs');
    await raiseInvoice(theirs, 'Someone Else Entirely');

    const res = await request(app).get(`/api/orgs/${mine.orgId}/export`).set(auth(mine)).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Someone Else Entirely');
    expect(body).not.toContain(theirs.orgId);
  });

  /* Two companies on ONE account — the case an account-level check hides. */
  it("contains no sibling company's data either", async () => {
    const second = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${mine.token}`)
      .send({ companyName: `Sibling ${Date.now()}-${rnd()}`, state: 'Kerala' })
      .expect(200);
    const sibling: Ctx = { token: mine.token, orgId: second.body.company.orgId, branchId: second.body.branch.id };
    await raiseInvoice(sibling, 'Sibling Customer');

    const res = await request(app).get(`/api/orgs/${mine.orgId}/export`).set(auth(mine)).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('Sibling Customer');
  });

  /* Books, not credentials. */
  it('carries no passwords, sessions or secrets', async () => {
    const res = await request(app).get(`/api/orgs/${mine.orgId}/export`).set(auth(mine)).expect(200);
    const body = JSON.stringify(res.body);
    for (const leak of ['passwordHash', 'refreshTokenHash', 'clientSecretEnc', 'JWT_SECRET']) {
      expect(body).not.toContain(leak);
    }
    expect(res.body.data.users).toBeUndefined();
    expect(res.body.data.sessions).toBeUndefined();
  });

  it('carries the till counts, which are the cash controls', async () => {
    // A day close held only by the till it was counted on is lost with that
    // machine; leaving it out of the export loses it again on purpose.
    await request(app)
      .post(`/api/orgs/${mine.orgId}/pos-day-closes`)
      .set(auth(mine))
      .send({ date: '2026-09-05', cash: 1234.5, total: 1234.5, countedCash: 1200, overShort: -34.5 })
      .expect(201);

    const listed = await request(app)
      .get(`/api/orgs/${mine.orgId}/export?scope=data`)
      .set(auth(mine))
      .expect(200);
    const close = listed.body.data.posDayCloses.find((d: any) => d.date === '2026-09-05');
    expect(Number(close.overShort)).toBe(-34.5);
  });

  it('refuses an org the caller is not in', async () => {
    const stranger = await makeOwner('stranger');
    await request(app).get(`/api/orgs/${stranger.orgId}/export`).set(auth(mine)).expect(403);
  });
});

/*
 * Two kinds of backup, because they answer two different questions.
 *
 * Data is what the business did and only grows. Configuration is how the
 * company is set up — small, rarely changed, and the thing you want when
 * somebody has broken the numbering or when a practice is setting up its
 * eleventh client the way it set up the tenth.
 */
describe('the two scopes', () => {
  it('gives data only when data is asked for', async () => {
    const res = await request(app).get(`/api/orgs/${mine.orgId}/export?scope=data`).set(auth(mine)).expect(200);
    expect(res.body.data.invoices.length).toBeGreaterThan(0);
    expect(res.body.configuration).toBeUndefined();
  });

  it('gives configuration only when configuration is asked for', async () => {
    const res = await request(app)
      .get(`/api/orgs/${mine.orgId}/export?scope=configuration`)
      .set(auth(mine))
      .expect(200);
    expect(res.body.data).toBeUndefined();
    expect(res.body.configuration.branches.length).toBeGreaterThan(0);
    expect(res.body.configuration.ledgerAccounts.length).toBeGreaterThan(0);
    // Roles and their permissions, which is what "put the access back" needs.
    expect(res.body.configuration.roles.length).toBeGreaterThan(0);
    expect(res.body.configuration.companyProfile[0].name).toBeTruthy();
  });

  /*
   * A configuration file is meant to be readable, copied between companies and
   * kept where a customer keeps files. None of those is a place for a
   * credential, even an encrypted one.
   */
  it('strips secrets out of the configuration', async () => {
    /*
     * A real secret has to exist for this to prove anything. Asserting that
     * `passwordEnc` is absent from a company with no email settings passes
     * whatever the code does — which it did, until this fixture was added.
     */
    const org = await platformPrisma.org.findUniqueOrThrow({
      where: { id: mine.orgId },
      select: { accountId: true, createdByUserId: true },
    });
    await platformPrisma.emailSetting.upsert({
      where: { orgId: mine.orgId },
      update: { passwordEnc: 'ENCRYPTED-SMTP-SECRET', username: 'smtp-user', host: 'smtp.example.com' },
      create: {
        accountId: org.accountId,
        orgId: mine.orgId,
        provider: 'SMTP',
        host: 'smtp.example.com',
        username: 'smtp-user',
        passwordEnc: 'ENCRYPTED-SMTP-SECRET',
        updatedByUserId: org.createdByUserId,
      },
    });

    const res = await request(app)
      .get(`/api/orgs/${mine.orgId}/export?scope=configuration`)
      .set(auth(mine))
      .expect(200);

    // The setting is exported — a config backup that loses the SMTP host is
    // not a config backup.
    expect(res.body.configuration.emailSettings[0].host).toBe('smtp.example.com');
    expect(res.body.configuration.emailSettings[0].username).toBe('smtp-user');

    // The secret is not.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('ENCRYPTED-SMTP-SECRET');
    for (const secret of ['passwordEnc', 'clientSecretEnc', 'publicKeyPem']) {
      expect(body).not.toContain(secret);
    }
  });

  it('keeps the ledger out of the configuration and the roles out of the data', async () => {
    const cfg = await request(app)
      .get(`/api/orgs/${mine.orgId}/export?scope=configuration`)
      .set(auth(mine))
      .expect(200);
    // The chart of accounts is configuration; the entries posted to it are not.
    expect(cfg.body.configuration.journalEntries).toBeUndefined();
    expect(cfg.body.configuration.invoices).toBeUndefined();

    const data = await request(app).get(`/api/orgs/${mine.orgId}/export?scope=data`).set(auth(mine)).expect(200);
    expect(data.body.data.roles).toBeUndefined();
    expect(data.body.data.numberSeries).toBeUndefined();
  });

  it('refuses a scope it does not know', async () => {
    await request(app).get(`/api/orgs/${mine.orgId}/export?scope=everything`).set(auth(mine)).expect(400);
  });

  it('says which scope the file is, so it explains itself later', async () => {
    const res = await request(app)
      .get(`/api/orgs/${mine.orgId}/export?scope=configuration`)
      .set(auth(mine))
      .expect(200);
    expect(res.body.export.scope).toBe('configuration');
  });
});

/*
 * A-18: the export asked only for Settings → Company data → EXPORT, then
 * dumped every People and Payroll table — bank accounts, PAN, UAN, salaries,
 * tax declarations — to anyone holding that one permission, past the payroll
 * VIEW permissions and the company's payroll second-factor setting. What you
 * can see in the app is what you can export; the rest is named as withheld.
 */
describe('personal data in the export', () => {
  /** A member whose only permission is exporting company data. */
  async function exporterOnly(c: Ctx): Promise<Ctx & { userId: string }> {
    const role = await request(app).post(`/api/orgs/${c.orgId}/roles`).set(auth(c)).send({ name: `Exporter ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
    await request(app).put(`/api/orgs/${c.orgId}/roles/${role.body.role.id}/permissions`).set(auth(c)).send({ permissions: ['SETTINGS::Company data::EXPORT'] }).expect(200);
    const email = `exp.only.${Date.now()}.${rnd()}@example.com`;
    const made = await request(app).post('/api/users').set(auth(c)).send({ email, fullName: 'Exporter', password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
    await request(app).put(`/api/orgs/${c.orgId}/users/${made.body.user.id}/role`).set(auth(c)).send({ roleId: role.body.role.id }).expect(200);
    const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
    return { token: login.body.token, orgId: c.orgId, branchId: c.branchId, userId: made.body.user.id };
  }

  it('leaves out People and Payroll for someone who cannot view them, and says so', async () => {
    const exporter = await exporterOnly(mine);
    const res = await request(app).get(`/api/orgs/${mine.orgId}/export?scope=all`).set(auth(exporter)).expect(200);
    const keys = Object.keys(res.body.data);
    expect(keys.some((k) => k.startsWith('payroll.'))).toBe(false);
    expect(keys.some((k) => k.startsWith('people.'))).toBe(false);
    expect(res.body.data.invoices.length).toBeGreaterThan(0);
    expect(res.body.export.withheld.map((w: any) => w.domain).sort()).toEqual(['payroll', 'people']);
    /* Not the full copy that closing a company relies on. */
    expect(await platformPrisma.auditLog.count({ where: { orgId: mine.orgId, action: 'EXPORT_ALL', createdByUserId: exporter.userId } })).toBe(0);
  });

  it('gives an administrator payroll data, and records that it left', async () => {
    const res = await request(app).get(`/api/orgs/${mine.orgId}/export?scope=data`).set(auth(mine)).expect(200);
    expect(Object.keys(res.body.data).some((k) => k.startsWith('payroll.'))).toBe(true);
    expect(res.body.export.withheld).toEqual([]);
    expect(await platformPrisma.auditLog.count({ where: { orgId: mine.orgId, action: 'EXPORT_PAYROLL' } })).toBeGreaterThan(0);
  });

  it('withholds payroll when the company asks for a second factor and none was given', async () => {
    const c = await makeOwner('stepup');
    const current = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(auth(c)).expect(200)).body.policy;
    await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(auth(c)).send({ ...current, requirePayrollStepUp: true }).expect(200);
    const res = await request(app).get(`/api/orgs/${c.orgId}/export?scope=data`).set(auth(c)).expect(200);
    expect(Object.keys(res.body.data).some((k) => k.startsWith('payroll.'))).toBe(false);
    expect(res.body.export.withheld).toEqual([expect.objectContaining({ domain: 'payroll' })]);
  });
});
