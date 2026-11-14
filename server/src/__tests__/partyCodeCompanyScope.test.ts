import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { getFeatures } from '../services/features.js';

/*
 * The customer and vendor code switches follow each company's own saved code
 * formats. Two real companies rather than a stubbed client: the switches and
 * the company profile are read from the platform database.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise<void>((done) => app.close(() => done())));
const suffix = () => Math.random().toString(36).slice(2, 9);

type Company = { accountId: string; orgId: string };
let configured: Company;
let fresh: Company;

async function newCompany(label: string): Promise<Company> {
  const signup = await request(app).post('/api/auth/signup').send({ email: `codescope.${label}.${Date.now()}.${suffix()}@example.com`, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Code scope ${label} ${suffix()}`, state: 'Karnataka' }).expect(200);
  const orgId = setup.body.company.orgId as string;
  const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { accountId: true } });
  return { accountId: org.accountId, orgId };
}

beforeAll(async () => {
  configured = await newCompany('configured');
  fresh = await newCompany('fresh');
  const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: configured.orgId }, select: { profileJson: true } });
  let profile: Record<string, unknown> = {};
  try { profile = JSON.parse(org.profileJson || '{}'); } catch { /* start from an empty profile */ }
  await platformPrisma.org.update({
    where: { id: configured.orgId },
    data: { profileJson: JSON.stringify({ ...profile, partyCodeSettings: { customer: { prefix: 'CU' }, vendor: { prefix: 'VE' } } }) },
  });
}, 60_000);

it('keeps customer and vendor code switches specific to each company', async () => {
  const configuredFlags = await getFeatures(configured.accountId, configured.orgId);
  const freshFlags = await getFeatures(fresh.accountId, fresh.orgId);

  expect(configuredFlags.customerCodes).toBe(true);
  expect(configuredFlags.vendorCodes).toBe(true);
  expect(freshFlags.customerCodes).toBe(false);
  expect(freshFlags.vendorCodes).toBe(false);
});
