import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';

/**
 * The second round of People and Attendance state races (docs/state-machines.md A8, A13, M6):
 * a reader's late or repeated answer to a command, an absence notice's e-mail status moved by
 * a stale outbox reading, and an offer accepted while HR rejects the candidate. Each leaves one
 * outcome. The races are made real where they can be: the test holds the row the other side
 * needs, starts the operation, waits until Postgres shows it blocked, then lets go.
 */

/* A hook into the mailer, so a delivery can be noted while the notice's own send is still under way. */
const hooks = vi.hoisted(() => ({ sendTemplate: null as null | ((opts: any, real: (o: any) => Promise<any>) => Promise<any>) }));
vi.mock('../services/mailer.js', async (orig) => {
  const real: any = await orig();
  return { ...real, sendTemplate: (opts: any) => (hooks.sendTemplate ? hooks.sendTemplate(opts, real.sendTemplate) : real.sendTemplate(opts)) };
});

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { sendAbsenceNotice, noteNoticeEmail } = await import('../services/people/absconding.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = (c: Ctx, base: 'attendance' | 'people') => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/${base}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/${base}${p}`).set(at(c)).send(b as any),
});

async function makeOwner(): Promise<Ctx> {
  const email = `races2.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Races Two ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true, payroll: false, peopleHiring: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.accountId = me.body.orgs.find((o: any) => o.orgId === ctx.orgId).accountId;
  return ctx;
}
const person = async (c: Ctx, code: string) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;

/**
 * Wait until `n` connections wait behind `pid` (directly, or queued behind one that waits on it), or the
 * operations are over without waiting.
 */
async function blockedBy(pid: number, over: () => boolean, n = 1) {
  for (let i = 0; i < 400; i++) {
    if (over()) return;
    const [r] = await peoplePrisma.$queryRaw<Array<{ n: number }>>`
      WITH direct AS (SELECT a.pid FROM pg_stat_activity a WHERE ${pid}::int = ANY(pg_blocking_pids(a.pid)))
      SELECT count(*)::int AS n FROM pg_stat_activity a
      WHERE a.pid IN (SELECT pid FROM direct) OR pg_blocking_pids(a.pid) && ARRAY(SELECT pid FROM direct)`;
    if (r.n >= n) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error('The operation never reached the lock.');
}
const settle = <T>(p: Promise<T>) => p.then((value) => ({ ok: true as const, value }), (error: any) => ({ ok: false as const, error }));

/** Change rows in a transaction held open until every op is blocked on them, then commit. */
async function changeDuring(change: (tx: any) => Promise<unknown>, ops: Array<() => Promise<any>>) {
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  let ready!: (pid: number) => void;
  const started = new Promise<number>((done) => (ready = done));
  const holding = peoplePrisma.$transaction(async (tx: any) => {
    const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
    await change(tx);
    ready(pid);
    await gate;
  }, { timeout: 60_000 });
  const pid = await started;
  let left = ops.length;
  const results = ops.map((op) => settle(op()).finally(() => (left -= 1)));
  await blockedBy(pid, () => left < ops.length, ops.length);
  release();
  await holding;
  return Promise.all(results);
}

/* ------------------------------------------------------------------ reader replies */

describe('a reader’s answer to a command', () => {
  async function readerWithCommand() {
    const c = await makeOwner();
    await person(c, '601');
    const sn = `TST${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
    const device = (await api(c, 'attendance').post('/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201)).body.device;
    const heartbeat = () => request(app).get(`/iclock/getrequest?SN=${sn}`);
    const answer = (id: number, ret: number) => request(app).post(`/iclock/devicecmd?SN=${sn}`).set('Content-Type', 'text/plain').send(`ID=${id}&Return=${ret}&CMD=DATA`);
    await heartbeat().expect(200);
    await peoplePrisma.deviceCommand.updateMany({ where: { deviceId: device.id, status: { in: ['PENDING', 'SENT'] } }, data: { status: 'DONE' } });
    const cmd = await peoplePrisma.deviceCommand.create({ data: { accountId: c.accountId, orgId: c.orgId, deviceId: device.id, serialNumber: sn, command: 'DATA DELETE USERINFO PIN=601', sequence: 0 } });
    /* Out with the reader: the heartbeat claims it. */
    expect((await heartbeat().expect(200)).text).toContain(`C:${cmd.id}:`);
    return { c, sn, device, cmd, heartbeat, answer };
  }

  it('settles it once; a repeated or late answer does not overwrite the result', async () => {
    const { cmd, answer } = await readerWithCommand();
    await answer(cmd.id, 0).expect(200);
    expect((await peoplePrisma.deviceCommand.findUniqueOrThrow({ where: { id: cmd.id } })).status).toBe('DONE');
    await answer(cmd.id, -1002).expect(200);
    const now = await peoplePrisma.deviceCommand.findUniqueOrThrow({ where: { id: cmd.id } });
    expect(now.status).toBe('DONE');
    expect(now.returnCode).toBe(0);
    expect(now.lastError).toBeNull();
  });

  it('does not settle a command put back in the queue after its answer was given up on', async () => {
    const { cmd, answer } = await readerWithCommand();
    await peoplePrisma.deviceCommand.update({ where: { id: cmd.id }, data: { status: 'PENDING' } });
    await answer(cmd.id, 0).expect(200);
    expect((await peoplePrisma.deviceCommand.findUniqueOrThrow({ where: { id: cmd.id } })).status).toBe('PENDING');
  });

  it('read on one attempt does not settle the next attempt sent meanwhile', async () => {
    const { cmd, answer } = await readerWithCommand();
    /* As the late answer to attempt 1 is handled, the command is re-queued and sent again (attempt 2). */
    const [r] = await changeDuring((tx) => tx.deviceCommand.update({ where: { id: cmd.id }, data: { status: 'SENT', attempts: 2, sentAt: new Date() } }), [() => answer(cmd.id, -1002)]);
    expect(r.ok).toBe(true);
    const now = await peoplePrisma.deviceCommand.findUniqueOrThrow({ where: { id: cmd.id } });
    expect(now.status).toBe('SENT');
    expect(now.attempts).toBe(2);
    expect(now.returnCode).toBeNull();
    /* The answer to attempt 2 settles it. */
    await answer(cmd.id, 0).expect(200);
    expect((await peoplePrisma.deviceCommand.findUniqueOrThrow({ where: { id: cmd.id } })).status).toBe('DONE');
  });

  it('on a Matrix controller, a repeated answer changes nothing', async () => {
    const c = await makeOwner();
    await person(c, '602');
    const made = (await api(c, 'attendance').post('/devices', { vendor: 'MATRIX_COSEC', name: 'Main door', direction: 'both', sourceTimezone: 'Asia/Kolkata' }).expect(201)).body;
    const call = (path: string, q: Record<string, string | number> = {}) => request(app).get(`/matrix/${made.pushToken}${path}`).query({ 'device-type': 0, 'serial-no': 'MX12345', ...q });
    await call('/login').expect(200);
    await peoplePrisma.deviceCommand.updateMany({ where: { deviceId: made.device.id, status: { in: ['PENDING', 'SENT'] } }, data: { status: 'DONE' } });
    const cmd = await peoplePrisma.deviceCommand.create({ data: { accountId: c.accountId, orgId: c.orgId, deviceId: made.device.id, serialNumber: made.device.serialNumber, command: 'cmd-id=18', sequence: 0 } });
    expect((await call('/getcmd').expect(200)).text).toBe('cmd-id=18');
    await call('/updatecmd', { 'cmd-id': 18, status: 1 }).expect(200);
    await call('/updatecmd', { 'cmd-id': 18, status: 0 }).expect(200);
    const now = await peoplePrisma.deviceCommand.findUniqueOrThrow({ where: { id: cmd.id } });
    expect(now.status).toBe('DONE');
    expect(now.returnCode).toBe(0);
  });
});

/* ------------------------------------------------------------------ absence notice e-mail */

describe('an absence notice’s e-mail status', () => {
  async function caseWithNotice(c: Ctx, code: string, emailStatus: string | null, outboxStatus?: string) {
    const p = await person(c, code);
    const kase = await peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, fromDate: '2026-10-01', lastAbsentDate: '2026-10-08', days: 6, status: 'NOTICE_1' } });
    const outbox = outboxStatus
      ? await platformPrisma.emailOutbox.create({ data: { accountId: c.accountId, orgId: c.orgId, templateKey: 'people.absence_notice', toEmail: `p${code}@example.com`, subject: 'Absence', bodyText: 'Report back.', status: outboxStatus } })
      : null;
    const notice = await peoplePrisma.absenceNotice.create({
      data: { accountId: c.accountId, orgId: c.orgId, caseId: kase.id, employeeId: p.id, seq: 1, reportBy: '2026-12-01', channels: ['APP', 'EMAIL'], text: 'Report back.', sentByUserId: 'hr-test', emailTo: `p${code}@example.com`, emailStatus, emailOutboxId: outbox?.id ?? null },
    });
    return { p, kase, outbox, notice };
  }
  const statusOf = async (id: string) => (await peoplePrisma.absenceNotice.findUniqueOrThrow({ where: { id } })).emailStatus;

  it('moves only forward: queued to sent or failed, failed to sent; sent stays sent', async () => {
    const c = await makeOwner();
    const { notice } = await caseWithNotice(c, '611', 'QUEUED');
    expect(await noteNoticeEmail(notice.id, 'FAILED')).toBe(true);
    expect(await noteNoticeEmail(notice.id, 'QUEUED')).toBe(false);
    expect(await statusOf(notice.id)).toBe('FAILED');
    expect(await noteNoticeEmail(notice.id, 'SENT')).toBe(true);
    /* A late reading of the first, failed attempt does not undo the delivery. */
    expect(await noteNoticeEmail(notice.id, 'FAILED')).toBe(false);
    expect(await noteNoticeEmail(notice.id, 'QUEUED')).toBe(false);
    expect(await statusOf(notice.id)).toBe('SENT');
  });

  it('two readings at once leave one answer', async () => {
    const c = await makeOwner();
    const { notice } = await caseWithNotice(c, '612', 'QUEUED');
    const [a, b] = await Promise.all([noteNoticeEmail(notice.id, 'SENT'), noteNoticeEmail(notice.id, 'FAILED')]);
    const final = await statusOf(notice.id);
    /* Either SENT won outright, or FAILED landed first and the retry's SENT followed: never SENT then FAILED. */
    expect(final).toBe('SENT');
    expect(a).toBe(true);
    expect(typeof b).toBe('boolean');
  });

  it('Absences shows what the outbox says, instead of queued for ever', async () => {
    const c = await makeOwner();
    const { kase, notice } = await caseWithNotice(c, '613', 'QUEUED', 'SENT');
    const list = (await api(c, 'people').get('/absences').expect(200)).body;
    const row = list.rows.find((r: any) => r.id === kase.id);
    expect(row.notices[0].emailStatus).toBe('SENT');
    expect(await statusOf(notice.id)).toBe('SENT');
  });

  it('a stale outbox row does not undo a delivery already noted', async () => {
    const c = await makeOwner();
    const { kase, notice } = await caseWithNotice(c, '614', 'SENT', 'FAILED');
    const row = (await api(c, 'people').get('/absences').expect(200)).body.rows.find((r: any) => r.id === kase.id);
    expect(row.notices[0].emailStatus).toBe('SENT');
    expect(await statusOf(notice.id)).toBe('SENT');
  });

  it('the send’s own first word does not overwrite a delivery noted while it was sending', async () => {
    const c = await makeOwner();
    const p = await person(c, '615');
    await peoplePrisma.employee.update({ where: { id: p.id }, data: { personalEmail: `p615.${rnd()}@example.com` } });
    const kase = await peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, fromDate: '2026-10-01', lastAbsentDate: '2026-10-08', days: 6 } });
    const who = { accountId: c.accountId, orgId: c.orgId, userId: 'hr-test', correlationId: `t-${rnd()}` };
    hooks.sendTemplate = async (opts, real) => {
      const sent = await real(opts);
      /* The mail went out and was noted against the notice before the send wrote its own (older) word. */
      await peoplePrisma.absenceNotice.update({ where: { id: opts.relatedId }, data: { emailStatus: 'SENT', emailOutboxId: sent.id } });
      return { ...sent, status: 'QUEUED' };
    };
    try {
      const saved = await sendAbsenceNotice(who, kase.id, { signatory: 'Meera Shah, HR' });
      expect(saved.emailStatus).toBe('SENT');
      expect(saved.channels).toContain('EMAIL');
    } finally {
      hooks.sendTemplate = null;
    }
  });
});

/* ------------------------------------------------------------------ offers */

describe('an offer accepted as HR rejects the candidate', () => {
  async function candidateWithOffer() {
    const c = await makeOwner();
    const job = (await api(c, 'people').post('/talent/openings', { title: 'Accountant', status: 'OPEN' }).expect(201)).body.opening;
    const email = `cand.${rnd()}@example.com`;
    const cand = (await api(c, 'people').post('/talent/candidates', { openingId: job.id, name: 'Meera K', email }).expect(201)).body.candidate;
    await api(c, 'people').post('/offers', { candidateId: cand.id, designation: 'Accountant', annualCtc: 360000, signatory: 'Owner', lines: [] }).expect(201);
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId: c.orgId, templateKey: 'people.offer', toEmail: email }, orderBy: { createdAt: 'desc' } });
    const token = /\/api\/people\/offer\/([a-f0-9]{64})/.exec(mail?.bodyText || '')?.[1] || '';
    expect(token).not.toBe('');
    return { c, cand, token };
  }
  const state = async (c: Ctx, id: string) => ({
    stage: (await api(c, 'people').get(`/talent/candidates/${id}`).expect(200)).body.candidate.stage,
    offers: (await api(c, 'people').get(`/offers?candidateId=${id}`).expect(200)).body.offers.map((o: any) => o.status),
  });

  it('accepted first: the rejection is refused with 409 and nothing changes', async () => {
    const { c, cand, token } = await candidateWithOffer();
    await request(app).post(`/api/people/offer/${token}/accept`).send({}).expect(200);
    const r = await api(c, 'people').post(`/talent/candidates/${cand.id}/stage`, { stage: 'REJECTED', reason: 'Went with someone else' }).expect(409);
    expect(r.body.code).toBe('OFFER_ACCEPTED');
    expect(await state(c, cand.id)).toEqual({ stage: 'OFFER', offers: ['ACCEPTED'] });
    /* Withdrawn by them, likewise. */
    expect((await api(c, 'people').post(`/talent/candidates/${cand.id}/stage`, { stage: 'WITHDRAWN', reason: 'Took another job' }).expect(409)).body.code).toBe('OFFER_ACCEPTED');
  });

  it('HR can still close it on purpose: the accepted offer is withdrawn with it', async () => {
    const { c, cand, token } = await candidateWithOffer();
    await request(app).post(`/api/people/offer/${token}/accept`).send({}).expect(200);
    await api(c, 'people').post(`/talent/candidates/${cand.id}/stage`, { stage: 'REJECTED', reason: 'Background check failed', overAcceptedOffer: true }).expect(200);
    expect(await state(c, cand.id)).toEqual({ stage: 'REJECTED', offers: ['WITHDRAWN'] });
  });

  it('at the same moment: one wins, and the offer and the candidate agree', async () => {
    const { c, cand, token } = await candidateWithOffer();
    const [accept, reject] = await changeDuring(
      (tx) => tx.$queryRaw`SELECT id FROM "Candidate" WHERE id = ${cand.id} FOR UPDATE`,
      [
        () => request(app).post(`/api/people/offer/${token}/accept`).send({}),
        () => api(c, 'people').post(`/talent/candidates/${cand.id}/stage`, { stage: 'REJECTED', reason: 'Went with someone else' }),
      ],
    );
    const a = (accept as any).value.status;
    const r = (reject as any).value.status;
    const now = await state(c, cand.id);
    if (a === 200) {
      expect(r).toBe(409);
      expect(now).toEqual({ stage: 'OFFER', offers: ['ACCEPTED'] });
    } else {
      expect(a).toBe(410);
      expect(r).toBe(200);
      expect(now).toEqual({ stage: 'REJECTED', offers: ['WITHDRAWN'] });
    }
  });
});
