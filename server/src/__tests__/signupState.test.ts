import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * The state a business registers in, captured at signup.
 *
 * It used to be hard-coded: every organisation created through the product was
 * born in Karnataka, whatever the owner typed, because the field was never
 * asked for. That is not a cosmetic default. The head office state decides
 * whether a sale inside the state splits into CGST + SGST or leaves as IGST,
 * so a business in Maharashtra billing a customer in Maharashtra was charging
 * the wrong tax on its first invoice and every one after it, with nothing on
 * screen to say why.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

const rnd = () => Math.random().toString(36).slice(2, 8);

async function newOwner() {
  const email = `st.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'State owner' })
    .expect(200);
  return signup.body.token as string;
}

const setup = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('setup-company captures where the business is', () => {
  it('stores the state that was chosen, not a default', async () => {
    const token = await newOwner();
    const res = await setup(token, { companyName: `Maha Co ${Date.now()}-${rnd()}`, state: 'Maharashtra' }).expect(200);

    const branch = await platformPrisma.branch.findUnique({
      where: { id: res.body.branch.id },
      select: { state: true, gstin: true, gstRegistrationType: true },
    });
    expect(branch?.state).toBe('Maharashtra');
    expect(branch?.state).not.toBe('Karnataka');
    // No GSTIN given, so the business is not claiming registration.
    expect(branch?.gstin).toBeNull();
    expect(branch?.gstRegistrationType).toBe('UNREGISTERED');
  });

  it('refuses a state it does not recognise rather than guessing one', async () => {
    const token = await newOwner();
    await setup(token, { companyName: `Nowhere ${Date.now()}-${rnd()}`, state: 'Atlantis' }).expect(400);
  });

  it('requires a state at all', async () => {
    const token = await newOwner();
    await setup(token, { companyName: `Stateless ${Date.now()}-${rnd()}` }).expect(400);
  });

  /*
   * A GSTIN carries its own state in the first two digits. If it disagrees
   * with the state chosen, one of the two is wrong and the tenant should not
   * be created with either.
   */
  it('rejects a GSTIN whose state contradicts the one chosen', async () => {
    const token = await newOwner();
    const res = await setup(token, {
      companyName: `Mismatch ${Date.now()}-${rnd()}`,
      state: 'Maharashtra', // 27
      gstin: '29AABCU9603R1ZJ', // 29 — Karnataka
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/does not match|state/i);
  });

  it('marks a business registered once it supplies a valid GSTIN', async () => {
    const token = await newOwner();
    const res = await setup(token, {
      companyName: `Reg Co ${Date.now()}-${rnd()}`,
      state: 'Karnataka',
      gstin: '29AABCU9603R1ZJ',
    }).expect(200);

    const branch = await platformPrisma.branch.findUnique({
      where: { id: res.body.branch.id },
      select: { state: true, gstin: true, gstRegistrationType: true },
    });
    expect(branch?.state).toBe('Karnataka');
    expect(branch?.gstin).toBe('29AABCU9603R1ZJ');
    expect(branch?.gstRegistrationType).toBe('REGULAR');
  });
});

/**
 * What signup collects, and what survives it.
 *
 * The wizard asks eleven questions about the business — trade name, entity
 * type, industries, the financial year it starts, the currency, the registered
 * address — and `setup-company` parsed all of them into a `profile` object
 * that nothing ever read. Three answers were kept and the rest were dropped on
 * the floor, so the profile screen greeted the owner empty and asked again.
 *
 * The second half is worse: the browser had no route that would tell it what
 * company it was looking at, so signing in on a new machine showed a
 * placeholder called "Company" with no GSTIN and no state, and offered to set
 * the company up from scratch. The books were on the server the whole time.
 */
describe('the company master survives signup', () => {
  it('keeps what the wizard asked for', async () => {
    const token = await newOwner();
    const res = await setup(token, {
      companyName: `Profile Co ${Date.now()}-${rnd()}`,
      state: 'Karnataka',
      profile: {
        tradeName: 'Profile Traders',
        entityType: 'Private Limited',
        industries: ['Manufacturing'],
        financialYearStart: '04-01',
        baseCurrency: 'INR',
        regCity: 'Bengaluru',
        phone: '9845000000',
      },
    }).expect(200);

    const org = await platformPrisma.org.findUnique({
      where: { id: res.body.company.orgId },
      select: { profileJson: true },
    });
    const stored = JSON.parse(String(org?.profileJson || '{}'));
    expect(stored.tradeName).toBe('Profile Traders');
    expect(stored.entityType).toBe('Private Limited');
    expect(stored.industries).toEqual(['Manufacturing']);
    expect(stored.regCity).toBe('Bengaluru');
    // State and GSTIN are stored here as well as on the branch: the branch is
    // what tax is computed from, this is what the browser reads.
    expect(stored.state).toBe('Karnataka');
  });

  it('hands the company back on the next sign-in, so nothing is set up twice', async () => {
    const token = await newOwner();
    const name = `Recall Co ${Date.now()}-${rnd()}`;
    const created = await setup(token, {
      companyName: name,
      state: 'Kerala',
      gstin: null,
      profile: { tradeName: 'Recall Traders', baseCurrency: 'INR' },
    }).expect(200);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('x-org-id', created.body.company.orgId)
      .expect(200);

    const org = me.body.orgs.find((o: any) => o.orgId === created.body.company.orgId);
    expect(org.org.name).toBe(name);
    // Parsed, not a JSON string: a browser should not be doing that.
    expect(org.org.profile.state).toBe('Kerala');
    expect(org.org.profile.tradeName).toBe('Recall Traders');
    expect(typeof org.org.slug).toBe('string');
  });
});
