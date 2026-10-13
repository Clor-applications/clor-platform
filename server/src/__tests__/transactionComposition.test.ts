import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { postEntry, reverseEntry, ensureLedgerSetup } from '../services/ledger.js';
import { recalcSettlementForPayment } from '../services/settlement.js';

/**
 * Accounting operations compose into one transaction.
 *
 * A counter sale is four writes — the invoice and its posting, the receipt and
 * its posting — plus the settlement derived from them, and they are only ever
 * correct together. Until now `postEntry` opened a transaction of its own, so
 * an outer operation could not roll the whole thing back: a receipt that failed
 * after the invoice had posted left a sale in the books with no money against
 * it, and the operator was told the sale had gone through.
 *
 * A suite that only checks the ledger still balances would pass against exactly
 * that bug. These assert the opposite thing — that when an operation is
 * abandoned, *nothing* it wrote survives.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
let owner: Ctx;
let userId = '';
let bankAccountId = '';

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

beforeAll(async () => {
  const email = `txc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Tx owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Tx Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);

  owner = {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    accountId: '',
  };
  const org = await platformPrisma.org.findUnique({ where: { id: owner.orgId }, select: { accountId: true } });
  owner.accountId = org!.accountId;
  const user = await platformPrisma.user.findFirst({ where: { email }, select: { id: true } });
  userId = user!.id;

  await ensureLedgerSetup(owner.accountId, owner.orgId, userId);
  const bank = await request(app)
    .post(`/api/orgs/${owner.orgId}/ledger/accounts`)
    .set(auth(owner))
    .send({ name: 'HDFC Current A/c', accountType: 'ASSET', controlKind: 'BANK' })
    .expect(201);
  bankAccountId = bank.body.account.id;
});

const counts = async () => ({
  invoices: await prisma.invoice.count({ where: { orgId: owner.orgId } }),
  payments: await prisma.payment.count({ where: { orgId: owner.orgId } }),
  allocations: await prisma.paymentAllocation.count({ where: { orgId: owner.orgId } }),
  entries: await prisma.journalEntry.count({ where: { orgId: owner.orgId } }),
  lines: await prisma.journalLine.count({ where: { orgId: owner.orgId } }),
});

const saleLines = (total: number) => [
  { controlKind: 'AR' as const, debit: total, description: 'Test sale' },
  { controlKind: 'SALES' as const, credit: total, description: 'Test sale' },
];

const ledgerBalanced = async () => {
  const entries = await prisma.journalEntry.findMany({ where: { orgId: owner.orgId }, include: { lines: true } });
  return entries.every((e) => {
    const d = e.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
    const c = e.lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
    return d === c;
  });
};

class Boom extends Error {}

describe('a supplied transaction owns everything written inside it', () => {
  it('leaves no entry and no line behind when the caller rolls back', async () => {
    const before = await counts();

    await expect(
      prisma.$transaction(async (tx) => {
        await postEntry(
          {
            accountId: owner.accountId,
            orgId: owner.orgId,
            branchId: owner.branchId,
            userId,
            date: '2026-06-10',
            journalCode: 'JV',
            narration: 'rolled back',
            lines: saleLines(500),
          },
          tx
        );
        // Proof it really was written inside this transaction before we abandon it.
        expect(await tx.journalEntry.count({ where: { orgId: owner.orgId } })).toBe(before.entries + 1);
        throw new Boom('abandon');
      })
    ).rejects.toThrow(Boom);

    const after = await counts();
    expect(after.entries).toBe(before.entries);
    expect(after.lines).toBe(before.lines);
    expect(await prisma.journalEntry.findFirst({ where: { orgId: owner.orgId, narration: 'rolled back' } })).toBeNull();
  });

  it('rolls back a document and its posting together', async () => {
    const before = await counts();
    const number = `TXC-${rnd()}`;

    await expect(
      prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            accountId: owner.accountId,
            orgId: owner.orgId,
            branchId: owner.branchId,
            number,
            date: '2026-06-10',
            customerName: 'Rollback Customer',
            subtotal: new Prisma.Decimal('1000'),
            total: new Prisma.Decimal('1000'),
            itemsJson: '[]',
            createdByUserId: userId,
          },
        });
        await postEntry(
          {
            accountId: owner.accountId,
            orgId: owner.orgId,
            branchId: owner.branchId,
            userId,
            date: '2026-06-10',
            journalCode: 'SAL',
            sourceDocType: 'INVOICE',
            sourceDocId: inv.id,
            lines: saleLines(1000),
          },
          tx
        );
        throw new Boom('abandon');
      })
    ).rejects.toThrow(Boom);

    expect(await prisma.invoice.findFirst({ where: { orgId: owner.orgId, number } })).toBeNull();
    expect(await counts()).toEqual(before);
  });

  it('commits both when nothing throws', async () => {
    const before = await counts();
    const number = `TXC-${rnd()}`;

    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          accountId: owner.accountId,
          orgId: owner.orgId,
          branchId: owner.branchId,
          number,
          date: '2026-06-10',
          customerName: 'Committed Customer',
          subtotal: new Prisma.Decimal('1000'),
          total: new Prisma.Decimal('1000'),
          itemsJson: '[]',
          createdByUserId: userId,
        },
      });
      await postEntry(
        {
          accountId: owner.accountId,
          orgId: owner.orgId,
          branchId: owner.branchId,
          userId,
          date: '2026-06-10',
          journalCode: 'SAL',
          sourceDocType: 'INVOICE',
          sourceDocId: inv.id,
          lines: saleLines(1000),
        },
        tx
      );
    });

    expect(await prisma.invoice.findFirst({ where: { orgId: owner.orgId, number } })).not.toBeNull();
    const after = await counts();
    expect(after.invoices).toBe(before.invoices + 1);
    expect(after.entries).toBe(before.entries + 1);
    expect(await ledgerBalanced()).toBe(true);
  });

  it('chains the hash across two postings inside one transaction', async () => {
    const tag = rnd();
    await prisma.$transaction(async (tx) => {
      for (const n of [1, 2]) {
        await postEntry(
          {
            accountId: owner.accountId,
            orgId: owner.orgId,
            branchId: owner.branchId,
            userId,
            date: '2026-06-11',
            journalCode: 'JV',
            narration: `chain ${tag} ${n}`,
            lines: saleLines(100 * n),
          },
          tx
        );
      }
    });

    const [first, second] = await prisma.journalEntry.findMany({
      where: { orgId: owner.orgId, narration: { startsWith: `chain ${tag}` } },
      orderBy: { entryNo: 'asc' },
      select: { entryNo: true, hash: true, prevHash: true },
    });
    // The second must see the first — the chain does not fork inside a transaction.
    expect(second.prevHash).toBe(first.hash);
    expect(second.entryNo).not.toBe(first.entryNo);
  });

  it('rolls back a reversal supplied with a transaction', async () => {
    const posted = await postEntry({
      accountId: owner.accountId,
      orgId: owner.orgId,
      branchId: owner.branchId,
      userId,
      date: '2026-06-12',
      journalCode: 'JV',
      narration: `to reverse ${rnd()}`,
      lines: saleLines(700),
    });
    const before = await counts();

    await expect(
      prisma.$transaction(async (tx) => {
        await reverseEntry(
          { accountId: owner.accountId, orgId: owner.orgId, branchId: owner.branchId, userId, entryId: posted.id },
          tx
        );
        throw new Boom('abandon');
      })
    ).rejects.toThrow(Boom);

    const original = await prisma.journalEntry.findUnique({ where: { id: posted.id } });
    expect(original!.status).toBe('POSTED'); // never marked reversed
    expect(original!.reversedById).toBeNull(); // and no contra survives
    expect(await counts()).toEqual(before);
  });
});

describe('a whole counter sale, composed', () => {
  /** Invoice + sale posting + receipt + allocation + receipt posting + settlement, in one transaction. */
  const sell = async (opts: { total: number; failAfter?: 'invoice' | 'payment' | 'allocation' | 'receipt' }) => {
    const number = `TXS-${rnd()}`;
    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          accountId: owner.accountId,
          orgId: owner.orgId,
          branchId: owner.branchId,
          number,
          date: '2026-06-15',
          customerName: 'Counter',
          subtotal: new Prisma.Decimal(String(opts.total)),
          total: new Prisma.Decimal(String(opts.total)),
          status: 'Unpaid',
          itemsJson: '[]',
          createdByUserId: userId,
        },
      });
      await postEntry(
        {
          accountId: owner.accountId,
          orgId: owner.orgId,
          branchId: owner.branchId,
          userId,
          date: '2026-06-15',
          journalCode: 'SAL',
          sourceDocType: 'INVOICE',
          sourceDocId: inv.id,
          lines: saleLines(opts.total),
        },
        tx
      );
      if (opts.failAfter === 'invoice') throw new Boom('after invoice');

      const pay = await tx.payment.create({
        data: {
          accountId: owner.accountId,
          orgId: owner.orgId,
          branchId: owner.branchId,
          direction: 'RECEIPT',
          number: `TXR-${rnd()}`,
          date: '2026-06-15',
          partyType: 'CUSTOMER',
          partyName: 'Counter',
          ledgerAccountId: bankAccountId,
          amount: new Prisma.Decimal(String(opts.total)),
          createdByUserId: userId,
        },
      });
      if (opts.failAfter === 'payment') throw new Boom('after payment');

      await tx.paymentAllocation.create({
        data: {
          accountId: owner.accountId,
          orgId: owner.orgId,
          branchId: owner.branchId,
          paymentId: pay.id,
          docType: 'INVOICE',
          docId: inv.id,
          amount: new Prisma.Decimal(String(opts.total)),
        },
      });
      if (opts.failAfter === 'allocation') throw new Boom('after allocation');

      await postEntry(
        {
          accountId: owner.accountId,
          orgId: owner.orgId,
          branchId: owner.branchId,
          userId,
          date: '2026-06-15',
          journalCode: 'BNK',
          sourceDocType: 'RECEIPT',
          sourceDocId: pay.id,
          lines: [
            { ledgerAccountId: bankAccountId, debit: opts.total, description: 'Money received' },
            { controlKind: 'AR' as const, credit: opts.total, description: 'Settled' },
          ],
        },
        tx
      );
      if (opts.failAfter === 'receipt') throw new Boom('after receipt');

      await recalcSettlementForPayment(tx, { accountId: owner.accountId, orgId: owner.orgId, paymentId: pay.id });
    });
    return number;
  };

  it('commits invoice, receipt, allocation, both postings and the settlement together', async () => {
    const before = await counts();
    const number = await sell({ total: 1180 });

    const inv = await prisma.invoice.findFirst({ where: { orgId: owner.orgId, number } });
    expect(inv).not.toBeNull();
    expect(Number(inv!.paidAmount)).toBe(1180);
    expect(inv!.status).toBe('Paid');

    const after = await counts();
    expect(after.invoices).toBe(before.invoices + 1);
    expect(after.payments).toBe(before.payments + 1);
    expect(after.allocations).toBe(before.allocations + 1);
    expect(after.entries).toBe(before.entries + 2); // sale and receipt
    expect(await ledgerBalanced()).toBe(true);
  });

  for (const stage of ['invoice', 'payment', 'allocation', 'receipt'] as const) {
    it(`leaves nothing behind when it fails after the ${stage}`, async () => {
      const before = await counts();
      await expect(sell({ total: 1180, failAfter: stage })).rejects.toThrow(Boom);
      expect(await counts()).toEqual(before);
      expect(await ledgerBalanced()).toBe(true);
    });
  }
});

describe('callers that supply no transaction are unchanged', () => {
  it('posts and reverses exactly as before', async () => {
    const before = await counts();
    const entry = await postEntry({
      accountId: owner.accountId,
      orgId: owner.orgId,
      branchId: owner.branchId,
      userId,
      date: '2026-06-20',
      journalCode: 'JV',
      narration: `no tx ${rnd()}`,
      lines: saleLines(250),
    });
    expect((await counts()).entries).toBe(before.entries + 1);

    const reversal = await reverseEntry({
      accountId: owner.accountId,
      orgId: owner.orgId,
      branchId: owner.branchId,
      userId,
      entryId: entry.id,
    });
    const original = await prisma.journalEntry.findUnique({ where: { id: entry.id } });
    expect(original!.status).toBe('REVERSED');
    expect(original!.reversedById).toBe(reversal.id);
    expect((await counts()).entries).toBe(before.entries + 2);
    expect(await ledgerBalanced()).toBe(true);
  });

  it('still refuses an unbalanced entry, before opening anything', async () => {
    const before = await counts();
    await expect(
      postEntry({
        accountId: owner.accountId,
        orgId: owner.orgId,
        branchId: owner.branchId,
        userId,
        date: '2026-06-20',
        journalCode: 'JV',
        lines: [
          { controlKind: 'AR', debit: 100 },
          { controlKind: 'SALES', credit: 99 },
        ],
      })
    ).rejects.toThrow(/does not balance/i);
    expect(await counts()).toEqual(before);
  });

  it('still refuses a line carrying both a debit and a credit', async () => {
    await expect(
      postEntry({
        accountId: owner.accountId,
        orgId: owner.orgId,
        branchId: owner.branchId,
        userId,
        date: '2026-06-20',
        journalCode: 'JV',
        lines: [
          { controlKind: 'AR', debit: 100, credit: 100 },
          { controlKind: 'SALES', credit: 100 },
        ],
      })
    ).rejects.toThrow(/either a debit or a credit/i);
  });
});

describe('payment source keys are unique per organisation', () => {
  /* The guarantee Invoice already had. A till whose network drops after the
     server committed will retry; the retry must land on the payment that
     exists rather than taking the money twice. Not wired to POS yet — this
     pins the constraint itself. */
  const makePayment = (over: Record<string, any>) =>
    prisma.payment.create({
      data: {
        accountId: owner.accountId,
        orgId: owner.orgId,
        branchId: owner.branchId,
        direction: 'RECEIPT',
        number: `SRC-${rnd()}`,
        date: '2026-06-25',
        ledgerAccountId: bankAccountId,
        amount: new Prisma.Decimal('100'),
        createdByUserId: userId,
        ...over,
      },
    });

  it('rejects the same org, system and key twice', async () => {
    const key = `checkout-${rnd()}`;
    await makePayment({ sourceSystem: 'POS', sourceKey: key });
    await expect(makePayment({ sourceSystem: 'POS', sourceKey: key })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a different key under the same system', async () => {
    await makePayment({ sourceSystem: 'POS', sourceKey: `checkout-${rnd()}` });
    await expect(makePayment({ sourceSystem: 'POS', sourceKey: `checkout-${rnd()}` })).resolves.toBeTruthy();
  });

  it('allows the same key in another organisation', async () => {
    const key = `shared-${rnd()}`;
    await makePayment({ sourceSystem: 'POS', sourceKey: key });

    const other = await request(app)
      .post('/api/auth/signup')
      .send({ email: `txo.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'Other' })
      .expect(200);
    const otherSetup = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${other.body.token}`)
      .send({ companyName: `Other Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(200);
    const otherOrg = await platformPrisma.org.findUnique({
      where: { id: otherSetup.body.company.orgId },
      select: { accountId: true, id: true },
    });
    const otherBank = await prisma.ledgerAccount.findFirst({
      where: { orgId: otherOrg!.id, controlKind: 'BANK' },
      select: { id: true },
    });

    await expect(
      prisma.payment.create({
        data: {
          accountId: otherOrg!.accountId,
          orgId: otherOrg!.id,
          branchId: otherSetup.body.branch.id,
          direction: 'RECEIPT',
          number: `SRC-${rnd()}`,
          date: '2026-06-25',
          ledgerAccountId: otherBank!.id,
          amount: new Prisma.Decimal('100'),
          createdByUserId: userId,
          sourceSystem: 'POS',
          sourceKey: key,
        },
      })
    ).resolves.toBeTruthy();
  });

  it('leaves rows without source fields alone — every existing payment is one', async () => {
    /* SQLite treats NULLs as distinct in a unique index, so the many existing
       payments carrying no source pair do not collide with each other. */
    await expect(makePayment({})).resolves.toBeTruthy();
    await expect(makePayment({})).resolves.toBeTruthy();
    await expect(makePayment({ sourceSystem: 'POS', sourceKey: null })).resolves.toBeTruthy();
    await expect(makePayment({ sourceSystem: 'POS', sourceKey: null })).resolves.toBeTruthy();
  });
});
