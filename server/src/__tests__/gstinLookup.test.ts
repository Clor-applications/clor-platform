import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * The GSTIN lookup, both halves of it.
 *
 * Without a portal configured it still answers, from what the number itself
 * encodes: the first two digits are the state code and characters 3–12 are the
 * PAN. That is most of the value and it costs nothing.
 *
 * With one configured it maps the provider's answer onto a single shape. The
 * shape matters more than it looks: three forms read this, and two of them were
 * reading a nested `address` the route never returned — so the portal fill
 * silently did nothing on the company and customer forms while working on
 * vendors. These hold that shape still.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

/*
 * A distinct number per test that reaches the provider, because the route
 * caches by GSTIN for ten minutes — which is the point of the cache, and would
 * otherwise have one test answering another's call. All four carry a real check
 * digit; the state is the first two digits.
 */
const VALID = '29AABCU9603R1ZJ'; // Karnataka
const VALID_MH = '27AABCU9603R1ZN'; // Maharashtra
const VALID_DL = '07AABCU9603R1ZP'; // Delhi
const VALID_GJ = '24AABCU9603R1ZT'; // Gujarat
const VALID_TN = '33AABCU9603R1ZU'; // Tamil Nadu
let token = '';

beforeAll(async () => {
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email: `gst.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'GST owner' })
    .expect(200);
  token = signup.body.token;
}, 60_000);

const origFetch = globalThis.fetch;
const origUrl = process.env.GSTIN_LOOKUP_URL;
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origUrl === undefined) delete process.env.GSTIN_LOOKUP_URL;
  else process.env.GSTIN_LOOKUP_URL = origUrl;
});

const look = (gstin: string) =>
  request(app).get(`/api/gstin/${gstin}`).set('Authorization', `Bearer ${token}`);

describe('without a portal configured', () => {
  it('still returns what the number encodes', async () => {
    delete process.env.GSTIN_LOOKUP_URL;
    const res = await look(VALID).expect(200);
    expect(res.body.source).toBe('derived');
    expect(res.body.state).toBe('Karnataka');
    expect(res.body.pan).toBe('AABCU9603R');
  });

  it('refuses a number that fails its own check digit', async () => {
    delete process.env.GSTIN_LOOKUP_URL;
    const res = await look('29AABCU9603R1ZZ').expect(400);
    expect(String(res.body.error)).toMatch(/check digit/i);
  });
});

describe('with a portal configured', () => {
  /* The GSTN field names, which is what a real provider passes through. */
  const gstnStyle = {
    lgnm: 'KNOCKBELL LOGISTICS PRIVATE LIMITED',
    tradeNam: 'Knockbell',
    sts: 'Active',
    dty: 'Regular',
    pradr: { addr: { bno: '12', st: 'MG Road', loc: 'Indiranagar', dst: 'Bengaluru Urban', stcd: 'Karnataka', pncd: '560038' } },
  };

  it('maps the provider onto the one shape every form reads', async () => {
    process.env.GSTIN_LOOKUP_URL = 'https://provider.example/gstin/{gstin}';
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => gstnStyle })) as any;

    const res = await look(VALID).expect(200);
    expect(res.body.source).toBe('portal');
    expect(res.body.legalName).toBe('KNOCKBELL LOGISTICS PRIVATE LIMITED');
    expect(res.body.tradeName).toBe('Knockbell');

    /* Nested — the shape the company, customer and vendor forms all read. */
    expect(res.body.address).toMatchObject({
      line1: '12, MG Road, Indiranagar',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
      pincode: '560038',
    });
  });

  /*
   * Where the provider and the number disagree about the state, the number
   * wins. Its first two digits ARE the state, and that decision drives
   * CGST/SGST against IGST on every invoice that follows.
   */
  it('trusts the number over the provider on the state', async () => {
    process.env.GSTIN_LOOKUP_URL = 'https://provider.example/gstin/{gstin}';
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...gstnStyle, pradr: { addr: { ...gstnStyle.pradr.addr, stcd: 'Maharashtra' } } }),
    })) as any;

    // A Tamil Nadu number (33) against a provider insisting on Maharashtra.
    const res = await look(VALID_TN).expect(200);
    expect(res.body.state).toBe('Tamil Nadu');
  });

  it('falls back to the derived answer when the provider is down', async () => {
    process.env.GSTIN_LOOKUP_URL = 'https://provider.example/gstin/{gstin}';
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    const res = await look(VALID_DL).expect(502);
    // Still useful: the state and PAN the number itself carries.
    expect(res.body.state).toBe('Delhi');
    expect(res.body.pan).toBe('AABCU9603R');
    expect(String(res.body.error)).toMatch(/could not be reached/i);
  });

  /* These lookups are billed per call and a person fixing a typo presses the button repeatedly. */
  it('does not call the provider twice for the same number', async () => {
    process.env.GSTIN_LOOKUP_URL = 'https://provider.example/gstin/{gstin}';
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => gstnStyle } as any;
    }) as any;

    const fresh = VALID_GJ;
    await look(fresh);
    await look(fresh);
    expect(calls).toBe(1);
  });
});
