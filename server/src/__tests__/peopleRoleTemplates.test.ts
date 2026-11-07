import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';

/**
 * The People role templates, to the owner's decisions of 8 Nov 2026 (ERPNext HRMS as the reference):
 *
 *   HR Manager  adds Policies, Privacy (privacy requests) and Private Cases (confidential cases); approves leave.
 *   HR User     never approves leave: HR Manager does.
 *   Viewer      read-only employee records; no confidential or HR-only documents; PAN, Aadhaar, UAN and bank masked,
 *               with no Show.
 *   Auditor     read-only People: the employee list with joining and leaving dates, and the audit log. No documents;
 *               identifiers never in clear.
 *
 * Each rule is checked for each of the four roles on the server, and the migration that brings companies' roles
 * along is run against roles as they stood before (followed) and as administrators changed them (left alone).
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant, outsideTenant } = await import('../utils/tenantScope.js');
const { ROLE_PRESETS, expandPreset, templateDrift } = await import('../constants/permissionCatalog.js');
const { leaveStepDeciders } = await import('../services/attendance/leaveRules.js');
const { deciders } = await import('../services/people/approvals/standIns.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId?: string; email?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const keysOf = (preset: string) => expandPreset(preset).map((r) => `${r.module}::${r.subModule}::${r.action}`);

async function owner(): Promise<Ctx> {
  const email = `tpl.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Templates Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  ctx.accountId = (await runInTenant(ctx.orgId, () => platformPrisma.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { accountId: true } }))).accountId;
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
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, email };
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}${p}`).set(at(c)),
});
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });

const ROLES = ['HR Manager', 'HR User', 'Viewer', 'Auditor'] as const;
type RoleName = (typeof ROLES)[number];

describe('the four templates', () => {
  it('HR Manager holds Policies, Privacy and Private Cases in full, and approves leave', () => {
    const k = keysOf('HR_MANAGER');
    for (const a of ['VIEW', 'CREATE', 'EDIT', 'APPROVE']) expect(k).toContain(`PEOPLE::Policies::${a}`);
    for (const a of ['VIEW', 'EDIT', 'DELETE']) expect(k).toContain(`PEOPLE::Privacy::${a}`);
    for (const a of ['VIEW', 'CREATE', 'EDIT']) expect(k).toContain(`PEOPLE::Private Cases::${a}`);
    expect(k).toContain('ATTENDANCE::Leave Requests::APPROVE');
    expect(k).toContain('PEOPLE::Confidential Documents::VIEW');
    expect(k).toContain('PEOPLE::HR-only Documents::VIEW');
    expect(k).toContain('PEOPLE::Full Identifiers::VIEW');
  });

  it('HR User raises and corrects leave but never approves it, and everything it has HR Manager has too', () => {
    const k = keysOf('HR_USER');
    expect(k).toContain('ATTENDANCE::Leave Requests::CREATE');
    expect(k).toContain('ATTENDANCE::Leave Requests::EDIT');
    expect(k).not.toContain('ATTENDANCE::Leave Requests::APPROVE');
    /* ERPNext's HR User creates employees and keeps org structure, leave types, attendance and shifts. */
    for (const key of ['PEOPLE::Employees::CREATE', 'PEOPLE::Org Structure::CREATE', 'ATTENDANCE::Leave Types::EDIT', 'ATTENDANCE::Attendance Records::EDIT', 'ATTENDANCE::Shifts::CREATE']) expect(k).toContain(key);
    const manager = new Set(keysOf('HR_MANAGER'));
    expect(k.filter((x) => !manager.has(x))).toEqual([]);
  });

  it('Viewer reads, and only reads: no confidential or HR-only files, no full identifier, no privacy or confidential cases, no statutory reports', () => {
    const k = keysOf('VIEWER');
    expect(k.every((x) => x.endsWith('::VIEW'))).toBe(true);
    for (const key of ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Statutory Details::VIEW', 'SALES::Invoices::VIEW', 'SETTINGS::Users::VIEW']) expect(k).toContain(key);
    for (const key of ['PEOPLE::Confidential Documents::VIEW', 'PEOPLE::HR-only Documents::VIEW', 'PEOPLE::Full Identifiers::VIEW', 'PEOPLE::Privacy::VIEW', 'PEOPLE::Private Cases::VIEW', 'PAYROLL::Payroll Reports::VIEW']) expect(k).not.toContain(key);
  });

  it('Auditor reads People’s list and the audit trail, and no document or identifier at all', () => {
    const k = keysOf('AUDITOR');
    expect(k.every((x) => x.endsWith('::VIEW') || x.endsWith('::EXPORT'))).toBe(true);
    expect(k).toContain('PEOPLE::Employees::VIEW');
    expect(k).toContain('SETTINGS::Audit trail::VIEW');
    expect(k.filter((x) => x.startsWith('PEOPLE::') && !x.startsWith('PEOPLE::Employees::') && !x.startsWith('PEOPLE::Org Structure::'))).toEqual([]);
  });

  it('says how a role named after a template differs from it, and nothing for one that matches or is not a template', () => {
    const exact = keysOf('VIEWER');
    expect(templateDrift({ name: 'Viewer' }, exact)?.matches).toBe(true);
    const drift = templateDrift({ name: 'viewer' }, [...exact.filter((x) => x !== 'PEOPLE::Employees::VIEW'), 'PEOPLE::Privacy::VIEW']);
    expect(drift).toMatchObject({ key: 'VIEWER', label: 'Viewer', matches: false, missing: ['PEOPLE::Employees::VIEW'], extra: ['PEOPLE::Privacy::VIEW'] });
    expect(templateDrift({ name: 'Owner' }, [])).toBeNull();
    expect(templateDrift({ name: 'Viewer', branchId: 'b1' }, [])).toBeNull();
    expect(Object.keys(ROLE_PRESETS)).toContain('AUDITOR');
  });
});

describe('the server enforces each rule for each role', () => {
  let boss: Ctx;
  const as = {} as Record<RoleName, Ctx>;
  let emp: any;
  const docs = {} as Record<'visible' | 'hrOnly' | 'confidential' | 'binned', any>;

  beforeAll(async () => {
    boss = await owner();
    for (const r of ROLES) as[r] = await withRole(boss, r);
    emp = (await api(boss).post('/people/employees', { name: 'Meera Iyer', code: 'RT-1', dateOfJoining: '2025-04-01' }).expect(201)).body.employee;
    const up = async (title: string, classification: string) => (await api(boss).post(`/people/employees/${emp.id}/documents`, { title, kind: 'OTHER', classification, ...file(title) }).expect(201)).body.document;
    docs.visible = await up('Handbook receipt', 'EMPLOYEE_VISIBLE');
    docs.hrOnly = await up('Offer letter HRONLY', 'HR_ONLY');
    docs.confidential = await up('Medical note CONFIDENTIAL', 'CONFIDENTIAL');
    docs.binned = await up('Old contract BINNED', 'HR_ONLY');
    await api(boss).del(`/people/documents/${docs.binned.id}`).expect(200);
    await api(boss).put(`/people/employees/${emp.id}/identity`, { passportNumber: 'K1234567', aadhaarLast4: '4321' }).expect(200);
    await runInTenant(boss.orgId, () => payrollPrisma.employeePayrollProfile.create({ data: { accountId: boss.accountId!, orgId: boss.orgId, employeeId: emp.id, pan: 'ABCPE1234F', uan: '100200300400', pfNumber: 'KABLR00112230000099', esiNumber: '3100445566', bankAccountNumber: '987654321012', createdByUserId: boss.userId } }));
  }, 120_000);

  it('leave: HR Manager approves; HR User, Viewer and Auditor are refused', async () => {
    const type = (await api(boss).post('/attendance/leave/types', { name: `Casual ${rnd()}`, annualDays: 20 }).expect(201)).body.type;
    const ask = async (date: string) => (await api(boss).post('/attendance/leave/requests', { employeeId: emp.id, leaveTypeId: type.id, fromDate: date, toDate: date, reason: 'Family' }).expect(201)).body.request;
    const pending = await ask('2026-12-01');
    expect(pending.status).toBe('PENDING');
    for (const r of ['HR User', 'Viewer', 'Auditor'] as const) {
      const refused = await api(as[r]).post(`/attendance/leave/requests/${pending.id}/approve`).expect(403);
      expect(refused.body.permission, r).toMatchObject({ module: 'ATTENDANCE', subModule: 'Leave Requests', action: 'APPROVE' });
      await api(as[r]).post('/attendance/leave/requests/bulk-review', { ids: [pending.id], approve: true }).expect(403);
    }
    /* HR User may still raise and see leave: only the decision is HR Manager's. */
    await api(as['HR User']).get('/attendance/leave/requests').expect(200);
    const ok = await api(as['HR Manager']).post(`/attendance/leave/requests/${pending.id}/approve`).expect(200);
    expect(ok.body.request.status).toBe('APPROVED');
    /* Nor does HR User count as the "HR" who decides a leave that waits on HR. */
    const me = (await api(as['HR User']).get('/permissions/me').expect(200)).body.permissions;
    expect(me).not.toContain('ATTENDANCE::Leave Requests::APPROVE');
  });

  it('statutory identifiers: masked for all four; Show only for HR Manager and HR User; nothing at all for Auditor', async () => {
    for (const r of ROLES) {
      const res = await api(as[r]).get(`/people/employees/${emp.id}/statutory`).expect(200);
      const body = JSON.stringify(res.body);
      for (const clear of ['K1234567', 'ABCPE1234F', '100200300400', '987654321012']) expect(body, `${r} ${clear}`).not.toContain(clear);
      if (r === 'Auditor') {
        expect(res.body).toEqual({ visible: false });
        continue;
      }
      expect(res.body.visible, r).toBe(true);
      expect(res.body.identity.passportNumber, r).toMatch(/\*+4567$/);
      expect(res.body.pan, r).toMatch(/\*+234F$/);
      expect(res.body.canReveal, r).toBe(r !== 'Viewer');
    }
    for (const r of ['Viewer', 'Auditor'] as const) {
      const refused = await api(as[r]).post(`/people/employees/${emp.id}/statutory/reveal`, { field: 'pan' }).expect(403);
      expect(refused.body.permission?.subModule, r).toBe(r === 'Viewer' ? 'Full Identifiers' : 'Statutory Details');
    }
    for (const r of ['HR Manager', 'HR User'] as const) {
      /* Through the grant; stopped only by the authenticator the reveal always asks for. */
      const asked = await api(as[r]).post(`/people/employees/${emp.id}/statutory/reveal`, { field: 'pan' }).expect(403);
      expect(asked.body.code, r).toBe('TWO_FACTOR_SETUP_REQUIRED');
    }
  });

  it('a joiner’s statutory approval view (identifiers in full) is refused to Viewer and Auditor before anything is read', async () => {
    for (const r of ['Viewer', 'Auditor'] as const) {
      const refused = await api(as[r]).get('/people/invites/no-such-invite/statutory').expect(403);
      expect(refused.body.permission?.module, r).toBe('PEOPLE');
    }
  });

  it('documents: HR Manager opens all; HR User no confidential; Viewer only what the person sees; Auditor none', async () => {
    const want: Record<RoleName, string[]> = {
      'HR Manager': [docs.visible.id, docs.hrOnly.id, docs.confidential.id],
      'HR User': [docs.visible.id, docs.hrOnly.id],
      Viewer: [docs.visible.id],
      Auditor: [],
    };
    for (const r of ROLES) {
      const list = await api(as[r]).get(`/people/employees/${emp.id}/documents`);
      const register = await api(as[r]).get('/people/documents');
      if (r === 'Auditor') {
        expect(list.status).toBe(403);
        expect(register.status).toBe(403);
      } else {
        expect(list.status, r).toBe(200);
        expect(list.body.documents.map((d: any) => d.id).sort(), r).toEqual([...want[r]].sort());
        expect(register.body.documents.filter((d: any) => d.employeeId === emp.id).map((d: any) => d.id).sort(), r).toEqual([...want[r]].sort());
      }
      for (const d of [docs.visible, docs.hrOnly, docs.confidential]) {
        const one = await api(as[r]).get(`/people/documents/${d.id}`);
        expect([one.status, r, d.title].join(' '), r).toBe([want[r].includes(d.id) ? 200 : r === 'Auditor' ? 403 : 404, r, d.title].join(' '));
      }
    }
  });

  it('activity and the recycle bin never name a file the role may not open', async () => {
    for (const r of ['Viewer', 'Auditor'] as const) {
      const activity = await api(as[r]).get(`/people/employees/${emp.id}/activity`).expect(200);
      const text = JSON.stringify(activity.body);
      for (const t of ['HRONLY', 'CONFIDENTIAL', 'BINNED', 'K1234567', 'ABCPE1234F']) expect(text, `${r} ${t}`).not.toContain(t);
      const bin = await api(as[r]).get('/recycle-bin');
      if (bin.status === 200) expect(JSON.stringify(bin.body), r).not.toContain('BINNED');
    }
    /* HR User may see the HR-only file's activity; HR Manager (who may delete files) sees it in the bin. */
    expect(JSON.stringify((await api(as['HR User']).get(`/people/employees/${emp.id}/activity`).expect(200)).body)).toContain('HRONLY');
    expect(JSON.stringify((await api(as['HR Manager']).get('/recycle-bin').expect(200)).body)).toContain('BINNED');
  });

  it('exports and reports: Viewer exports nothing; Auditor exports the list without identifiers; Payroll’s statutory report is refused to both', async () => {
    await api(as.Viewer).get('/people/employees/export').expect(403);
    const exported = await api(as.Auditor).get('/people/employees/export?format=csv');
    expect(exported.status).toBe(200);
    for (const clear of ['K1234567', 'ABCPE1234F', '100200300400', '987654321012', '4321']) expect(exported.text, clear).not.toContain(clear);
    for (const r of ['Viewer', 'Auditor'] as const) {
      const refused = await api(as[r]).get('/payroll/reports/statutory').expect(403);
      expect(refused.body.permission, r).toMatchObject({ module: 'PAYROLL', subModule: 'Payroll Reports' });
    }
    /* Payroll's own employee screen keeps them masked for Viewer: PAN and bank by its field level, UAN, PF and ESI numbers without Full identifiers. */
    const pay = await api(as.Viewer).get(`/payroll/employees/${emp.id}`).expect(200);
    for (const clear of ['ABCPE1234F', '987654321012', '100200300400', 'KABLR00112230000099', '3100445566']) expect(JSON.stringify(pay.body), clear).not.toContain(clear);
    expect(pay.body.employee.payroll.uan).toMatch(/0400$/);
    expect(pay.body.employee.payroll.statutoryMasked).toBe(true);
    const own = await api(boss).get(`/payroll/employees/${emp.id}`).expect(200);
    expect(own.body.employee.payroll).toMatchObject({ uan: '100200300400', pfNumber: 'KABLR00112230000099', esiNumber: '3100445566' });
  });

  it('the company export: Auditor takes People with identifiers masked and no HR-only, confidential or binned file; the owner takes it whole', async () => {
    const taken = await api(as.Auditor).get('/export?scope=data').expect(200);
    const text = JSON.stringify(taken.body);
    expect(taken.body.data['people.employee'].some((e: any) => e.id === emp.id)).toBe(true);
    for (const clear of ['K1234567', 'ABCPE1234F', '100200300400', 'KABLR00112230000099', '987654321012']) expect(text, clear).not.toContain(clear);
    expect(taken.body.data['people.employeeIdentity'].find((i: any) => i.employeeId === emp.id).passportNumber).toMatch(/\*+4567$/);
    for (const title of ['Offer letter HRONLY', 'Medical note CONFIDENTIAL', 'Old contract BINNED', 'Handbook receipt']) expect(text, title).not.toContain(title);
    const whole = JSON.stringify((await api(boss).get('/export?scope=data').expect(200)).body);
    for (const kept of ['K1234567', 'Offer letter HRONLY', 'Medical note CONFIDENTIAL', 'Old contract BINNED']) expect(whole, kept).toContain(kept);
  });

  it('leave already taken, imported, is approved as it lands: HR User is refused it, HR Manager imports', async () => {
    const type = (await api(boss).post('/attendance/leave/types', { name: `Earned ${rnd()}`, annualDays: 20 }).expect(201)).body.type;
    const rows = [{ employeeCode: 'RT-1', leaveType: type.name, from: '2026-10-06', to: '2026-10-06', reason: 'Imported' }];
    for (const dryRun of [true, false]) {
      const refused = await api(as['HR User']).post('/attendance/leave/requests/import', { rows, dryRun }).expect(403);
      expect(refused.body.permission).toMatchObject({ module: 'ATTENDANCE', subModule: 'Leave Requests', action: 'APPROVE' });
    }
    expect((await runInTenant(boss.orgId, () => peoplePrisma.leaveRequest.count({ where: { orgId: boss.orgId, leaveTypeId: type.id } })))).toBe(0);
    const done = await api(as['HR Manager']).post('/attendance/leave/requests/import', { rows }).expect(200);
    expect(done.body.imported).toBe(1);
  });

  it('a leave rule naming HR User’s role gives HR User no decision; nor can HR User stand in for leave', async () => {
    const roles = (await api(boss).get('/roles').expect(200)).body.roles;
    const roleId = (name: string) => roles.find((r: any) => r.name === name).id;
    const step = (name: string) => runInTenant(boss.orgId, () => leaveStepDeciders(boss.accountId!, boss.orgId, { kind: 'ROLE', id: roleId(name) } as any, emp.id));
    expect(await step('HR User')).toEqual([]);
    expect(await step('HR Manager')).toContain(as['HR Manager'].userId);
    const leave = await runInTenant(boss.orgId, () => deciders(boss.accountId!, boss.orgId, ['LEAVE']));
    expect(leave.has(as['HR User'].userId)).toBe(false);
    expect(leave.has(as['HR Manager'].userId)).toBe(true);
    /* HR User still decides People requests, and may stand in for those. */
    expect((await runInTenant(boss.orgId, () => deciders(boss.accountId!, boss.orgId, ['PROFILE_CHANGE']))).has(as['HR User'].userId)).toBe(true);
  });

  it('a compliance deadline’s evidence opens only for who sees statutory details', async () => {
    const task = await runInTenant(boss.orgId, () => peoplePrisma.complianceTask.create({ data: { accountId: boss.accountId!, orgId: boss.orgId, code: 'PF_ECR', period: '2026-10', title: 'PF ECR', dueDate: '2026-11-15', evidenceName: 'ecr.txt', evidenceMime: 'text/plain', evidenceData: Buffer.from('UAN 100200300400') } }));
    await api(as.Auditor).get(`/people/compliance/${task.id}/evidence`).expect(404);
    await api(as['HR Manager']).get(`/people/compliance/${task.id}/evidence`).expect(200);
  });

  it('Auditor reads the employee list with joining and leaving dates, and the audit trail; changes nothing', async () => {
    const list = await api(as.Auditor).get('/people/employees').expect(200);
    const row = (list.body.employees || list.body.items || []).find((e: any) => e.id === emp.id);
    expect(row?.dateOfJoining).toBe('2025-04-01');
    expect('dateOfLeaving' in row).toBe(true);
    await api(as.Auditor).get('/audit').expect(200);
    await api(as.Auditor).post('/people/employees', { name: 'Not allowed', code: 'RT-X', dateOfJoining: '2025-01-01' }).expect(403);
  });

  it('policies, privacy requests and confidential cases open for HR Manager, and not for Viewer or Auditor', async () => {
    await api(as['HR Manager']).get('/people/policies').expect(200);
    await api(as['HR Manager']).get('/people/privacy/retention').expect(200);
    await api(as['HR Manager']).get('/people/private-cases/committee/GRIEVANCE').expect(200);
    for (const r of ['Viewer', 'Auditor'] as const) {
      await api(as[r]).get('/people/privacy/retention').expect(403);
      await api(as[r]).get('/people/private-cases/committee/GRIEVANCE').expect(403);
    }
    /* HR User keeps the policy library it had. */
    await api(as['HR User']).get('/people/policies').expect(200);
  });

  it('the roles list says each stock role matches its template', async () => {
    const roles = (await api(boss).get('/roles').expect(200)).body.roles;
    for (const r of ROLES) expect(roles.find((x: any) => x.name === r).template, r).toMatchObject({ matches: true, missing: [], extra: [] });
    expect(roles.find((x: any) => x.name === 'Owner').template).toBeNull();
  });
});

describe('the migration brings unchanged roles to the new templates and leaves changed ones alone', () => {
  const dir = 'prisma/platform/migrations/20261116090000_people_role_templates_erpnext/migration.sql';
  const sql = fs.readFileSync(path.resolve(dir), 'utf8');
  const statements = sql.split(/;\s*\n/).map((st) => st.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
  const block = (from: string, to: string) => sql.slice(sql.indexOf(from), sql.indexOf(to));
  const rowsIn = (text: string) => {
    const out = new Map<string, string[]>();
    for (const m of text.matchAll(/\('(hr user|hr manager|viewer|auditor)', '([^']+)', '([^']+)', '([^']+)'\)/g)) out.set(m[1], [...(out.get(m[1]) || []), `${m[2]}::${m[3]}::${m[4]}`]);
    return out;
  };
  const OLD = rowsIn(block('old_template (', 'new_template ('));
  const NEW = rowsIn(block('new_template (', 'descriptions ('));
  const PRESET: Record<string, string> = { 'hr user': 'HR_USER', 'hr manager': 'HR_MANAGER', viewer: 'VIEWER', auditor: 'AUDITOR' };

  const run = () => outsideTenant('test: the role template migration', () => platformPrisma.$transaction(async (tx) => {
    for (const st of statements) await tx.$executeRawUnsafe(st);
  }, { timeout: 120_000, maxWait: 30_000 }));
  const roleOf = (c: Ctx, name: string) => runInTenant(c.orgId, () => platformPrisma.role.findFirstOrThrow({ where: { orgId: c.orgId, name, branchId: null }, select: { id: true, description: true } }));
  const held = (roleId: string) => outsideTenant('test: grants', async () => (await platformPrisma.rolePermission.findMany({ where: { roleId, allowed: true }, select: { permission: { select: { module: true, subModule: true, action: true } } } })).map((r) => `${r.permission.module}::${r.permission.subModule}::${r.permission.action}`).sort());
  /* Roles as an old company has them, written straight to the database (no audit row: nobody changed them). */
  const setGrants = (roleId: string, keys: string[]) => outsideTenant('test: old grants', async () => {
    const role = await platformPrisma.role.findUniqueOrThrow({ where: { id: roleId } });
    await platformPrisma.rolePermission.deleteMany({ where: { roleId } });
    for (const k of keys) {
      const [module, subModule, action] = k.split('::');
      const p = await platformPrisma.permission.upsert({ where: { module_subModule_action: { module, subModule, action } }, create: { module, subModule, action }, update: {} });
      await platformPrisma.rolePermission.create({ data: { accountId: role.accountId, orgId: role.orgId, roleId, permissionId: p.id, allowed: true, permLevel: 0 } });
    }
  });
  /* As an administrator changes a role on the roles screen: the route writes the audit row. */
  const setOnScreen = async (c: Ctx, roleId: string, keys: string[]) => api(c).put(`/roles/${roleId}/permissions`, { permissions: keys }).expect(200);

  it('reads the old and new templates it carries straight from the catalogue', () => {
    for (const [name, key] of Object.entries(PRESET)) expect([...(NEW.get(name) || [])].sort(), name).toEqual(keysOf(key).sort());
    expect(OLD.get('hr user')).not.toContain('ATTENDANCE::Leave Requests::APPROVE');
    expect(OLD.get('viewer')).toContain('PEOPLE::Confidential Documents::VIEW');
  });

  it('follows, leaves alone, keeps what others open, notes it, and runs twice to the same end', async () => {
    const x = await owner();
    const y = await owner();
    for (const c of [x, y]) await api(c).get('/roles').expect(200);

    /* Company X: nobody changed its stock roles. */
    const xViewer = await roleOf(x, 'Viewer');
    const xHrManager = await roleOf(x, 'HR Manager');
    const xHrUser = await roleOf(x, 'HR User');
    const xAuditor = await roleOf(x, 'Auditor');
    await setGrants(xViewer.id, OLD.get('viewer')!);
    await outsideTenant('test: old description', () => platformPrisma.role.update({ where: { id: xViewer.id }, data: { description: 'Read-only across the product' } }));
    /* Made from an older version still (before My attendance CREATE): not an exact match, never changed. */
    await setGrants(xHrManager.id, OLD.get('hr manager')!.filter((k) => k !== 'ATTENDANCE::My Attendance::CREATE'));
    await setGrants(xAuditor.id, OLD.get('auditor')!);
    /* Saved on the screen exactly as the old template: changed by a person, but still the template. */
    await setOnScreen(x, xHrUser.id, OLD.get('hr user')!);

    /* Company Y: an administrator changed them. */
    const yHrManager = await roleOf(y, 'HR Manager');
    const yViewer = await roleOf(y, 'Viewer');
    const yAuditor = await roleOf(y, 'Auditor');
    await setOnScreen(y, yHrManager.id, OLD.get('hr manager')!.filter((k) => k !== 'PEOPLE::Employees::DELETE'));
    await setOnScreen(y, yViewer.id, [...OLD.get('viewer')!, 'SALES::Invoices::EXPORT']);
    await setGrants(yAuditor.id, OLD.get('auditor')!);
    await outsideTenant('test: team-only auditor', () => platformPrisma.role.update({ where: { id: yAuditor.id }, data: { ownDocumentsOnly: true } }));
    const reader = (await api(y).post('/roles', { name: `Docs reader ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201)).body.role;
    await setOnScreen(y, reader.id, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Statutory Details::VIEW']);

    await run();

    expect(await held(xViewer.id)).toEqual(keysOf('VIEWER').sort());
    expect((await roleOf(x, 'Viewer')).description).toBe(ROLE_PRESETS.VIEWER.description);
    expect(await held(xHrManager.id)).toEqual(keysOf('HR_MANAGER').sort());
    expect(await held(xHrUser.id)).toEqual(keysOf('HR_USER').sort());
    expect(await held(xAuditor.id)).toEqual(keysOf('AUDITOR').sort());

    /* Left alone, but opening exactly what it opened before: HR-only files and full identifiers come with it. */
    const yHr = await held(yHrManager.id);
    expect(yHr).not.toContain('PEOPLE::Policies::VIEW');
    expect(yHr).not.toContain('PEOPLE::Employees::DELETE');
    expect(yHr).toContain('PEOPLE::HR-only Documents::VIEW');
    expect(yHr).toContain('PEOPLE::Full Identifiers::VIEW');
    const yView = await held(yViewer.id);
    expect(yView).toContain('PEOPLE::Confidential Documents::VIEW');
    expect(yView).toContain('SALES::Invoices::EXPORT');
    expect(yView).toContain('PEOPLE::HR-only Documents::VIEW');
    expect(yView).toContain('PEOPLE::Full Identifiers::VIEW');
    expect(await held(yAuditor.id)).toEqual([...OLD.get('auditor')!].sort());
    expect(await held(reader.id)).toEqual(['PEOPLE::Documents::VIEW', 'PEOPLE::Employees::VIEW', 'PEOPLE::Full Identifiers::VIEW', 'PEOPLE::HR-only Documents::VIEW', 'PEOPLE::Statutory Details::VIEW']);

    /* Said in the audit trail, and on the roles screen. */
    const notes = await outsideTenant('test: notes', () => platformPrisma.auditLog.findMany({ where: { entityId: { in: [xViewer.id, yHrManager.id] }, action: { in: ['TEMPLATE_LEFT', 'TEMPLATE_APPLIED'] } }, select: { entityId: true, action: true } }));
    expect(notes).toEqual(expect.arrayContaining([{ entityId: xViewer.id, action: 'TEMPLATE_APPLIED' }, { entityId: yHrManager.id, action: 'TEMPLATE_LEFT' }]));
    const yRoles = (await api(y).get('/roles').expect(200)).body.roles;
    const drift = yRoles.find((r: any) => r.id === yHrManager.id).template;
    expect(drift.matches).toBe(false);
    expect(drift.missing).toEqual(expect.arrayContaining(['PEOPLE::Policies::VIEW', 'PEOPLE::Privacy::VIEW', 'PEOPLE::Private Cases::VIEW', 'PEOPLE::Employees::DELETE']));

    /* Run again: nothing more changes. */
    const ids = [xViewer.id, xHrManager.id, xHrUser.id, xAuditor.id, yHrManager.id, yViewer.id, yAuditor.id, reader.id];
    const before = await Promise.all(ids.map(held));
    const notesBefore = await outsideTenant('test: count notes', () => platformPrisma.auditLog.count({ where: { entityId: { in: ids }, action: { in: ['TEMPLATE_LEFT', 'TEMPLATE_APPLIED'] } } }));
    await run();
    expect(await Promise.all(ids.map(held))).toEqual(before);
    expect(await outsideTenant('test: count notes', () => platformPrisma.auditLog.count({ where: { entityId: { in: ids }, action: { in: ['TEMPLATE_LEFT', 'TEMPLATE_APPLIED'] } } }))).toBe(notesBefore);
  }, 120_000);
});
