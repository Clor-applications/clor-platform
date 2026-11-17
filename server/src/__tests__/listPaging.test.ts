import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The document lists page: Reports and the GST returns in the browser are
 * added up from them, so every row has to be reachable, once, whatever the
 * page size (audit, 17 Nov 2026: 200 bills and 100 payments was all a
 * company could ever read).
 */
const { buildApp } = await import('../app.js');
const { at, opsKit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company } = opsKit(app);
type Ctx = Awaited<ReturnType<typeof company>>;
let c: Ctx;

const figures = { subtotal: 100, cgstTotal: 0, sgstTotal: 0, igstTotal: 0, gstTotal: 0, total: 100, items: [{ description: 'x', quantity: 1, rate: 100, gstRate: 0 }] };
const get = (path: string) => request(app).get(`/api/orgs/${c.orgId}${path}`).set(at(c)).expect(200);

/** Read a list two rows at a time to its end. */
async function paged(path: string, key: string) {
  const ids: string[] = [];
  for (let offset = 0; offset < 40; offset += 2) {
    const rows = (await get(`${path}${path.includes('?') ? '&' : '?'}limit=2&offset=${offset}`)).body[key] as Array<{ id: string }>;
    ids.push(...rows.map((r) => r.id));
    if (rows.length < 2) break;
  }
  return ids;
}

beforeAll(async () => {
  c = await company('page');
  /* Same date, made together: the order between them is settled by id alone. */
  for (let i = 0; i < 5; i += 1) {
    await request(app).post(`/api/orgs/${c.orgId}/bills`).set(at(c)).send({ date: '2026-10-10', partyName: 'Supplier Co', ...figures }).expect(201);
    await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send({ date: '2026-10-10', customerName: 'Asha Traders', status: 'Unpaid', ...figures }).expect(201);
  }
}, 120_000);

describe('reading a list a page at a time', () => {
  it.each([
    ['/bills', 'documents', 5],
    ['/invoices', 'invoices', 5],
    ['/ledger/entries', 'entries', 10],
  ])('%s: every row once, none twice', async (path, key, count) => {
    const whole = ((await get(`${path}?limit=500`)).body[key] as Array<{ id: string }>).map((r) => r.id);
    expect(whole).toHaveLength(count);
    const ids = await paged(path, key);
    expect(ids).toHaveLength(count);
    expect(new Set(ids).size).toBe(count);
    expect(ids).toEqual(whole);
  });

  it('payments: an offset past the end is empty, not an error', async () => {
    expect((await get('/payments?direction=RECEIPT&limit=500&offset=0')).body.payments).toEqual([]);
    expect((await get('/payments?direction=PAYMENT&limit=2&offset=50')).body.payments).toEqual([]);
    expect((await get('/bills?limit=2&offset=50')).body.documents).toEqual([]);
  });
});
