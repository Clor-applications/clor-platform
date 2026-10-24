import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

import { buildApp } from '../app.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/*
 * A-29: punches sent with an API key were recorded under a "reader" found by
 * a global serial, API-<the key's first characters>, with `update: {}`. A
 * reader of that serial already claimed by another company was used as it
 * was, and ingest wrote the punches under that reader's company. The key's
 * prefix is shown on its owner's screen; the serial pattern for claiming a
 * reader allowed "API-…". One company could take another's punches.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function company(label: string): Promise<Ctx> {
  const email = `pr.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `PR ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}

const person = (c: Ctx, code: string) =>
  request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2026-01-01' }).expect(201);

const newKey = async (c: Ctx) =>
  (await request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/keys`).set(at(c)).send({ name: `Key ${rnd()}`, scopes: ['punches:write'] }).expect(201)).body.token as string;

const serialFor = (token: string) => `API-${token.slice(0, 12).replace(/[^A-Za-z0-9]/g, '')}`;

const punchesIn = (orgId: string) => outsideTenant('test: count punches', () => peoplePrisma.devicePunch.count({ where: { orgId } }));

describe("an API key's punches", () => {
  it('cannot be claimed as a reader by another company', async () => {
    const mine = await company('mine');
    const theirs = await company('theirs');
    const token = await newKey(mine);
    const res = await request(app).post(`/api/orgs/${theirs.orgId}/attendance/devices`).set(at(theirs)).send({ serialNumber: serialFor(token), name: 'Squatted', direction: 'both' });
    expect(res.status).toBe(400);
  });

  it("land in the key's own company even when its serial was taken first", async () => {
    const mine = await company('mine2');
    const theirs = await company('theirs2');
    await person(mine, '901');
    await person(theirs, '901');
    const token = await newKey(mine);
    /* A reader of that serial in the other company — as the old claim route allowed. */
    const squat = await outsideTenant('test: squat a serial', () =>
      peoplePrisma.attendanceDevice.create({ data: { accountId: 'squatter', orgId: theirs.orgId, serialNumber: serialFor(token), name: 'Squatted', vendor: 'ZK', createdByUserId: 'squatter' } })
    );
    const theirsBefore = await punchesIn(theirs.orgId);
    await request(app).post('/v1/attendance/punches').set('Authorization', `Bearer ${token}`).send({ employee_code: '901', timestamp: '2026-09-21 09:15:00' }).expect(200);
    expect(await punchesIn(theirs.orgId)).toBe(theirsBefore);
    expect(await punchesIn(mine.orgId)).toBe(1);
    const own = await outsideTenant('test: read the key', () => peoplePrisma.apiClient.findFirst({ where: { orgId: mine.orgId }, select: { deviceId: true } }));
    expect(own?.deviceId).toBeTruthy();
    expect(own?.deviceId).not.toBe(squat.id);
  });
});
