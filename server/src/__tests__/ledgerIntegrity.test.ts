import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Prisma, PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { reverseEntry } from '../services/ledger.js';

/**
 * The ledger's integrity, held by the database as well as by the service.
 *
 *  - A reversal is one transaction and happens once, however often it is asked
 *    for and however many ask at the same moment.
 *  - A posted entry's lines balance and cannot be edited or deleted, whoever
 *    writes: the triggers in migration 20261106100000_ledger_guards refuse it,
 *    not only services/ledger.ts.
 *  - The hash chain the ledger writes is read back and checked.
 *  - Reopening closed books needs a reason, and leaves a record of it.
 *  - Profit & loss and the balance sheet come from the same posted lines as
 *    the trial balance, and agree with it to the paisa.
 */

const app = buildApp().listen(0, '127.0.0.1');
const rnd = () => Math.random().toString(36).slice(2, 8);

/* The owner's connection: the application role may not create triggers or switch them off. */
const ownerUrl = () => {
  const url = new URL(String(process.env.PG_ADMIN_URL));
  url.pathname = new URL(String(process.env.DATABASE_URL)).pathname;
  url.search = '?schema=accounting';
  return url.toString();
};
const owner = new PrismaClient({ datasources: { db: { url: ownerUrl() } } });

/** Tampering, as somebody with direct database access would: triggers off for one statement. */
const tamper = (sql: string, ...values: unknown[]) =>
  owner.$transaction([owner.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`), owner.$executeRawUnsafe(sql, ...values)]);

const CRASH = `crash-${rnd()}`;

beforeAll(async () => {
  /* A crash after the contra is written: marking the original REVERSED fails. */
  await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION accounting.ledger_crash_test() RETURNS trigger AS $$
    BEGIN IF NEW."status" = 'REVERSED' AND OLD."narration" = '${CRASH}' THEN RAISE EXCEPTION 'simulated crash after the contra'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ledger_crash_test ON accounting."JournalEntry"`);
  await owner.$executeRawUnsafe(
    `CREATE TRIGGER ledger_crash_test BEFORE UPDATE ON accounting."JournalEntry" FOR EACH ROW EXECUTE FUNCTION accounting.ledger_crash_test()`
  );
});

afterAll(async () => {
  await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ledger_crash_test ON accounting."JournalEntry"`);
  await owner.$executeRawUnsafe(`DROP FUNCTION IF EXISTS accounting.ledger_crash_test()`);
  await owner.$disconnect();
  await new Promise((done) => app.close(done));
});

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };

async function makeTenant(label: string): Promise<Ctx> {
  const email = `li.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `LI ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    accountId: signup.body.user.accountId,
    userId: signup.body.user.id,
  };
}

const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const get = (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/ledger${path}`).set(auth(c));
const post = (c: Ctx, path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/ledger${path}`).set(auth(c)).send(body as object);

async function accounts(c: Ctx) {
  await post(c, '/setup', {}).expect(200);
  const list = (await get(c, '/accounts').expect(200)).body.accounts as Array<{ id: string; controlKind: string | null }>;
  const by = (kind: string) => list.find((a) => a.controlKind === kind)!.id;
  return { ar: by('AR'), sales: by('SALES'), expenses: by('EXPENSES'), bank: by('BANK'), ap: by('AP'), opening: by('OPENING_DIFF') };
}

async function journal(c: Ctx, debitId: string, creditId: string, amount: number, narration = 'test', date = '2026-08-16') {
  const res = await post(c, '/entries', {
    date,
    journalCode: 'JV',
    narration,
    lines: [
      { ledgerAccountId: debitId, debit: amount },
      { ledgerAccountId: creditId, credit: amount },
    ],
  }).expect(201);
  return res.body.entry as { id: string; entryNo: string; lines: Array<{ id: string }> };
}

/** What the database says, with no tenant scope and no service in the way. */
const lineCount = (entryId: string) => owner.journalLine.count({ where: { entryId } });
const contrasOf = (entryId: string) => owner.journalEntry.count({ where: { reversesId: entryId } });

let A: Ctx;
let acc: Awaited<ReturnType<typeof accounts>>;

beforeAll(async () => {
  A = await makeTenant('a');
  acc = await accounts(A);
}, 60_000);

describe('reversing an entry', () => {
  it('posts one contra however many times it is asked, and hands back the same one', async () => {
    const e = await journal(A, acc.ar, acc.sales, 500);
    const first = await post(A, `/entries/${e.id}/reverse`, {}).expect(201);
    const again = await post(A, `/entries/${e.id}/reverse`, {}).expect(201);

    expect(again.body.entry.id).toBe(first.body.entry.id);
    expect(await contrasOf(e.id)).toBe(1);
    const original = await owner.journalEntry.findUnique({ where: { id: e.id } });
    expect(original?.status).toBe('REVERSED');
    expect(original?.reversedById).toBe(first.body.entry.id);
  });

  it('posts one contra when two reversals arrive at once', async () => {
    const e = await journal(A, acc.ar, acc.sales, 700);
    const both = await Promise.all([
      post(A, `/entries/${e.id}/reverse`, {}),
      post(A, `/entries/${e.id}/reverse`, {}),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both[0].body.entry.id).toBe(both[1].body.entry.id);
    expect(await contrasOf(e.id)).toBe(1);
  });

  it('leaves nothing behind when it fails after the contra is written', async () => {
    const e = await journal(A, acc.ar, acc.sales, 900, CRASH);
    const tbBefore = (await get(A, '/trial-balance').expect(200)).body.totals;
    const entriesBefore = await owner.journalEntry.count({ where: { orgId: A.orgId } });

    /* No transaction passed: the path that used to be three separate writes. */
    await expect(
      reverseEntry({ accountId: A.accountId, orgId: A.orgId, branchId: A.branchId, userId: A.userId, entryId: e.id })
    ).rejects.toThrow(/simulated crash/);

    expect(await owner.journalEntry.count({ where: { orgId: A.orgId } })).toBe(entriesBefore);
    expect(await contrasOf(e.id)).toBe(0);
    expect((await owner.journalEntry.findUnique({ where: { id: e.id } }))?.status).toBe('POSTED');
    expect((await get(A, '/trial-balance').expect(200)).body.totals).toEqual(tbBefore);
  });

  it('rolls back with the larger operation it was part of', async () => {
    const e = await journal(A, acc.ar, acc.sales, 300);
    await expect(
      prisma.$transaction(async (tx) => {
        await reverseEntry({ accountId: A.accountId, orgId: A.orgId, branchId: A.branchId, userId: A.userId, entryId: e.id }, tx);
        throw new Error('the rest of the operation failed');
      })
    ).rejects.toThrow(/rest of the operation/);
    expect(await contrasOf(e.id)).toBe(0);
    expect((await owner.journalEntry.findUnique({ where: { id: e.id } }))?.status).toBe('POSTED');
  });
});

describe('the database guards the ledger', () => {
  /* As the application, through its own client and role: what a route written tomorrow could do. */

  it('refuses to edit a posted line', async () => {
    const e = await journal(A, acc.ar, acc.sales, 1000);
    await expect(prisma.journalLine.update({ where: { id: e.lines[0].id }, data: { debit: new Prisma.Decimal(1) } })).rejects.toThrow(
      /ledger_append_only/
    );
  });

  it('refuses to delete a posted line, or the entry and its lines with it', async () => {
    const e = await journal(A, acc.ar, acc.sales, 1000);
    await expect(prisma.journalLine.delete({ where: { id: e.lines[0].id } })).rejects.toThrow(/ledger_append_only/);
    await expect(prisma.journalEntry.delete({ where: { id: e.id } })).rejects.toThrow(/ledger_append_only/);
    expect(await lineCount(e.id)).toBe(2);
  });

  it('refuses to change what the hash covers, or to take a posted entry back to draft', async () => {
    const e = await journal(A, acc.ar, acc.sales, 1000);
    await expect(prisma.journalEntry.update({ where: { id: e.id }, data: { date: '2026-08-01' } })).rejects.toThrow(/ledger_append_only/);
    await expect(prisma.journalEntry.update({ where: { id: e.id }, data: { entryNo: `JV-X${rnd()}` } })).rejects.toThrow(/ledger_append_only/);
    await expect(prisma.journalEntry.update({ where: { id: e.id }, data: { hash: 'f'.repeat(64) } })).rejects.toThrow(/ledger_append_only/);
    await expect(prisma.journalEntry.update({ where: { id: e.id }, data: { status: 'DRAFT' } })).rejects.toThrow(/ledger_append_only/);
    await expect(prisma.journalEntry.update({ where: { id: e.id }, data: { status: 'REVERSED' } })).rejects.toThrow(/ledger_append_only/);
  });

  it('still lets a contra be reconciled against the bank', async () => {
    const e = await journal(A, acc.bank, acc.opening, 250);
    const res = await request(app)
      .patch(`/api/orgs/${A.orgId}/ledger/entries/${e.id}/reconcile`)
      .set(auth(A))
      .send({ reconciled: true, bankDate: '2026-08-20', statementRef: 'STMT-1' })
      .expect(200);
    expect(res.body.entry.reconciled).toBe(true);
  });

  it('refuses a negative line, and a line on both sides', async () => {
    const e = await owner.journalEntry.findFirstOrThrow({ where: { orgId: A.orgId, status: 'POSTED' } });
    const line = (debit: number, credit: number) => ({
      accountId: A.accountId,
      orgId: A.orgId,
      branchId: A.branchId,
      entryId: e.id,
      ledgerAccountId: acc.ar,
      debit: new Prisma.Decimal(debit),
      credit: new Prisma.Decimal(credit),
    });
    await expect(prisma.journalLine.create({ data: line(-5, 0) })).rejects.toThrow(/JournalLine_amounts_check/);
    await expect(prisma.journalLine.create({ data: line(5, 5) })).rejects.toThrow(/JournalLine_amounts_check/);
  });

  it('refuses at commit a posted entry whose lines do not balance', async () => {
    const template = await owner.journalEntry.findFirstOrThrow({ where: { orgId: A.orgId, status: 'POSTED' } });
    const entryNo = `JV-T${rnd()}`;
    await expect(
      prisma.journalEntry.create({
        data: {
          accountId: A.accountId,
          orgId: A.orgId,
          branchId: A.branchId,
          journalId: template.journalId,
          fiscalYearId: template.fiscalYearId,
          entryNo,
          date: '2026-08-16',
          status: 'POSTED',
          createdByUserId: A.userId,
          lines: {
            create: [
              { accountId: A.accountId, orgId: A.orgId, branchId: A.branchId, ledgerAccountId: acc.ar, debit: new Prisma.Decimal(100) },
              { accountId: A.accountId, orgId: A.orgId, branchId: A.branchId, ledgerAccountId: acc.sales, credit: new Prisma.Decimal(99) },
            ],
          },
        },
      })
    ).rejects.toThrow(/ledger_unbalanced/);
    expect(await owner.journalEntry.count({ where: { orgId: A.orgId, entryNo } })).toBe(0);
  });

  it('refuses at commit a line added to a posted entry that unbalances it', async () => {
    const e = await journal(A, acc.ar, acc.sales, 40);
    await expect(
      prisma.journalLine.create({
        data: { accountId: A.accountId, orgId: A.orgId, branchId: A.branchId, entryId: e.id, ledgerAccountId: acc.ar, debit: new Prisma.Decimal(1) },
      })
    ).rejects.toThrow(/ledger_unbalanced/);
    expect(await lineCount(e.id)).toBe(2);
  });
});

describe('verifying the hash chain', () => {
  it('passes for a ledger nobody has touched, reversals included', async () => {
    const c = await makeTenant('chain-ok');
    const a = await accounts(c);
    await journal(c, a.ar, a.sales, 100);
    const r = await journal(c, a.ar, a.sales, 200);
    await post(c, `/entries/${r.id}/reverse`, {}).expect(201);
    await journal(c, a.expenses, a.bank, 50);

    const v = (await get(c, '/verify-chain').expect(200)).body;
    expect(v).toMatchObject({ ok: true, checked: 4, branches: 1, problemCount: 0, forks: 0 });
  });

  it('finds a line whose amount was changed behind the ledger', async () => {
    const c = await makeTenant('chain-edit');
    const a = await accounts(c);
    await journal(c, a.ar, a.sales, 100);
    const e = await journal(c, a.ar, a.sales, 200);
    await tamper(`UPDATE "JournalLine" SET "debit" = 20 WHERE "entryId" = $1 AND "debit" > 0`, e.id);
    await tamper(`UPDATE "JournalLine" SET "credit" = 20 WHERE "entryId" = $1 AND "credit" > 0`, e.id);

    const v = (await get(c, '/verify-chain').expect(200)).body;
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual([expect.objectContaining({ entryId: e.id, kind: 'HASH_MISMATCH' })]);
  });

  it('finds an entry deleted from the middle', async () => {
    const c = await makeTenant('chain-gap');
    const a = await accounts(c);
    await journal(c, a.ar, a.sales, 100);
    const gone = await journal(c, a.ar, a.sales, 200);
    const next = await journal(c, a.ar, a.sales, 300);
    await tamper(`DELETE FROM "JournalEntry" WHERE "id" = $1`, gone.id);

    const v = (await get(c, '/verify-chain').expect(200)).body;
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual([expect.objectContaining({ entryId: next.id, kind: 'MISSING_PREVIOUS' })]);
  });

  it("checks only the caller's company", async () => {
    const c = await makeTenant('chain-other');
    const v = (await get(c, '/verify-chain').expect(200)).body;
    expect(v).toMatchObject({ ok: true, problemCount: 0 });
  });
});

describe('reopening closed books', () => {
  it('needs a reason, and keeps it with the change', async () => {
    const c = await makeTenant('lock');
    await post(c, '/fiscal-years/2026-27/lock', { lockedThrough: '2026-09-30' }).expect(200);

    const refused = await post(c, '/fiscal-years/2026-27/lock', { lockedThrough: null });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('REASON_REQUIRED');
    /* Moving the date back reopens part of the period: the same rule. */
    expect((await post(c, '/fiscal-years/2026-27/lock', { lockedThrough: '2026-06-30' })).status).toBe(400);
    expect((await get(c, '/fiscal-years').expect(200)).body.fiscalYears[0].lockedThrough).toBe('2026-09-30');

    await post(c, '/fiscal-years/2026-27/lock', { lockedThrough: '2026-06-30', reason: 'GSTR-1 amendment for July' }).expect(200);
    await post(c, '/fiscal-years/2026-27/lock', { lockedThrough: null, reason: 'Auditor asked for a reclass' }).expect(200);

    const { changes } = (await get(c, '/period-lock-changes').expect(200)).body;
    expect(changes.map((x: any) => [x.action, x.previousLockedThrough, x.lockedThrough, x.reason])).toEqual([
      ['REOPEN', '2026-06-30', null, 'Auditor asked for a reclass'],
      ['REOPEN', '2026-09-30', '2026-06-30', 'GSTR-1 amendment for July'],
      ['LOCK', null, '2026-09-30', null],
    ]);
    expect(changes.every((x: any) => x.byUserId === c.userId)).toBe(true);
  });

  it('keeps the record append-only', async () => {
    const c = await makeTenant('lock-history');
    await post(c, '/fiscal-years/2026-27/lock', { lockedThrough: '2026-09-30' }).expect(200);
    const row = await owner.periodLockChange.findFirstOrThrow({ where: { orgId: c.orgId } });
    await expect(prisma.periodLockChange.update({ where: { id: row.id }, data: { reason: 'edited' } })).rejects.toThrow(/append_only/);
    await expect(prisma.periodLockChange.delete({ where: { id: row.id } })).rejects.toThrow(/append_only/);
  });

  it("does not show one company another's history", async () => {
    const c = await makeTenant('lock-a');
    const d = await makeTenant('lock-b');
    await post(c, '/fiscal-years/2026-27/lock', { lockedThrough: '2026-09-30' }).expect(200);
    expect((await get(d, '/period-lock-changes').expect(200)).body.changes).toEqual([]);
  });
});

describe('profit & loss and the balance sheet', () => {
  it('come from posted lines and agree with the trial balance to the paisa', async () => {
    const c = await makeTenant('statements');
    const a = await accounts(c);
    /* Capital in, a sale on credit (through the invoice route, so with GST), an expense paid, a reversal. */
    await journal(c, a.bank, a.opening, 50_000);
    await request(app)
      .post(`/api/orgs/${c.orgId}/invoices`)
      .set(auth(c))
      .send({
        number: `INV-${rnd()}`,
        date: '2026-08-16',
        customerName: 'Acme Ltd',
        subtotal: 1000,
        cgstTotal: 90,
        sgstTotal: 90,
        igstTotal: 0,
        gstTotal: 180,
        total: 1180,
        items: [{ description: 'Widget', quantity: 10, rate: 100, gstRate: 18 }],
      })
      .expect(201);
    await journal(c, a.expenses, a.bank, 333.33);
    const undone = await journal(c, a.expenses, a.bank, 99);
    await post(c, `/entries/${undone.id}/reverse`, {}).expect(201);

    const tb = (await get(c, '/trial-balance').expect(200)).body;
    const pl = (await get(c, '/profit-loss').expect(200)).body;
    const bs = (await get(c, '/balance-sheet').expect(200)).body;

    expect(pl.totals).toEqual({ income: 1000, expenses: 333.33, netProfit: 666.67 });
    expect(pl.income.find((r: any) => r.controlKind === 'SALES').balance).toBe(1000);

    /* Every account in the trial balance appears once, on one statement, with its closing balance. */
    const statementRows = [...pl.income, ...pl.expenses, ...bs.assets, ...bs.liabilities, ...bs.equity];
    expect(statementRows.map((r: any) => r.accountId).sort()).toEqual(tb.rows.map((r: any) => r.accountId).sort());
    for (const r of tb.rows) {
      const s = statementRows.find((x: any) => x.accountId === r.accountId);
      const net = Math.round((r.closingDebit - r.closingCredit) * 100) / 100;
      expect(Math.abs(s.balance)).toBe(Math.abs(net));
    }

    expect(bs.totals).toMatchObject({
      assets: 50_846.67,
      liabilities: 180,
      equity: 50_000,
      currentYearProfit: 666.67,
      balanced: true,
      difference: 0,
    });
    expect(bs.totals.assets).toBe(bs.totals.liabilitiesAndEquity);
    expect(bs.trialBalance.balanced).toBe(true);
  });

  it('see entries the server posted that no browser ever held', async () => {
    const c = await makeTenant('server-only');
    const a = await accounts(c);
    /* Straight through the service, as payroll does. */
    const { postEntry } = await import('../services/ledger.js');
    await postEntry({
      accountId: c.accountId,
      orgId: c.orgId,
      branchId: c.branchId,
      userId: c.userId,
      date: '2026-08-31',
      journalCode: 'PAY',
      narration: 'Salaries for August',
      sourceDocType: 'PAYROLL_RUN',
      sourceDocId: `run_${rnd()}`,
      lines: [
        { ledgerAccountId: a.expenses, debit: 25_000 },
        { ledgerAccountId: a.bank, credit: 25_000 },
      ],
    });
    const pl = (await get(c, '/profit-loss').expect(200)).body;
    expect(pl.totals).toEqual({ income: 0, expenses: 25_000, netProfit: -25_000 });
    const bs = (await get(c, '/balance-sheet').expect(200)).body;
    expect(bs.totals).toMatchObject({ assets: -25_000, currentYearProfit: -25_000, balanced: true });
  });

  it('respect the dates: the balance sheet as of a day, the P&L for a period', async () => {
    const c = await makeTenant('dated');
    const a = await accounts(c);
    await journal(c, a.ar, a.sales, 100, 'July', '2026-07-10');
    await journal(c, a.ar, a.sales, 200, 'August', '2026-08-10');

    expect((await get(c, '/profit-loss?from=2026-08-01&to=2026-08-31').expect(200)).body.totals.income).toBe(200);
    expect((await get(c, '/balance-sheet?asOf=2026-07-31').expect(200)).body.totals).toMatchObject({ assets: 100, currentYearProfit: 100 });
    expect((await get(c, '/balance-sheet').expect(200)).body.totals.assets).toBe(300);
  });
});
