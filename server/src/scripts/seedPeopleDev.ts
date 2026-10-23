import 'dotenv/config';
/**
 * A People company for local development and browser checks of the People
 * build (docs/people). Synthetic only: nothing here is a real person.
 *
 * Goes through the HTTP API, as seedUiQa.ts does, so every record passes the
 * same rules a person's would. Idempotent by identity: the owner's email is
 * fixed, so a second run signs in and tops up rather than making a second
 * company.
 *
 * Run:
 *   cd server && npx tsx src/scripts/seedPeopleDev.ts
 *
 * Sign in at the web app with the owner below. The password is a local test
 * value for this seeded company only.
 */
import request from 'supertest';

import { buildApp } from '../app.js';

const app = buildApp();

export const PEOPLE_DEV_OWNER = { email: 'people.dev@clor.test', password: 'People-Dev-2026!', name: 'Asha Menon' };
const COMPANY = { companyName: 'Meridian Facilities Pvt Ltd', state: 'Karnataka' };

type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(): Promise<Ctx> {
  const login = await request(app).post('/api/auth/login').send({ email: PEOPLE_DEV_OWNER.email, password: PEOPLE_DEV_OWNER.password });
  let token: string;
  if (login.status === 200) {
    token = login.body.token;
  } else {
    const signup = await request(app).post('/api/auth/signup').send(PEOPLE_DEV_OWNER);
    if (signup.status !== 200) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
    token = signup.body.token;
  }
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  const existing = (me.body?.orgs || []).find((m: any) => m.org?.name === COMPANY.companyName);
  if (existing) return { token, orgId: existing.orgId, branchId: existing.branchId || '' };
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${token}`).send(COMPANY);
  if (setup.status !== 200) throw new Error(`setup-company failed: ${setup.status} ${JSON.stringify(setup.body)}`);
  const ctx = { token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true, payroll: true } });
  return ctx;
}

const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

const DEPARTMENTS = ['Operations', 'Housekeeping', 'Security', 'Finance', 'Design'];
const POSITIONS: Record<string, string[]> = {
  Operations: ['Site supervisor', 'Operations manager'],
  Housekeeping: ['Housekeeping staff', 'Team lead'],
  Security: ['Security guard', 'Security officer'],
  Finance: ['Accountant', 'Payroll executive'],
  Design: ['Designer', 'Senior designer'],
};
const FIRST = ['Meera', 'Ravi', 'Anil', 'Priya', 'Suresh', 'Kavya', 'Imran', 'Lakshmi', 'Deepak', 'Farah', 'Arjun', 'Nisha', 'Vikram', 'Pooja', 'Rahul', 'Sana', 'Mohan', 'Divya', 'Kiran', 'Rekha'];
const LAST = ['Shah', 'Kumar', 'Patil', 'Nair', 'Iyer', 'Reddy', 'Khan', 'Das', 'Verma', 'Joshi'];

async function main() {
  const c = await owner();
  const have = await people(c).get('/employees?limit=500');
  const count = have.body?.employees?.length ?? 0;
  if (count >= 40) {
    console.log(`Meridian Facilities already has ${count} people; nothing to add.`);
    return;
  }
  const depts: Record<string, string> = {};
  const listed = await people(c).get('/structure/departments');
  for (const d of listed.body?.items || []) depts[d.name] = d.id;
  for (const name of DEPARTMENTS) {
    if (!depts[name]) {
      const r = await people(c).post('/structure/departments', { name });
      depts[name] = r.body.item.id;
    }
  }
  const positions: Record<string, string> = {};
  const listedPos = await people(c).get('/structure/job-positions');
  for (const p of listedPos.body?.items || []) positions[p.name] = p.id;
  for (const [dept, names] of Object.entries(POSITIONS)) {
    for (const name of names) {
      if (!positions[name]) {
        const r = await people(c).post('/structure/job-positions', { name, departmentId: depts[dept] });
        positions[name] = r.body.item.id;
      }
    }
  }
  let made = 0;
  for (let i = count; i < 40; i++) {
    const dept = DEPARTMENTS[i % DEPARTMENTS.length];
    const pos = POSITIONS[dept][i % 2];
    const firstName = FIRST[i % FIRST.length];
    const lastName = LAST[(i * 7) % LAST.length];
    const join = new Date(2024, i % 12, 1 + (i % 27));
    const r = await people(c).post('/employees', {
      firstName,
      lastName,
      code: `MF-${String(i + 1).padStart(3, '0')}`,
      departmentId: depts[dept],
      jobPositionId: positions[pos],
      dateOfJoining: join.toISOString().slice(0, 10),
      email: `${firstName}.${lastName}.${i + 1}@meridian.test`.toLowerCase(),
      phone: `98${String(10000000 + i * 7919).slice(0, 8)}`,
      gender: i % 2 ? 'FEMALE' : 'MALE',
    });
    if (r.status === 201) made++;
    else console.warn(`person ${i + 1}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  console.log(`Seeded ${made} people into ${COMPANY.companyName} (org ${c.orgId}). Sign in as ${PEOPLE_DEV_OWNER.email}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
