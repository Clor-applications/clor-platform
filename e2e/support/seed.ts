/**
 * The scenario world, built through the API (setup only; TEAM.md).
 *
 *   Asha Textiles <run>  Karnataka, 12 people, People + Time switched on
 *   Vels Traders <run>   Tamil Nadu, same account (A4)
 *   Other Co <run>       a separate account (B1, B2)
 *
 * Personas (docs/people/qa/PERSONA-SCENARIOS.md):
 *   Suresh  owner          web     (account owner; also on the employee list)
 *   Kavya   HR             web     role "HR Manager" (People admin)
 *   Rahul   manager of 4   web     role "Team Manager" (own team only)
 *   Priya   in Rahul's team         employee app
 *   Arjun   in Neha's team          employee app
 *   Meena   in Neha's team          employee app (H4 puts her on notice)
 * Imran, Lakshmi and Deepak are Rahul's other three reports; they have the
 * employee app too, so manager scenarios have requests that are not Priya's
 * (Priya's own balance is what the employee scenarios read).
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { as, auth, portal, type Session } from './api';
import { HOLIDAY_DAY, HOLIDAY_WEEK, iso, todayIST, weekday } from './dates';
import { stateDir, worldFile, type Company, type Device, type Person, type World } from './world';

/* Local runs use a fixed test value for a throwaway database; staging must be given one. */
const password = process.env.E2E_PASSWORD || (process.env.E2E_TARGET === 'staging' ? '' : 'E2e-Local-Passw0rd!26');
const mailDomain = process.env.E2E_MAIL_DOMAIN || 'e2e.clor.test';

type Spec = { key: string; first: string; last: string; dept: string; designation: string; manager: string | null; web?: boolean; app?: boolean };

const ASHA: Spec[] = [
  { key: 'suresh', first: 'Suresh', last: 'Rao', dept: 'Management', designation: 'Managing director', manager: null, web: true },
  { key: 'kavya', first: 'Kavya', last: 'Nair', dept: 'Human resources', designation: 'HR executive', manager: 'suresh', web: true },
  { key: 'rahul', first: 'Rahul', last: 'Menon', dept: 'Production', designation: 'Production manager', manager: 'suresh', web: true },
  { key: 'priya', first: 'Priya', last: 'Sharma', dept: 'Production', designation: 'Weaver', manager: 'rahul', app: true },
  { key: 'imran', first: 'Imran', last: 'Khan', dept: 'Production', designation: 'Weaver', manager: 'rahul', app: true },
  { key: 'lakshmi', first: 'Lakshmi', last: 'Patil', dept: 'Production', designation: 'Dyer', manager: 'rahul', app: true },
  { key: 'deepak', first: 'Deepak', last: 'Verma', dept: 'Production', designation: 'Dyer', manager: 'rahul', app: true },
  { key: 'neha', first: 'Neha', last: 'Joshi', dept: 'Sales', designation: 'Sales lead', manager: 'suresh' },
  { key: 'arjun', first: 'Arjun', last: 'Das', dept: 'Sales', designation: 'Sales executive', manager: 'neha', app: true },
  { key: 'meena', first: 'Meena', last: 'Iyer', dept: 'Sales', designation: 'Sales executive', manager: 'neha', app: true },
  { key: 'farah', first: 'Farah', last: 'Reddy', dept: 'Accounts', designation: 'Accountant', manager: 'suresh' },
  { key: 'vikram', first: 'Vikram', last: 'Kumar', dept: 'Accounts', designation: 'Accounts assistant', manager: 'farah' },
];
const VELS: Spec[] = [
  { key: 'vel', first: 'Velmurugan', last: 'Sekar', dept: 'Operations', designation: 'Store manager', manager: null },
  { key: 'selvi', first: 'Selvi', last: 'Raman', dept: 'Operations', designation: 'Cashier', manager: 'vel' },
];
const OTHER: Spec[] = [{ key: 'zubin', first: 'Zubin', last: 'Outsidewala', dept: 'Admin', designation: 'Clerk', manager: null }];

/* Ten digits, different per person and per run (phones are matched across an account). */
const phoneFor = (run: string, i: number) => `9${String(100000000 + ((parseInt(run.slice(-4), 36) * 37 + i * 7919) % 899999999)).padStart(9, '0')}`;

async function company(token: string, name: string, state: string): Promise<{ s: Session; c: Company }> {
  const made = await auth.setupCompany(token, name, state);
  const s = { token, orgId: made.company.orgId, branchId: made.branch.id };
  await as(s).put(`/orgs/${s.orgId}/features`, { features: { people: true, attendance: true, peopleHiring: true, peoplePerformance: true, peopleEngage: true, peopleBenefits: true } });
  const me = await auth.me(token);
  const code = String(me.orgs.find((o: any) => o.orgId === s.orgId)?.org?.code || '');
  return { s, c: { name, orgId: s.orgId, branchId: s.branchId, code } };
}

async function staff(run: string, s: Session, specs: Spec[], prefix: string, emails: Record<string, string>) {
  const api = as(s);
  const base = `/orgs/${s.orgId}/people`;
  const depts: Record<string, string> = {};
  const desigs: Record<string, string> = {};
  for (const sp of specs) {
    if (!depts[sp.dept]) depts[sp.dept] = (await api.post(`${base}/structure/departments`, { name: sp.dept })).item.id;
    if (!desigs[sp.designation]) desigs[sp.designation] = (await api.post(`${base}/structure/job-positions`, { name: sp.designation, departmentId: depts[sp.dept] })).item.id;
  }
  const out: Record<string, Person> = {};
  let i = 0;
  for (const sp of specs) {
    i += 1;
    const code = `${prefix}-${String(i).padStart(3, '0')}`;
    const email = emails[sp.key];
    const phone = sp.app ? phoneFor(run, i) : undefined;
    const body = {
      firstName: sp.first,
      lastName: sp.last,
      code,
      departmentId: depts[sp.dept],
      jobPositionId: desigs[sp.designation],
      reportingManagerId: sp.manager ? out[sp.manager].id : undefined,
      dateOfJoining: '2025-04-01',
      gender: ['priya', 'kavya', 'lakshmi', 'meena', 'neha', 'farah', 'selvi'].includes(sp.key) ? 'FEMALE' : 'MALE',
      ...(email ? { email, workEmail: email } : {}),
      ...(phone ? { phone } : {}),
      /* Private details a manager must not see (M6). */
      ...(sp.key === 'priya' ? { dateOfBirth: '1996-05-14', addressLine: '12 Temple Road, Chamundipuram', city: 'Mysuru', emergencyContactName: 'Anita Sharma', emergencyContactPhone: '9845011122', emergencyContactRelation: 'Mother' } : {}),
    };
    const e = (await api.post(`${base}/employees`, body)).employee;
    out[sp.key] = { key: sp.key, name: `${sp.first} ${sp.last}`, code, id: e.id, department: sp.dept, designation: sp.designation, manager: sp.manager, email, phone };
  }
  return out;
}

async function webUser(owner: Session, email: string, fullName: string, roleName: string) {
  const roles = (await as(owner).get(`/orgs/${owner.orgId}/roles`)).roles as Array<{ id: string; name: string }>;
  const role = roles.find((r) => r.name === roleName);
  if (!role) throw new Error(`No role named ${roleName}; have ${roles.map((r) => r.name).join(', ')}`);
  const user = (await as(owner).post('/users', { email, fullName, password, orgIds: [owner.orgId], branchIdsByOrg: { [owner.orgId]: [owner.branchId] } })).user;
  await as(owner).post(`/orgs/${owner.orgId}/users/${user.id}/roles`, { roleId: role.id, branchId: null });
  /* Their sign-in finds their employee file by email the first time they open their own leave. */
  const { token } = await auth.login(email, password);
  await as({ token, orgId: owner.orgId, branchId: owner.branchId }).get(`/orgs/${owner.orgId}/attendance/me/leave`);
}

export async function seed(device: Device): Promise<World> {
  const run = `${process.env.E2E_RUN || Date.now().toString(36).slice(-5)}${device[0]}`;
  const mail = (who: string) => `${who}.${run}@${mailDomain}`;
  if (!password) throw new Error('E2E_PASSWORD must be set for a staging run.');
  const started = Date.now();
  const users = {
    owner: { email: mail('suresh'), name: 'Suresh Rao' },
    hr: { email: mail('kavya'), name: 'Kavya Nair' },
    manager: { email: mail('rahul'), name: 'Rahul Menon' },
    otherOwner: { email: mail('zubin'), name: 'Zubin Outsidewala' },
  };

  /* The owner, two companies in one account. */
  const { token } = await auth.signup(users.owner.email, password, users.owner.name);
  const asha = await company(token, `Asha Textiles ${run}`, 'Karnataka');
  const people = await staff(run, asha.s, ASHA, 'AT', { suresh: users.owner.email, kavya: users.hr.email, rahul: users.manager.email });

  /* Leave policy: Casual (half days allowed) and Earned, a holiday three weeks out. */
  const api = as(asha.s);
  const lv = `/orgs/${asha.s.orgId}/attendance/leave`;
  const casual = (await api.post(`${lv}/types`, { name: 'Casual leave', code: 'CL', isPaid: true, annualDays: 12, accrual: 'YEARLY', allowHalfDay: true })).type;
  const earned = (await api.post(`${lv}/types`, { name: 'Earned leave', code: 'EL', isPaid: true, annualDays: 15, accrual: 'YEARLY', allowHalfDay: false })).type;
  const holiday = { date: weekday(HOLIDAY_WEEK, HOLIDAY_DAY), name: `Founders day ${run}` };
  await api.post(`/orgs/${asha.s.orgId}/attendance/holidays`, { date: holiday.date, name: holiday.name });
  /* Lakshmi came in on the last working day and never punched out (R2): set at setup, so the first wake of the missing-punch job finds it. */
  /* (Never fails the world: R2 fails on its own if this did not take.) */
  await markMissedPunch(asha.s, people.lakshmi.id).catch((e) => console.warn(`[e2e seed] missed punch for R2 not set: ${String(e?.message || e).slice(0, 200)}`));

  /* Web users with their roles (A3 is checked in the browser by the A-scenarios). */
  await webUser(asha.s, users.hr.email, users.hr.name, 'HR Manager');
  await webUser(asha.s, users.manager.email, users.manager.name, 'Team Manager');

  /* The employee app for the people who use it: a code each, activated with the run's password. */
  const appKeys = ASHA.filter((p) => p.app).map((p) => p.key);
  const sent = await as(asha.s).post(`/orgs/${asha.s.orgId}/people/app-access/send`, { employeeIds: appKeys.map((k) => people[k].id) });
  const appUsers: World['appUsers'] = {};
  for (const k of appKeys) {
    const row = sent.sent.find((x: any) => x.employeeId === people[k].id);
    if (!row?.activationCode) throw new Error(`No activation code for ${k}: ${JSON.stringify(sent).slice(0, 300)}`);
    await portal.activate(asha.c.code, people[k].code, row.activationCode, password);
    appUsers[k] = { company: asha.c.code, code: people[k].code, name: people[k].name };
  }

  /* Vels Traders, same account. */
  const vels = await company(token, `Vels Traders ${run}`, 'Tamil Nadu');
  const velsPeople = await staff(run, vels.s, VELS, 'VT', {});

  /* Other Co, a different account altogether. */
  const other = await auth.signup(users.otherOwner.email, password, users.otherOwner.name);
  const otherCo = await company(other.token, `Other Co ${run}`, 'Maharashtra');
  const otherPeople = await staff(run, otherCo.s, OTHER, 'OC', {});

  const w: World = {
    run,
    device,
    password,
    asha: asha.c,
    vels: vels.c,
    other: otherCo.c,
    users,
    appUsers,
    people,
    velsPeople,
    otherPeople,
    leave: { casualId: casual.id, earnedId: earned.id, casualDays: 12, holiday },
  };
  mkdirSync(stateDir(device), { recursive: true });
  writeFileSync(worldFile(device), JSON.stringify(w, null, 2));
  console.log(`[e2e seed] ${device} run ${run}: Asha Textiles (12), Vels Traders (2), Other Co (1) in ${Math.round((Date.now() - started) / 100) / 10}s`);
  return w;
}

/** A leave request made in the employee app's name (setup for the manager scenarios). */
export async function appLeave(w: World, who: string, from: string, to: string, reason: string, typeId = w.leave.casualId) {
  const u = w.appUsers[who];
  const { token } = await portal.login(u.company, u.code, w.password);
  return portal.as(token).post('/portal/leave', { leaveTypeId: typeId, fromDate: from, toDate: to, reason }).then((r: any) => r.request || r);
}

/** A web user's own leave request (Rahul's own, M8). */
export async function webLeave(w: World, email: string, from: string, to: string, reason: string) {
  const { token } = await auth.login(email, w.password);
  const s = { token, orgId: w.asha.orgId, branchId: w.asha.branchId };
  return as(s).post(`/orgs/${w.asha.orgId}/attendance/me/leave`, { leaveTypeId: w.leave.casualId, fromDate: from, toDate: to, reason });
}

/** A manager's or HR's decision on a leave request, made through the API (setup for M4 and the like). */
export async function decideLeave(w: World, email: string, requestId: string, decision: 'approve' | 'reject', note = '') {
  const { token } = await auth.login(email, w.password);
  const s = { token, orgId: w.asha.orgId, branchId: w.asha.branchId };
  return as(s).post(`/orgs/${w.asha.orgId}/attendance/leave/requests/${requestId}/${decision}`, note ? { note } : {});
}

/* ------------------------------------------------------------------ money and attendance rules (X1–X2, R1–R3) */

/** The last working day before today (Sunday is the seeded weekly off): the day of R2's missing punch-out. */
export function missedPunchDay() {
  const d = todayIST();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  if (d.getDay() === 0) d.setDate(d.getDate() - 1);
  return iso(d);
}

/** A day marked by hand with a check-in and no check-out: what the missing-punch notice is about. */
export async function markMissedPunch(s: Session, employeeId: string) {
  await as(s).put(`/orgs/${s.orgId}/attendance/records`, { employeeId, date: missedPunchDay(), checkIn: '09:20', status: 'PRESENT', note: 'No punch-out' });
}

/** The owner's session in Asha Textiles, for setup. */
export async function ownerSession(w: World): Promise<Session> {
  const { token } = await auth.login(w.users.owner.email, w.password);
  return { token, orgId: w.asha.orgId, branchId: w.asha.branchId };
}

/** Days marked by hand with a check-in and a check-out (a check-in after 09:10 is late on the default 09:00 shift). */
export async function markDays(w: World, who: string, days: string[], checkIn: string, checkOut = '18:30') {
  const s = await ownerSession(w);
  for (const date of days) await as(s).put(`/orgs/${s.orgId}/attendance/records`, { employeeId: w.people[who].id, date, checkIn, checkOut });
}

/** An expense claim sent from the employee app and approved by the manager through the API (setup for X2). */
export async function approvedClaim(w: World, who: string, title: string, amount: number, merchant: string) {
  const u = w.appUsers[who];
  const { token } = await portal.login(u.company, u.code, w.password);
  const me = portal.as(token);
  const money = await me.get('/portal/people/money');
  const category = money.categories.find((c: any) => c.name === 'Courier and postage') || money.categories[0];
  await me.post('/portal/people/money/lines', { amount, spentOn: iso(todayIST()), categoryId: category.id, merchant, notDuplicate: true });
  const draft = (await me.get('/portal/people/money')).draft;
  await me.post(`/portal/people/money/claims/${draft.id}/submit`, { title });
  const { token: mt } = await auth.login(w.users.manager.email, w.password);
  const ms = { token: mt, orgId: w.asha.orgId, branchId: w.asha.branchId };
  const box = await as(ms).get(`/orgs/${w.asha.orgId}/people/inbox`);
  const item = (box.items || []).find((i: any) => i.kind === 'APPROVAL' && String(i.what).includes(title));
  if (!item) throw new Error(`The claim "${title}" is not waiting for ${w.users.manager.name}`);
  await as(ms).post(`/orgs/${w.asha.orgId}/people/requests/${item.id}/approve`, {});
}

/** A shift, and one person on it from a day on (setup for R3). */
export async function giveShift(w: World, who: string, shift: { name: string; startTime: string; endTime: string }, from: string) {
  const s = await ownerSession(w);
  const made = (await as(s).post(`/orgs/${s.orgId}/attendance/shifts`, { ...shift, breakMinutes: 30 })).shift;
  await as(s).post(`/orgs/${s.orgId}/attendance/shift-assignments`, { employeeIds: [w.people[who].id], shiftId: made.id, effectiveFrom: from });
}
