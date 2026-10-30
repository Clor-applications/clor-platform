import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Row-level security on every People table this build adds (docs/people/02-PRD.md
 * FND-01): the policy fails closed (no company set, no bypass: nothing), and
 * one company never reads another's rows through the application client.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `rls.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `RLS Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.accountId = me.body.orgs.find((o: any) => o.orgId === ctx.orgId).accountId;
  return ctx;
}

/* Every table this build added, with how to make one row in it. */
const TABLES: Array<{ table: string; model: string; make: (c: Ctx, employeeId: string) => Record<string, unknown> }> = [
  { table: 'EmploymentEpisode', model: 'employmentEpisode', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, seq: 9, startDate: '2026-01-01' }) },
  { table: 'ChangeLog', model: 'changeLog', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, entity: 'Employee', entityId: employeeId, employeeId, field: 'x', source: 'API', correlationId: `t-${rnd()}` }) },
  { table: 'OutboxEvent', model: 'outboxEvent', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, name: 'people.employee.updated.v1', employeeId, correlationId: `t-${rnd()}`, payload: {} }) },
  { table: 'LegalEntity', model: 'legalEntity', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, name: `LE ${rnd()}` }) },
  { table: 'Establishment', model: 'establishment', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, name: `Est ${rnd()}`, state: 'Karnataka' }) },
  { table: 'ScheduledChange', model: 'scheduledChange', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, field: 'departmentId', effectiveOn: '2099-01-01', correlationId: `t-${rnd()}` }) },
  { table: 'EmployeeIdentity', model: 'employeeIdentity', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, employeeId, aadhaarLast4: '1111' }) },
  { table: 'AccessLog', model: 'accessLog', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, what: 'STATUTORY', entityId: employeeId, employeeId, userId: 'u' }) },
  /* Shift swaps and request types HR makes (FEATURE-UI-AUDIT gaps 24, 25). */
  { table: 'ShiftSwap', model: 'shiftSwap', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, requesterEmployeeId: employeeId, colleagueEmployeeId: employeeId, fromDate: '2099-01-01', toDate: '2099-01-01', days: [], requestedByUserId: 'u' }) },
  { table: 'RequestForm', model: 'requestForm', make: (c) => ({ accountId: c.accountId, orgId: c.orgId, name: `Form ${rnd()}`, fields: [] }) },
  { table: 'RequestFormFile', model: 'requestFormFile', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, formId: 'f', employeeId, fieldKey: 'k', fileName: 'a.png', mime: 'image/png', size: 1, data: Buffer.from('x') }) },
  { table: 'Referral', model: 'referral', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, openingId: `o-${rnd()}`, candidateId: `c-${rnd()}`, referrerEmployeeId: employeeId, phoneKey: '9800000000' }) },
  { table: 'ReferralLink', model: 'referralLink', make: (c, employeeId) => ({ accountId: c.accountId, orgId: c.orgId, openingId: `o-${rnd()}`, referrerEmployeeId: employeeId, tokenHash: `h-${rnd()}${rnd()}` }) },
];

let a: Ctx;
let b: Ctx;
let employeeA: string;
beforeAll(async () => {
  a = await owner();
  b = await owner();
  employeeA = (await request(app).post(`/api/orgs/${a.orgId}/people/employees`).set(at(a)).send({ name: 'Only A', code: 'R-1' }).expect(201)).body.employee.id;
}, 90_000);

describe('row-level security on the new People tables', () => {
  for (const t of TABLES) {
    it(`${t.table}: the policy fails closed and company B reads nothing of company A's`, async () => {
      const [{ qual }] = await peoplePrisma.$queryRawUnsafe<Array<{ qual: string }>>(`SELECT pg_get_expr(polqual, polrelid) AS qual FROM pg_policy WHERE polname = 'tenant_isolation' AND polrelid = '"${t.table}"'::regclass`);
      expect(qual, t.table).toContain("current_setting('clor.bypass'::text, true) = 'on'::text");
      expect(qual, t.table).toContain("NULLIF(current_setting('clor.org_id'::text, true), ''::text)");
      expect(qual, t.table).not.toContain('IS NULL');
      const [{ forced }] = await peoplePrisma.$queryRawUnsafe<Array<{ forced: boolean }>>(`SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = '"${t.table}"'::regclass`);
      expect(forced, t.table).toBe(true);

      const row = await runInTenant(a.orgId, () => (peoplePrisma as any)[t.model].create({ data: t.make(a, employeeA) }));
      expect(await runInTenant(a.orgId, () => (peoplePrisma as any)[t.model].count({ where: { id: row.id } }))).toBe(1);
      expect(await runInTenant(b.orgId, () => (peoplePrisma as any)[t.model].count({ where: { id: row.id } }))).toBe(0);
      /* Company B cannot write into A's row either: the update finds nothing. */
      const touched = await runInTenant(b.orgId, () => (peoplePrisma as any)[t.model].updateMany({ where: { id: row.id }, data: { orgId: b.orgId } }));
      expect(touched.count).toBe(0);
    });
  }
});
