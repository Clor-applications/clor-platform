import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Record extras on the employee file (server picks, theme A, 18 Nov 2026).
 *
 *   HR only (health, second emergency contact)   HR User and the owner; never Viewer or Auditor.
 *   Personal tier (address, food, sizes)         as the existing personal details: Viewer yes, Auditor no.
 *   Work profile (extension, initials, languages) everyone who reads the directory; languages searchable.
 *
 * Each change is in the change log; the lines for fields a role may not see come back redacted.
 */
const { buildApp } = await import('../app.js');
const { hireSourceFromCandidate, normaliseLanguages } = await import('../services/people/recordExtras.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(): Promise<Ctx> {
  const email = `extras.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Extras Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  return ctx;
}
async function withRole(boss: Ctx, label: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body.roles;
  const role = roles.find((r: any) => r.name === label);
  expect(role, label).toBeTruthy();
  const email = `${label.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: label, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId };
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});

const HR_ONLY = ['bloodGroup', 'disability', 'healthNote', 'emergencyContact2Name', 'emergencyContact2Phone', 'emergencyContact2Relation'];
const SECRET_WORDS = ['ASTHMA-NOTE', 'LOWVISION-X', 'Kavya SECONDCONTACT'];

let boss: Ctx;
let emp: any;
const as: Record<string, Ctx> = {};
beforeAll(async () => {
  boss = await owner();
  for (const r of ['HR User', 'Viewer', 'Auditor']) as[r] = await withRole(boss, r);
  emp = (await api(boss).post('/employees', {
    name: 'Meera Iyer', code: `RX-${rnd()}`, phone: '+91 98765 22222', officeExtension: '204', initials: 'MI',
    languages: ['tamil', ' English ', 'Tamil', 'hindi'], hireSource: 'REFERRAL',
    addressLine: '4 Lake Road', city: 'Chennai', permSameAsPresent: true, foodPreference: 'JAIN', shoeSize: '8', uniformSize: 'M',
  }).expect(201)).body.employee;
  /* Health and the second contact written after, so the change log carries lines for them. */
  await api(boss).put(`/employees/${emp.id}`, { bloodGroup: 'O+', disability: 'LOWVISION-X', healthNote: 'ASTHMA-NOTE', emergencyContact2Name: 'Kavya SECONDCONTACT', emergencyContact2Phone: '+91 98765 33333', emergencyContact2Relation: 'Sister' }).expect(200);
}, 120_000);

describe('the record extras', () => {
  it('keeps one spelling per language and carries hiring’s source onto the record', () => {
    expect(normaliseLanguages(['tamil', ' English ', 'Tamil', '', 'hindi'])).toEqual(['Tamil', 'English', 'Hindi']);
    expect(hireSourceFromCandidate('REFERRAL')).toBe('REFERRAL');
    expect(hireSourceFromCandidate('Employee referral')).toBe('REFERRAL');
    expect(hireSourceFromCandidate('LinkedIn')).toBe('JOB_SITE');
    expect(hireSourceFromCandidate('')).toBeNull();
  });

  it('saves every field for HR, with languages tidied', async () => {
    const one = (await api(boss).get(`/employees/${emp.id}`).expect(200)).body.employee;
    expect(one).toMatchObject({ officeExtension: '204', initials: 'MI', hireSource: 'REFERRAL', permSameAsPresent: true, foodPreference: 'JAIN', bloodGroup: 'O+', healthNote: 'ASTHMA-NOTE', emergencyContact2Name: 'Kavya SECONDCONTACT' });
    expect(one.languages).toEqual(['Tamil', 'English', 'Hindi']);
  });

  it('refuses values outside the lists', async () => {
    await api(boss).put(`/employees/${emp.id}`, { bloodGroup: 'Z+' }).expect(400);
    await api(boss).put(`/employees/${emp.id}`, { foodPreference: 'VEGAN' }).expect(400);
    await api(boss).put(`/employees/${emp.id}`, { officeExtension: 'ext 12' }).expect(400);
  });

  it('health and the second emergency contact reach HR User, and never Viewer or Auditor (record, list, activity, journey)', async () => {
    const hr = (await api(as['HR User']).get(`/employees/${emp.id}`).expect(200)).body.employee;
    expect(hr.healthNote).toBe('ASTHMA-NOTE');
    expect(hr.emergencyContact2Name).toBe('Kavya SECONDCONTACT');
    for (const r of ['Viewer', 'Auditor']) {
      const one = (await api(as[r]).get(`/employees/${emp.id}`).expect(200)).body.employee;
      for (const k of HR_ONLY) expect(one, `${r} ${k}`).not.toHaveProperty(k);
      expect(one.hrOnlyHidden, r).toBe(true);
      const list = (await api(as[r]).get('/employees').expect(200)).body.employees.find((e: any) => e.id === emp.id);
      for (const k of HR_ONLY) expect(list, `${r} list ${k}`).not.toHaveProperty(k);
      for (const path of [`/employees/${emp.id}`, '/employees', `/employees/${emp.id}/activity`, `/employees/${emp.id}/journey`]) {
        const res = await api(as[r]).get(path);
        if (res.status !== 200) continue;
        for (const w of SECRET_WORDS) expect(JSON.stringify(res.body), `${r} ${path} ${w}`).not.toContain(w);
      }
    }
  });

  it('the personal tier follows the personal details: Viewer sees food and sizes, Auditor does not', async () => {
    const viewer = (await api(as.Viewer).get(`/employees/${emp.id}`).expect(200)).body.employee;
    expect(viewer.foodPreference).toBe('JAIN');
    const auditor = (await api(as.Auditor).get(`/employees/${emp.id}`).expect(200)).body.employee;
    for (const k of ['foodPreference', 'shoeSize', 'uniformSize', 'permSameAsPresent']) expect(auditor, k).not.toHaveProperty(k);
    /* The work profile reaches everyone who reads the directory. */
    expect(auditor).toMatchObject({ officeExtension: '204', initials: 'MI' });
    expect(auditor.languages).toEqual(['Tamil', 'English', 'Hindi']);
  });

  it('counts food preference for whoever sees personal details, and not for Auditor', async () => {
    expect((await api(boss).get('/employees/counts').expect(200)).body.food).toEqual({ JAIN: 1 });
    expect((await api(as.Viewer).get('/employees/counts').expect(200)).body.food).toEqual({ JAIN: 1 });
    expect((await api(as.Auditor).get('/employees/counts').expect(200)).body.food).toBeUndefined();
  });

  it('finds people by a language they speak, by search or by filter', async () => {
    const byQ = (await api(as.Auditor).get('/employees?q=tamil').expect(200)).body.employees.map((e: any) => e.id);
    expect(byQ).toContain(emp.id);
    const byFilter = (await api(boss).get('/employees?language=hindi').expect(200)).body.employees.map((e: any) => e.id);
    expect(byFilter).toEqual([emp.id]);
    expect((await api(boss).get('/employees?language=kannada').expect(200)).body.employees).toEqual([]);
  });

  it('logs each change, and HR reads it in the activity', async () => {
    const text = JSON.stringify((await api(as['HR User']).get(`/employees/${emp.id}/activity`).expect(200)).body);
    expect(text).toContain('ASTHMA-NOTE');
    await api(boss).put(`/employees/${emp.id}`, { officeExtension: '305' }).expect(200);
    const after = JSON.stringify((await api(boss).get(`/employees/${emp.id}/activity`).expect(200)).body);
    expect(after).toContain('305');
  });
});
