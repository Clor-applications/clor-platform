import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Alerts for CLOR staff (Ops plan P1): the job raises one alert per problem,
 * keeps it fresh while true, closes it when it clears, asks again when a
 * warning turns critical, and mails each new one once to the staff it is for.
 */
const mails: Array<{ key: string; to: string; data: any }> = [];
vi.mock('../services/mailer.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, sendTemplate: async (o: any) => { mails.push({ key: o.templateKey, to: o.to, data: o.data }); return { status: 'SENT' }; } };
});

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { collectFindings, syncAlerts, tellStaff, runAlerts } = await import('../services/ops/alerts.js');
const { at, opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: alerts', fn);
const HOUR = 3_600_000;

describe('what the alerts job finds', () => {
  it('an overdue CLOR invoice, an urgent ticket left unanswered, readers offline and a trial about to end', async () => {
    const c = await company('alrt');
    const now = Date.now();
    const inv = await db(() => platformPrisma.billingInvoice.create({ data: { number: `CLOR/T/${rnd()}`, accountId: c.accountId, status: 'ISSUED', issueDate: new Date(now - 30 * 86_400_000), dueDate: new Date(now - 20 * 86_400_000), total: 118000, booksStatus: 'OFF' } as any }));
    const t = (await request(app).post('/api/support/tickets').set(at(c)).send({ subject: 'Payroll will not run', body: 'The run stops at step two every time.', urgent: true }).expect(201)).body.ticket;
    await db(() => platformPrisma.supportTicket.update({ where: { id: t.id }, data: { lastCustomerAt: new Date(now - 2 * HOUR) } }));
    await db(() => peoplePrisma.attendanceDevice.create({ data: { accountId: c.accountId, orgId: c.orgId, serialNumber: `SN-${rnd()}-${Date.now()}`, name: 'Main gate', createdByUserId: c.userId, lastSeenAt: new Date(now - 3 * HOUR) } as any }));
    await db(() => platformPrisma.subscription.upsert({ where: { accountId: c.accountId }, create: { accountId: c.accountId, status: 'trialing', trialEndsAt: new Date(now + 2 * 86_400_000) } as any, update: { status: 'trialing', trialEndsAt: new Date(now + 2 * 86_400_000) } }));

    const f = await db(() => collectFindings(now));
    const by = (key: string) => f.find((x) => x.key === key);
    expect(by(`invoice:${inv.id}`)).toMatchObject({ severity: 'critical', audience: 'BILLING', accountId: c.accountId, link: { page: 'invoices', id: inv.id } });
    expect(by(`invoice:${inv.id}`)!.title).toMatch(/overdue 20 days/);
    expect(by(`ticket:${t.id}`)).toMatchObject({ severity: 'critical', audience: 'SUPPORT', link: { page: 'tickets', id: t.id } });
    expect(by(`readers:${c.accountId}`)).toMatchObject({ severity: 'warning', title: expect.stringMatching(/1 attendance reader offline/) });
    expect(by(`trial:${c.accountId}`)).toMatchObject({ audience: 'SALES', title: expect.stringMatching(/trial ends in 2 days/) });
  }, 60_000);
});

describe('raising, refreshing and closing alerts', () => {
  const f = (key: string, severity: 'warning' | 'critical' = 'warning', audience: 'SUPPORT' | 'BILLING' | 'SALES' = 'SUPPORT') => ({ key, kind: 'email' as const, severity, audience, title: `Test ${key}` });
  const mine = (key: string) => db(() => platformPrisma.opsAlert.findMany({ where: { key }, orderBy: { firstSeenAt: 'asc' } }));
  /* Other files share the table: run the sync over every open alert plus ours, so theirs are kept. */
  const others = async (except: string[]) => (await db(() => platformPrisma.opsAlert.findMany({ where: { resolvedAt: null, key: { notIn: except } } }))).map((a) => ({ key: a.key, kind: a.kind as any, severity: a.severity as any, audience: a.audience as any, title: a.title }));

  it('opens once, stays one row while true, asks again when it turns critical, closes when it clears', async () => {
    const key = `test:${rnd()}`;
    const r1 = await db(async () => syncAlerts([...(await others([key])), f(key)]));
    expect(r1.opened.map((a: any) => a.key)).toContain(key);
    const r2 = await db(async () => syncAlerts([...(await others([key])), f(key)]));
    expect(r2.opened.map((a: any) => a.key)).not.toContain(key);
    expect(await mine(key)).toHaveLength(1);

    await db(() => platformPrisma.opsAlert.updateMany({ where: { key }, data: { acknowledgedAt: new Date(), acknowledgedBy: 'someone' } }));
    const r3 = await db(async () => syncAlerts([...(await others([key])), f(key, 'critical')]));
    expect(r3.opened.map((a: any) => a.key)).toContain(key);
    expect((await mine(key))[0]).toMatchObject({ severity: 'critical', acknowledgedAt: null });

    await db(async () => syncAlerts(await others([key])));
    const closed = await mine(key);
    expect(closed[0].resolvedAt).not.toBeNull();
    /* It comes back as a new alert if the problem returns. */
    await db(async () => syncAlerts([...(await others([key])), f(key)]));
    expect(await mine(key)).toHaveLength(2);
    await db(async () => syncAlerts(await others([key])));
  });

  it('mails each person only what is for their team; owners get everything', async () => {
    const sup = await staff('SUPPORT');
    const fin = await staff('BILLING');
    const own = await staff('SUPER_ADMIN');
    mails.length = 0;
    await db(() => tellStaff([
      { title: 'Mail stuck', severity: 'warning', audience: 'SUPPORT', detail: null },
      { title: 'Invoice overdue', severity: 'critical', audience: 'BILLING', detail: '₹1,180 unpaid.' },
    ]));
    const to = (email: string) => mails.filter((m) => m.key === 'ops.alerts_opened' && m.to === email);
    expect(to(sup.email)[0].data.list).toMatch(/Mail stuck/);
    expect(to(sup.email)[0].data.list).not.toMatch(/Invoice/);
    expect(to(fin.email)[0].data).toMatchObject({ headline: '1 urgent alert on CLOR' });
    expect(to(own.email)[0].data.count).toBe('2');
  });
});

describe('the Alerts page', () => {
  it('lists open alerts for everyone; only the team it is for acknowledges, with a fresh code', async () => {
    const key = `test-ack:${rnd()}`;
    const others = (await db(() => platformPrisma.opsAlert.findMany({ where: { resolvedAt: null } }))).map((a) => ({ key: a.key, kind: a.kind as any, severity: a.severity as any, audience: a.audience as any, title: a.title }));
    await db(() => syncAlerts([...others, { key, kind: 'invoice', severity: 'warning', audience: 'BILLING', title: 'Test overdue' }]));
    const ro = await staff('READ_ONLY');
    const sup = await staff('SUPPORT');
    const fin = await staff('BILLING');
    const list = (await request(app).get('/api/ops/alerts').set(ro.h).expect(200)).body;
    const a = list.open.find((x: any) => x.key === key);
    expect(a).toMatchObject({ forMe: false, acknowledgedBy: null });
    expect(list.rules.urgentTicketMinutes).toBe(60);
    await request(app).post(`/api/ops/alerts/${a.id}/acknowledge`).set(ro.h).expect(403);
    expect((await request(app).post(`/api/ops/alerts/${a.id}/acknowledge`).set(sup.h).expect(403)).body.error).toMatch(/another team/);
    await request(app).post(`/api/ops/alerts/${a.id}/acknowledge`).set(fin.h).expect(200);
    const after = (await request(app).get('/api/ops/alerts').set(fin.h).expect(200)).body.open.find((x: any) => x.key === key);
    expect(after).toMatchObject({ forMe: true, acknowledgedBy: { id: fin.userId } });
    await db(() => platformPrisma.opsAlert.updateMany({ where: { key }, data: { resolvedAt: new Date() } }));
  });

  it('the whole run works end to end', async () => {
    const r = await runAlerts();
    expect(r).toHaveProperty('findings');
    expect(typeof r.opened).toBe('number');
  }, 60_000);
});

describe('late background jobs', () => {
  it('a few late jobs are one warning each; many at once are one urgent alert', async () => {
    const now = Date.now();
    const w = `test.late.${rnd()}`;
    const runs = (name: string) => [30, 40, 50].map((h) => ({ worker: name, startedAt: new Date(now - h * 3_600_000), finishedAt: new Date(now - h * 3_600_000 + 1000), outcome: 'OK', holder: 'test' }));
    await db(() => platformPrisma.jobRun.createMany({ data: runs(w) as any }));
    let f = await db(() => collectFindings(now));
    const one = f.find((x) => x.key === `worker-late:${w}`) || f.find((x) => x.key === 'workers-late');
    expect(one).toBeTruthy();
    const many = [1, 2, 3].map((i) => `${w}.${i}`);
    await db(() => platformPrisma.jobRun.createMany({ data: many.flatMap(runs) as any }));
    f = await db(() => collectFindings(now));
    expect(f.find((x) => x.key === 'workers-late')).toMatchObject({ severity: 'critical' });
    expect(f.some((x) => x.key.startsWith(`worker-late:${w}`))).toBe(false);
    await db(() => platformPrisma.jobRun.deleteMany({ where: { worker: { startsWith: w } } }));
  });
});
