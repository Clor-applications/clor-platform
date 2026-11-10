import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Announcements from CLOR (Ops plan P1): Support writes a draft, publishes it
 * and ends it, each audited; customers see only live ones for their apps and
 * role; news can be closed per person, a problem notice cannot.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { bearer, lastAudit, opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: announcements', fn);

/** A customer that owns exactly these apps, in good standing. */
async function customer(apps: string[]) {
  const c = await company('ann');
  await db(async () => {
    await platformPrisma.subscription.deleteMany({ where: { accountId: c.accountId } });
    await platformPrisma.subscription.create({
      data: { accountId: c.accountId, status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), items: { create: apps.map((appCode) => ({ appCode })) } } as any,
    });
  });
  return c;
}

const seen = async (c: { token: string }) => (await request(app).get('/api/announcements').set(bearer(c)).expect(200)).body.announcements as Array<{ id: string; dismissible: boolean }>;
const ids = async (c: { token: string }) => (await seen(c)).map((a) => a.id);

describe('announcements', () => {
  it('a draft shows to nobody; published it shows to the apps it is for; ended it goes', async () => {
    const sup = await staff('SUPPORT');
    const people = await customer(['people']);
    const books = await customer(['accounting']);
    const title = `People maintenance ${rnd()}`;
    const a = (await request(app).post('/api/ops/announcements').set(sup.h).send({ title, body: 'People is down for ten minutes at 11 pm tonight.', kind: 'maintenance', apps: ['people'] }).expect(201)).body.announcement;
    expect(a).toMatchObject({ status: 'draft', apps: ['people'], audience: 'everyone' });
    expect(await ids(people)).not.toContain(a.id);

    const pub = (await request(app).post(`/api/ops/announcements/${a.id}/publish`).set(sup.h).expect(200)).body.announcement;
    expect(pub.status).toBe('live');
    expect(await lastAudit(sup.userId, 'ANNOUNCEMENT_PUBLISHED')).toMatchObject({ targetAccountId: null });
    expect(await ids(people)).toContain(a.id);
    expect(await ids(books)).not.toContain(a.id);
    await request(app).post(`/api/ops/announcements/${a.id}/publish`).set(sup.h).expect(409);
    await request(app).delete(`/api/ops/announcements/${a.id}`).set(sup.h).expect(409);

    await request(app).post(`/api/ops/announcements/${a.id}/end`).set(sup.h).expect(200);
    expect(await ids(people)).not.toContain(a.id);
    await request(app).patch(`/api/ops/announcements/${a.id}`).set(sup.h).send({ title: 'Too late to change' }).expect(409);
  }, 60_000);

  it('news can be closed for one person; a problem notice cannot; admins-only skips members', async () => {
    const sup = await staff('SUPPORT');
    const owner = await customer(['people']);
    const mk = async (body: Record<string, unknown>) => {
      const a = (await request(app).post('/api/ops/announcements').set(sup.h).send({ body: 'Something worth knowing about today.', ...body }).expect(201)).body.announcement;
      await request(app).post(`/api/ops/announcements/${a.id}/publish`).set(sup.h).expect(200);
      return a.id as string;
    };
    const news = await mk({ title: `New letters ${rnd()}`, kind: 'info' });
    const fire = await mk({ title: `Payslips slow ${rnd()}`, kind: 'incident' });
    const admins = await mk({ title: `Price change ${rnd()}`, audience: 'admins' });

    const list = await seen(owner);
    const mine = list.filter((a) => [news, fire, admins].includes(a.id)).map((a) => a.id);
    /* The problem being fixed comes first. */
    expect(mine[0]).toBe(fire);
    expect(mine).toEqual(expect.arrayContaining([news, admins]));

    await request(app).post(`/api/announcements/${news}/dismiss`).set(bearer(owner)).expect(200);
    expect(await ids(owner)).not.toContain(news);
    await request(app).post(`/api/announcements/${fire}/dismiss`).set(bearer(owner)).expect(409);
    await request(app).post(`/api/announcements/${news}/dismiss`).set(bearer(owner)).expect(404);

    /* A plain member of the same account does not see the admins-only one. */
    const member = await customer(['people']);
    await db(() => platformPrisma.accountMembership.updateMany({ where: { accountId: member.accountId, userId: member.userId }, data: { role: 'MEMBER' } }));
    const m = await ids(member);
    expect(m).toContain(news);
    expect(m).not.toContain(admins);

    for (const id of [news, fire, admins]) await request(app).post(`/api/ops/announcements/${id}/end`).set(sup.h).expect(200);
  }, 60_000);

  it('scheduled ones wait for their start; times and fields are checked; only Support may write; customers cannot reach the console', async () => {
    const sup = await staff('SUPPORT');
    const ro = await staff('READ_ONLY');
    const sales = await staff('SALES');
    const c = await customer(['people']);
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const a = (await request(app).post('/api/ops/announcements').set(sup.h).send({ title: `Later ${rnd()}`, body: 'This one starts in three hours.', startsAt: later }).expect(201)).body.announcement;
    expect((await request(app).post(`/api/ops/announcements/${a.id}/publish`).set(sup.h).expect(200)).body.announcement.status).toBe('scheduled');
    expect(await ids(c)).not.toContain(a.id);

    await request(app).post('/api/ops/announcements').set(sup.h).send({ title: 'Bad times', body: 'Ends before it starts, which is wrong.', startsAt: later, endsAt: new Date().toISOString() }).expect(400);
    await request(app).post('/api/ops/announcements').set(sup.h).send({ title: 'Bad app', body: 'An app that does not exist anywhere.', apps: ['nonsense'] }).expect(400);
    await request(app).post('/api/ops/announcements').set(ro.h).send({ title: 'Read only', body: 'Read-only staff cannot write these.' }).expect(403);
    await request(app).post('/api/ops/announcements').set(sales.h).send({ title: 'Sales', body: 'Sales staff cannot write these either.' }).expect(403);
    const list = (await request(app).get('/api/ops/announcements').set(ro.h).expect(200)).body;
    expect(list.announcements.find((x: any) => x.id === a.id)).toMatchObject({ status: 'scheduled', writtenBy: expect.any(String) });
    expect(list.counts.scheduled).toBeGreaterThanOrEqual(1);
    await request(app).get('/api/ops/announcements').set(bearer(c)).expect(403);

    /* A draft can be deleted. */
    const d = (await request(app).post('/api/ops/announcements').set(sup.h).send({ title: `Draft ${rnd()}`, body: 'Never published, so it can go.' }).expect(201)).body.announcement;
    await request(app).delete(`/api/ops/announcements/${d.id}`).set(sup.h).expect(200);
    await request(app).post(`/api/ops/announcements/${a.id}/end`).set(sup.h).expect(200);
  }, 60_000);
});
