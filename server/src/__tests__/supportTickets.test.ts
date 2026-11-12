import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Customer tickets (Ops plan P1): a customer asks from the Workspace, CLOR
 * answers on the operator console. A member follows their own tickets, the
 * account's owner every ticket of the account; another account sees none.
 * Internal notes never reach the customer, nor their security log.
 */
const mails: Array<{ key: string; to: string; data: any }> = [];
vi.mock('../services/mailer.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return {
    ...real,
    sendTemplate: async (opts: any) => {
      mails.push({ key: opts.templateKey, to: opts.to, data: opts.data });
      return { status: 'SENT' };
    },
  };
});

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { at, opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: tickets', fn);
const PASSWORD = 'Passw0rd!23';

/** A plain member of the owner's account, signed in. */
async function member(o: Awaited<ReturnType<typeof company>>) {
  const email = `tk.member.${Date.now()}.${rnd()}@example.com`;
  await request(app).post('/api/account/invitations').set(at(o)).send({ email, accountRole: 'MEMBER', grants: [{ orgId: o.orgId }] }).expect(201);
  const inv = mails.filter((m) => m.key === 'account.invited' && m.to === email).pop();
  const token = new URL(String(inv?.data?.inviteUrl)).searchParams.get('token');
  await request(app).post('/api/invitations/accept').send({ token, fullName: 'Meera Pillai', password: PASSWORD }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { ...o, token: login.body.token, email };
}

const open = (c: any, body: Record<string, unknown> = {}) =>
  request(app).post('/api/support/tickets').set(at(c)).send({ subject: 'Payslips show the wrong month', body: 'Every payslip for October says September at the top.', category: 'PROBLEM', app: 'payroll', ...body });

describe('customer tickets', () => {
  it('a member opens one; they and the owner see it, another account does not; CLOR staff hear of it', async () => {
    const o = await company('tko');
    const m = await member(o);
    const sup = await staff('SUPPORT');
    mails.length = 0;
    const r = (await open(m, { requestId: 'req_7Hk2mQ9xLp3vT8wZ', urgent: true }).expect(201)).body.ticket;
    expect(r.code).toMatch(/^T-\d+$/); /* From 1001 in a migrated database; the test schema is pushed. */
    expect(r).toMatchObject({ status: 'OPEN', app: 'payroll', requestId: 'req_7Hk2mQ9xLp3vT8wZ', openedBy: 'Meera Pillai' });
    await new Promise((x) => setTimeout(x, 300));
    expect(mails.some((x) => x.key === 'support.ticket_opened' && x.to === sup.email)).toBe(true);

    expect((await request(app).get('/api/support/tickets').set(at(m)).expect(200)).body.tickets.map((t: any) => t.id)).toEqual([r.id]);
    const ownerView = (await request(app).get('/api/support/tickets').set(at(o)).expect(200)).body;
    expect(ownerView.wholeAccount).toBe(true);
    expect(ownerView.tickets.map((t: any) => t.id)).toContain(r.id);

    const other = await company('tkx');
    expect((await request(app).get('/api/support/tickets').set(at(other)).expect(200)).body.tickets).toEqual([]);
    await request(app).get(`/api/support/tickets/${r.id}`).set(at(other)).expect(404);

    /* The owner's own ticket is not the member's to read. */
    const mine = (await open(o, { subject: 'Owner question', app: null }).expect(201)).body.ticket;
    await request(app).get(`/api/support/tickets/${mine.id}`).set(at(m)).expect(404);
  }, 90_000);

  it('checks what is typed: a short subject, an error code that is not one', async () => {
    const o = await company('tkv');
    expect((await open(o, { subject: 'Hi' }).expect(400)).body.error).toMatch(/few words/);
    expect((await open(o, { requestId: 'hello world!' }).expect(400)).body.error).toMatch(/error code/);
    await open(o, { requestId: '' }).expect(201);
  });

  it('CLOR answers: the customer is told by email, sees "CLOR support", never the internal note; a reply opens it again', async () => {
    const o = await company('tkr');
    const sup = await staff('SUPPORT');
    const t = (await open(o).expect(201)).body.ticket;

    await request(app).post(`/api/ops/tickets/${t.id}/reply`).set(sup.h).send({ body: 'Looks like the payslip template, checking.', internal: true }).expect(200);
    mails.length = 0;
    const replied = (await request(app).post(`/api/ops/tickets/${t.id}/reply`).set(sup.h).send({ body: 'Fixed. Please download the payslips again.', solve: true }).expect(200)).body;
    expect(replied.ticket).toMatchObject({ status: 'SOLVED', assignedTo: { id: sup.userId } });
    expect(replied.ticket.messages.map((x: any) => x.internal)).toEqual([false, true, false]);
    expect(mails.find((x) => x.key === 'support.ticket_reply')).toMatchObject({ to: o.email, data: { reply: 'Fixed. Please download the payslips again.' } });

    const seen = (await request(app).get(`/api/support/tickets/${t.id}`).set(at(o)).expect(200)).body.ticket;
    expect(seen.status).toBe('SOLVED');
    expect(seen.messages).toHaveLength(2);
    expect(seen.messages[1]).toMatchObject({ fromStaff: true, author: 'CLOR support' });
    expect(JSON.stringify(seen)).not.toMatch(/checking|payslip template|assignedTo/);

    const again = (await request(app).post(`/api/support/tickets/${t.id}/reply`).set(at(o)).send({ body: 'Still September on two of them.' }).expect(200)).body.ticket;
    expect(again.status).toBe('OPEN');

    /* None of it is in the customer's security activity. */
    const events = await db(() => platformPrisma.authEvent.findMany({ where: { accountId: o.accountId, eventType: { startsWith: 'OPERATOR_TICKET' } } }));
    expect(events).toHaveLength(0);
  }, 60_000);

  it('only Support changes tickets, with a fresh code; read-only staff can read', async () => {
    const o = await company('tkp');
    const t = (await open(o).expect(201)).body.ticket;
    const ro = await staff('READ_ONLY');
    const sup = await staff('SUPPORT');
    const list = (await request(app).get('/api/ops/tickets').set(ro.h).expect(200)).body;
    expect(list.tickets.map((x: any) => x.id)).toContain(t.id);
    expect(list.counts.open).toBeGreaterThan(0);
    await request(app).post(`/api/ops/tickets/${t.id}/reply`).set(ro.h).send({ body: 'x' }).expect(403);
    await request(app).patch(`/api/ops/tickets/${t.id}`).set(ro.h).send({ priority: 'HIGH' }).expect(403);
    /* No step-up token: refused. */
    const bare = { Authorization: sup.h.Authorization };
    expect((await request(app).patch(`/api/ops/tickets/${t.id}`).set(bare).send({ priority: 'HIGH' }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');

    const changed = (await request(app).patch(`/api/ops/tickets/${t.id}`).set(sup.h).send({ priority: 'HIGH', assignedOperatorId: sup.userId }).expect(200)).body.ticket;
    expect(changed).toMatchObject({ priority: 'HIGH', assignedTo: { id: sup.userId } });
    await request(app).patch(`/api/ops/tickets/${t.id}`).set(sup.h).send({ assignedOperatorId: o.userId }).expect(400);
    const found = (await request(app).get('/api/ops/tickets').query({ q: t.code }).set(ro.h).expect(200)).body.tickets;
    expect(found.map((x: any) => x.id)).toEqual([t.id]);

    /* Closed is final for the customer. */
    await request(app).patch(`/api/ops/tickets/${t.id}`).set(sup.h).send({ status: 'CLOSED' }).expect(200);
    expect((await request(app).post(`/api/support/tickets/${t.id}/reply`).set(at(o)).send({ body: 'one more thing' }).expect(409)).body.error).toMatch(/closed/);
  }, 60_000);

  it('the customer can say it is solved', async () => {
    const o = await company('tks');
    const t = (await open(o).expect(201)).body.ticket;
    expect((await request(app).post(`/api/support/tickets/${t.id}/solved`).set(at(o)).expect(200)).body.ticket.status).toBe('SOLVED');
  });
});
