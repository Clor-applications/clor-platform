import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * The on-site connector's side of CLOR: a connector made under Integrations,
 * its token fetching what to do (readers with credentials, Tally, LDAP, the
 * SCIM token once, jobs), punches it read sent up, jobs reported — and the
 * pure planning the connector does with a directory listing.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { syncAllVendorConnections } = await import('../services/attendance/vendorSync.js');
const { planLdapSync, adActive, pullWindow, readTallyReply, hikvisionTimeZone, clockOffsetSeconds, clockSetDue, localStamp } = await import('../../agent/src/plan.js');
const { assessConnector, runReaderChecks } = await import('../services/attendance/readerHealth.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
  await platformPrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `agent.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Agent Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
const agent = (token: string) => ({
  get: (p: string) => request(app).get(`/agent/v1${p}`).set('Authorization', `Bearer ${token}`),
  post: (p: string, b: unknown) => request(app).post(`/agent/v1${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

describe('an on-site connector', () => {
  it('is made with a token shown once, fetches its work, sends punches up and reports jobs', async () => {
    const c = await makeOwner();
    const made = await api(c).post('/integrations/agents', { name: 'Head office server', tally: { host: '192.168.1.20', port: 9000, company: 'Sundaram Textiles' } }).expect(201);
    expect(made.body.token).toMatch(/^clora_/);
    expect(made.body.downloadUrl).toMatch(/\/agent\/v1\/download$/);
    const id = made.body.agent.id;
    const list = await api(c).get('/integrations/agents').expect(200);
    expect(list.body.agents[0]).toMatchObject({ id, name: 'Head office server', online: false, tally: { host: '192.168.1.20', port: 9000 }, readers: [] });
    expect(JSON.stringify(list.body)).not.toContain(made.body.token);

    /* A LAN reader assigned to it: its address is private, which the cloud would refuse to call. */
    const reader = (await api(c).post('/devices', { vendor: 'HIKVISION', name: 'LAN gate', direction: 'both', baseUrl: 'http://203.0.113.5:80', username: 'admin', password: 'Secret12' }).expect(201)).body.device;
    await api(c).put(`/devices/${reader.id}`, { name: 'LAN gate', direction: 'both', baseUrl: 'http://192.168.1.64:80', agentId: id }).expect(200);
    await api(c).put(`/devices/${reader.id}`, { name: 'LAN gate', direction: 'both', agentId: 'nope' }).expect(400);
    const wrongOrg = await makeOwner();
    const theirs = (await api(wrongOrg).post('/devices', { vendor: 'HIKVISION', name: 'Other', direction: 'both', baseUrl: 'http://203.0.113.9:80', username: 'a', password: 'b' }).expect(201)).body.device;
    await api(wrongOrg).put(`/devices/${theirs.id}`, { name: 'Other', direction: 'both', agentId: id }).expect(400);

    const a = agent(made.body.token);
    await request(app).get('/agent/v1/config').expect(401);
    await agent('clora_' + 'x'.repeat(32)).get('/config').expect(401);
    const cfg = await a.get('/config?version=1.0.0&hostname=HO-SRV').expect(200);
    expect(cfg.body.agent).toMatchObject({ id, pollSeconds: 60 });
    expect(cfg.body.readers).toHaveLength(1);
    expect(cfg.body.readers[0]).toMatchObject({ id: reader.id, vendor: 'HIKVISION', baseUrl: 'http://192.168.1.64:80', username: 'admin', password: 'Secret12', zone: 'Asia/Kolkata' });
    expect(cfg.body.tally).toEqual({ host: '192.168.1.20', port: 9000, company: 'Sundaram Textiles' });
    expect(cfg.body.ldap).toBeNull();
    expect(cfg.body.jobs).toEqual([]);
    const after = (await api(c).get('/integrations/agents').expect(200)).body.agents[0];
    expect(after).toMatchObject({ online: true, version: '1.0.0', hostname: 'HO-SRV' });
    expect(after.readers.map((r: any) => r.id)).toEqual([reader.id]);

    /* The cloud's own pull leaves that reader alone. */
    const synced = await syncAllVendorConnections();
    expect((await peoplePrisma.attendanceDevice.findUnique({ where: { id: reader.id } }))?.lastError).toBeNull();
    /* At least the other company's reader. Not an exact count of the whole
       database: test files run in parallel and add readers of their own
       between the pull and a count, which failed this on CI (2 vs 1). The two
       readers above say what this test is about. */
    expect(synced.connections).toBeGreaterThanOrEqual(1);
    expect((await peoplePrisma.attendanceDevice.findUnique({ where: { id: theirs.id } }))?.lastError).toBeTruthy(); // the cloud did try that one

    /* Punches it read. */
    const p = await person(c, { name: 'Lan User', code: '501' });
    const up = await a.post(`/readers/${reader.id}/punches`, { ok: true, lines: ['501\t2026-09-01 09:00:00\t0\t15', '501\t2026-09-01 18:00:00\t1\t15', 'garbage'], received: 2, payload: '{"AcsEvent":1}' }).expect(200);
    expect(up.body).toEqual({ added: 2, received: 2 });
    expect(await peoplePrisma.devicePunch.count({ where: { employeeId: p.id } })).toBe(2);
    const dev = await peoplePrisma.attendanceDevice.findUnique({ where: { id: reader.id } });
    expect(dev?.lastFetchedAt).toBeTruthy();
    expect(dev?.lastPayload).toBe('{"AcsEvent":1}');
    await a.post(`/readers/${reader.id}/punches`, { ok: false, message: 'Digest refused' }).expect(200);
    expect((await peoplePrisma.attendanceDevice.findUnique({ where: { id: reader.id } }))?.lastError).toBe('Digest refused');
    await a.post(`/readers/${theirs.id}/punches`, { ok: true, lines: [] }).expect(404);

    /* Lines it kept while CLOR was out of reach: taken (repeats dropped), but the reader's cursor and error stay as they were. */
    const before = await peoplePrisma.attendanceDevice.findUnique({ where: { id: reader.id } });
    const replay = await a.post(`/readers/${reader.id}/punches`, { ok: true, replay: true, lines: ['501\t2026-09-01 09:00:00\t0\t15', '501\t2026-09-02 09:00:00\t0\t15'], received: 2 }).expect(200);
    expect(replay.body).toEqual({ added: 1, received: 2 });
    const afterReplay = await peoplePrisma.attendanceDevice.findUnique({ where: { id: reader.id } });
    expect(afterReplay?.lastFetchedAt?.getTime()).toBe(before?.lastFetchedAt?.getTime());
    expect(afterReplay?.lastError).toBe('Digest refused');

    /* Its clock, as the connector read it: drift recorded; a set clears it and is logged. */
    await a.post(`/readers/${reader.id}/clock`, { offsetSec: 95 }).expect(200);
    expect((await peoplePrisma.attendanceDevice.findUnique({ where: { id: reader.id } }))?.clockOffsetSec).toBe(95);
    expect((await a.get('/config').expect(200)).body.readers[0].clockOffsetSec).toBe(95);
    await a.post(`/readers/${reader.id}/clock`, { offsetSec: 95, set: true }).expect(200);
    expect((await peoplePrisma.attendanceDevice.findUnique({ where: { id: reader.id } }))?.clockOffsetSec).toBe(0);
    await a.post(`/readers/${reader.id}/clock`, { error: 'clock: time set answered 403' }).expect(200);
    const clockLogs = await peoplePrisma.deviceLog.findMany({ where: { deviceId: reader.id, code: 'CLOCK_SET' }, orderBy: { id: 'asc' } });
    expect(clockLogs.map((l) => l.kind)).toEqual(['OPERATION', 'ERROR']);
    await a.post(`/readers/${theirs.id}/clock`, { offsetSec: 1 }).expect(404);

    /* A connector that goes quiet is an alert like a reader's; one checking in is not. */
    await peoplePrisma.siteAgent.update({ where: { id }, data: { lastSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
    await runReaderChecks();
    const alert = await peoplePrisma.readerAlert.findFirst({ where: { orgId: c.orgId, key: `connector:${id}`, resolvedAt: null } });
    expect(alert).toMatchObject({ kind: 'connector', severity: 'high' });
    expect(alert?.details).toMatch(/1 reader behind it is not being read/);
    await a.get('/config').expect(200);
    await runReaderChecks();
    expect((await peoplePrisma.readerAlert.findFirst({ where: { orgId: c.orgId, key: `connector:${id}` } }))?.resolvedAt).toBeTruthy();

    /* A job queued for it goes out once, then its result comes back. */
    const job = await peoplePrisma.agentJob.create({ data: { accountId: dev!.accountId, orgId: c.orgId, agentId: id, kind: 'TALLY_XML', payloadJson: JSON.stringify({ label: 'Payroll Oct → Tally', xml: '<ENVELOPE/>' }), createdByUserId: 'test' } });
    const cfg2 = await a.get('/config').expect(200);
    expect(cfg2.body.jobs).toEqual([{ id: job.id, kind: 'TALLY_XML', payload: { label: 'Payroll Oct → Tally', xml: '<ENVELOPE/>' } }]);
    expect((await a.get('/config').expect(200)).body.jobs).toEqual([]);
    await a.post(`/jobs/${job.id}/result`, { ok: true, result: 'Tally took it (1 created, 0 altered).' }).expect(200);
    expect((await peoplePrisma.agentJob.findUnique({ where: { id: job.id } }))).toMatchObject({ status: 'DONE', attempts: 1, result: 'Tally took it (1 created, 0 altered).' });
    const jobs = (await api(c).get(`/integrations/agents/${id}/jobs`).expect(200)).body.jobs;
    expect(jobs[0]).toMatchObject({ id: job.id, status: 'DONE', label: 'Payroll Oct → Tally' });
    await a.post('/report', { summary: 'LAN gate: 2 read, 2 new', error: null, spooled: 0 }).expect(200);
    expect((await api(c).get('/integrations/agents').expect(200)).body.agents[0].lastSummary).toBe('LAN gate: 2 read, 2 new');

    /* Switched off: refused; rotated: the old token dies; removed: readers come back to the cloud. */
    await api(c).put(`/integrations/agents/${id}`, { name: 'Head office server', isActive: false }).expect(200);
    await a.get('/config').expect(403);
    await api(c).put(`/integrations/agents/${id}`, { name: 'Head office server', isActive: true }).expect(200);
    const rotated = (await api(c).post(`/integrations/agents/${id}/rotate`).expect(200)).body;
    await a.get('/config').expect(401);
    await agent(rotated.token).get('/config').expect(200);
    await api(c).del(`/integrations/agents/${id}`).expect(200);
    expect((await peoplePrisma.attendanceDevice.findUnique({ where: { id: reader.id } }))?.agentId).toBeNull();
    await agent(rotated.token).get('/config').expect(401);
  });

  it('is handed a SCIM token once when LDAP is set, and keeps the bind password to itself', async () => {
    const c = await makeOwner();
    const made = await api(c).post('/integrations/agents', { name: 'DC sync', ldap: { url: 'ldaps://dc1.corp.local', bindDn: 'CN=svc-clor,OU=Service,DC=corp,DC=local', bindPassword: 'bindpw', baseDn: 'DC=corp,DC=local', deactivateMissing: true } }).expect(201);
    expect(made.body.agent.ldap).toMatchObject({ url: 'ldaps://dc1.corp.local', passwordSet: true, deactivateMissing: true });
    expect(made.body.agent.scimPending).toBe(true);
    expect(JSON.stringify(made.body)).not.toContain('bindpw');
    const a = agent(made.body.token);
    const first = await a.get('/config').expect(200);
    expect(first.body.once.scimToken).toMatch(/^clors_/);
    expect(first.body.ldap).toMatchObject({ url: 'ldaps://dc1.corp.local', bindDn: 'CN=svc-clor,OU=Service,DC=corp,DC=local', bindPassword: 'bindpw', baseDn: 'DC=corp,DC=local', scimBase: expect.stringMatching(/\/scim\/v2$/) });
    expect((await a.get('/config').expect(200)).body.once).toEqual({});
    /* The SCIM token works, for this organisation, and dies with the connector. */
    const scimToken = first.body.once.scimToken;
    expect((await request(app).get('/scim/v2/Users').set('Authorization', `Bearer ${scimToken}`).expect(200)).body.totalResults).toBe(1);
    expect((await request(app).get(`/api/orgs/${c.orgId}/security/scim`).set(at(c)).expect(200)).body.tokens).toHaveLength(1);
    await api(c).post('/integrations/agents', { name: 'Bad', ldap: { url: 'http://x', bindDn: 'a', baseDn: 'b' } }).expect(400);
    /* Directory sync may not hand out an administrator role, nor a role of another organisation. */
    const adminRole = await platformPrisma.role.findFirst({ where: { orgId: c.orgId, roleType: 'ADMIN' }, select: { id: true } });
    expect((await api(c).post('/integrations/agents', { name: 'Escalate', ldap: { url: 'ldaps://dc', bindDn: 'a', bindPassword: 'b', baseDn: 'c', defaultRoleId: adminRole!.id } }).expect(400)).body.error).toMatch(/administrator role/);
    const elsewhere = await makeOwner();
    const foreign = await platformPrisma.role.findFirst({ where: { orgId: elsewhere.orgId }, select: { id: true } });
    expect((await api(c).post('/integrations/agents', { name: 'Foreign', ldap: { url: 'ldaps://dc', bindDn: 'a', bindPassword: 'b', baseDn: 'c', defaultRoleId: foreign!.id } }).expect(400)).body.error).toMatch(/not in this organisation/);
    await api(c).del(`/integrations/agents/${made.body.agent.id}`).expect(200);
    await request(app).get('/scim/v2/Users').set('Authorization', `Bearer ${scimToken}`).expect(401);
  });

  it('offers its download only when built', async () => {
    const r = await request(app).get('/agent/v1/download');
    expect([200, 404]).toContain(r.status);
    if (r.status === 200) expect(r.text).toContain('CLOR connector');
  });
});

describe('what the connector decides on its own', () => {
  it('plans a directory sync without touching people it did not make', () => {
    const directory = [
      { email: 'new@corp.local', name: 'New Person', active: true },
      { email: 'disabled-new@corp.local', name: 'Never Came', active: false },
      { email: 'left@corp.local', name: 'Left Person', active: false },
      { email: 'same@corp.local', name: 'Same Person', active: true },
      { email: 'renamed@corp.local', name: 'Re Named', active: true },
      { email: 'SAME@corp.local', name: 'Dup', active: true },
    ];
    const scim = [
      { id: 'u1', userName: 'left@corp.local', active: true, name: { formatted: 'Left Person' } },
      { id: 'u2', userName: 'same@corp.local', active: true, name: { formatted: 'Same Person' } },
      { id: 'u3', userName: 'renamed@corp.local', active: true, name: { formatted: 'Old Name' } },
      { id: 'u4', userName: 'owner@corp.local', active: true, name: { formatted: 'The Owner' } },
      { id: 'u5', userName: 'gone@corp.local', active: true, name: { formatted: 'Made By Agent' } },
    ];
    const plan = planLdapSync(directory, scim, new Set(['gone@corp.local']), true);
    expect(plan.create).toEqual([{ email: 'new@corp.local', name: 'New Person', active: true }]);
    expect(plan.setActive).toEqual([
      { id: 'u1', email: 'left@corp.local', active: false },
      { id: 'u5', email: 'gone@corp.local', active: false },
    ]);
    expect(plan.rename).toEqual([{ id: 'u3', email: 'renamed@corp.local', name: 'Re Named' }]);
    expect(plan.unchanged).toBe(1);
    /* Without deactivateMissing, nobody absent from the directory is touched. */
    expect(planLdapSync(directory, scim, new Set(['gone@corp.local']), false).setActive).toEqual([{ id: 'u1', email: 'left@corp.local', active: false }]);
  });
  it('judges connectors', () => {
    const now = new Date();
    const base = { id: 'a', name: 'HQ', isActive: true, lastSeenAt: now, readers: 2, lastError: null };
    expect(assessConnector(base, now, { offlineMinutes: 30 })).toEqual([]);
    expect(assessConnector({ ...base, lastSeenAt: null }, now, { offlineMinutes: 30 })[0]).toMatchObject({ kind: 'connector', severity: 'medium' });
    expect(assessConnector({ ...base, lastSeenAt: new Date(now.getTime() - 31 * 60_000) }, now, { offlineMinutes: 30 })[0]).toMatchObject({ kind: 'connector', severity: 'high', details: expect.stringMatching(/2 readers behind it are not being read/) });
    expect(assessConnector({ ...base, lastError: 'LDAP: bind failed' }, now, { offlineMinutes: 30 })[0]).toMatchObject({ kind: 'connector-error' });
    expect(assessConnector({ ...base, isActive: false, lastSeenAt: null }, now, { offlineMinutes: 30 })).toEqual([]);
  });
  it('reads reader clocks the way Hikvision and Dahua write them', () => {
    expect(hikvisionTimeZone(330)).toBe('CST-5:30:00');
    expect(hikvisionTimeZone(-300)).toBe('CST+5:00:00');
    expect(hikvisionTimeZone(0)).toBe('CST+0:00:00');
    const now = new Date('2026-10-18T04:30:00Z');
    expect(clockOffsetSeconds('2026-10-18T10:01:30+05:30', 'Asia/Kolkata', now)).toBe(90);
    expect(clockOffsetSeconds('2026-10-18 09:59:00', 'Asia/Kolkata', now)).toBe(-60);
    expect(clockOffsetSeconds('2026-10-18T08:30:00Z', 'Asia/Dubai', now)).toBe(14_400);
    expect(clockOffsetSeconds('garbage', 'Asia/Kolkata', now)).toBeNull();
    expect(localStamp(now, 'Asia/Kolkata')).toBe('2026-10-18T10:00:00');
    expect(clockSetDue(30, null)).toBe(false);
    expect(clockSetDue(90, null)).toBe(true);
    expect(clockSetDue(90, Date.now() - 60_000)).toBe(false);
    expect(clockSetDue(-90, Date.now() - 11 * 60_000)).toBe(true);
  });
  it('reads AD flags, pull windows and Tally replies', () => {
    expect(adActive(512)).toBe(true);
    expect(adActive(514)).toBe(false);
    expect(adActive('66050')).toBe(false);
    expect(adActive(undefined)).toBe(true);
    const w = pullWindow('2026-10-18T04:00:00.000Z', new Date('2026-10-18T04:30:00.000Z'));
    expect(w.from.toISOString()).toBe('2026-10-18T03:50:00.000Z');
    expect(pullWindow(null, new Date('2026-10-18T04:30:00.000Z')).from.toISOString()).toBe('2026-10-17T18:30:00.000Z');
    expect(readTallyReply('<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS></RESPONSE>')).toEqual({ ok: true, message: 'Tally took it (1 created, 0 altered).' });
    expect(readTallyReply('<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger \'Salaries\' does not exist!</LINEERROR></RESPONSE>')).toMatchObject({ ok: false, message: expect.stringMatching(/does not exist/) });
    expect(readTallyReply('<html>Unknown Request, cannot be processed</html>').ok).toBe(false);
  });
});

describe('the connector download', () => {
  it('serves the signature beside the file, and says so plainly when there is none', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sigFile = path.resolve(process.cwd(), 'dist-agent/clor-agent.cjs.sig');
    const kept = fs.existsSync(sigFile) ? fs.readFileSync(sigFile) : null;
    try {
      fs.rmSync(sigFile, { force: true });
      const none = await request(app).get('/agent/v1/download.sig').expect(404);
      expect(none.body.error).toMatch(/not signed/);
      fs.mkdirSync(path.dirname(sigFile), { recursive: true });
      fs.writeFileSync(sigFile, 'c2lnbmF0dXJl\n');
      /* No token needed, like the download itself. */
      const got = await request(app).get('/agent/v1/download.sig').expect(200);
      expect(got.text).toBe('c2lnbmF0dXJl\n');
      expect(got.headers['content-type']).toMatch(/text\/plain/);
    } finally {
      if (kept) fs.writeFileSync(sigFile, kept);
      else fs.rmSync(sigFile, { force: true });
    }
  });
});
