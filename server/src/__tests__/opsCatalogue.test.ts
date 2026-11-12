import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/** The app catalogue: public to read, the owner's to change, every change on the record. */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { opsKit, lastAudit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await platformPrisma.appCatalogueEntry.deleteMany({ where: { code: 'timesheet' } });
  await new Promise((done) => app.close(done));
});
const { staff } = opsKit(app);

describe('the app catalogue', () => {
  it('is public to read, without hidden apps; only the owner changes it; Workspace cannot be hidden', async () => {
    const pub = (await request(app).get('/api/public/app-catalogue').set('Origin', 'https://clor.in').expect(200)).body.apps;
    expect(pub.map((a: any) => a.code)).toEqual(['books', 'people', 'attendance', 'payroll', 'workspace', 'projects', 'timesheet']);
    expect(pub.find((a: any) => a.code === 'projects')).toMatchObject({ status: 'COMING_SOON', appId: 'projects' });

    const owner = await staff('SUPER_ADMIN');
    const sup = await staff('SUPPORT');
    await request(app).put('/api/ops/apps/timesheet').set(sup.h).send({ status: 'HIDDEN', blurb: 'Later', reason: 'Not yet' }).expect(403);
    await request(app).put('/api/ops/apps/timesheet').set(owner.h).send({ status: 'HIDDEN', blurb: 'Time logged against projects.' }).expect(400);
    await request(app).put('/api/ops/apps/workspace').set(owner.h).send({ status: 'HIDDEN', blurb: 'Your account.', reason: 'Try' }).expect(400);
    await request(app).put('/api/ops/apps/timesheet').set(owner.h).send({ status: 'HIDDEN', blurb: 'Time logged against projects.', reason: 'Not this year' }).expect(200);

    const after = (await request(app).get('/api/public/app-catalogue').expect(200)).body.apps;
    expect(after.map((a: any) => a.code)).not.toContain('timesheet');
    const inOps = (await request(app).get('/api/ops/apps').set(sup.h).expect(200)).body.apps.find((a: any) => a.code === 'timesheet');
    expect(inOps).toMatchObject({ status: 'HIDDEN', changed: true });
    expect((await lastAudit(owner.userId, 'APP_CATALOGUE_CHANGED'))?.detail).toMatchObject({ app: 'Timesheet', from: 'COMING_SOON', to: 'HIDDEN', reason: 'Not this year' });
  }, 90_000);
});
