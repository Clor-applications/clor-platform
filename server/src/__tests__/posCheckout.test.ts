import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

/**
 * A counter sale, whole or not at all.
 *
 * The till used to raise an invoice marked Paid, write a receipt into browser
 * storage, and stop. The ledger got a debit to receivables and nothing that
 * cleared it, the money reached no cash or bank account, and `paidAmount` sat
 * at zero underneath a status that said Paid. A suite that only checked the
 * invoice existed would have passed against all of that, so these assert the
 * things that were actually wrong: where the money landed, what the invoice
 * settled to, and — for every way the sale can fail — that nothing at all
 * survives.
 */

/* Failure injection. Null means "behave normally", which is how it sits for
   every test but the rollback ones. */
const fail: { at: string | null } = { at: null };

vi.mock('../services/ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ledger.js')>();
  return {
    ...actual,
    postEntry: async (req: any, tx?: any) => {
      if (fail.at === 'sale-posting' && req.sourceDocType === 'INVOICE') throw new Error('injected: sale posting');
      if (fail.at === 'receipt-posting' && req.sourceDocType === 'RECEIPT') throw new Error('injected: receipt posting');
      return actual.postEntry(req, tx);
    },
  };
});

vi.mock('../services/numbering.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/numbering.js')>();
  return {
    ...actual,
    allocateNumber: async (tx: any, opts: any) => {
      if (fail.at === 'receipt-number' && opts.docType === 'RECEIPT') throw new Error('injected: receipt number');
      return actual.allocateNumber(tx, opts);
    },
  };
});

vi.mock('../services/settlement.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/settlement.js')>();
  return {
    ...actual,
    recalcSettlementForPayment: async (tx: any, opts: any) => {
      if (fail.at === 'settlement') throw new Error('injected: settlement');
      const real = await actual.recalcSettlementForPayment(tx, opts);
      // A settlement that came back wrong must not be committed on top of.
      if (fail.at === 'settlement-wrong') return real.map((r) => ({ ...r, paidAmount: 0, status: 'Unpaid' }));
      return real;
    },
  };
});

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

const rnd = () => Math.random().toString(36).slice(2, 8);
const uuid = () => `pos-${Date.now()}-${rnd()}-${rnd()}`;

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
let owner: Ctx;
let cashAccountId = '';
let bankAccountId = '';
let cardBankAccountId = '';

const at = (c: Ctx, branchId = c.branchId) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': branchId,
});

async function makeOwner(prefix: string): Promise<Ctx> {
  const email = `${prefix}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Till owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Till Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: setup.body.company.orgId }, select: { accountId: true } });
  const user = await platformPrisma.user.findFirst({ where: { email }, select: { id: true } });
  return {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    accountId: org!.accountId,
    userId: user!.id,
  };
}

const makeLedger = async (c: Ctx, name: string, controlKind: 'CASH' | 'BANK') => {
  const r = await request(app)
    .post(`/api/orgs/${c.orgId}/ledger/accounts`)
    .set(at(c))
    .send({ name, accountType: 'ASSET', controlKind })
    .expect(201);
  return String(r.body.account.id);
};

const mapTender = (c: Ctx, tender: string, ledgerAccountId: string, branchId?: string) =>
  request(app)
    .put(`/api/orgs/${c.orgId}/pos/tender-accounts`)
    .set(at(c, branchId))
    .send({ tender, ledgerAccountId });

/** A ₹1,180 cart: ₹1,000 taxable, ₹90 CGST, ₹90 SGST. */
const CART = {
  date: '2026-06-12',
  taxType: 'CGST_SGST',
  subtotal: 1000,
  cgstTotal: 90,
  sgstTotal: 90,
  igstTotal: 0,
  gstTotal: 180,
  total: 1180,
  items: [{ description: 'Filter coffee 250g', quantity: 1, rate: 1000, lineTotal: 1000 }],
};

const checkout = (c: Ctx, body: Record<string, unknown>, branchId?: string) =>
  request(app).post(`/api/orgs/${c.orgId}/pos/checkout`).set(at(c, branchId)).send(body);

const sell = (c: Ctx, over: Record<string, unknown> = {}, branchId?: string) =>
  checkout(c, { checkoutId: uuid(), tender: 'CASH', customerName: 'Walk-in Customer', ...CART, ...over }, branchId);

/** Everything a checkout could have written, counted. */
const counts = async (orgId: string) => ({
  invoices: await prisma.invoice.count({ where: { orgId } }),
  payments: await prisma.payment.count({ where: { orgId } }),
  allocations: await prisma.paymentAllocation.count({ where: { orgId } }),
  entries: await prisma.journalEntry.count({ where: { orgId } }),
  lines: await prisma.journalLine.count({ where: { orgId } }),
});

/** The end of the branch's hash chain — the thing a stray write would move. */
const chainTip = async (orgId: string, branchId: string) => {
  const last = await prisma.journalEntry.findFirst({
    where: { orgId, branchId },
    orderBy: { entryNo: 'desc' },
    select: { entryNo: true, hash: true },
  });
  return last ? `${last.entryNo}:${last.hash}` : 'empty';
};

/** What one ledger account's balance moved by, in paise. */
const balancePaise = async (orgId: string, ledgerAccountId: string) => {
  const lines = await prisma.journalLine.findMany({
    where: { orgId, ledgerAccountId, entry: { status: 'POSTED' } },
    select: { debit: true, credit: true },
  });
  return lines.reduce(
    (s, l) => s + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100),
    0
  );
};

const controlAccountId = async (orgId: string, controlKind: string) => {
  const a = await prisma.ledgerAccount.findFirst({ where: { orgId, controlKind }, select: { id: true } });
  return a!.id;
};

const everyEntryBalances = async (orgId: string) => {
  const entries = await prisma.journalEntry.findMany({ where: { orgId }, include: { lines: true } });
  return entries.every((e) => {
    const d = e.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
    const c = e.lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
    return d === c;
  });
};

beforeAll(async () => {
  owner = await makeOwner('poscheckout');
  cashAccountId = await makeLedger(owner, 'Counter Till', 'CASH');
  bankAccountId = await makeLedger(owner, 'HDFC Current A/c', 'BANK');
  cardBankAccountId = await makeLedger(owner, 'ICICI Card Settlement A/c', 'BANK');
  await mapTender(owner, 'CASH', cashAccountId).expect(200);
  await mapTender(owner, 'UPI', bankAccountId).expect(200);
  await mapTender(owner, 'CARD', cardBankAccountId).expect(200);
});

beforeEach(() => {
  fail.at = null;
});

describe('a ₹1,180 cash sale', () => {
  it('books the sale, takes the money, and settles the invoice', async () => {
    const arId = await controlAccountId(owner.orgId, 'AR');
    const salesId = await controlAccountId(owner.orgId, 'SALES');
    const cgstId = await controlAccountId(owner.orgId, 'CGST_OUT');
    const sgstId = await controlAccountId(owner.orgId, 'SGST_OUT');

    const before = {
      ar: await balancePaise(owner.orgId, arId),
      cash: await balancePaise(owner.orgId, cashAccountId),
      sales: await balancePaise(owner.orgId, salesId),
      cgst: await balancePaise(owner.orgId, cgstId),
      sgst: await balancePaise(owner.orgId, sgstId),
    };

    const res = await sell(owner).expect(201);

    // Receivables opened and closed by the same sale.
    expect((await balancePaise(owner.orgId, arId)) - before.ar).toBe(0);
    // The money is where the branch said it should land.
    expect((await balancePaise(owner.orgId, cashAccountId)) - before.cash).toBe(118000);
    // Revenue and tax are credits, so the signed delta is negative.
    expect((await balancePaise(owner.orgId, salesId)) - before.sales).toBe(-100000);
    expect((await balancePaise(owner.orgId, cgstId)) - before.cgst).toBe(-9000);
    expect((await balancePaise(owner.orgId, sgstId)) - before.sgst).toBe(-9000);

    expect(res.body.invoice).toMatchObject({ total: 1180, paidAmount: 1180, outstanding: 0, status: 'Paid' });
    expect(res.body.payment).toMatchObject({ amount: 1180, status: 'POSTED', ledgerAccountId: cashAccountId });
    expect(res.body.allocation.amount).toBe(1180);

    // And the same answer from the database, not only from the response.
    const invoice = await prisma.invoice.findUnique({ where: { id: res.body.invoice.id } });
    expect(Number(invoice!.paidAmount)).toBe(1180);
    expect(invoice!.status).toBe('Paid');
    expect(invoice!.sourceSystem).toBe('POS');

    const entries = await prisma.journalEntry.findMany({
      where: {
        orgId: owner.orgId,
        OR: [
          { sourceDocType: 'INVOICE', sourceDocId: res.body.invoice.id },
          { sourceDocType: 'RECEIPT', sourceDocId: res.body.payment.id },
        ],
      },
    });
    expect(entries).toHaveLength(2);
    expect(await everyEntryBalances(owner.orgId)).toBe(true);
  });

  it('posts the receipt against receivables, never a second time against sales', async () => {
    const res = await sell(owner).expect(201);
    const receipt = await prisma.journalEntry.findFirst({
      where: { orgId: owner.orgId, sourceDocType: 'RECEIPT', sourceDocId: res.body.payment.id },
      include: { lines: { include: { ledgerAccount: { select: { controlKind: true, id: true } } } } },
    });
    const kinds = receipt!.lines.map((l) => ({
      id: l.ledgerAccountId,
      kind: l.ledgerAccount?.controlKind,
      debit: Number(l.debit),
      credit: Number(l.credit),
    }));
    expect(kinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: cashAccountId, debit: 1180 }),
        expect.objectContaining({ kind: 'AR', credit: 1180 }),
      ])
    );
    expect(kinds.some((k) => k.kind === 'SALES')).toBe(false);
  });

  it('does not let the client declare itself paid', async () => {
    // The old till sent status: 'Paid' and the server wrote it down. Settlement
    // is what the allocations say, so this is simply not read.
    const res = await sell(owner, { status: 'Draft', paidAmount: 0 } as any).expect(201);
    expect(res.body.invoice.status).toBe('Paid');
    expect(res.body.invoice.paidAmount).toBe(1180);
  });
});

describe('each tender lands in the account configured for it', () => {
  it('cash into the till, UPI and card into their banks', async () => {
    const before = {
      cash: await balancePaise(owner.orgId, cashAccountId),
      bank: await balancePaise(owner.orgId, bankAccountId),
      card: await balancePaise(owner.orgId, cardBankAccountId),
    };

    const c = await sell(owner, { tender: 'CASH' }).expect(201);
    const u = await sell(owner, { tender: 'UPI' }).expect(201);
    const k = await sell(owner, { tender: 'CARD' }).expect(201);

    expect(c.body.payment.ledgerAccountId).toBe(cashAccountId);
    expect(u.body.payment.ledgerAccountId).toBe(bankAccountId);
    expect(k.body.payment.ledgerAccountId).toBe(cardBankAccountId);

    // Three different accounts really moved, by exactly one sale each.
    expect((await balancePaise(owner.orgId, cashAccountId)) - before.cash).toBe(118000);
    expect((await balancePaise(owner.orgId, bankAccountId)) - before.bank).toBe(118000);
    expect((await balancePaise(owner.orgId, cardBankAccountId)) - before.card).toBe(118000);
  });

  it('accepts the spelling the screen uses', async () => {
    const res = await sell(owner, { tender: 'Card' }).expect(201);
    expect(res.body.payment.ledgerAccountId).toBe(cardBankAccountId);
  });
});

describe('an unconfigured tender', () => {
  let bare: Ctx;
  beforeAll(async () => {
    bare = await makeOwner('posbare');
  });

  it('refuses the sale and writes nothing at all', async () => {
    const before = await counts(bare.orgId);
    const res = await checkout(bare, { checkoutId: uuid(), tender: 'CASH', customerName: 'Walk-in', ...CART });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POS_TENDER_UNCONFIGURED');
    expect(res.body.error).toMatch(/POS Payment Accounts/);
    expect(await counts(bare.orgId)).toEqual(before);
  });

  it('refuses when only the other tenders are configured', async () => {
    const cash = await makeLedger(bare, 'Bare Till', 'CASH');
    await mapTender(bare, 'CASH', cash).expect(200);
    const res = await checkout(bare, { checkoutId: uuid(), tender: 'UPI', customerName: 'Walk-in', ...CART });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POS_TENDER_UNCONFIGURED');
  });

  it('refuses once a configured account is deactivated, rather than using it', async () => {
    const cash = await prisma.ledgerAccount.findFirst({ where: { orgId: bare.orgId, name: 'Bare Till' } });
    await prisma.ledgerAccount.update({ where: { id: cash!.id }, data: { isActive: false } });
    const before = await counts(bare.orgId);
    const res = await checkout(bare, { checkoutId: uuid(), tender: 'CASH', customerName: 'Walk-in', ...CART });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POS_TENDER_UNCONFIGURED');
    expect(await counts(bare.orgId)).toEqual(before);
    await prisma.ledgerAccount.update({ where: { id: cash!.id }, data: { isActive: true } });
  });

  it('will not borrow another branch mapping', async () => {
    const second = await request(app)
      .post(`/api/orgs/${owner.orgId}/branches`)
      .set(at(owner))
      .send({
        branchCode: `C2-${rnd()}`,
        branchName: 'Other Counter',
        addressLine1: '1 Road',
        state: 'Karnataka',
        country: 'India',
        gstRegistrationType: 'UNREGISTERED',
      });
    const otherBranch = String(second.body?.branch?.id || second.body?.id);
    expect(otherBranch).toBeTruthy();

    const before = await counts(owner.orgId);
    const res = await checkout(
      owner,
      { checkoutId: uuid(), tender: 'CASH', customerName: 'Walk-in', ...CART },
      otherBranch
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POS_TENDER_UNCONFIGURED');
    expect(await counts(owner.orgId)).toEqual(before);
  });
});

describe('a checkout that fails part way', () => {
  const stages = ['sale-posting', 'receipt-number', 'receipt-posting', 'settlement', 'settlement-wrong'];

  for (const stage of stages) {
    it(`leaves nothing behind when it fails at ${stage}`, async () => {
      const before = await counts(owner.orgId);
      const tip = await chainTip(owner.orgId, owner.branchId);
      const key = uuid();

      fail.at = stage;
      const res = await checkout(owner, { checkoutId: key, tender: 'CASH', customerName: 'Walk-in', ...CART });
      fail.at = null;

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await counts(owner.orgId)).toEqual(before);
      expect(await chainTip(owner.orgId, owner.branchId)).toBe(tip);
      expect(await prisma.invoice.findFirst({ where: { orgId: owner.orgId, sourceKey: key } })).toBeNull();
      expect(await prisma.payment.findFirst({ where: { orgId: owner.orgId, sourceKey: key } })).toBeNull();
    });
  }

  it('lets the same key succeed afterwards, because the failure kept nothing', async () => {
    const key = uuid();
    fail.at = 'receipt-posting';
    await checkout(owner, { checkoutId: key, tender: 'CASH', customerName: 'Walk-in', ...CART }).expect(500);
    fail.at = null;

    const ok = await checkout(owner, { checkoutId: key, tender: 'CASH', customerName: 'Walk-in', ...CART }).expect(201);
    expect(ok.body.invoice.status).toBe('Paid');
  });
});

describe('the same checkout, twice', () => {
  it('sells once and hands the second call the sale that exists', async () => {
    const key = uuid();
    const body = { checkoutId: key, tender: 'CASH', customerName: 'Walk-in', ...CART };
    const before = await counts(owner.orgId);

    const first = await checkout(owner, body).expect(201);
    const second = await checkout(owner, body).expect(200);

    expect(second.body.replayed).toBe(true);
    expect(second.body.invoice.id).toBe(first.body.invoice.id);
    expect(second.body.payment.id).toBe(first.body.payment.id);
    expect(second.body.allocation.id).toBe(first.body.allocation.id);

    const after = await counts(owner.orgId);
    expect(after.invoices - before.invoices).toBe(1);
    expect(after.payments - before.payments).toBe(1);
    expect(after.allocations - before.allocations).toBe(1);
    expect(after.entries - before.entries).toBe(2);

    const invoice = await prisma.invoice.findUnique({ where: { id: first.body.invoice.id } });
    expect(Number(invoice!.paidAmount)).toBe(1180);
  });

  it('sells once when both calls arrive at the same moment', async () => {
    const key = uuid();
    const body = { checkoutId: key, tender: 'UPI', customerName: 'Walk-in', ...CART };
    const before = await counts(owner.orgId);

    const [a, b] = await Promise.all([checkout(owner, body), checkout(owner, body)]);

    // Whichever order they landed in, one economic checkout exists and both
    // callers were told about the same one.
    /* Asserted as a pair, so a failure names the statuses and the errors
       rather than saying "expected false to be true". */
    expect({ statuses: [a.status, b.status].sort(), errors: [a.body?.error, b.body?.error] }).toEqual({
      statuses: expect.arrayContaining([expect.any(Number)]),
      errors: [undefined, undefined],
    });
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
    expect(a.body.invoice.id).toBe(b.body.invoice.id);

    const after = await counts(owner.orgId);
    expect(after.invoices - before.invoices).toBe(1);
    expect(after.payments - before.payments).toBe(1);
    expect(after.allocations - before.allocations).toBe(1);
    expect(after.entries - before.entries).toBe(2);
  });

  it('treats two identical carts with different keys as two sales', async () => {
    const before = await counts(owner.orgId);
    const one = await sell(owner).expect(201);
    const two = await sell(owner).expect(201);

    expect(one.body.invoice.id).not.toBe(two.body.invoice.id);
    expect(one.body.invoice.number).not.toBe(two.body.invoice.number);
    const after = await counts(owner.orgId);
    expect(after.invoices - before.invoices).toBe(2);
    expect(after.payments - before.payments).toBe(2);
    expect(after.entries - before.entries).toBe(4);
  });
});

describe('a settled POS sale', () => {
  it('cannot be cancelled through the ordinary status route', async () => {
    const res = await sell(owner).expect(201);
    const before = await counts(owner.orgId);

    const cancel = await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${res.body.invoice.id}/status`)
      .set(at(owner))
      .send({ status: 'Cancelled' });

    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('POS_REFUND_REQUIRED');

    // Refused means refused: no half-reversal, no orphaned receipt.
    expect(await counts(owner.orgId)).toEqual(before);
    const invoice = await prisma.invoice.findUnique({ where: { id: res.body.invoice.id } });
    expect(invoice!.status).toBe('Paid');
    expect(Number(invoice!.paidAmount)).toBe(1180);
  });

  it('leaves an ordinary unpaid invoice cancellable as before', async () => {
    const inv = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(at(owner))
      .send({
        number: `REG-${rnd()}`,
        date: '2026-06-12',
        customerName: 'Credit Customer',
        subtotal: 1000,
        cgstTotal: 90,
        sgstTotal: 90,
        gstTotal: 180,
        total: 1180,
        status: 'Unpaid',
        items: [{ description: 'Widget', quantity: 1, rate: 1000 }],
      })
      .expect(201);

    const cancel = await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${inv.body.invoice.id}/status`)
      .set(at(owner))
      .send({ status: 'Cancelled' })
      .expect(200);
    expect(cancel.body.invoice.status).toBe('Cancelled');
    expect(cancel.body.reversedEntries).toBe(1);
  });
});

describe('ordinary accounting is untouched', () => {
  it('still creates an invoice, receipts it, and settles it the normal way', async () => {
    const inv = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(at(owner))
      .send({
        number: `REG-${rnd()}`,
        date: '2026-06-12',
        customerName: 'Regular Customer',
        subtotal: 1000,
        cgstTotal: 90,
        sgstTotal: 90,
        gstTotal: 180,
        total: 1180,
        status: 'Unpaid',
        items: [{ description: 'Widget', quantity: 1, rate: 1000 }],
      })
      .expect(201);

    const pay = await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(at(owner))
      .send({
        direction: 'RECEIPT',
        date: '2026-06-12',
        partyType: 'CUSTOMER',
        partyName: 'Regular Customer',
        ledgerAccountId: bankAccountId,
        amount: 1180,
        allocations: [{ docType: 'INVOICE', docId: inv.body.invoice.id, amount: 1180 }],
      })
      .expect(201);

    expect(pay.body.settlements[0]).toMatchObject({ paidAmount: 1180, outstanding: 0, status: 'Paid' });
    // And it carries no POS identity, so nothing above applies to it.
    const row = await prisma.payment.findUnique({ where: { id: pay.body.payment.id } });
    expect(row!.sourceSystem).toBeNull();
  });

  it('leaves every entry in the organisation balanced', async () => {
    expect(await everyEntryBalances(owner.orgId)).toBe(true);
  });
});
