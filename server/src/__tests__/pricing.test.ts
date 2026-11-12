import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Pricing (roadmap item 9), made in the operator console: price books from
 * empty or a copy, the sample prices button, preview, publish, archive, roll
 * back, CLOR's GST settings, and clor.in's public price list and quote.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { seedSampleBook } = await import('../services/pricing/seed.js');
const { clearPublishedCache } = await import('../services/pricing/books.js');

const app = buildApp().listen(0, '127.0.0.1');
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: pricing', fn);
const reset = async () => {
  await db(() => platformPrisma.priceBook.deleteMany({}));
  await db(() => platformPrisma.platformSetting.deleteMany({ where: { key: 'billing.gst' } }));
  clearPublishedCache();
};
beforeAll(reset);
afterAll(async () => {
  await reset();
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
const publicList = () => request(app).get('/api/public/pricing');
const publicQuote = (body: unknown) => request(app).post('/api/public/pricing/quote').send(body as any);

describe('with nothing published', () => {
  it('the site is told there are no prices, so it shows Request a demo', async () => {
    const r = await publicList().set('Origin', 'https://clor.in').expect(404);
    expect(r.body.code).toBe('NO_PRICE_BOOK');
    expect(r.headers['access-control-allow-origin']).toBe('https://clor.in');
    expect((await publicQuote({ plans: ['books-starter'], period: 'monthly' }).expect(404)).body.code).toBe('NO_PRICE_BOOK');
  });
});

describe('the operator console', () => {
  it('is for CLOR operators only, and changes need a fresh authenticator code', async () => {
    const c = await company();
    expect((await request(app).get('/api/ops/pricing').set(bearer(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    expect((await request(app).put('/api/ops/settings/tax').set(bearer(c)).send({ registered: false }).expect(403)).body.code).toBe('OPERATOR_ONLY');
    const { op } = await operator();
    expect((await request(app).post('/api/ops/pricing/books').set(bearer(op)).send({ empty: true }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    expect((await request(app).put('/api/ops/settings/tax').set(bearer(op)).send({ registered: false }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
  }, 60_000);

  it('makes a book from empty, loads the sample prices, previews, publishes; then a copy, archive and roll back', async () => {
    const { op, h } = await operator();

    /* An empty draft, filled with the sample prices from the editor's button. */
    const empty = (await request(app).post('/api/ops/pricing/books').set(h).send({ empty: true }).expect(201)).body.book;
    expect(empty).toMatchObject({ version: 1, status: 'DRAFT', plans: [] });
    expect((await request(app).post('/api/ops/pricing/books').set(h).send({}).expect(409)).body).toMatchObject({ code: 'DRAFT_OPEN', draftId: empty.id });
    expect((await request(app).post(`/api/ops/pricing/books/${empty.id}/publish`).set(h).send({}).expect(400)).body.problems).toEqual(['Add at least one plan before publishing.']);
    const sample = (await request(app).get('/api/ops/pricing/sample').set(bearer(op)).expect(200)).body;
    expect(sample.plans).toHaveLength(8);

    /* The preview: cards and a sample quote for unsaved plans. */
    const preview = (await request(app).post('/api/ops/pricing/preview').set(bearer(op)).send({ plans: sample.plans, quote: { plans: ['books-starter', 'payroll-starter'], period: 'monthly', users: 3, employees: 6 } }).expect(200)).body;
    expect(preview.problems).toEqual([]);
    expect(preview.cards[0]).toMatchObject({ code: 'books-starter', monthly: { basePrice: 300 * RS, extraUnitPrice: 300 * RS }, yearly: { basePrice: 3000 * RS, saving: 600 * RS } });
    expect(preview.quote).toMatchObject({ subtotal: 1400 * RS, total: 1400 * RS });
    const broken = (await request(app).post('/api/ops/pricing/preview').set(bearer(op)).send({ plans: [{ ...sample.plans[0], apps: [] }] }).expect(200)).body;
    expect(broken.problems).toEqual(['Books Starter: choose at least one app.']);

    const refused = (await request(app).patch(`/api/ops/pricing/books/${empty.id}`).set(h).send({ plans: [{ ...sample.plans[0], name: '' }] }).expect(400)).body;
    expect(refused.code).toBe('INVALID_PLANS');
    expect((await request(app).patch(`/api/ops/pricing/books/${empty.id}`).set(h).send({ plans: [{ ...sample.plans[0], includedUnits: 1.5 }] }).expect(400)).body.code).toBe('INVALID');
    await request(app).patch(`/api/ops/pricing/books/${empty.id}`).set(h).send({ plans: sample.plans, note: sample.note }).expect(200);
    /* Not on the site until published. */
    await publicList().expect(404);
    const v1 = (await request(app).post(`/api/ops/pricing/books/${empty.id}/publish`).set(h).send({}).expect(200)).body;
    expect(v1).toMatchObject({ previousVersion: null, book: { version: 1, status: 'PUBLISHED' } });

    const site = (await publicList().expect(200)).body;
    expect(site).toMatchObject({ version: 1, note: 'Sample prices — not final', gst: { charged: false, ratePercent: 0 } });
    expect(site.plans.map((p: any) => p.code)).toEqual(['books-starter', 'books-growth', 'payroll-starter', 'payroll-growth', 'people-starter', 'people-growth', 'attendance-starter', 'attendance-growth']);
    expect(site.plans[1]).toMatchObject({ name: 'Books Growth', highlight: true, trialDays: 30 });
    const q = (await publicQuote({ plans: ['books-starter', 'payroll-starter'], period: 'monthly', users: 3, employees: 6 }).expect(200)).body.quote;
    expect(q).toMatchObject({ priceBookVersion: 1, subtotal: 1400 * RS, total: 1400 * RS, tax: { charged: false, amount: 0 } });
    expect((await publicQuote({ plans: ['books-starter'], period: 'weekly' }).expect(400)).body.code).toBe('INVALID');

    /* v2: a copy with People Starter raised and hidden from the site; the published book stays as it is until v2 is published. */
    const v2 = (await request(app).post('/api/ops/pricing/books').set(h).send({}).expect(201)).body.book;
    expect(v2).toMatchObject({ version: 2, copiedFromId: v1.book.id });
    const plans = v2.plans.map((p: any) => (p.code === 'people-starter' ? { ...p, prices: [{ period: 'MONTHLY', basePrice: 350 * RS, extraUnitPrice: 35 * RS }], periods: ['MONTHLY', 'YEARLY'], yearlyDiscountPct: 20 } : p.code === 'attendance-growth' ? { ...p, showOnWebsite: false } : p));
    await request(app).patch(`/api/ops/pricing/books/${v2.id}`).set(h).send({ plans }).expect(200);
    expect((await publicQuote({ plans: ['people-starter'], period: 'monthly', employees: 10 }).expect(200)).body.quote.total).toBe(300 * RS);
    expect((await request(app).patch(`/api/ops/pricing/books/${v1.book.id}`).set(h).send({ note: 'rewriting history' }).expect(409)).body.code).toBe('NOT_DRAFT');
    await request(app).post(`/api/ops/pricing/books/${v2.id}/publish`).set(h).send({}).expect(200);
    expect((await publicQuote({ plans: ['people-starter'], period: 'monthly', employees: 10 }).expect(200)).body.quote.total).toBe(350 * RS);
    /* 20% off twelve months of ₹350: ₹3,360. */
    expect((await publicQuote({ plans: ['people-starter'], period: 'yearly', employees: 10 }).expect(200)).body.quote.total).toBe(3360 * RS);
    expect((await publicList().expect(200)).body.plans.map((p: any) => p.code)).not.toContain('attendance-growth');
    expect((await publicQuote({ plans: ['attendance-growth'], period: 'monthly' }).expect(400)).body.code).toBe('UNKNOWN_PLAN');

    /* Archive the published book: the site has no prices again. */
    await request(app).post(`/api/ops/pricing/books/${v2.id}/archive`).set(h).send({}).expect(200);
    await publicList().expect(404);

    /* Roll back to v1: a new version 3, a copy of it, published. */
    const back = (await request(app).post(`/api/ops/pricing/books/${v1.book.id}/roll-back`).set(h).send({}).expect(200)).body;
    expect(back).toMatchObject({ fromVersion: 1, previousVersion: null, book: { version: 3, status: 'PUBLISHED', copiedFromId: v1.book.id } });
    expect((await publicQuote({ plans: ['people-starter'], period: 'monthly', employees: 10 }).expect(200)).body.quote.total).toBe(300 * RS);
    expect((await request(app).post(`/api/ops/pricing/books/${back.book.id}/roll-back`).set(h).send({}).expect(409)).body.code).toBe('NOT_ARCHIVED');

    const books = await db(() => platformPrisma.priceBook.findMany({ orderBy: { version: 'asc' }, select: { version: true, status: true } }));
    expect(books).toEqual([
      { version: 1, status: 'ARCHIVED' },
      { version: 2, status: 'ARCHIVED' },
      { version: 3, status: 'PUBLISHED' },
    ]);
    await expect(db(() => platformPrisma.priceBook.create({ data: { version: 99, status: 'PUBLISHED' } }))).rejects.toThrow();

    const log = await db(() => platformPrisma.operatorAuditEvent.findMany({ where: { operatorUserId: op.userId, action: { startsWith: 'PRICE_BOOK_' } }, orderBy: { at: 'asc' } }));
    expect(log.map((e) => e.action)).toEqual([
      'PRICE_BOOK_DRAFTED',
      'PRICE_BOOK_EDITED',
      'PRICE_BOOK_PUBLISHED',
      'PRICE_BOOK_DRAFTED',
      'PRICE_BOOK_EDITED',
      'PRICE_BOOK_PUBLISHED',
      'PRICE_BOOK_ARCHIVED',
      'PRICE_BOOK_ROLLED_BACK',
    ]);
    expect(log[4].detail).toMatchObject({ version: 2, plans: { added: [], removed: [], changed: expect.arrayContaining([expect.objectContaining({ code: 'people-starter' })]) } });
    expect(log[7].detail).toMatchObject({ version: 3, fromVersion: 1 });
  }, 120_000);

  it('turns GST on only with a valid GSTIN, legal name and SAC; quotes then carry CGST + SGST or IGST', async () => {
    const { op, h } = await operator();
    expect((await request(app).get('/api/ops/settings/tax').set(bearer(op)).expect(200)).body.tax).toMatchObject({ registered: false, ratePercent: 18 });
    const bad = (await request(app).put('/api/ops/settings/tax').set(h).send({ registered: true, gstin: '29ABCDE1234F1Z5' }).expect(400)).body;
    expect(bad.problems).toContain('That GSTIN is not right: check the 15 characters.');
    const on = (await request(app).put('/api/ops/settings/tax').set(h).send({ registered: true, gstin: '29AABCU9603R1ZJ', legalName: 'Clor Applications Pvt Ltd', state: 'Karnataka', sac: '998314', ratePercent: 18 }).expect(200)).body.tax;
    expect(on).toMatchObject({ registered: true, stateCode: '29', sac: '998314' });

    const body = { plans: ['books-starter'], period: 'monthly', users: 3 };
    const ka = (await publicQuote({ ...body, state: 'Karnataka' }).expect(200)).body.quote;
    expect(ka.tax).toMatchObject({ kind: 'CGST_SGST', cgst: 81 * RS, sgst: 81 * RS, amount: 162 * RS });
    expect(ka.total).toBe(1062 * RS);
    expect((await publicQuote({ ...body, state: '27' }).expect(200)).body.quote.tax).toMatchObject({ kind: 'IGST', igst: 162 * RS });
    expect((await publicList().expect(200)).body.gst).toMatchObject({ charged: true, ratePercent: 18 });

    await request(app).put('/api/ops/settings/tax').set(h).send({ registered: false, gstin: '29AABCU9603R1ZJ', legalName: 'Clor Applications Pvt Ltd' }).expect(200);
    expect((await publicQuote(body).expect(200)).body.quote.tax).toMatchObject({ charged: false, amount: 0 });
    const log = await db(() => platformPrisma.operatorAuditEvent.findMany({ where: { operatorUserId: op.userId, action: 'TAX_SETTINGS_CHANGED' } }));
    expect(log).toHaveLength(2);
  }, 60_000);

  it('leaves changes to billing operators', async () => {
    const boss = await operator();
    const sup = await company();
    const secret = await withAuthenticator(sup);
    await request(app).post('/api/ops/operators').set(boss.h).send({ email: sup.email, role: 'SUPPORT' }).expect(201);
    const st = (await request(app).post('/api/ops/step-up').set(bearer(sup)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token;
    const h = { ...bearer(sup), 'x-step-up': st };
    await request(app).get('/api/ops/pricing').set(h).expect(200);
    expect((await request(app).post('/api/ops/pricing/books').set(h).send({ empty: true }).expect(403)).body.code).toBe('OPERATOR_ROLE');
    expect((await request(app).put('/api/ops/settings/tax').set(h).send({ registered: false }).expect(403)).body.code).toBe('OPERATOR_ROLE');
  }, 90_000);

  it('the developer seed publishes the sample book once and never over a book that exists', async () => {
    expect(await seedSampleBook()).toEqual({ created: false });
    await reset();
    expect(await seedSampleBook()).toMatchObject({ created: true, version: 1 });
    expect(await seedSampleBook()).toEqual({ created: false });
    expect((await publicList().expect(200)).body.plans).toHaveLength(8);
  });
});
