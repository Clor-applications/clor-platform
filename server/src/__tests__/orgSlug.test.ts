import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { normaliseSlug, slugProblem, slugUnavailableReason, suggestSlug, RESERVED_SLUGS } from '../services/slug.js';

/**
 * The public handle for a company — the `agc` in agc.books.neevone.com.
 *
 * Two identifiers on purpose. The cuid `id` carries every foreign key and every
 * authorisation check and never changes; the slug is what a person reads in a
 * URL and quotes to support, and is the one that will eventually have to change
 * for somebody. Conflating them is how renaming a company breaks its own
 * foreign keys.
 *
 * The original idea was the first three letters of the name. That collides
 * immediately — AGC Traders and AGC Exports both give `agc`, and so does
 * Agarwal Consultants — which in a product aimed at Indian SMEs, where a family
 * of firms shares a prefix by design, is the first week rather than an edge
 * case.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

describe('shaping a slug', () => {
  it('lowercases and hyphenates a company name', () => {
    expect(normaliseSlug('AGC Traders Pvt. Ltd.')).toBe('agc-traders-pvt-ltd');
    expect(normaliseSlug('  Sunrise   &   Sons  ')).toBe('sunrise-sons');
  });

  it('never starts or ends with a hyphen, however the name is punctuated', () => {
    expect(normaliseSlug('...Moonrise...')).toBe('moonrise');
    expect(normaliseSlug('& Co.')).toBe('co');
  });

  it('refuses what cannot be a hostname, in words a person can act on', () => {
    expect(slugProblem('ab')).toMatch(/at least/i);
    expect(slugProblem('AGC')).toMatch(/lowercase/i);
    expect(slugProblem('agc traders')).toMatch(/lowercase/i);
    expect(slugProblem('12345')).toMatch(/letter/i);
    expect(slugProblem('agc-traders')).toBeNull();
  });

  /*
   * A tenant called `api` would take the API's own subdomain, and one called
   * `sales` would take a path we will want.
   */
  it('reserves the hostnames we serve and the ones we will want', () => {
    for (const word of ['api', 'www', 'admin', 'billing', 'sales', 'books']) {
      expect(`${word}:${slugProblem(word)}`).toBe(`${word}:That name is reserved.`);
    }
    expect(RESERVED_SLUGS.has('login')).toBe(true);
  });
});

/*
 * Orgs are made through the real signup flow rather than by inserting rows:
 * Org has foreign keys to both Account and User, and a hand-built row is a
 * different shape from the one the product actually creates.
 */
const makeCompany = async (companyName: string) => {
  const email = `slug.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Slug owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName, state: 'Karnataka' })
    .expect(200);
  return { orgId: setup.body.company.orgId as string, slug: setup.body.company.slug as string };
};

describe('choosing a free slug', () => {
  it('gives two companies sharing a prefix different handles', async () => {
    const name = `AGC Traders ${rnd()}`;
    const first = await makeCompany(name);
    // A second company deriving the same slug must not get the same handle.
    const second = await suggestSlug(first.slug);
    expect(second).not.toBe(first.slug);
    expect(await slugUnavailableReason(first.slug)).toMatch(/taken/i);
    expect(await slugUnavailableReason(second)).toBeNull();
  });

  it('pads a name too short to be a hostname', async () => {
    const s = await suggestSlug('AB');
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(slugProblem(s)).toBeNull();
  });

  it('lets an org keep its own slug when it is the one editing', async () => {
    const { orgId, slug } = await makeCompany(`Keeps Its Own ${rnd()}`);
    expect(await slugUnavailableReason(slug, orgId)).toBeNull();
    expect(await slugUnavailableReason(slug, 'someone-else')).toMatch(/taken/i);
  });
});

describe('a company created through signup', () => {
  it('is given a handle, and it is usable as a hostname', async () => {
    const email = `slug.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'Passw0rd!23', name: 'Slug owner' })
      .expect(200);
    const setup = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .send({ companyName: `AGC Traders ${rnd()}`, state: 'Karnataka' })
      .expect(200);

    const slug = setup.body.company.slug as string;
    expect(slug).toBeTruthy();
    expect(slug.startsWith('agc-traders')).toBe(true);
    expect(slugProblem(slug)).toBeNull();

    const stored = await platformPrisma.org.findUnique({ where: { id: setup.body.company.orgId } });
    expect(stored?.slug).toBe(slug);
  });
});
