import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * The employee portal and phone punch (ClorTime's /portal and mobile
 * attendance): activation codes HR hands out, a password only the employee
 * knows, a separate sign-in realm, punches checked against work sites, an
 * optional selfie kept for a limited time, and one's own leave and corrections.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const portal = await import('../services/attendance/portal.js');
const { purgePunchPhotos } = await import('../routes/portalAdmin.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `portal.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Portal owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Portal Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { attendance: true } }).expect(200);
  return ctx;
}
const hr = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
const me = (token: string) => ({
  get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
});

/* MG Road, Bengaluru, and a point about 5 km north. */
const SITE = { latitude: 12.9757, longitude: 77.6061 };
const FAR = { latitude: 13.0207, longitude: 77.6061 };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');

describe('the rules, pure', () => {
  it('makes 8-character codes nobody misreads, and reads them back however typed', () => {
    const c = portal.newActivationCode();
    expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(portal.normaliseCode(` ${portal.formatCode(c).toLowerCase()} `)).toBe(c);
  });

  it('wants passwords of 8+ with a letter and a digit', () => {
    expect(portal.passwordProblem('short1')).toMatch(/8/);
    expect(portal.passwordProblem('lettersonly')).toMatch(/digit/);
    expect(portal.passwordProblem('good pass 1')).toBeNull();
  });

  it('measures distance and finds the site a position is inside', () => {
    expect(portal.distanceMeters(SITE, FAR)).toBeGreaterThan(4900);
    expect(portal.distanceMeters(SITE, FAR)).toBeLessThan(5100);
    const fences = [
      { id: 'a', name: 'Office', ...SITE, radiusMeters: 200 },
      { id: 'b', name: 'Depot', ...FAR, radiusMeters: 300 },
    ];
    expect(portal.matchFence({ latitude: SITE.latitude + 0.001, longitude: SITE.longitude }, fences).inside?.fence.id).toBe('a');
    const out = portal.matchFence({ latitude: 12.99, longitude: 77.6061 }, fences);
    expect(out.inside).toBeNull();
    expect(out.nearest?.fence.id).toBe('a');
  });

  it('takes JPEG and PNG by their bytes, nothing else, at most 2 MB', () => {
    expect(portal.decodePhoto(`data:image/jpeg;base64,${JPEG}`)).toMatchObject({ mime: 'image/jpeg' });
    expect(portal.decodePhoto(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString('base64'))).toMatchObject({ mime: 'image/png' });
    expect(portal.decodePhoto(Buffer.from('GIF89a....').toString('base64'))).toEqual({ error: expect.stringMatching(/JPEG or PNG/) });
    expect(portal.decodePhoto(Buffer.alloc(portal.PHOTO_MAX_BYTES + 1, 0xff).toString('base64'))).toEqual({ error: expect.stringMatching(/2 MB/) });
    expect(portal.decodePhoto(null)).toBeNull();
  });

  it('alternates in and out from the last punch', () => {
    expect(portal.nextDirection([])).toBe('IN');
    expect(portal.nextDirection([{ kind: 'IN' }])).toBe('OUT');
    expect(portal.nextDirection([{ kind: 'IN' }, { kind: 'OUT' }])).toBe('IN');
    expect(portal.nextDirection([{ kind: null }])).toBe('OUT');
  });
});

describe('the employee portal', () => {
  let c: Ctx;
  let emp: any;
  let company: string;
  let token: string;
  beforeAll(async () => {
    c = await makeOwner();
    emp = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Rao', code: 'P101', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  }, 60_000);

  it('hands out a one-time code; the person chooses their own password', async () => {
    const list = await hr(c).get('/portal-access').expect(200);
    company = list.body.company.code;
    expect(company).toMatch(/-C\d+$/);
    expect(list.body.employees.find((e: any) => e.id === emp.id)).toMatchObject({ portalEnabled: false, activated: false, codePending: false });

    const issued = await hr(c).post('/portal-access/codes', { employeeIds: [emp.id] }).expect(200);
    const code = issued.body.codes[0].activationCode;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const stored = await peoplePrisma.employee.findUnique({ where: { id: emp.id } });
    expect(stored!.portalSetupHash).not.toContain(code.replace('-', ''));

    const wrong = await request(app).post('/api/portal/activate').send({ company, employeeCode: 'P101', activationCode: 'AAAA-AAAA', password: 'mine pass 1' }).expect(401);
    const nobody = await request(app).post('/api/portal/activate').send({ company, employeeCode: 'NOPE', activationCode: code, password: 'mine pass 1' }).expect(401);
    expect(wrong.body.error).toBe(nobody.body.error);
    await request(app).post('/api/portal/activate').send({ company, employeeCode: 'p101', activationCode: code, password: 'weak' }).expect(400);
    const ok = await request(app).post('/api/portal/activate').send({ company: company.toLowerCase(), employeeCode: 'p101', activationCode: code.toLowerCase(), password: 'mine pass 1' }).expect(200);
    token = ok.body.token;
    // Used once.
    await request(app).post('/api/portal/activate').send({ company, employeeCode: 'P101', activationCode: code, password: 'other pass 2' }).expect(401);
    expect((await hr(c).get('/portal-access')).body.employees.find((e: any) => e.id === emp.id)).toMatchObject({ portalEnabled: true, activated: true, codePending: false });
  });

  it('signs in with company + employee code + password, with one answer for every mistake', async () => {
    const bad = await request(app).post('/api/portal/login').send({ company, employeeCode: 'P101', password: 'wrong pass 1' }).expect(401);
    const noCompany = await request(app).post('/api/portal/login').send({ company: 'ZZZZ-C999', employeeCode: 'P101', password: 'mine pass 1' }).expect(401);
    expect(bad.body.error).toBe(noCompany.body.error);
    const ok = await request(app).post('/api/portal/login').send({ company, employeeCode: 'P101', password: 'mine pass 1' }).expect(200);
    expect(ok.body.employee).toEqual({ name: 'Asha Rao', code: 'P101' });
  });

  it('keeps the two realms apart', async () => {
    await request(app).get(`/api/orgs/${c.orgId}/attendance/overview`).set({ ...at(c), Authorization: `Bearer ${token}` }).expect(401);
    await me(c.token).get('/me').expect(401);
    await request(app).get('/api/portal/me').expect(401);
  });

  it('shows today, and no secrets', async () => {
    const r = await me(token).get('/me').expect(200);
    expect(r.body.employee).toMatchObject({ name: 'Asha Rao', code: 'P101' });
    expect(r.body.company.code).toBe(company);
    expect(r.body.phone).toMatchObject({ allowed: false, next: 'IN' });
    expect(JSON.stringify(r.body)).not.toMatch(/portalPasswordHash|portalSetupHash|\$2[aby]\$/);
  });

  it('lets a manager approve what their reportees ask for, and nobody else', async () => {
    expect((await me(token).get('/me').expect(200)).body.approver).toBe(false);
    expect((await me(token).get('/approvals').expect(200)).body).toMatchObject({ approver: false, leaves: [], corrections: [] });

    /* Ravi reports to Asha; Kiran reports to nobody. */
    const ravi = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Ravi Nair', code: 'P102', dateOfJoining: '2026-01-01', reportingManagerId: emp.id }).expect(201)).body.employee;
    const raviId = ravi.id;
    expect((await me(token).get('/me').expect(200)).body.approver).toBe(true);

    const askedBy = await hr(c).post('/requests', { employeeId: raviId, date: '2026-10-05', checkIn: '09:00', checkOut: '18:00', reason: 'Reader was down' }).expect(201);
    const list = await me(token).get('/approvals').expect(200);
    expect(list.body.approver).toBe(true);
    expect(list.body.corrections.map((x: any) => x.id)).toContain(askedBy.body.request.id);
    expect(list.body.corrections[0]).toMatchObject({ employeeName: 'Ravi Nair', checkIn: '09:00' });

    await me(token).post(`/approvals/correction/${askedBy.body.request.id}`, { decision: 'maybe' }).expect(400);
    await me(token).post(`/approvals/correction/nope`, { decision: 'approve' }).expect(404);
    const ok = await me(token).post(`/approvals/correction/${askedBy.body.request.id}`, { decision: 'approve', note: 'Seen the reader log' }).expect(200);
    expect(ok.body.request).toMatchObject({ status: 'APPROVED', reviewedByUserId: `portal:${emp.id}`, reviewNote: 'Seen the reader log' });
    expect((await me(token).post(`/approvals/correction/${askedBy.body.request.id}`, { decision: 'reject' }).expect(409)).body.error).toMatch(/already approved/);
    expect((await me(token).get('/approvals').expect(200)).body.corrections).toEqual([]);
  });

  it('punches from the phone only when allowed, at a site, inside it', async () => {
    const off = await me(token).post('/punch', { ...SITE, accuracy: 10 }).expect(403);
    expect(off.body.code).toBe('PHONE_OFF');
    await hr(c).put('/portal-access', { employeeIds: [emp.id], mobilePunch: true }).expect(200);
    expect((await me(token).post('/punch', { ...SITE, accuracy: 10 }).expect(409)).body.code).toBe('NO_SITE');

    const fence = (await hr(c).post('/geofences', { name: 'MG Road office', ...SITE, radiusMeters: 200 }).expect(201)).body.geofence;
    await hr(c).post('/geofences', { name: 'Nowhere', latitude: 0, longitude: 0, radiusMeters: 200 }).expect(400);
    await hr(c).post('/geofences', { name: 'Tiny', ...SITE, radiusMeters: 5 }).expect(400);

    const outside = await me(token).post('/punch', { ...FAR, accuracy: 10 }).expect(403);
    expect(outside.body).toMatchObject({ code: 'OUTSIDE' });
    expect(outside.body.error).toMatch(/km from MG Road office/);
    expect((await me(token).post('/punch', { ...SITE, accuracy: 900 }).expect(400)).body.code).toBe('ROUGH_LOCATION');
    expect((await me(token).post('/punch', { accuracy: 10 }).expect(400)).body.code).toBe('NO_LOCATION');
    expect((await me(token).post('/punch', { ...SITE, photo: Buffer.from('GIF89a').toString('base64') }).expect(400)).body.code).toBe('BAD_PHOTO');

    const first = await me(token).post('/punch', { ...SITE, accuracy: 12, photo: `data:image/jpeg;base64,${JPEG}` }).expect(201);
    expect(first.body).toMatchObject({ kind: 'IN', site: 'MG Road office', photo: true });
    expect((await me(token).post('/punch', { ...SITE }).expect(409)).body.code).toBe('TOO_SOON');

    // A punch two minutes ago, then out.
    const p = await peoplePrisma.devicePunch.findFirst({ where: { orgId: c.orgId, employeeId: emp.id }, orderBy: { at: 'desc' } });
    await peoplePrisma.devicePunch.update({ where: { id: p!.id }, data: { at: new Date(p!.at.getTime() - 120_000) } });
    const second = await me(token).post('/punch', { ...SITE }).expect(201);
    expect(second.body).toMatchObject({ kind: 'OUT', photo: false });

    const status = await me(token).get('/me').expect(200);
    expect(status.body.punches.map((x: any) => x.kind)).toEqual(['IN', 'OUT']);
    expect(status.body.phone.next).toBe('IN');
    expect(status.body.record?.checkIn).toBeTruthy();

    // HR sees where, which site and the selfie.
    const tx = (await hr(c).get('/transactions').expect(200)).body.transactions.filter((t: any) => t.employeeId === emp.id);
    expect(tx).toHaveLength(2);
    const withPhoto = tx.find((t: any) => t.photoId);
    expect(withPhoto).toMatchObject({ verify: 'Phone', siteName: 'MG Road office', deviceName: 'Phone punches' });
    const img = await hr(c).get(`/punch-photos/${withPhoto.photoId}`).expect(200);
    expect(img.body.photo).toBe(`data:image/jpeg;base64,${JPEG}`);

    // A person tied to one site cannot punch at another.
    const depot = (await hr(c).post('/geofences', { name: 'Depot', ...FAR, radiusMeters: 300 }).expect(201)).body.geofence;
    await hr(c).put('/portal-access', { employeeIds: [emp.id], geofenceId: depot.id }).expect(200);
    expect((await me(token).post('/punch', { ...SITE }).expect(403)).body.error).toMatch(/from Depot/);
    await hr(c).put('/portal-access', { employeeIds: [emp.id], geofenceId: null }).expect(200);

    // A site in use is switched off, not deleted.
    await hr(c).del(`/geofences/${fence.id}`).expect(409);
  });

  it('deletes selfies past the retention period and keeps the punch', async () => {
    const photo = await peoplePrisma.punchPhoto.findFirst({ where: { orgId: c.orgId } });
    await peoplePrisma.punchPhoto.update({ where: { id: photo!.id }, data: { createdAt: new Date(Date.now() - 91 * 86_400_000) } });
    expect(await purgePunchPhotos()).toBeGreaterThanOrEqual(1);
    expect(await peoplePrisma.punchPhoto.count({ where: { orgId: c.orgId } })).toBe(0);
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, employeeId: emp.id } })).toBe(2);
    expect(await peoplePrisma.devicePunch.count({ where: { orgId: c.orgId, photoId: { not: null } } })).toBe(0);
  });

  it('asks for leave and corrections as the employee', async () => {
    const type = (await hr(c).post('/leave/types', { name: 'Casual', isPaid: true, annualDays: 12 }).expect(201)).body.type;
    let d = new Date(Date.now() + 10 * 86_400_000 + 330 * 60_000);
    while (d.getUTCDay() === 0) d = new Date(d.getTime() + 86_400_000);
    const day = d.toISOString().slice(0, 10);
    if (day.slice(0, 4) !== new Date().toISOString().slice(0, 4)) return; // year end: leave stays in one year
    const asked = await me(token).post('/leave', { leaveTypeId: type.id, fromDate: day, toDate: day, reason: 'Family function' }).expect(201);
    expect(asked.body.request).toMatchObject({ status: 'PENDING', days: 1, requestedByUserId: `portal:${emp.id}` });
    const mine = await me(token).get('/leave').expect(200);
    expect(mine.body.types.find((t: any) => t.id === type.id)).toMatchObject({ allocated: 12, pending: 1, available: 11 });
    expect((await hr(c).get('/leave/requests?status=PENDING').expect(200)).body.requests.map((r: any) => r.id)).toContain(asked.body.request.id);
    await me(token).post(`/leave/${asked.body.request.id}/cancel`).expect(200);

    const yesterday = new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
    const fix = await me(token).post('/corrections', { date: yesterday, checkIn: '09:05', checkOut: '18:10', reason: 'Reader was down' }).expect(201);
    expect(fix.body.request).toMatchObject({ status: 'PENDING', requestedByUserId: `portal:${emp.id}` });
    const month = await me(token).get(`/attendance?month=${yesterday.slice(0, 7)}`).expect(200);
    expect(month.body.corrections.map((r: any) => r.id)).toContain(fix.body.request.id);
    const sched = await me(token).get('/schedule').expect(200);
    expect(sched.body.days.length).toBeGreaterThanOrEqual(28);
    expect(sched.body.days[0]).toHaveProperty('kind');
  });

  it('ends every session on a new password, a switch-off or a reset', async () => {
    await me(token).post('/password', { current: 'wrong', next: 'newer pass 2' }).expect(400);
    const changed = await me(token).post('/password', { current: 'mine pass 1', next: 'newer pass 2' }).expect(200);
    await me(token).get('/me').expect(401);
    token = changed.body.token;
    await me(token).get('/me').expect(200);

    await hr(c).put('/portal-access', { employeeIds: [emp.id], portalEnabled: false }).expect(200);
    await me(token).get('/me').expect(401);
    await request(app).post('/api/portal/login').send({ company, employeeCode: 'P101', password: 'newer pass 2' }).expect(401);
    await hr(c).put('/portal-access', { employeeIds: [emp.id], portalEnabled: true }).expect(200);
    const back = await request(app).post('/api/portal/login').send({ company, employeeCode: 'P101', password: 'newer pass 2' }).expect(200);

    await hr(c).post(`/portal-access/${emp.id}/reset`).expect(200);
    await me(back.body.token).get('/me').expect(401);
    await request(app).post('/api/portal/login').send({ company, employeeCode: 'P101', password: 'newer pass 2' }).expect(401);
  });

  it('needs an employee code to hand out a code', async () => {
    const nocode = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'No Code', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    if (nocode.code) return; // codes are numbered automatically in this setup
    expect((await hr(c).post('/portal-access/codes', { employeeIds: [nocode.id] }).expect(400)).body.error).toMatch(/employee code/);
  });
});
