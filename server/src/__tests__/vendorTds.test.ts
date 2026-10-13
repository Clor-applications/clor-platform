import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

/**
 * TDS we deduct when paying a vendor.
 *
 * The route accepted a `deductions` array and used it to decide how much of the
 * bill was settled — and then posted nothing for it. A 1,00,000 bill paid as
 * 90,000 cash with 10,000 TDS produced exactly two lines, Dr Accounts Payable
 * 90,000 and Cr Cash 90,000. Two things followed, both silent:
 *
 *   - The vendor's ledger said the bill was settled while Accounts Payable
 *     still carried 10,000 of it, so the subsidiary and its control account
 *     disagreed by the deduction on every such payment, permanently.
 *   - The tax owed to the government was recorded nowhere at all. There was no
 *     TDS Payable account in the chart for it to land in.
 *
 * The receipt branch, in the same file, always did the mirror of this
 * correctly.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; bankId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

beforeAll(async () => {
  const email = `vtds.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Vendor TDS owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `VTDS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const orgId = setup.body.company.orgId as string;
  const bank = await prisma.ledgerAccount.findFirst({ where: { orgId, controlKind: { in: ['CASH', 'BANK'] } } });
  owner = { token: signup.body.token, orgId, branchId: setup.body.branch.id, bankId: bank!.id };
}, 60_000);

const linesFor = async (paymentId: string) => {
  const entries = await prisma.journalEntry.findMany({
    where: { orgId: owner.orgId, sourceDocType: 'PAYMENT', sourceDocId: paymentId },
    include: { lines: { include: { ledgerAccount: true } } },
  });
  return entries.flatMap((e) => e.lines);
};

const pay = (body: Record<string, unknown>) =>
  request(app).post(`/api/orgs/${owner.orgId}/payments`).set(auth(owner)).send({
    direction: 'PAYMENT',
    date: '2026-08-01',
    partyType: 'VENDOR',
    partyName: 'Contractor Co',
    ledgerAccountId: owner.bankId,
    ...body,
  });

describe('a vendor payment with TDS deducted', () => {
  it('reduces the payable by what settled the bill, not by the cash', async () => {
    const res = await pay({ amount: 90000, deductions: [{ kind: 'TDS', amount: 10000, note: 'TDS 194J(b)' }] }).expect(201);
    const lines = await linesFor(res.body.payment.id);

    const ap = lines.find((l) => l.ledgerAccount?.controlKind === 'AP');
    expect(Number(ap?.debit ?? 0)).toBe(100000);

    // The cash that actually left is still the cash that actually left.
    const cash = lines.find((l) => ['CASH', 'BANK'].includes(String(l.ledgerAccount?.controlKind)));
    expect(Number(cash?.credit ?? 0)).toBe(90000);
  });

  it('records the tax as a liability, because it is owed until the challan is paid', async () => {
    const res = await pay({ amount: 90000, deductions: [{ kind: 'TDS', amount: 10000 }] }).expect(201);
    const lines = await linesFor(res.body.payment.id);

    const tds = lines.find((l) => l.ledgerAccount?.controlKind === 'TDS_PAYABLE');
    expect(tds, 'no TDS Payable line was posted').toBeTruthy();
    expect(Number(tds?.credit ?? 0)).toBe(10000);
    expect(tds?.ledgerAccount?.accountType).toBe('LIABILITY');
  });

  it('still balances', async () => {
    const res = await pay({
      amount: 88000,
      deductions: [
        { kind: 'TDS', amount: 10000 },
        { kind: 'BANK_CHARGES', amount: 2000 },
      ],
    }).expect(201);
    const lines = await linesFor(res.body.payment.id);
    const net = lines.reduce((sum, l) => sum + Number(l.debit ?? 0) - Number(l.credit ?? 0), 0);
    expect(Math.abs(net)).toBeLessThan(0.005);

    const ap = lines.find((l) => l.ledgerAccount?.controlKind === 'AP');
    expect(Number(ap?.debit ?? 0)).toBe(100000);
  });

  /* Nothing changes for a payment with no deduction, which is most of them. */
  it('leaves an ordinary payment exactly as it was', async () => {
    const res = await pay({ amount: 50000 }).expect(201);
    const lines = await linesFor(res.body.payment.id);
    expect(lines).toHaveLength(2);
    const ap = lines.find((l) => l.ledgerAccount?.controlKind === 'AP');
    expect(Number(ap?.debit ?? 0)).toBe(50000);
    expect(lines.some((l) => l.ledgerAccount?.controlKind === 'TDS_PAYABLE')).toBe(false);
  });
});
