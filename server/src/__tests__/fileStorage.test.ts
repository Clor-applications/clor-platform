import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * R2 plan (GAP-012 follow-on): documents, punch selfies and compliance
 * evidence live in object storage — R2 in production, memory in this suite —
 * under `org/<orgId>/…`, with the row keeping only the key. Callers see no
 * difference; one company's key never opens for another; the recycle bin can
 * still restore; unneeded objects are swept; closing a company removes them;
 * files already in the database are moved by a job that can stop and resume.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant, runInTenant } = await import('../utils/tenantScope.js');
const { fileStore, keyFor, resetFileStore, sigv4, FileStoreError } = await import('../services/fileStore.js');
const { moveFilesToDatabase, moveFilesToStore } = await import('../services/fileMove.js');
const { checkCompany } = await import('../services/integrity/checks.js');
const { deleteCompanyData } = await import('../services/companyClosure.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
afterEach(() => {
  process.env.FILE_STORE = 'memory';
  resetFileStore();
});
const rnd = () => Math.random().toString(36).slice(2, 8);
const PDF = Buffer.from('%PDF-1.4\n% r2 plan test\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `fs.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'FS owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `FS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
const employee = async (c: Ctx) => (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Rao', code: `F${rnd()}`, dateOfJoining: '2026-01-01' }).expect(201)).body.employee.id as string;
const upload = async (c: Ctx, employeeId: string) =>
  (
    await request(app)
      .post(`/api/orgs/${c.orgId}/people/employees/${employeeId}/documents`)
      .set(at(c))
      .send({ kind: 'OTHER', title: `Offer ${rnd()}`, data: `data:application/pdf;base64,${PDF.toString('base64')}`, mime: 'application/pdf' })
      .expect(201)
  ).body.document.id as string;
/** The row as the database holds it, bytes and all — read straight, not through the store. */
const rawDoc = (id: string) =>
  outsideTenant('test: the row as stored', async () => (await peoplePrisma.$queryRawUnsafe<any[]>(`SELECT "storageKey", length("data") AS n FROM "EmployeeDocument" WHERE id = $1`, id))[0]);

let a: Ctx;
let b: Ctx;
beforeAll(async () => {
  [a, b] = await Promise.all([company(), company()]);
}, 90_000);

describe('a file goes to the store and comes back unchanged', () => {
  it('an uploaded document: the row keeps the key and no bytes; the API returns the file', async () => {
    const docId = await upload(a, await employee(a));
    const row = await rawDoc(docId);
    expect(row.storageKey).toBe(keyFor(a.orgId, 'employee-documents', docId));
    expect(Number(row.n)).toBe(0);
    expect(await fileStore()!.get(a.orgId, row.storageKey)).toEqual(PDF);
    const got = await request(app).get(`/api/orgs/${a.orgId}/people/documents/${docId}`).set(at(a)).expect(200);
    expect(got.body.document.dataUrl).toBe(`data:application/pdf;base64,${PDF.toString('base64')}`);
  });

  it('a punch selfie and compliance evidence, the same way', async () => {
    const empId = await employee(a);
    const photo = await runInTenant(a.orgId, () => peoplePrisma.punchPhoto.create({ data: { accountId: a.accountId, orgId: a.orgId, employeeId: empId, mime: 'image/png', data: PNG } }));
    expect(photo.storageKey).toBe(keyFor(a.orgId, 'punch-photos', photo.id));
    const shown = await request(app).get(`/api/orgs/${a.orgId}/attendance/punch-photos/${photo.id}`).set(at(a)).expect(200);
    expect(shown.body.photo).toBe(`data:image/png;base64,${PNG.toString('base64')}`);

    /* Compliance proof (the calendar's evidence moved here): same store, same kind of key. */
    const ob = (await request(app).post(`/api/orgs/${a.orgId}/people/compliance/obligations`).set(at(a)).send({ title: 'PF challan', dueOn: '2026-11-15' }).expect(201)).body.obligation;
    const proof = (await request(app).post(`/api/orgs/${a.orgId}/people/compliance/obligations/${ob.id}/proofs`).set(at(a)).send({ name: 'challan.pdf', mime: 'application/pdf', dataUrl: `data:application/pdf;base64,${PDF.toString('base64')}` }).expect(201)).body.proof;
    const stored = await runInTenant(a.orgId, () => peoplePrisma.$queryRawUnsafe<any[]>(`SELECT "storageKey", length("data") AS n FROM "ObligationProof" WHERE id = $1`, proof.id));
    expect(stored[0].storageKey).toBe(keyFor(a.orgId, 'compliance-evidence', proof.id));
    expect(Number(stored[0].n)).toBe(0);
    const ev = await request(app).get(`/api/orgs/${a.orgId}/people/compliance/obligations/${ob.id}/proofs/${proof.id}`).set(at(a)).expect(200);
    expect(ev.body.proof.dataUrl).toContain(PDF.toString('base64'));
  });

  it('with no store configured, files stay in the row as before', async () => {
    process.env.FILE_STORE = 'db';
    resetFileStore();
    const docId = await upload(a, await employee(a));
    const row = await rawDoc(docId);
    expect(row.storageKey).toBeNull();
    expect(Number(row.n)).toBe(PDF.length);
  });
});

describe('one company’s key never opens for another', () => {
  it('the store refuses a key outside the company asked for', async () => {
    const key = keyFor(a.orgId, 'employee-documents', 'x');
    await expect(fileStore()!.get(b.orgId, key)).rejects.toBeInstanceOf(FileStoreError);
    await expect(fileStore()!.put(b.orgId, key, PDF)).rejects.toBeInstanceOf(FileStoreError);
    await expect(fileStore()!.get(a.orgId, `org/${a.orgId}/../${b.orgId}/x`)).rejects.toBeInstanceOf(FileStoreError);
  });

  it('company B cannot fetch company A’s stored document', async () => {
    const docId = await upload(a, await employee(a));
    await request(app).get(`/api/orgs/${b.orgId}/people/documents/${docId}`).set(at(b)).expect(404);
  });
});

describe('deleting, restoring, sweeping, closing', () => {
  it('a document in the recycle bin keeps its object and comes back whole', async () => {
    const docId = await upload(a, await employee(a));
    const key = keyFor(a.orgId, 'employee-documents', docId);
    await request(app).delete(`/api/orgs/${a.orgId}/people/documents/${docId}`).set(at(a)).expect(200);
    /* The nightly check must not take an object the bin may still restore. */
    await checkCompany({ accountId: a.accountId, orgId: a.orgId }, { repair: true });
    expect(await fileStore()!.get(a.orgId, key)).toEqual(PDF);
    const bin = (await request(app).get(`/api/orgs/${a.orgId}/recycle-bin`).set(at(a)).expect(200)).body;
    const item = bin.items.find((i: any) => i.kind === 'employeeDocument'); // newest first
    await request(app).post(`/api/orgs/${a.orgId}/recycle-bin/${item.id}/restore`).set(at(a)).expect(200);
    const got = await request(app).get(`/api/orgs/${a.orgId}/people/documents/${docId}`).set(at(a)).expect(200);
    expect(got.body.document.dataUrl).toContain(PDF.toString('base64'));
  });

  it('an object nothing needs is removed by the nightly check; a row whose object is gone is reported', async () => {
    const c = await company();
    const kept = await upload(c, await employee(c));
    const dropped = await upload(c, await employee(c));
    await runInTenant(c.orgId, () => peoplePrisma.employeeDocument.deleteMany({ where: { id: dropped } }));
    await fileStore()!.delete(c.orgId, keyFor(c.orgId, 'employee-documents', kept));
    const found = await checkCompany({ accountId: c.accountId, orgId: c.orgId }, { repair: true });
    expect(found.find((f) => f.sourceId === keyFor(c.orgId, 'employee-documents', dropped))?.repair).toBe('REPAIRED');
    expect(found.find((f) => f.sourceId === kept)?.link).toMatch(/its object in storage/);
    expect(await fileStore()!.list(c.orgId)).toEqual([]);
  }, 60_000);

  it('closing a company deletes its objects with its data', async () => {
    const c = await company();
    await upload(c, await employee(c));
    expect((await fileStore()!.list(c.orgId)).length).toBe(1);
    const counts = await deleteCompanyData(c.orgId);
    expect(counts['files.objects']).toBe(1);
    expect(await fileStore()!.list(c.orgId)).toEqual([]);
  }, 60_000);
});

describe('files already in the database', () => {
  it('are moved by a job that touches only what is left, and can run again', async () => {
    const c = await company();
    process.env.FILE_STORE = 'db';
    resetFileStore();
    const docs = [await upload(c, await employee(c)), await upload(c, await employee(c))];
    expect(Number((await rawDoc(docs[0])).n)).toBe(PDF.length);
    process.env.FILE_STORE = 'memory';
    resetFileStore();
    expect(await moveFilesToStore({ only: [c.orgId] })).toEqual({ moved: 2 });
    for (const id of docs) {
      const row = await rawDoc(id);
      expect(row.storageKey).toBe(keyFor(c.orgId, 'employee-documents', id));
      expect(Number(row.n)).toBe(0);
    }
    expect(await moveFilesToStore({ only: [c.orgId] })).toEqual({ moved: 0 });
    await request(app).get(`/api/orgs/${c.orgId}/people/documents/${docs[1]}`).set(at(c)).expect(200);

    /* And back, for a rollback: the rows hold their bytes again and work with no store at all. */
    expect(await moveFilesToDatabase({ only: [c.orgId] })).toEqual({ restored: 2 });
    process.env.FILE_STORE = 'db';
    resetFileStore();
    expect(await rawDoc(docs[0])).toMatchObject({ storageKey: null });
    expect(Number((await rawDoc(docs[0])).n)).toBe(PDF.length);
    const got = await request(app).get(`/api/orgs/${c.orgId}/people/documents/${docs[0]}`).set(at(c)).expect(200);
    expect(got.body.document.dataUrl).toContain(PDF.toString('base64'));
  }, 60_000);
});

describe('the R2 request signature', () => {
  it('matches AWS’s published Signature Version 4 example (GET object)', () => {
    const auth = sigv4({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      amzDate: '20130524T000000Z',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(auth).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    );
  });
});
