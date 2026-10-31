import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

/** Employee self-service: what needs attention, the month to confirm, shifts ahead, overtime and comp-off, and where requests stand. */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { purgeExpiredRecords } = await import('../services/retention.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `home.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Reader owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Home Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
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


const tmpl = (s: string) => Buffer.from(`template-${s}-`.repeat(20)).toString('base64');
const dp = (c: Ctx) => ({
  get: () => api(c).get('/data-protection'),
  put: (b: unknown) => api(c).put('/data-protection', b),
});
const portalFor = async (c: Ctx, employeeId: string, code: string) => {
  const list = await api(c).get('/portal-access').expect(200);
  const company = list.body.company.code;
  const issued = await api(c).post('/portal-access/codes', { employeeIds: [employeeId] }).expect(200);
  const ok = await request(app).post('/api/portal/activate').send({ company, employeeCode: code, activationCode: issued.body.codes[0].activationCode, password: 'mine pass 1' }).expect(200);
  const token = ok.body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
    put: (p: string, b: unknown = {}) => request(app).put(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
  };
};

const ist = (offsetDays = 0) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** The most recent past day (before yesterday) that is a working day under the default shift (Sunday off). */
const pastWorkday = (from = -2) => {
  for (let i = from; i > -9; i--) if (weekday(ist(i)) !== 0) return ist(i);
  throw new Error('no workday');
};
const lastSunday = () => {
  for (let i = -1; i > -9; i--) if (weekday(ist(i)) === 0) return ist(i);
  throw new Error('no sunday');
};
const otRules = (c: Ctx, b: Record<string, unknown>) =>
  api(c).put('/overtime/rules', { overtimeRequests: true, overtimeApproval: 'HR', compOffEnabled: false, compOffLeaveTypeId: null, confirmCutoffDay: 28, ...b });

describe('employee self-service', () => {
  it('lists the days that need attention, each with what to do', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Asha', code: 'A1' });
    const sn = serial();
    await addReader(c, sn);
    const noOut = pastWorkday(-1 - (weekday(ist(-1)) === 0 ? 1 : 0));
    await reader(sn).push([`A1\t${noOut} 09:02:00\t0\t1`]).expect(200);
    const me = await portalFor(c, p.id, 'A1');
    const fixed = pastWorkday(-3);
    await me.post('/corrections', { date: fixed, checkIn: '09:00', checkOut: '18:00', reason: 'Forgot my card' }).expect(201);
    const a = (await me.get('/attention').expect(200)).body;
    expect(a.items.find((i: any) => i.date === noOut)).toMatchObject({ kind: 'NO_OUT', action: 'FIX', checkIn: '09:02' });
    expect(a.items.find((i: any) => i.date === fixed)).toMatchObject({ kind: 'FIX_WAITING', action: 'NONE' });
    expect(a.items.some((i: any) => i.kind === 'NO_PUNCHES')).toBe(true);
    expect(a.items.every((i: any) => weekday(i.date) !== 0 || i.kind === 'FIX_WAITING')).toBe(true);
    expect(a.items.every((i: any) => i.date < ist())).toBe(true);
    expect(a.count).toBe(a.items.filter((i: any) => i.action === 'FIX').length);
  });

  it('lets the employee confirm or dispute last month before the cutoff, and shows HR who did', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Bala', code: 'B1' });
    const me = await portalFor(c, p.id, 'B1');
    const last = new Date(Date.UTC(Number(ist().slice(0, 4)), Number(ist().slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    await otRules(c, { confirmCutoffDay: 1 }).expect(200);
    const late = (await me.get(`/month-review?month=${last}`).expect(200)).body;
    if (Number(ist().slice(8, 10)) > 1) {
      expect(late.canConfirm).toBe(false);
      expect(late.why).toMatch(/cutoff/);
      await me.post(`/month-review/${last}/confirm`).expect(409);
    }
    const thisMonth = (await me.get(`/month-review?month=${ist().slice(0, 7)}`).expect(200)).body;
    /* The month's own last day counts as ended (it can be confirmed that evening): this ran at 01:21 IST on 31 Oct in CI. */
    if (ist(1).slice(0, 7) === ist().slice(0, 7)) {
      expect(thisMonth.canConfirm).toBe(false);
      expect(thisMonth.why).toMatch(/ended/);
    } else expect(thisMonth.canConfirm).toBe(true);

    await otRules(c, { confirmCutoffDay: 28 }).expect(200);
    const r = (await me.get(`/month-review?month=${last}`).expect(200)).body;
    if (Number(ist().slice(8, 10)) <= 28) {
      expect(r).toMatchObject({ month: last, canConfirm: true, confirmation: null });
      expect(r.summary).toHaveProperty('payableDays');
      expect(r.unresolved.length).toBeGreaterThan(0);
      await me.post(`/month-review/${last}/dispute`, { note: 'x' }).expect(400);
      await me.post(`/month-review/${last}/dispute`, { note: 'I was on a client visit on the 12th' }).expect(200);
      const hr = (await api(c).get(`/months/${last}/readiness`).expect(200)).body.confirmations;
      expect(hr).toMatchObject({ confirmed: 0, portalPeople: 1, notYet: 0 });
      expect(hr.disputed[0]).toMatchObject({ name: 'Bala', note: 'I was on a client visit on the 12th' });
      await me.post(`/month-review/${last}/confirm`).expect(200);
      expect((await me.get(`/month-review?month=${last}`).expect(200)).body.confirmation).toMatchObject({ status: 'CONFIRMED' });
      expect((await api(c).get(`/months/${last}/readiness`).expect(200)).body.confirmations).toMatchObject({ confirmed: 1, disputed: [] });
    }
  });

  it('shows the shifts coming up across months, with weekly offs', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Chitra', code: 'C1' });
    const me = await portalFor(c, p.id, 'C1');
    const s = (await me.get(`/schedule?from=${ist()}&days=21`).expect(200)).body;
    expect(s.days).toHaveLength(21);
    expect(s.days[0].date).toBe(ist());
    for (const d of s.days) {
      if (weekday(d.date) === 0) expect(d.kind).toBe('OFF');
      else expect(d.kind).toBe('WORK');
      expect(d).toHaveProperty('sourceText');
    }
    expect((await me.get(`/schedule?month=${ist().slice(0, 7)}`).expect(200)).body.month).toBe(ist().slice(0, 7));
  });

  it('asks for overtime and comp-off, and approval pays the overtime and adds the comp-off day', async () => {
    const c = await makeOwner();
    const boss = await person(c, { name: 'Mohan', code: 'M1' });
    const p = await person(c, { name: 'Deepa', code: 'D1', reportingManagerId: boss.id });
    const sn = serial();
    await addReader(c, sn);
    const work = pastWorkday(-1 - (weekday(ist(-1)) === 0 ? 1 : 0));
    const sun = lastSunday();
    await reader(sn).push([`D1\t${work} 09:00:00\t0\t1`, `D1\t${work} 21:00:00\t1\t1`, `D1\t${sun} 09:00:00\t0\t1`, `D1\t${sun} 18:30:00\t1\t1`]).expect(200);
    const me = await portalFor(c, p.id, 'D1');
    const month = work.slice(0, 7);
    const ot = (await me.get(`/overtime?month=${month}`).expect(200)).body;
    const wd = ot.days.find((d: any) => d.date === work);
    expect(wd.overtimeMinutes).toBeGreaterThan(0);
    expect(wd).toMatchObject({ overtimeApproved: false, canAskOvertime: true, restDay: false });
    expect(ot.policy).toMatchObject({ overtimeRequests: true, compOff: false });
    await me.post('/overtime', { date: work, kind: 'OVERTIME', reason: 'x' }).expect(400);
    const asked = (await me.post('/overtime', { date: work, kind: 'OVERTIME', reason: 'Month-end dispatch' }).expect(201)).body.request;
    await me.post('/overtime', { date: work, kind: 'OVERTIME', reason: 'Month-end dispatch' }).expect(409);
    await me.post('/overtime', { date: sun, kind: 'COMP_OFF', reason: 'Sunday stock count' }).expect(409);

    const pending = (await api(c).get('/overtime/requests').expect(200)).body.requests;
    expect(pending[0]).toMatchObject({ id: asked.id, employeeName: 'Deepa', kind: 'OVERTIME' });
    await api(c).post(`/overtime/requests/${asked.id}/approve`, {}).expect(200);
    expect((await day(c, p.id, work)).overtimeApproved).toBe(true);
    await api(c).post(`/overtime/requests/${asked.id}/approve`, {}).expect(409);

    const comp = await (async () => (await api(c).post('/leave/types', { name: 'Comp-off', annualDays: 0 }).expect(201)).body.type)();
    await otRules(c, { compOffEnabled: true, compOffLeaveTypeId: null }).expect(400);
    await otRules(c, { compOffEnabled: true, compOffLeaveTypeId: comp.id, overtimeApproval: 'MANAGER_THEN_HR' }).expect(200);
    const sv = (await me.get(`/overtime?month=${sun.slice(0, 7)}`).expect(200)).body.days.find((d: any) => d.date === sun);
    expect(sv).toMatchObject({ restDay: true, compOffDays: 1, canAskCompOff: true });
    const co = (await me.post('/overtime', { date: sun, kind: 'COMP_OFF', reason: 'Sunday stock count' }).expect(201)).body.request;

    /* Manager first, then HR; the timeline says who is next. */
    let t = (await me.get('/requests').expect(200)).body.requests.find((r: any) => r.id === co.id);
    expect(t).toMatchObject({ kind: 'compoff', next: 'Mohan' });
    expect(t.steps.map((s: any) => s.state)).toEqual(['DONE', 'NOW', 'LATER', 'LATER']);
    await api(c).post(`/overtime/requests/${co.id}/approve`, {}).expect(409);
    const mm = await portalFor(c, boss.id, 'M1');
    const queue = (await mm.get('/approvals').expect(200)).body;
    expect(queue.overtime.map((o: any) => o.id)).toContain(co.id);
    expect((await mm.post(`/approvals/overtime/${co.id}`, { decision: 'approve' }).expect(200)).body.stage).toBe('HR');
    t = (await me.get('/requests').expect(200)).body.requests.find((r: any) => r.id === co.id);
    expect(t).toMatchObject({ next: 'HR', withHr: true });
    await api(c).post(`/overtime/requests/${co.id}/approve`, { note: 'ok' }).expect(200);
    /* Comp-off is a dated credit, like HR's grant: once per day worked (closure audit, 27 Oct 2026). */
    const credit = await peoplePrisma.leaveAdjustment.findMany({ where: { orgId: c.orgId, employeeId: p.id, leaveTypeId: comp.id } });
    expect(credit.map((x) => [x.days, x.workedOn])).toEqual([[1, co.date]]);
    t = (await me.get('/requests').expect(200)).body.requests.find((r: any) => r.id === co.id);
    expect(t.next).toBeNull();
    expect(t.steps.every((s: any) => s.state === 'DONE')).toBe(true);
  });

  it('shows why a request was declined, and who decides a leave request', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Esha', code: 'E1' });
    const me = await portalFor(c, p.id, 'E1');
    const made = (await me.post('/corrections', { date: pastWorkday(-2), checkIn: '09:00', reason: 'Card did not read' }).expect(201)).body.request;
    let r = (await me.get('/requests').expect(200)).body.requests.find((x: any) => x.id === made.id);
    expect(r).toMatchObject({ next: 'HR' });
    await api(c).post(`/requests/${made.id}/reject`, { note: 'No reader fault that day' }).expect(200);
    r = (await me.get('/requests').expect(200)).body.requests.find((x: any) => x.id === made.id);
    expect(r.next).toBeNull();
    expect(r.steps.at(-1)).toMatchObject({ state: 'REFUSED', label: 'Declined: No reader fault that day' });
  });
});
