import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * People's reports (routes/peopleReports.ts, services/people/reports.ts) on a
 * company of ten: the numbers of each report, the filters, the CSV, a team
 * manager's cut of them, and the small-numbers rule for gender and age.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { FEWER, NOT_FEWER, maskRow } = await import('../services/people/reports.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `rep.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Reports Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ mime: 'text/plain', data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}` });
const Q1 = 'from=2025-01-01&to=2025-03-31';
const DAY = 'to=2025-03-31';

let hr: Ctx;
let manager: Ctx;
let viewer: Ctx;
let sales: any;
let ops: any;
const emp: Record<string, any> = {};

beforeAll(async () => {
  hr = await owner();
  manager = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW'], true);
  /* Reads the whole company, keeps no records: not HR for the small-numbers rule. */
  viewer = await colleague(hr, ['PEOPLE::Employees::VIEW']);
  sales = (await people(hr).post('/structure/departments', { name: 'Sales' }).expect(201)).body.item;
  ops = (await people(hr).post('/structure/departments', { name: 'Ops' }).expect(201)).body.item;
  const add = async (key: string, body: Record<string, unknown>) => {
    emp[key] = (await people(hr).post('/employees', { code: key, ...body }).expect(201)).body.employee;
  };
  await add('S1', { name: 'Asha', gender: 'FEMALE', dateOfBirth: '1990-06-15', dateOfJoining: '2020-01-10', departmentId: sales.id });
  await add('S2', { name: 'Bina', gender: 'FEMALE', dateOfBirth: '1985-03-01', dateOfJoining: '2024-11-01', departmentId: sales.id });
  await add('S3', { name: 'Chetan', gender: 'MALE', dateOfBirth: '1999-12-31', dateOfJoining: '2025-02-15', departmentId: sales.id, probationEndDate: '2025-08-15' });
  await add('S4', { name: 'Dev', gender: 'MALE', dateOfBirth: '1970-01-01', dateOfJoining: '2015-05-01', departmentId: sales.id });
  await add('S5', { name: 'Esha', gender: 'FEMALE', dateOfJoining: '2025-03-05', departmentId: sales.id });
  await add('S6', { name: 'Farid', gender: 'MALE', dateOfBirth: '1992-01-01', dateOfJoining: '2022-07-01', departmentId: sales.id });
  await add('O1', { name: 'Gita', gender: 'FEMALE', dateOfBirth: '1980-08-08', dateOfJoining: '2018-04-01', departmentId: ops.id });
  await add('O2', { name: 'Hari', gender: 'MALE', dateOfBirth: '1995-05-05', dateOfJoining: '2025-01-20', departmentId: ops.id, reportingManagerId: emp.O1.id, probationEndDate: '2025-07-20' });
  await add('O3', { name: 'Indu', gender: 'FEMALE', dateOfBirth: '2001-02-02', dateOfJoining: '2023-09-01', departmentId: ops.id, reportingManagerId: emp.O1.id });
  await add('O4', { name: 'Jai', gender: 'NON_BINARY', dateOfJoining: '2024-06-01', departmentId: ops.id, reportingManagerId: emp.O2.id, contractEndDate: '2025-06-30' });
  await runInTenant(hr.orgId, async () => {
    await peoplePrisma.employee.update({ where: { id: emp.O1.id }, data: { userId: manager.userId } });
    /* Two leavers, as the leaving flow writes them: the record and the stint. */
    for (const [key, day] of [['S4', '2025-03-20'], ['O3', '2025-02-10']] as const) {
      await peoplePrisma.employee.update({ where: { id: emp[key].id }, data: { status: 'LEFT', dateOfLeaving: day, leavingType: 'RESIGNED' } });
      await peoplePrisma.employmentEpisode.updateMany({ where: { employeeId: emp[key].id, seq: 1 }, data: { endDate: day, endType: 'RESIGNED' } });
    }
    await peoplePrisma.employee.update({ where: { id: emp.S3.id }, data: { confirmedOn: '2025-08-15' } });
  });
  await people(hr).post(`/employees/${emp.O2.id}/documents`, { title: 'Driving licence', kind: 'CERTIFICATE', classification: 'EMPLOYEE_VISIBLE', expiresOn: '2020-01-15', ...file('a') }).expect(201);
  await people(hr).post(`/employees/${emp.S1.id}/documents`, { title: 'Work visa', kind: 'WORK_PERMIT', classification: 'HR_ONLY', expiresOn: '2020-02-01', ...file('b') }).expect(201);
}, 180_000);

const report = async (c: Ctx, id: string, query = '') => (await people(c).get(`/hr-reports/${id}${query ? `?${query}` : ''}`).expect(200)).body;
const keyOf = (r: any, label: string) => r.columns.find((c: any) => c.label === label).key;
const cells = (r: any, row: any, labels: string[]) => labels.map((l) => row[keyOf(r, l)]);

describe('the list of reports', () => {
  it('names every report in its group, with the filters the reader’s people are in', async () => {
    const body = (await people(hr).get('/hr-reports').expect(200)).body;
    expect(body.reports.map((r: any) => r.id)).toEqual(['headcount', 'tenure', 'age', 'gender', 'movement', 'probation', 'contracts', 'documents']);
    expect([...new Set(body.reports.map((r: any) => r.group))]).toEqual(['Workforce', 'Joining and leaving', 'Documents and compliance']);
    expect(body.filters.departments.map((d: any) => d.name)).toEqual(['Ops', 'Sales']);
    const mine = (await people(manager).get('/hr-reports').expect(200)).body;
    expect(mine.filters.departments.map((d: any) => d.name)).toEqual(['Ops']);
  });

  it('refuses a report that does not exist, a period back to front and one too long', async () => {
    await people(hr).get('/hr-reports/salary').expect(404);
    await people(hr).get('/hr-reports/headcount?from=2025-06-01&to=2025-01-31').expect(400);
    await people(hr).get('/hr-reports/headcount?from=2020-01-01&to=2025-01-31').expect(400);
  });

  it('needs the right to read the employee list', async () => {
    const outsider = await colleague(hr, ['PEOPLE::Policies::VIEW']);
    await people(outsider).get('/hr-reports').expect(403);
    await people(outsider).get('/hr-reports/headcount').expect(403);
    await people(outsider).get('/hr-reports/headcount/export.csv').expect(403);
  });
});

describe('headcount over time', () => {
  it('counts who worked here at each month’s end, by department', async () => {
    const r = await report(hr, 'headcount', Q1);
    expect(r.columns.map((c: any) => c.label)).toEqual(['Month', 'Sales', 'Ops', 'Total']);
    expect(r.rows.map((row: any) => [row.month, ...cells(r, row, ['Sales', 'Ops', 'Total'])])).toEqual([
      ['Jan 2025', 4, 4, 8],
      ['Feb 2025', 5, 3, 8],
      ['Mar 2025', 5, 3, 8],
    ]);
    expect(r.chart).toMatchObject({ kind: 'stacked', categories: ['Jan 2025', 'Feb 2025', 'Mar 2025'], series: [{ label: 'Sales', values: [4, 5, 5] }, { label: 'Ops', values: [4, 3, 3] }] });
  });

  it('follows the filters and the grouping', async () => {
    const one = await report(hr, 'headcount', `${Q1}&departmentId=${ops.id}`);
    expect(one.columns.map((c: any) => c.label)).toEqual(['Month', 'Ops', 'Total']);
    expect(one.rows.map((row: any) => row.total)).toEqual([4, 3, 3]);
    const byType = await report(hr, 'headcount', `${Q1}&by=employmentType`);
    expect(byType.by).toBe('employmentType');
    expect(byType.rows.map((row: any) => row.total)).toEqual([8, 8, 8]);
    const none = await report(hr, 'headcount', `${Q1}&gradeId=no-such-grade`);
    expect(none.rows.map((row: any) => row.total)).toEqual([0, 0, 0]);
  });

  it('a team manager’s headcount is their own line’s', async () => {
    const r = await report(manager, 'headcount', Q1);
    expect(r.columns.map((c: any) => c.label)).toEqual(['Month', 'Ops', 'Total']);
    expect(r.rows.map((row: any) => row.total)).toEqual([4, 3, 3]);
    expect(JSON.stringify(r)).not.toContain('Sales');
  });

  it('exports exactly the rows on screen', async () => {
    const csv = (await people(hr).get(`/hr-reports/headcount/export.csv?${Q1}&departmentId=${sales.id}`).expect(200));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toContain('headcount-2025-01-01-to-2025-03-31.csv');
    expect(csv.text.replace(/^﻿/, '').split('\r\n')).toEqual(['Month,Sales,Total', 'Jan 2025,4,4', 'Feb 2025,5,5', 'Mar 2025,5,5']);
  });
});

describe('joiners, leavers and attrition', () => {
  it('month by month, with the month’s rate and the last 12 months’', async () => {
    const r = await report(hr, 'movement', Q1);
    expect(r.rows).toEqual([
      { month: 'Jan 2025', start: 7, joiners: 1, leavers: 0, end: 8, attrition: 0, trailing: 0 },
      { month: 'Feb 2025', start: 8, joiners: 1, leavers: 1, end: 8, attrition: 12.5, trailing: expect.any(Number) },
      /* Two leavers over an average of 6.375 people across April 2024 to March 2025. */
      { month: 'Mar 2025', start: 8, joiners: 1, leavers: 1, end: 8, attrition: 12.5, trailing: 31.4 },
    ]);
    expect(r.totals).toMatchObject({ start: 7, joiners: 3, leavers: 2, end: 8, attrition: 25.5 });
    expect(r.chart.series).toEqual([{ label: 'Joiners', values: [1, 1, 1] }, { label: 'Leavers', values: [0, 1, 1] }]);
  });

  it('by department', async () => {
    const r = await report(hr, 'movement', `${Q1}&by=department`);
    expect(r.rows).toEqual([
      { group: 'Sales', start: 4, joiners: 2, leavers: 1, end: 5, average: 4.5, attrition: 22.2 },
      { group: 'Ops', start: 3, joiners: 1, leavers: 1, end: 3, average: 3.3, attrition: 30 },
    ]);
    expect(r.totals).toMatchObject({ group: 'Everyone', joiners: 3, leavers: 2, attrition: 25.5 });
    const csv = (await people(hr).get(`/hr-reports/movement/export.csv?${Q1}&by=department`).expect(200)).text;
    expect(csv).toContain('Sales,4,2,1,5,4.5,22.2%');
  });

  it('a team manager sees their own team’s', async () => {
    const r = await report(manager, 'movement', Q1);
    expect(r.totals).toMatchObject({ start: 3, joiners: 1, leavers: 1, end: 3 });
  });
});

describe('length of service', () => {
  it('bands everyone working on the day', async () => {
    const r = await report(hr, 'tenure', DAY);
    const bands = ['Under 6 months', '6 to 12 months', '1 to 2 years', '2 to 5 years', '5 to 10 years', '10 years or more', 'Total'];
    expect(r.rows.map((row: any) => [row.group, ...cells(r, row, bands)])).toEqual([
      ['Sales', 3, 0, 0, 1, 1, 0, 5],
      ['Ops', 1, 1, 0, 0, 1, 0, 3],
    ]);
    expect(cells(r, r.totals, bands)).toEqual([4, 1, 0, 1, 2, 0, 8]);
    expect(r.chart.series[0].values).toEqual([4, 1, 0, 1, 2, 0]);
    expect(r.masked).toBe(false);
    /* Not a personal detail: a reader who is not HR sees the same numbers. */
    expect((await report(viewer, 'tenure', DAY)).rows).toEqual(r.rows);
  });
});

describe('gender and age: small numbers', () => {
  const answers = ['Women', 'Men', 'Another identity', 'Not said'];
  const ages = ['Under 25', '25 to 34', '35 to 44', '45 to 54', '55 or over', 'Not recorded'];

  it('whole-company HR reads the numbers', async () => {
    const g = await report(hr, 'gender', DAY);
    expect(g.rows.map((row: any) => [row.group, ...cells(g, row, answers), row.total])).toEqual([
      ['Sales', 3, 2, 0, 0, 5],
      ['Ops', 1, 1, 1, 0, 3],
    ]);
    expect(g.masked).toBe(false);
    expect(g.chart.series[0].values).toEqual([4, 3, 1, 0]);
    const a = await report(hr, 'age', DAY);
    expect(a.rows.map((row: any) => [row.group, ...cells(a, row, ages), row.total])).toEqual([
      ['Sales', 0, 3, 1, 0, 0, 1, 5],
      ['Ops', 0, 1, 1, 0, 0, 1, 3],
    ]);
    expect(a.rows[0].average).toBeGreaterThan(30);
  });

  it('anyone else reads “fewer than 5”, on screen and in the file, and no average', async () => {
    for (const reader of [viewer, manager]) {
      const g = await report(reader, 'gender', DAY);
      expect(g.masked).toBe(true);
      for (const row of [...g.rows, g.totals]) expect(cells(g, row, answers)).toEqual([FEWER, FEWER, FEWER, FEWER]);
      expect(g.chart).toBeNull();
      expect(g.notes.join(' ')).toMatch(/fewer than 5/);
      const a = await report(reader, 'age', DAY);
      for (const row of [...a.rows, a.totals]) {
        expect(cells(a, row, ages).every((c: unknown) => c === FEWER)).toBe(true);
        expect(row.average).toBeNull();
      }
    }
    /* The total is the directory's count, and stays. */
    expect((await report(viewer, 'gender', DAY)).rows.map((row: any) => row.total)).toEqual([5, 3]);
    expect((await report(manager, 'gender', DAY)).rows.map((row: any) => [row.group, row.total])).toEqual([['Ops', 3]]);
    const csv = (await people(viewer).get(`/hr-reports/gender/export.csv?${DAY}`).expect(200)).text;
    expect(csv).toContain(`Sales,${FEWER},${FEWER},${FEWER},${FEWER},5`);
    expect(csv).not.toMatch(/Sales,3,2/);
  });

  it('a row with one small band gives no band an exact figure', () => {
    expect(maskRow([7, 2, 0], false)).toEqual({ cells: [NOT_FEWER, FEWER, FEWER], masked: true });
    expect(maskRow([7, 0, 12], false)).toEqual({ cells: [7, 0, 12], masked: false });
    expect(maskRow([7, 2, 0], true)).toEqual({ cells: [7, 2, 0], masked: false });
  });
});

describe('probation, contracts and documents', () => {
  it('probation overdue and confirmations made, in the period', async () => {
    const r = await report(hr, 'probation', 'from=2025-01-01&to=2025-12-31');
    expect(r.rows.map((row: any) => [row.name, row.department, row.ends, row.confirmed, row.status])).toEqual([
      ['Hari', 'Ops', '2025-07-20', null, 'Overdue'],
      ['Chetan', 'Sales', '2025-08-15', '2025-08-15', 'Confirmed'],
    ]);
    expect(r.rows[0].days).toBeLessThan(0);
    expect(r.totals.status).toBe('1 overdue, 0 due, 1 confirmed');
    expect((await report(hr, 'probation', 'from=2025-08-01&to=2025-12-31')).rows.map((row: any) => row.name)).toEqual(['Chetan']);
    expect((await report(manager, 'probation', 'from=2025-01-01&to=2025-12-31')).rows.map((row: any) => row.name)).toEqual(['Hari']);
  });

  it('contracts that end in the period', async () => {
    const r = await report(hr, 'contracts', 'from=2025-06-01&to=2025-07-31');
    expect(r.rows.map((row: any) => [row.name, row.code, row.ends])).toEqual([['Jai', 'O4', '2025-06-30']]);
    expect(r.chart.series).toEqual([{ label: 'Contracts ending', values: [1, 0] }]);
    expect((await report(hr, 'contracts', `from=2025-06-01&to=2025-07-31&departmentId=${sales.id}`)).rows).toEqual([]);
    expect((await report(hr, 'contracts', 'from=2025-07-01&to=2025-07-31')).rows).toEqual([]);
  });

  it('documents expiring: only the files the reader may open, inside their team', async () => {
    const period = 'from=2020-01-01&to=2020-03-01';
    const all = await report(hr, 'documents', period);
    expect(all.rows.map((row: any) => [row.name, row.document, row.kind, row.expires, row.status])).toEqual([
      ['Hari', 'Driving licence', 'Certificate', '2020-01-15', 'Expired'],
      ['Asha', 'Work visa', 'Work permit', '2020-02-01', 'Expired'],
    ]);
    expect((await report(manager, 'documents', period)).rows.map((row: any) => row.document)).toEqual(['Driving licence']);
    /* No right to documents: the report opens, and lists none. */
    expect((await report(viewer, 'documents', period)).rows).toEqual([]);
  });
});
