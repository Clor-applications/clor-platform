import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * Where a branch's counter takings post.
 *
 * A till knows it took "Cash"; a receipt needs a ledger account, and nothing
 * joined the two — which is why a POS sale currently debits receivables and
 * leaves them there. These pin the configuration that closes that gap, and the
 * refusals that stop it being closed with the wrong account.
 *
 * Explicit per branch, with no inheritance: the product has the idea of a head
 * office but no field that authoritatively identifies one, and production
 * already holds an organisation with two parentless branches.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
let owner: Ctx;
let branchB = '';
let outsider: Ctx;

const at = (c: Ctx, branchId = c.branchId) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': branchId,
});

async function makeOwner(prefix: string): Promise<Ctx> {
  const email = `${prefix}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'POS owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `POS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: setup.body.company.orgId }, select: { accountId: true } });
  return {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    accountId: org!.accountId,
  };
}

/** A ledger account owned by one branch, or shared when branchId is null. */
const makeAccount = async (
  ctx: Ctx,
  opts: { name: string; controlKind: 'CASH' | 'BANK' | null; accountType?: string; branchId?: string | null; active?: boolean }
) => {
  const row = await prisma.ledgerAccount.create({
    data: {
      accountId: ctx.accountId,
      orgId: ctx.orgId,
      branchId: opts.branchId === undefined ? null : opts.branchId,
      code: `9${Math.floor(Math.random() * 100000)}`,
      name: opts.name,
      accountType: (opts.accountType as any) ?? 'ASSET',
      controlKind: opts.controlKind,
      isActive: opts.active !== false,
      createdByUserId: 'seed',
    },
  });
  return row;
};

const get = (c: Ctx, branchId?: string) =>
  request(app).get(`/api/orgs/${c.orgId}/pos/tender-accounts`).set(at(c, branchId));

const put = (c: Ctx, tender: string, ledgerAccountId: string, branchId?: string) =>
  request(app).put(`/api/orgs/${c.orgId}/pos/tender-accounts`).set(at(c, branchId)).send({ tender, ledgerAccountId });

const del = (c: Ctx, tender: string, branchId?: string) =>
  request(app).delete(`/api/orgs/${c.orgId}/pos/tender-accounts/${tender}`).set(at(c, branchId));

beforeAll(async () => {
  owner = await makeOwner('pos');
  outsider = await makeOwner('posx');

  const second = await request(app)
    .post(`/api/orgs/${owner.orgId}/branches`)
    .set(at(owner))
    .send({
      branchCode: `B2-${rnd()}`,
      branchName: 'Second Counter',
      addressLine1: '1 Road',
      state: 'Karnataka',
      country: 'India',
      gstRegistrationType: 'UNREGISTERED',
    });
  branchB = second.body?.branch?.id || second.body?.id;
  expect(branchB).toBeTruthy();
});

describe('a branch with nothing configured', () => {
  it('reports every tender unconfigured, and says what each one needs', async () => {
    const res = await get(owner).expect(200);
    expect(res.body.branchId).toBe(owner.branchId);
    for (const t of ['CASH', 'UPI', 'CARD']) {
      expect(res.body.tenders[t].status).toBe('UNCONFIGURED');
      expect(res.body.tenders[t].ledgerAccountId).toBeNull();
    }
    expect(res.body.tenders.CASH.controlKind).toBe('CASH');
    expect(res.body.tenders.UPI.controlKind).toBe('BANK');
    expect(res.body.tenders.CARD.controlKind).toBe('BANK');
  });

  it('offers no setup control account among the eligible ones', async () => {
    const res = await get(owner).expect(200);
    const codes = res.body.eligibleAccounts.map((a: any) => a.code);
    expect(codes).not.toContain('1200'); // Cash-in-Hand
    expect(codes).not.toContain('1300'); // Bank Accounts
  });
});

describe('configuring a tender', () => {
  it('maps cash, UPI and card to the accounts each requires', async () => {
    const till = await makeAccount(owner, { name: 'Counter Till', controlKind: 'CASH' });
    const bank = await makeAccount(owner, { name: 'HDFC Current', controlKind: 'BANK' });

    await put(owner, 'CASH', till.id).expect(200);
    await put(owner, 'UPI', bank.id).expect(200);
    const res = await put(owner, 'CARD', bank.id).expect(200);

    expect(res.body.tenders.CASH).toMatchObject({ status: 'DIRECT', ledgerAccountId: till.id, ledgerName: 'Counter Till' });
    expect(res.body.tenders.UPI).toMatchObject({ status: 'DIRECT', ledgerAccountId: bank.id });
    expect(res.body.tenders.CARD).toMatchObject({ status: 'DIRECT', ledgerAccountId: bank.id });
  });

  it('keeps one row per branch and tender, replacing rather than adding', async () => {
    const one = await makeAccount(owner, { name: 'Till One', controlKind: 'CASH' });
    const two = await makeAccount(owner, { name: 'Till Two', controlKind: 'CASH' });
    await put(owner, 'CASH', one.id).expect(200);
    await put(owner, 'CASH', two.id).expect(200);

    const rows = await prisma.posTenderAccount.findMany({ where: { orgId: owner.orgId, branchId: owner.branchId, tender: 'CASH' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].ledgerAccountId).toBe(two.id);
  });

  it('accepts a shared account — choosing one is still this branch making a choice', async () => {
    const shared = await makeAccount(owner, { name: 'Shared Bank', controlKind: 'BANK', branchId: null });
    const res = await put(owner, 'UPI', shared.id).expect(200);
    expect(res.body.tenders.UPI.ledgerAccountId).toBe(shared.id);
  });
});

describe('what the server refuses', () => {
  it('refuses cash into a bank account and UPI or card into cash', async () => {
    const till = await makeAccount(owner, { name: 'A Till', controlKind: 'CASH' });
    const bank = await makeAccount(owner, { name: 'A Bank', controlKind: 'BANK' });

    const cashToBank = await put(owner, 'CASH', bank.id);
    expect(cashToBank.status).toBe(400);
    expect(String(cashToBank.body.error)).toMatch(/cash account/i);

    expect((await put(owner, 'UPI', till.id)).status).toBe(400);
    expect((await put(owner, 'CARD', till.id)).status).toBe(400);
  });

  it('refuses revenue and tax accounts', async () => {
    const sales = await makeAccount(owner, { name: 'Sales Revenue', controlKind: null, accountType: 'INCOME' });
    const gst = await makeAccount(owner, { name: 'Output SGST', controlKind: null, accountType: 'LIABILITY' });
    expect((await put(owner, 'CASH', sales.id)).status).toBe(400);
    expect((await put(owner, 'CARD', gst.id)).status).toBe(400);
  });

  it('refuses an inactive account', async () => {
    const dead = await makeAccount(owner, { name: 'Closed Till', controlKind: 'CASH', active: false });
    const res = await put(owner, 'CASH', dead.id);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/no longer active/i);
  });

  it("refuses another organisation's account, without confirming it exists", async () => {
    const theirs = await makeAccount(outsider, { name: 'Their Till', controlKind: 'CASH' });
    const res = await put(owner, 'CASH', theirs.id);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/does not belong to this organisation/i);
  });

  it("refuses another branch's own account", async () => {
    const bOwned = await makeAccount(owner, { name: 'Branch B Till', controlKind: 'CASH', branchId: branchB });
    const res = await put(owner, 'CASH', bOwned.id);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/another branch/i);
  });

  it('refuses a setup control account', async () => {
    const setupCash = await prisma.ledgerAccount.findFirst({ where: { orgId: owner.orgId, code: '1200' } });
    const res = await put(owner, 'CASH', setupCash!.id);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/control account/i);
  });

  it('refuses an unknown tender', async () => {
    const till = await makeAccount(owner, { name: 'Till', controlKind: 'CASH' });
    await request(app)
      .put(`/api/orgs/${owner.orgId}/pos/tender-accounts`)
      .set(at(owner))
      .send({ tender: 'CHEQUE', ledgerAccountId: till.id })
      .expect(400);
  });
});

describe('removal', () => {
  it('leaves the tender unconfigured, with no sentinel account', async () => {
    const till = await makeAccount(owner, { name: 'Removable Till', controlKind: 'CASH' });
    await put(owner, 'CASH', till.id).expect(200);

    const res = await del(owner, 'CASH').expect(200);
    expect(res.body.tenders.CASH.status).toBe('UNCONFIGURED');
    expect(res.body.tenders.CASH.ledgerAccountId).toBeNull();
    expect(await prisma.posTenderAccount.count({ where: { orgId: owner.orgId, branchId: owner.branchId, tender: 'CASH' } })).toBe(0);
  });

  it('is safe to repeat', async () => {
    await del(owner, 'CASH').expect(200);
    await del(owner, 'CASH').expect(200);
  });
});

describe('branches do not configure each other', () => {
  it('leaves branch B unconfigured when branch A is configured', async () => {
    const tillA = await makeAccount(owner, { name: 'Till A', controlKind: 'CASH' });
    await put(owner, 'CASH', tillA.id).expect(200);

    const bView = await get(owner, branchB).expect(200);
    expect(bView.body.branchId).toBe(branchB);
    expect(bView.body.tenders.CASH.status).toBe('UNCONFIGURED');
  });

  it('lets each branch use its own till', async () => {
    const tillA = await makeAccount(owner, { name: 'Till For A', controlKind: 'CASH', branchId: owner.branchId });
    const tillB = await makeAccount(owner, { name: 'Till For B', controlKind: 'CASH', branchId: branchB });

    await put(owner, 'CASH', tillA.id).expect(200);
    await put(owner, 'CASH', tillB.id, branchB).expect(200);

    expect((await get(owner).expect(200)).body.tenders.CASH.ledgerAccountId).toBe(tillA.id);
    expect((await get(owner, branchB).expect(200)).body.tenders.CASH.ledgerAccountId).toBe(tillB.id);
  });

  it('lets both branches point at the same shared account', async () => {
    const shared = await makeAccount(owner, { name: 'One Shared Bank', controlKind: 'BANK', branchId: null });
    await put(owner, 'UPI', shared.id).expect(200);
    await put(owner, 'UPI', shared.id, branchB).expect(200);

    expect((await get(owner).expect(200)).body.tenders.UPI.ledgerAccountId).toBe(shared.id);
    expect((await get(owner, branchB).expect(200)).body.tenders.UPI.ledgerAccountId).toBe(shared.id);
  });

  it("will not let branch B use branch A's own till", async () => {
    const tillA = await makeAccount(owner, { name: 'A Private Till', controlKind: 'CASH', branchId: owner.branchId });
    const res = await put(owner, 'CASH', tillA.id, branchB);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/another branch/i);
  });

  it('does not disturb branch B when branch A removes its mapping', async () => {
    const tillA = await makeAccount(owner, { name: 'A Till 2', controlKind: 'CASH', branchId: owner.branchId });
    const tillB = await makeAccount(owner, { name: 'B Till 2', controlKind: 'CASH', branchId: branchB });
    await put(owner, 'CASH', tillA.id).expect(200);
    await put(owner, 'CASH', tillB.id, branchB).expect(200);

    await del(owner, 'CASH').expect(200);

    expect((await get(owner).expect(200)).body.tenders.CASH.status).toBe('UNCONFIGURED');
    expect((await get(owner, branchB).expect(200)).body.tenders.CASH.ledgerAccountId).toBe(tillB.id);
  });

  it('never inherits — a brand new branch starts unconfigured however well configured its siblings are', async () => {
    const fresh = await request(app)
      .post(`/api/orgs/${owner.orgId}/branches`)
      .set(at(owner))
      .send({
        branchCode: `B3-${rnd()}`,
        branchName: 'Third Counter',
        addressLine1: '2 Road',
        state: 'Karnataka',
        country: 'India',
        gstRegistrationType: 'UNREGISTERED',
      });
    const freshId = fresh.body?.branch?.id || fresh.body?.id;
    const res = await get(owner, freshId).expect(200);
    for (const t of ['CASH', 'UPI', 'CARD']) expect(res.body.tenders[t].status).toBe('UNCONFIGURED');
  });
});

describe('a mapping that stopped being usable', () => {
  it('reports unconfigured rather than a dead account', async () => {
    const till = await makeAccount(owner, { name: 'Soon Closed', controlKind: 'CASH' });
    await put(owner, 'CASH', till.id).expect(200);
    expect((await get(owner).expect(200)).body.tenders.CASH.status).toBe('DIRECT');

    await prisma.ledgerAccount.update({ where: { id: till.id }, data: { isActive: false } });
    expect((await get(owner).expect(200)).body.tenders.CASH.status).toBe('UNCONFIGURED');
  });
});

describe('the payment modes the receipt screens read', () => {
  it('still lists the operational cash and bank accounts, and no control accounts', async () => {
    const till = await makeAccount(owner, { name: 'Modes Till', controlKind: 'CASH' });
    const res = await request(app).get(`/api/orgs/${owner.orgId}/payment-modes`).set(at(owner)).expect(200);

    const ids = res.body.modes.map((m: any) => m.id);
    expect(ids).toContain(till.id);
    const codes = res.body.modes.map((m: any) => m.code);
    expect(codes).not.toContain('1200');
    expect(codes).not.toContain('1300');
    for (const m of res.body.modes) expect(['CASH', 'BANK']).toContain(m.controlKind);
    // The shape receipt entry consumes is unchanged.
    expect(Object.keys(res.body.modes[0]).sort()).toEqual(['code', 'controlKind', 'id', 'name']);
  });

  it("does not offer another branch's own account", async () => {
    const bOwned = await makeAccount(owner, { name: 'B Only Bank', controlKind: 'BANK', branchId: branchB });
    const res = await request(app).get(`/api/orgs/${owner.orgId}/payment-modes`).set(at(owner)).expect(200);
    expect(res.body.modes.map((m: any) => m.id)).not.toContain(bOwned.id);
  });
});

describe('configuration moves no money', () => {
  it('writes no document, payment, allocation or journal line', async () => {
    const before = {
      invoices: await prisma.invoice.count(),
      bills: await prisma.bill.count(),
      payments: await prisma.payment.count(),
      allocations: await prisma.paymentAllocation.count(),
      entries: await prisma.journalEntry.count(),
      lines: await prisma.journalLine.count(),
      stock: await prisma.stockBalance.count(),
    };

    const till = await makeAccount(owner, { name: 'No Side Effect Till', controlKind: 'CASH' });
    const bank = await makeAccount(owner, { name: 'No Side Effect Bank', controlKind: 'BANK' });
    await put(owner, 'CASH', till.id).expect(200);
    await put(owner, 'UPI', bank.id).expect(200);
    await put(owner, 'CARD', bank.id).expect(200);
    await get(owner).expect(200);
    await del(owner, 'CARD').expect(200);

    expect({
      invoices: await prisma.invoice.count(),
      bills: await prisma.bill.count(),
      payments: await prisma.payment.count(),
      allocations: await prisma.paymentAllocation.count(),
      entries: await prisma.journalEntry.count(),
      lines: await prisma.journalLine.count(),
      stock: await prisma.stockBalance.count(),
    }).toEqual(before);
  });
});
