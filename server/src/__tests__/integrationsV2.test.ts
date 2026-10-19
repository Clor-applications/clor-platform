import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';

/**
 * Integrations, second round: webhook deliveries that retry and can be sent
 * again; events for employees, leave and months; an API that syncs by change
 * time, refuses a repeated write, takes employees and leave from an HRMS,
 * and describes itself.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { flushWebhooks, retryDueDeliveries, RETRY_MINUTES } = await import('../services/attendance/webhooks.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const v1 = (key: string, extra: Record<string, string> = {}) => ({
  get: (p: string) => request(app).get(`/v1${p}`).set('Authorization', `Bearer ${key}`),
  post: (p: string, b: unknown) => request(app).post(`/v1${p}`).set('Authorization', `Bearer ${key}`).set(extra).send(b as any),
  patch: (p: string, b: unknown) => request(app).patch(`/v1${p}`).set('Authorization', `Bearer ${key}`).set(extra).send(b as any),
});

async function makeOwner(): Promise<Ctx> {
  const email = `int2.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Int2 Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
const newKey = async (c: Ctx, scopes: string[]) => (await api(c).post('/integrations/keys', { name: `Key ${rnd()}`, scopes }).expect(201)).body.token as string;

/** A receiving end that can be told to fail, remembering what arrived. */
function receiver() {
  const got: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
  let failNext = 0;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      got.push({ headers: req.headers, body: data ? JSON.parse(data) : null });
      if (failNext > 0) {
        failNext -= 1;
        res.writeHead(500).end('nope');
      } else res.writeHead(200).end('ok');
    });
  });
  return {
    got,
    fail: (n: number) => (failNext = n),
    start: () => new Promise<string>((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as any).port}/hook`))),
    stop: () => new Promise((ok) => server.close(ok)),
  };
}

let c: Ctx;
beforeAll(async () => {
  c = await makeOwner();
}, 60_000);

describe('webhook deliveries', () => {
  it('are recorded, retried on a schedule, listed and can be sent again', async () => {
    const rx = receiver();
    const url = await rx.start();
    /* The receiver is on this machine; outside tests, loopback is refused (services/outbound.ts). */
    const prev = process.env.INTEGRATIONS_ALLOW_PRIVATE;
    process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
    try {
      const hook = (await api(c).post('/integrations/webhooks', { name: 'HRMS', url, events: ['employee.created', 'employee.left', 'leave.requested', 'leave.approved', 'month.closed'] }).expect(201)).body.webhook;

      rx.fail(1);
      const emp = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Rao', code: 'W1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
      await flushWebhooks();
      expect(rx.got).toHaveLength(1);
      expect(rx.got[0].headers['x-clor-event']).toBe('employee.created');
      expect(rx.got[0].headers['x-clor-attempt']).toBe('1');
      expect(rx.got[0].body.data).toMatchObject({ code: 'W1', name: 'Asha Rao', status: 'ACTIVE' });

      let list = (await api(c).get(`/integrations/webhooks/${hook.id}/deliveries`).expect(200)).body.deliveries;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ event: 'employee.created', status: 'PENDING', attempts: 1, lastStatus: 500, lastError: 'Answered 500' });
      const due = new Date(list[0].nextAttemptAt).getTime() - new Date(list[0].createdAt).getTime();
      expect(Math.round(due / 60_000)).toBe(RETRY_MINUTES[0]);

      /* Not yet due: nothing happens. Due: it is tried again, with the same delivery id. */
      expect(await retryDueDeliveries(new Date())).toBe(0);
      expect(await retryDueDeliveries(new Date(Date.now() + 2 * 60_000))).toBe(1);
      expect(rx.got).toHaveLength(2);
      expect(rx.got[1].headers['x-clor-delivery']).toBe(rx.got[0].headers['x-clor-delivery']);
      expect(rx.got[1].headers['x-clor-attempt']).toBe('2');
      list = (await api(c).get(`/integrations/webhooks/${hook.id}/deliveries`).expect(200)).body.deliveries;
      expect(list[0]).toMatchObject({ status: 'OK', attempts: 2, lastStatus: 200 });

      const again = await api(c).post(`/integrations/webhooks/${hook.id}/deliveries/${list[0].id}/resend`).expect(200);
      expect(again.body.ok).toBe(true);
      expect(rx.got).toHaveLength(3);

      /* Leaving: the event says so. */
      await request(app).put(`/api/orgs/${c.orgId}/people/employees/${emp.id}`).set(at(c)).send({ name: 'Asha Rao', status: 'LEFT', dateOfLeaving: '2026-10-01' }).expect(200);
      await flushWebhooks();
      expect(rx.got.at(-1)!.headers['x-clor-event']).toBe('employee.left');

      /* Leave: asked for, then approved. */
      const p2 = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Ravi', code: 'W2', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
      await flushWebhooks();
      const t = (await api(c).post('/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
      const lr = (await api(c).post('/leave/requests', { employeeId: p2.id, leaveTypeId: t.id, fromDate: '2026-11-03', toDate: '2026-11-04', reason: 'Family visit' }).expect(201)).body.request;
      await flushWebhooks();
      expect(rx.got.at(-1)!.headers['x-clor-event']).toBe('leave.requested');
      expect(rx.got.at(-1)!.body.data).toMatchObject({ id: lr.id, employeeCode: 'W2', leaveType: 'Casual', days: 2 });
      await api(c).post(`/leave/requests/${lr.id}/approve`).expect(200);
      await flushWebhooks();
      expect(rx.got.at(-1)!.headers['x-clor-event']).toBe('leave.approved');

      await api(c).post('/months/2026-09/close').send({ acknowledge: true }).expect(200);
      await flushWebhooks();
      expect(rx.got.at(-1)!.body).toMatchObject({ event: 'month.closed', data: { month: '2026-09' } });
    } finally {
      process.env.INTEGRATIONS_ALLOW_PRIVATE = prev;
      await rx.stop();
    }
  });
});

describe('the API, second round', () => {
  it('describes itself without a key', async () => {
    const spec = (await request(app).get('/v1/openapi.json').expect(200)).body;
    expect(spec.openapi).toBe('3.0.3');
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/employees', '/leave/requests', '/attendance/shifts', '/readers']));
    const html = (await request(app).get('/v1/docs').expect(200)).text;
    expect(html).toContain('CLOR Attendance API');
    expect(html).toContain('/leave/requests/{id}/approve');
  });

  it('takes employees from an HRMS, syncs what changed, and refuses a repeated write', async () => {
    const o = await makeOwner();
    const key = await newKey(o, ['employees:read', 'employees:write']);
    const idem = { 'Idempotency-Key': `k-${rnd()}` };

    const body = { code: 'H100', name: 'Meena S', department: 'Dyeing', dateOfJoining: '2026-02-01' };
    const first = await v1(key, idem).post('/employees', body).expect(201);
    expect(first.body).toMatchObject({ created: true, employee: { code: 'H100', readerId: 'H100', department: 'Dyeing' } });
    /* The same call again (a retry): the same answer, nothing new. */
    const replay = await v1(key, idem).post('/employees', body).expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.employee.id).toBe(first.body.employee.id);
    expect(await peoplePrisma.employee.count({ where: { orgId: o.orgId, code: 'H100' } })).toBe(1);
    /* Same key, different request: refused. */
    await v1(key, idem).post('/employees', { code: 'H101', name: 'Other' }).expect(422);

    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    const upd = await v1(key).post('/employees', { code: 'H100', designation: 'Supervisor', readerId: '7100' }).expect(200);
    expect(upd.body).toMatchObject({ created: false, employee: { designation: 'Supervisor', readerId: '7100' } });
    await v1(key).post('/employees', { code: 'H101', name: 'Kumar' }).expect(201);
    await v1(key).post('/employees', { code: 'H102' }).expect(400); // a new person needs a name

    const page1 = (await v1(key).get(`/employees?updated_since=${encodeURIComponent(since)}&limit=1`).expect(200)).body;
    expect(page1.employees).toHaveLength(1);
    expect(page1.next_cursor).toBeTruthy();
    const page2 = (await v1(key).get(`/employees?cursor=${encodeURIComponent(page1.next_cursor)}&limit=1`).expect(200)).body;
    expect(page2.employees).toHaveLength(1);
    expect(page2.next_cursor).toBeNull();
    expect([page1.employees[0].code, page2.employees[0].code].sort()).toEqual(['H100', 'H101']);
    await v1(key).get('/employees?cursor=garbage').expect(400);

    const left = await v1(key).patch('/employees/H101', { status: 'LEFT', dateOfLeaving: '2026-10-15' }).expect(200);
    expect(left.body.employee.status).toBe('LEFT');
    await v1(key).patch('/employees/NOPE', { name: 'x' }).expect(404);
    await v1(key).patch('/employees/H100', { dateOfLeaving: '2025-01-01' }).expect(400); // before joining
  });

  it('handles leave, shifts, readers and closed months', async () => {
    const o = await makeOwner();
    const key = await newKey(o, ['attendance:read', 'leave:read', 'leave:write', 'readers:read']);
    const noLeave = await newKey(o, ['attendance:read']);
    await request(app).post(`/api/orgs/${o.orgId}/people/employees`).set(at(o)).send({ name: 'Priya', code: 'L1', dateOfJoining: '2026-01-01' }).expect(201);
    await api(o).post('/leave/types', { name: 'Earned', code: 'EL', annualDays: 15 }).expect(201);

    expect((await v1(key).get('/leave/types').expect(200)).body.types[0]).toMatchObject({ name: 'Earned', code: 'EL', isPaid: true });
    const bal = (await v1(key).get('/leave/balances?year=2026&employee_code=L1').expect(200)).body;
    expect(bal.rows[0].balances[0]).toMatchObject({ leaveTypeCode: 'EL', allocated: 15, available: 15 });

    await v1(noLeave).post('/leave/requests', {}).expect(403);
    await v1(key).post('/leave/requests', { employee_code: 'L1', leave_type: 'Sick', from: '2026-11-10', to: '2026-11-11', reason: 'Fever' }).expect(400);
    const made = (await v1(key).post('/leave/requests', { employee_code: 'L1', leave_type: 'EL', from: '2026-11-10', to: '2026-11-11', reason: 'Family function' }).expect(201)).body.request;
    expect(made).toMatchObject({ status: 'PENDING', days: 2, leaveTypeName: 'Earned' });
    expect((await v1(key).get('/leave/requests?status=PENDING&employee_code=L1').expect(200)).body.requests).toHaveLength(1);
    const ok = (await v1(key).post(`/leave/requests/${made.id}/approve`, { note: 'Fine' }).expect(200)).body.request;
    expect(ok).toMatchObject({ status: 'APPROVED', reviewNote: 'Fine' });
    await v1(key).post(`/leave/requests/${made.id}/approve`, {}).expect(409);
    expect((await v1(key).get('/leave/balances?year=2026&employee_code=L1').expect(200)).body.rows[0].balances[0].available).toBe(13);

    /* Shifts: a working day and a Sunday. */
    const shifts = (await v1(key).get('/attendance/shifts?from=2026-09-05&to=2026-09-06&employee_code=L1').expect(200)).body.shifts;
    expect(shifts).toHaveLength(2);
    expect(shifts.find((s: any) => s.date === '2026-09-06').weeklyOff).toBe(true);
    expect(shifts.find((s: any) => s.date === '2026-09-05')).toMatchObject({ employeeCode: 'L1', weeklyOff: false });
    await v1(key).get('/attendance/shifts?from=2026-01-01&to=2026-03-01').expect(400);

    await api(o).post('/months/2026-08/close').send({ acknowledge: true }).expect(200);
    const months = (await v1(key).get('/attendance/months?year=2026').expect(200)).body.months;
    expect(months.find((m: any) => m.month === '2026-08').closed).toBe(true);
    expect(months.find((m: any) => m.month === '2026-09').closed).toBe(false);

    await api(o).post('/devices', { vendor: 'FILE', name: 'Export' }).expect(201);
    const readers = (await v1(key).get('/readers').expect(200)).body.readers;
    expect(readers).toEqual([expect.objectContaining({ name: 'Export', driver: 'File import', online: false, punchesToday: 0 })]);
    await v1(noLeave).get('/readers').expect(403);

    /* Days by change time, after a correction. */
    const emp = (await request(app).get(`/api/orgs/${o.orgId}/people/employees`).set(at(o)).expect(200)).body.employees.find((e: any) => e.code === 'L1');
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    await api(o).put('/records', { employeeId: emp.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    const days = (await v1(key).get(`/attendance/days?updated_since=${encodeURIComponent(since)}`).expect(200)).body;
    expect(days.days.map((d: any) => d.date)).toEqual(['2026-09-02']);
    expect(days.days[0].updatedAt).toBeTruthy();
  });
});
