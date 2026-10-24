import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * GAP-012 (Batch 11): files — employee documents, punch selfies, compliance
 * evidence, mail attachments — are kept in the database and handed out by
 * five routes. None may reach another company, another employee, or a
 * manager the person does not report to; none may be kept by a browser or
 * proxy cache; and every table holding them is under forced row-level
 * security, so a query that forgets its company sees nothing.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant, runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

/* The smallest file that is still a PDF, and a one-pixel PNG. */
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `fb.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'FB owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `FB Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: (jwt.decode(signup.body.token) as any).accountId };
}

/** An employee with the portal activated; returns their id and a portal token. */
async function employee(c: Ctx, name: string) {
  const code = `F${rnd().toUpperCase()}`;
  const emp = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name, code, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  const list = await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200);
  const activationCode = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [emp.id] }).expect(200)).body.codes[0].activationCode;
  const activated = await request(app).post('/api/portal/activate').send({ company: list.body.company.code, employeeCode: code, activationCode, password: 'mine pass 1' }).expect(200);
  return { id: emp.id as string, portal: activated.body.token as string };
}
const portal = (token: string) => ({ get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`) });

async function upload(c: Ctx, employeeId: string, visibleToEmployee: boolean) {
  const r = await request(app)
    .post(`/api/orgs/${c.orgId}/people/employees/${employeeId}/documents`)
    .set(at(c))
    .send({ kind: 'OTHER', title: `Offer letter ${rnd()}`, data: `data:application/pdf;base64,${PDF.toString('base64')}`, mime: 'application/pdf', visibleToEmployee });
  expect(r.status).toBe(201);
  return r.body.document.id as string;
}

/** A field punch with a selfie, as the phone leaves it (outside every site, so a manager decides it). */
async function fieldPunch(c: Ctx, employeeId: string) {
  return outsideTenant('test: a field punch with a selfie', async () => {
    const photo = await peoplePrisma.punchPhoto.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, mime: 'image/png', data: PNG } });
    const at_ = new Date();
    const punch = await peoplePrisma.devicePunch.create({
      data: { accountId: c.accountId, orgId: c.orgId, deviceId: 'phone', serialNumber: 'PHONE', pin: employeeId, at: at_, localTime: at_.toISOString().slice(0, 19), state: 'IN', employeeId, photoId: photo.id, outsideSite: true, reviewStatus: 'PENDING' },
    });
    return { photoId: photo.id, punchId: punch.id };
  });
}

/** A compliance deadline with a filed challan attached. */
async function evidence(c: Ctx) {
  return outsideTenant('test: compliance evidence', async () =>
    (
      await peoplePrisma.complianceTask.create({
        data: { accountId: c.accountId, orgId: c.orgId, code: 'CUSTOM', period: `custom-${rnd()}`, title: 'PF challan', dueDate: '2026-11-15', evidenceName: 'challan.pdf', evidenceMime: 'application/pdf', evidenceData: PDF },
      })
    ).id
  );
}

let a: Ctx;
let b: Ctx;
let manager: { id: string; portal: string };
let asha: { id: string; portal: string };
let ravi: { id: string; portal: string };
let bEmp: { id: string; portal: string };
let ashaDoc: string;
let hiddenDoc: string;
let punch: { photoId: string; punchId: string };
let taskId: string;
beforeAll(async () => {
  [a, b] = await Promise.all([company(), company()]);
  manager = await employee(a, 'Meena Iyer');
  asha = await employee(a, 'Asha Rao');
  ravi = await employee(a, 'Ravi Kumar');
  bEmp = await employee(b, 'Bala Das');
  await outsideTenant('test: Asha reports to Meena', () => peoplePrisma.employee.update({ where: { id: asha.id }, data: { reportingManagerId: manager.id } }));
  ashaDoc = await upload(a, asha.id, true);
  hiddenDoc = await upload(a, asha.id, false);
  punch = await fieldPunch(a, asha.id);
  taskId = await evidence(a);
}, 120_000);

describe('staff: a file stays in its company', () => {
  it('company A’s own staff open each file', async () => {
    const doc = await request(app).get(`/api/orgs/${a.orgId}/people/documents/${ashaDoc}`).set(at(a)).expect(200);
    expect(doc.body.document.dataUrl).toBe(`data:application/pdf;base64,${PDF.toString('base64')}`);
    await request(app).get(`/api/orgs/${a.orgId}/attendance/punch-photos/${punch.photoId}`).set(at(a)).expect(200);
    const ev = await request(app).get(`/api/orgs/${a.orgId}/people/compliance/${taskId}/evidence`).set(at(a)).expect(200);
    expect(ev.body.evidence.name).toBe('challan.pdf');
  });

  it('company B asking under its own address finds nothing', async () => {
    for (const p of [`/people/documents/${ashaDoc}`, `/attendance/punch-photos/${punch.photoId}`, `/people/compliance/${taskId}/evidence`]) {
      const r = await request(app).get(`/api/orgs/${b.orgId}${p}`).set(at(b));
      expect(r.status, p).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain(PDF.toString('base64'));
    }
  });

  it('company B asking under company A’s address is refused', async () => {
    for (const p of [`/people/documents/${ashaDoc}`, `/attendance/punch-photos/${punch.photoId}`, `/people/compliance/${taskId}/evidence`]) {
      const r = await request(app).get(`/api/orgs/${a.orgId}${p}`).set({ ...at(b), 'x-org-id': a.orgId });
      expect(r.status, p).toBe(403);
    }
  });

  it('in the database, company B’s scope sees none of company A’s files', async () => {
    const count = (orgId: string) =>
      runInTenant(orgId, async () => ({
        docs: await peoplePrisma.employeeDocument.count({ where: { id: { in: [ashaDoc, hiddenDoc] } } }),
        photos: await peoplePrisma.punchPhoto.count({ where: { id: punch.photoId } }),
        tasks: await peoplePrisma.complianceTask.count({ where: { id: taskId } }),
      }));
    /* The same query under company A's scope finds them, so the zero below is the boundary, not a bad query. */
    expect(await count(a.orgId)).toEqual({ docs: 2, photos: 1, tasks: 1 });
    expect(await count(b.orgId)).toEqual({ docs: 0, photos: 0, tasks: 0 });
  });
});

describe('employee app: a file stays with its person', () => {
  it('Asha opens her own visible document, not the one HR keeps back', async () => {
    const own = await portal(asha.portal).get(`/documents/${ashaDoc}`).expect(200);
    expect(own.body.document.dataUrl).toContain(PDF.toString('base64'));
    await portal(asha.portal).get(`/documents/${hiddenDoc}`).expect(404);
    const list = (await portal(asha.portal).get('/documents').expect(200)).body.documents.map((d: any) => d.id);
    expect(list).toEqual([ashaDoc]);
  });

  it('a colleague, and an employee of another company, cannot open it', async () => {
    await portal(ravi.portal).get(`/documents/${ashaDoc}`).expect(404);
    await portal(bEmp.portal).get(`/documents/${ashaDoc}`).expect(404);
  });

  it('only the manager Asha reports to sees her punch selfie', async () => {
    await portal(manager.portal).get(`/approvals/punch/${punch.punchId}/photo`).expect(200);
    expect((await portal(ravi.portal).get(`/approvals/punch/${punch.punchId}/photo`)).status).toBe(403);
    expect((await portal(asha.portal).get(`/approvals/punch/${punch.punchId}/photo`)).status).toBe(403);
    expect((await portal(bEmp.portal).get(`/approvals/punch/${punch.punchId}/photo`)).status).toBe(404);
  });
});

describe('no copy is kept on the way', () => {
  it('every file response says private, no-store', async () => {
    const responses = [
      await request(app).get(`/api/orgs/${a.orgId}/people/documents/${ashaDoc}`).set(at(a)),
      await request(app).get(`/api/orgs/${a.orgId}/attendance/punch-photos/${punch.photoId}`).set(at(a)),
      await request(app).get(`/api/orgs/${a.orgId}/people/compliance/${taskId}/evidence`).set(at(a)),
      await portal(asha.portal).get(`/documents/${ashaDoc}`),
      await portal(manager.portal).get(`/approvals/punch/${punch.punchId}/photo`),
    ];
    for (const r of responses) expect(r.status, r.req.path).toBe(200);
    /* Listed together, so a failure names every route that lets a copy be kept. */
    const kept = responses.filter((r) => !/private/.test(r.headers['cache-control'] || '') || !/no-store/.test(r.headers['cache-control'] || '')).map((r) => `${r.req.path} → ${r.headers['cache-control'] ?? '(none)'}`);
    expect(kept).toEqual([]);
  });
});

describe('every table that holds a file is under forced row-level security', () => {
  const forced = async (client: any, tables: string[]) =>
    outsideTenant('test: row-level security on file tables', () =>
      client.$queryRawUnsafe(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relname = ANY($1::text[])`, tables)
    ) as Promise<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>;

  it('people: documents, selfies, compliance evidence', async () => {
    const rows = await forced(peoplePrisma, ['EmployeeDocument', 'PunchPhoto', 'ComplianceTask']);
    expect(rows.map((r) => r.relname).sort()).toEqual(['ComplianceTask', 'EmployeeDocument', 'PunchPhoto']);
    for (const r of rows) expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('platform: mail attachments', async () => {
    const rows = await forced(platformPrisma, ['EmailOutbox']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
