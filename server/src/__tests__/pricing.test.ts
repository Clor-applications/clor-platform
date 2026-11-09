import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Pricing (roadmap item 9): the mock price book, clor.in's public price list
 * and quote, and the operator's draft -> edit -> publish.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { ensureFirstPriceBook } = await import('../services/pricing/seed.js');
const { clearPublishedCache } = await import('../services/pricing/books.js');

const app = buildApp().listen(0, '127.0.0.1');
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: pricing', fn);
afterAll(async () => {
  await db(() => platformPrisma.priceBook.deleteMany({}));
  await db(() => platformPrisma.platformSetting.deleteMany({ where: { key: 'billing.gst' } }));
  clearPublishedCache();
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });

async function company(): Promise<Ctx> {
  const email = `pricing.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Price Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, email };
}
async function withAuthenticator(c: Ctx) {
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  return secret as string;
}
async function operator() {
  const op = await company();
  const secret = await withAuthenticator(op);
  process.env.CLOR_OPERATOR_USER_IDS = op.userId;
  const stepUp = (await request(app).post('/api/ops/step-up').set(bearer(op)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
  return { op, h: { ...bearer(op), 'x-step-up': stepUp } };
}

const RS = 100;

beforeAll(async () => {
  /* One database per run: start from no price book at all, as a new platform database does. */
  await db(() => platformPrisma.priceBook.deleteMany({}));
  clearPublishedCache();
});

describe('the mock price book', () => {
  it('is made and published once, and a second run changes nothing', async () => {
    expect((await request(app).get('/api/public/pricing').expect(503)).body.code).toBe('NO_PRICE_BOOK');
    const first = await ensureFirstPriceBook();
    expect(first).toMatchObject({ created: true, version: 1 });
    expect(await ensureFirstPriceBook()).toEqual({ created: false });
    const books = await db(() => platformPrisma.priceBook.findMany({ include: { prices: true } }));
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ version: 1, status: 'PUBLISHED', currency: 'INR', note: 'Mock prices — not final' });
    expect(books[0].prices).toHaveLength(16);
    expect(books[0].prices.every((p) => Number.isInteger(p.unitAmount) && p.trialDays === 30 && p.gstApplies)).toBe(true);
  });

  it('cannot have two published books', async () => {
    await expect(db(() => platformPrisma.priceBook.create({ data: { version: 99, status: 'PUBLISHED' } }))).rejects.toThrow();
  });
});

describe('the public price list', () => {
  it('shows the published book to clor.in, without credentials, and nobody else’s origin', async () => {
    const r = await request(app).get('/api/public/pricing').set('Origin', 'https://clor.in').expect(200);
    expect(r.headers['access-control-allow-origin']).toBe('https://clor.in');
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
    expect(r.headers['cache-control']).toBe('public, max-age=300');
    expect(r.body).toMatchObject({ version: 1, currency: 'INR', note: 'Mock prices — not final', gst: { charged: false, ratePercent: 0 } });
    expect(r.body.gst.note).toMatch(/not registered for GST/);
    expect(r.body.tiers).toEqual([
      { code: 'starter', name: 'Starter' },
      { code: 'growth', name: 'Growth' },
    ]);
    expect(r.body.apps.map((a: any) => a.name)).toEqual(['Books', 'Payroll', 'People', 'Attendance']);
    const books = r.body.apps[0];
    expect(books.prices).toContainEqual({ tier: 'starter', period: 'MONTHLY', unit: 'USER', unitAmount: 300 * RS, includedUnits: 1, trialDays: 30, gstApplies: true });
    const other = await request(app).get('/api/public/pricing').set('Origin', 'https://evil.example').expect(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('quotes from the published book, with no GST until CLOR is registered', async () => {
    const r = await request(app).post('/api/public/pricing/quote').send({ apps: ['books', 'payroll'], tier: 'starter', period: 'monthly', users: 3, employees: 6 }).expect(200);
    expect(r.body.quote).toMatchObject({ priceBookVersion: 1, subtotal: 1400 * RS, total: 1400 * RS, tax: { charged: false, amount: 0 } });
    expect(r.body.quote.lines.map((l: any) => [l.appName, l.billedUnits, l.amount])).toEqual([
      ['Books', 3, 900 * RS],
      ['Payroll', 10, 500 * RS],
    ]);
    expect((await request(app).post('/api/public/pricing/quote').send({ apps: ['books'], tier: 'starter', period: 'weekly' }).expect(400)).body.code).toBe('INVALID');
    expect((await request(app).post('/api/public/pricing/quote').send({ apps: ['books'], tier: 'platinum', period: 'monthly' }).expect(400)).body.code).toBe('NO_PRICE');
  });

  it('adds 18% once CLOR is registered: CGST + SGST in Karnataka, IGST elsewhere', async () => {
    await db(() => platformPrisma.platformSetting.create({ data: { key: 'billing.gst', value: { registered: true, gstin: '29AABCU9603R1ZJ' } } }));
    try {
      const body = { apps: ['books'], tier: 'starter', period: 'monthly', users: 3 };
      const ka = (await request(app).post('/api/public/pricing/quote').send({ ...body, state: 'Karnataka' }).expect(200)).body.quote;
      expect(ka.tax).toMatchObject({ kind: 'CGST_SGST', cgst: 81 * RS, sgst: 81 * RS, amount: 162 * RS });
      expect(ka.total).toBe(1062 * RS);
      const mh = (await request(app).post('/api/public/pricing/quote').send({ ...body, state: '27' }).expect(200)).body.quote;
      expect(mh.tax).toMatchObject({ kind: 'IGST', igst: 162 * RS });
      expect((await request(app).get('/api/public/pricing').expect(200)).body.gst).toMatchObject({ charged: true, ratePercent: 18 });
    } finally {
      await db(() => platformPrisma.platformSetting.delete({ where: { key: 'billing.gst' } }));
    }
  });
});

describe('the operator’s price books', () => {
  it('is for CLOR operators only, and changes need a fresh authenticator code', async () => {
    const c = await company();
    expect((await request(app).get('/api/ops/pricing').set(bearer(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    expect((await request(app).post('/api/ops/pricing/books').set(bearer(c)).send({}).expect(403)).body.code).toBe('OPERATOR_ONLY');
    const { op } = await operator();
    expect((await request(app).post('/api/ops/pricing/books').set(bearer(op)).send({}).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
  }, 60_000);

  it('copies the published book to a draft, edits it, and publishes it; the old one is archived and the site changes at once', async () => {
    const { op, h } = await operator();
    const list = (await request(app).get('/api/ops/pricing').set(bearer(op)).expect(200)).body;
    expect(list.gst).toMatchObject({ registered: false, gstin: null });
    const v1 = list.books.find((b: any) => b.status === 'PUBLISHED');
    expect(v1).toMatchObject({ version: 1, priceCount: 16 });

    const draft = (await request(app).post('/api/ops/pricing/books').set(h).send({}).expect(201)).body.book;
    expect(draft).toMatchObject({ version: 2, status: 'DRAFT', copiedFromId: v1.id, note: 'Mock prices — not final', priceCount: 16 });
    expect(draft.prices).toHaveLength(16);
    const again = (await request(app).post('/api/ops/pricing/books').set(h).send({}).expect(409)).body;
    expect(again).toMatchObject({ code: 'DRAFT_OPEN', draftId: draft.id });

    /* People Starter: ₹30 -> ₹35 a month, ₹300 -> ₹350 a year. */
    const prices = draft.prices.map((p: any) => (p.appCode === 'people' && p.tier === 'starter' ? { ...p, unitAmount: p.period === 'MONTHLY' ? 35 * RS : 350 * RS } : p));
    const bad = prices.map((p: any, i: number) => (i === 0 ? { ...p, unitAmount: -1 } : p));
    const refused = (await request(app).patch(`/api/ops/pricing/books/${draft.id}`).set(h).send({ prices: bad }).expect(400)).body;
    expect(refused.code).toBe('INVALID_PRICES');
    expect(refused.problems[0]).toMatch(/whole paise/);
    expect((await request(app).patch(`/api/ops/pricing/books/${draft.id}`).set(h).send({ prices: [{ ...prices[0], unitAmount: 12.5 }] }).expect(400)).body.code).toBe('INVALID');

    const edited = (await request(app).patch(`/api/ops/pricing/books/${draft.id}`).set(h).send({ prices, note: 'Mock prices — not final, People raised' }).expect(200)).body.book;
    expect(edited.prices.find((p: any) => p.appCode === 'people' && p.tier === 'starter' && p.period === 'MONTHLY').unitAmount).toBe(35 * RS);
    /* The published book is untouched until the draft is published. */
    expect((await request(app).post('/api/public/pricing/quote').send({ apps: ['people'], tier: 'starter', period: 'monthly', employees: 10 }).expect(200)).body.quote.total).toBe(300 * RS);
    expect((await request(app).patch(`/api/ops/pricing/books/${v1.id}`).set(h).send({ note: 'rewriting history' }).expect(409)).body.code).toBe('NOT_DRAFT');

    const pub = (await request(app).post(`/api/ops/pricing/books/${draft.id}/publish`).set(h).send({}).expect(200)).body;
    expect(pub).toMatchObject({ previousVersion: 1, book: { version: 2, status: 'PUBLISHED' } });
    const site = (await request(app).get('/api/public/pricing').expect(200)).body;
    expect(site).toMatchObject({ version: 2, note: 'Mock prices — not final, People raised' });
    expect((await request(app).post('/api/public/pricing/quote').send({ apps: ['people'], tier: 'starter', period: 'monthly', employees: 10 }).expect(200)).body.quote.total).toBe(350 * RS);

    const books = await db(() => platformPrisma.priceBook.findMany({ orderBy: { version: 'asc' }, include: { prices: { where: { appCode: 'people', tier: 'starter', period: 'MONTHLY' } } } }));
    expect(books.map((b) => [b.version, b.status, b.prices[0].unitAmount])).toEqual([
      [1, 'ARCHIVED', 30 * RS],
      [2, 'PUBLISHED', 35 * RS],
    ]);
    expect(books[0].archivedAt).toBeTruthy();
    expect((await request(app).post(`/api/ops/pricing/books/${draft.id}/publish`).set(h).send({}).expect(409)).body.code).toBe('NOT_DRAFT');

    const log = await db(() => platformPrisma.operatorAuditEvent.findMany({ where: { operatorUserId: op.userId, action: { startsWith: 'PRICE_BOOK_' } }, orderBy: { at: 'asc' } }));
    expect(log.map((e) => e.action)).toEqual(['PRICE_BOOK_DRAFTED', 'PRICE_BOOK_EDITED', 'PRICE_BOOK_PUBLISHED']);
    expect(log[1].detail).toMatchObject({ version: 2, changes: expect.arrayContaining([{ price: 'people|starter|MONTHLY', from: { unitAmount: 30 * RS }, to: { unitAmount: 35 * RS } }]) });
    expect(log[2].detail).toMatchObject({ version: 2, previousVersion: 1 });
  }, 90_000);

  it('leaves drafting and publishing to billing operators', async () => {
    const boss = await operator();
    const sup = await company();
    const secret = await withAuthenticator(sup);
    await request(app).post('/api/ops/operators').set(boss.h).send({ email: sup.email, role: 'SUPPORT' }).expect(201);
    const st = (await request(app).post('/api/ops/step-up').set(bearer(sup)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token;
    const h = { ...bearer(sup), 'x-step-up': st };
    await request(app).get('/api/ops/pricing').set(h).expect(200);
    expect((await request(app).post('/api/ops/pricing/books').set(h).send({}).expect(403)).body.code).toBe('OPERATOR_ROLE');
  }, 90_000);
});
