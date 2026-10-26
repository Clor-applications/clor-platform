import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

/**
 * Reader IDs per site: two sites that gave the same number to different
 * people, each site's readers knowing their own (services/attendance/readerIds.ts).
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `site.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Reader owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Site Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  if (Object.keys(features).length) await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

/** What a reader sends. */
const reader = (sn: string) => ({
  handshake: () => request(app).get(`/iclock/cdata?SN=${sn}&options=all&pushver=2.4.1&language=69`),
  heartbeat: (info?: string) => request(app).get(`/iclock/getrequest?SN=${sn}${info ? `&INFO=${encodeURIComponent(info)}` : ''}`),
  push: (lines: string[], table = 'ATTLOG') =>
    request(app).post(`/iclock/cdata?SN=${sn}&table=${table}&Stamp=9999`).set('Content-Type', 'text/plain').send(lines.join('\n')),
  result: (body: string) => request(app).post(`/iclock/devicecmd?SN=${sn}`).set('Content-Type', 'text/plain').send(body),
});
const serial = () => `TST${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
const addReader = async (c: Ctx, sn: string, direction = 'both') =>
  (await api(c).post('/devices', { serialNumber: sn, name: `Gate ${sn.slice(-4)}`, direction }).expect(201)).body;
const day = async (c: Ctx, employeeId: string, date: string) =>
  (await api(c).get(`/records?from=${date}&to=${date}&employeeId=${employeeId}`).expect(200)).body.records[0];


const area = async (c: Ctx, name: string) => (await request(app).post(`/api/orgs/${c.orgId}/people/structure/areas`).set(at(c)).send({ name }).expect(201)).body.item;
const siteReader = async (c: Ctx, areaId: string) => {
  const sn = serial();
  const d = (await addReader(c, sn)).device;
  await api(c).put(`/devices/${d.id}`, { name: `Gate ${sn.slice(-4)}`, direction: 'both', areaId }).expect(200);
  return { sn, id: d.id };
};
const queued = async (deviceId: string) => (await peoplePrisma.deviceCommand.findMany({ where: { deviceId, status: 'PENDING' }, orderBy: { id: 'asc' } })).map((x) => x.command.split('\t')[0]);

describe('reader IDs per site', () => {
  it('lets two sites use the same ID for different people, each site punching its own person', async () => {
    const c = await makeOwner();
    const factory = await area(c, 'Factory');
    const depot = await area(c, 'Depot');
    const fr = await siteReader(c, factory.id);
    const dr = await siteReader(c, depot.id);
    const ravi = await person(c, { name: 'Ravi', code: '105', areaId: factory.id });
    const sita = await person(c, { name: 'Sita', code: 'D-9', areaId: depot.id });

    /* 105 is Ravi's company-wide ID and Ravi works at the factory: nobody else may take it there. */
    expect((await api(c).put(`/employees/${sita.id}/reader-ids`, { sites: [{ areaId: factory.id, pin: '105' }] }).expect(409)).body.error).toMatch(/Ravi/);
    await peoplePrisma.deviceCommand.deleteMany({ where: { orgId: c.orgId } });
    const saved = (await api(c).put(`/employees/${sita.id}/reader-ids`, { sites: [{ areaId: depot.id, pin: '105' }] }).expect(200)).body;
    expect(saved).toMatchObject({ companyId: 'D-9', changed: 1, sites: [{ areaId: depot.id, pin: '105' }] });
    /* The depot reader drops D-9 and gets Sita as 105; the factory reader is not touched. */
    const atDepot = (await peoplePrisma.deviceCommand.findMany({ where: { deviceId: dr.id, status: 'PENDING' } })).map((x) => x.command);
    expect(atDepot.some((x) => /^DATA DELETE USERINFO PIN=D-9/.test(x))).toBe(true);
    expect(atDepot.some((x) => /^DATA UPDATE USERINFO PIN=105\tName=Sita/.test(x))).toBe(true);
    expect(await queued(fr.id)).toEqual([]);

    /* The same second at both gates: two people, two punches. */
    await reader(fr.sn).push(['105\t2026-09-01 09:00:00\t0\t1']).expect(200);
    await reader(dr.sn).push(['105\t2026-09-01 09:00:00\t0\t1']).expect(200);
    const punches = await peoplePrisma.devicePunch.findMany({ where: { orgId: c.orgId, pin: '105' } });
    expect(punches.map((p) => p.employeeId).sort()).toEqual([ravi.id, sita.id].sort());
    expect((await api(c).get(`/employees/${sita.id}/reader-ids`).expect(200)).body.sites).toEqual([{ areaId: depot.id, pin: '105' }]);
    expect((await api(c).get('/reader-ids/sites').expect(200)).body.sites[0]).toMatchObject({ name: 'Sita', areaName: 'Depot', pin: '105', companyId: 'D-9' });
  });

  it('drops the same person punching on two readers in the same second, but not two people', async () => {
    const c = await makeOwner();
    const a = serial();
    const b = serial();
    await addReader(c, a);
    await addReader(c, b);
    const p = await person(c, { name: 'Both Gates', code: '300' });
    await reader(a).push(['300\t2026-09-01 09:00:00\t0\t1']).expect(200);
    await reader(b).push(['300\t2026-09-01 09:00:00\t0\t1']).expect(200);
    await reader(a).push(['300\t2026-09-01 09:00:00\t0\t1']).expect(200);
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, employeeId: p.id } })).toBe(1);
  });

  it('lists an unknown ID once per site and can match it at one site only', async () => {
    const c = await makeOwner();
    const factory = await area(c, 'Factory');
    const depot = await area(c, 'Depot');
    const fr = await siteReader(c, factory.id);
    const dr = await siteReader(c, depot.id);
    const kiran = await person(c, { name: 'Kiran', code: 'K1', areaId: depot.id });
    await reader(fr.sn).push(['777\t2026-09-01 09:00:00\t0\t1']).expect(200);
    await reader(dr.sn).push(['777\t2026-09-01 09:05:00\t0\t1', '777\t2026-09-01 18:05:00\t1\t1']).expect(200);
    const list = (await api(c).get('/punches/unmatched').expect(200)).body.pins;
    expect(list.map((x: any) => `${x.areaName}:${x.punches}`).sort()).toEqual(['Depot:2', 'Factory:1']);
    expect((await api(c).get('/mapping-audit').expect(200)).body.unmatched.filter((u: any) => u.pin === '777')).toHaveLength(2);

    const r = (await api(c).post('/punches/match', { pin: '777', employeeId: kiran.id, areaId: depot.id }).expect(200)).body;
    expect(r.matched).toBe(2);
    /* The factory's 777 is still nobody's; Kiran keeps K1 elsewhere. */
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, deviceId: fr.id, employeeId: null } })).toBe(1);
    expect((await peoplePrisma.employee.findUnique({ where: { id: kiran.id } }))!.devicePin).toBeNull();
    await reader(dr.sn).push(['777\t2026-09-02 09:01:00\t0\t1']).expect(200);
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, employeeId: kiran.id } })).toBe(3);
  });

  it('takes a leaver off only under the IDs that are theirs at each site', async () => {
    const c = await makeOwner();
    const factory = await area(c, 'Factory');
    const depot = await area(c, 'Depot');
    const fr = await siteReader(c, factory.id);
    const dr = await siteReader(c, depot.id);
    const ravi = await person(c, { name: 'Ravi', code: '105', areaId: factory.id });
    const sita = await person(c, { name: 'Sita', code: 'D-9', areaId: depot.id });
    await api(c).put(`/employees/${sita.id}/reader-ids`, { sites: [{ areaId: depot.id, pin: '105' }] }).expect(200);
    await peoplePrisma.deviceCommand.deleteMany({ where: { orgId: c.orgId } });
    await request(app).post(`/api/orgs/${c.orgId}/people/employees/${ravi.id}/resign`).set(at(c)).send({ lastDay: '2026-09-30', leavingType: 'RESIGNED' }).expect(200);
    const fCmds = (await peoplePrisma.deviceCommand.findMany({ where: { deviceId: fr.id } })).map((x) => x.command);
    const dCmds = (await peoplePrisma.deviceCommand.findMany({ where: { deviceId: dr.id } })).map((x) => x.command);
    expect(fCmds.some((x) => /PIN=105/.test(x) && /DELETE/.test(x))).toBe(true);
    /* At the depot 105 is Sita: never removed because Ravi left. */
    expect(dCmds.some((x) => /PIN=105/.test(x))).toBe(false);
  });
});
