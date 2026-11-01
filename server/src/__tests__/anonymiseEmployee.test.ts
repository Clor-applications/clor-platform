import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Anonymising a former employee (LX-07): personal data erased, what labour,
 * tax and PF law keep left in place, only for someone who has left, only with
 * their name typed, answered to their erasure request, and in the audit log.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `anon.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Anon Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { accountId: true } });
  return { ...ctx, accountId: org.accountId };
}

const anonymise = (c: Ctx, id: string, body: Record<string, unknown>) =>
  request(app).post(`/api/orgs/${c.orgId}/people/employees/${id}/anonymise`).set(at(c)).send(body);

describe('anonymising a former employee', () => {
  it('erases personal data, keeps what the law needs, and answers the erasure request', async () => {
    const c = await makeOwner();
    const made = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c))
      .send({ name: 'Leela Menon', code: 'E900', dateOfJoining: '2025-01-01', phone: '9876543210', personalEmail: 'leela@example.com', addressLine: '12 MG Road', city: 'Kochi', dateOfBirth: '1990-05-05', gender: 'FEMALE' })
      .expect(201)).body.employee;
    const id = made.id;
    const scope = { accountId: c.accountId, orgId: c.orgId, employeeId: id };

    await peoplePrisma.employeeNote.create({ data: { ...scope, body: 'Asked for a transfer', createdByUserId: 'u' } });
    await peoplePrisma.employeeDocument.createMany({
      data: [
        { ...scope, kind: 'ID_PROOF', title: 'Aadhaar', mime: 'application/pdf', size: 3, data: Buffer.from('abc'), uploadedByUserId: 'u' },
        { ...scope, kind: 'CONTRACT', title: 'Offer letter', mime: 'application/pdf', size: 3, data: Buffer.from('abc'), uploadedByUserId: 'u' },
      ],
    });
    await peoplePrisma.devicePunch.create({
      data: { accountId: c.accountId, orgId: c.orgId, deviceId: 'phone', serialNumber: 'PHONE', pin: 'E900', at: new Date('2026-09-01T03:30:00Z'), localTime: '2026-09-01 09:00:00', state: '0', verifyMode: 0, employeeId: id, latitude: 9.93, longitude: 76.26, accuracyM: 12, address: 'MG Road, Kochi' },
    });
    const erasure = await peoplePrisma.dataRequest.create({ data: { ...scope, type: 'ERASURE', details: 'Please erase my data', status: 'PENDING' } });
    /* PRV-04: the free text that used to be left behind — a candidate record from before the hire (not linked by id),
       an HR case on their file, a checklist note, an earlier privacy request, and the reason on their history. */
    const candidate = await peoplePrisma.peopleRecord.create({ data: { accountId: c.accountId, orgId: c.orgId, kind: 'candidates', title: 'Leela Menon', status: 'HIRED', details: { email: 'leela@example.com', phone: '9876543210', notes: 'Strong at Excel' }, createdBy: 'u', updatedBy: 'u' } });
    const hrCase = await peoplePrisma.peopleRecord.create({ data: { ...scope, kind: 'helpdesk', title: 'PF number wrong', status: 'OPEN', details: { description: 'My UAN shows Leela Menon with the wrong DOB', priority: 'NORMAL' }, createdBy: 'u', updatedBy: 'u' } });
    const task = await peoplePrisma.checklistTask.create({ data: { ...scope, kind: 'LEAVING', title: 'Collect laptop', owner: 'IT', note: 'Lives at 12 MG Road, Kochi' } });
    const access = await peoplePrisma.dataRequest.create({ data: { ...scope, type: 'ACCESS', details: 'Send everything to leela@example.com', status: 'RESOLVED', resolution: 'Sent' } });

    /* Still employed: refused. */
    const early = await anonymise(c, id, { confirmName: 'Leela Menon' });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('STILL_EMPLOYED');

    await peoplePrisma.employee.update({ where: { id }, data: { status: 'LEFT', dateOfLeaving: '2026-09-30' } });

    /* The name must be typed. */
    const wrong = await anonymise(c, id, { confirmName: 'Leela' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('CONFIRM_NAME');

    const ok = await anonymise(c, id, { confirmName: 'leela menon', dataRequestId: erasure.id }).expect(200);
    expect(ok.body.requestResolved).toBe(true);
    expect(ok.body.result.erased).toMatchObject({ hrNotes: 1, documents: 1, punchLocations: 1, registers: 2, checklistNotes: 1, dataRequests: 2 });

    /* Nothing personal left in the free text anywhere on People's side. */
    for (const needle of ['leela@example.com', '9876543210', 'MG Road']) {
      const [{ n }] = await peoplePrisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "PeopleRecord" WHERE "orgId" = ${c.orgId} AND "details"::text ILIKE ${'%' + needle + '%'}`;
      expect(Number(n), needle).toBe(0);
    }
    expect((await peoplePrisma.peopleRecord.findUniqueOrThrow({ where: { id: candidate.id } })).title).toBe('Anonymised');
    expect((await peoplePrisma.peopleRecord.findUniqueOrThrow({ where: { id: hrCase.id } })).title).toBe('PF number wrong');
    expect((await peoplePrisma.checklistTask.findUniqueOrThrow({ where: { id: task.id } })).note).toBeNull();
    expect((await peoplePrisma.dataRequest.findUniqueOrThrow({ where: { id: access.id } })).details).toBe('[erased]');

    const after = await peoplePrisma.employee.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ name: 'Leela Menon', code: 'E900', dateOfJoining: '2025-01-01', dateOfLeaving: '2026-09-30', phone: null, personalEmail: null, addressLine: null, city: null, dateOfBirth: null, gender: null, portalEnabled: false });
    expect(after.anonymisedAt).toBeTruthy();

    const docs = await peoplePrisma.employeeDocument.findMany({ where: scope, select: { kind: true } });
    expect(docs.map((d) => d.kind)).toEqual(['CONTRACT']);
    expect(await peoplePrisma.employeeNote.count({ where: scope })).toBe(0);
    const punch = await peoplePrisma.devicePunch.findFirstOrThrow({ where: { ...scope } });
    expect(punch).toMatchObject({ latitude: null, longitude: null, address: null, localTime: '2026-09-01 09:00:00' });

    const req2 = await peoplePrisma.dataRequest.findUniqueOrThrow({ where: { id: erasure.id } });
    expect(req2.status).toBe('RESOLVED');
    expect(req2.resolution).toMatch(/erased/);

    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'Employee', entityId: id, action: 'ANONYMISE' } });
    expect(audit?.message).toMatch(/Anonymised Leela Menon \(E900\)/);

    /* Once only. */
    const again = await anonymise(c, id, { confirmName: 'Leela Menon' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_ANONYMISED');
  });

  it('is refused for another company’s employee', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const theirs = (await request(app).post(`/api/orgs/${b.orgId}/people/employees`).set(at(b)).send({ name: 'Other Person', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    const res = await anonymise(a, theirs.id, { confirmName: 'Other Person' });
    expect(res.status).toBe(404);
  });
});
