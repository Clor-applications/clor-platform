import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Compliance in depth (People audit 30 Oct 2026, gaps 2, 10 and 16):
 * obligations carry an owner (a user or someone outside CLOR), a reference,
 * a note, proof files and "checked by / on"; the company adds its own
 * deadlines and its own rules for the states it works in (versioned, checked
 * again by a named person); the old calendar's deadlines move into
 * Compliance; a work site's registrations feed it; every notice opens
 * Compliance.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { PrismaClient } = await import('../generated/people/index.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(name = 'Asha Owner'): Promise<Ctx> {
  const email = `cdepth.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Depth Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/\s/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  patch: (path: string, body: unknown) => request(app).patch(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);
const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF').toString('base64')}`;

let boss: Ctx;
let hr: Ctx;
let viewer: Ctx;
let teamLead: Ctx;
let other: Ctx;
beforeAll(async () => {
  boss = await owner();
  hr = await colleague(boss, 'Kiran HR', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Org Structure::VIEW', 'PEOPLE::Org Structure::EDIT', 'PEOPLE::Org Structure::CREATE']);
  viewer = await colleague(boss, 'Vinod Viewer', ['PEOPLE::Employees::VIEW']);
  teamLead = await colleague(boss, 'Tara Lead', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT'], true);
  other = await owner('Other Owner');
}, 120_000);

describe('obligations: owner, proof, checked', () => {
  it('HR adds its own deadline with an outside owner, attaches proof, marks it done, and someone checks it; the history stays', async () => {
    await people(hr).post('/compliance/obligations', { title: '', dueOn: plus(10) }).expect(400);
    await people(hr).post('/compliance/obligations', { title: 'Fire licence renewal', dueOn: 'soon' }).expect(400);
    const made = (await people(hr).post('/compliance/obligations', { title: 'Fire licence renewal', dueOn: plus(10), ownerName: 'Mehta & Co (CA)', note: 'Inspector visits first' }).expect(201)).body.obligation;
    expect(made).toMatchObject({ source: 'OWN', title: 'Fire licence renewal', status: 'DUE', owner: 'Mehta & Co (CA)', ownerSet: true, legalSource: 'Your own deadline', ruleChecked: true, proofs: [] });
    const owners = (await people(hr).get('/compliance/owners').expect(200)).body;
    expect(owners.users.map((u: any) => u.name)).toEqual(expect.arrayContaining(['Asha Owner', 'Kiran HR']));
    expect(owners.names).toContain('Mehta & Co (CA)');

    /* Proof: the bytes must be what the file says it is. */
    await people(hr).post(`/compliance/obligations/${made.id}/proofs`, { name: 'receipt.pdf', mime: 'application/pdf', dataUrl: `data:application/pdf;base64,${Buffer.from('<html>no</html>').toString('base64')}` }).expect(400);
    await people(hr).post(`/compliance/obligations/${made.id}/proofs`, { name: 'receipt.txt', mime: 'text/plain', dataUrl: 'data:text/plain;base64,aGk=' }).expect(400);
    const proof = (await people(hr).post(`/compliance/obligations/${made.id}/proofs`, { name: 'Fire NOC receipt.pdf', mime: 'application/pdf', dataUrl: pdf }).expect(201)).body.proof;
    const file = (await people(viewer).get(`/compliance/obligations/${made.id}/proofs/${proof.id}`).expect(200)).body.proof;
    expect(file).toMatchObject({ name: 'Fire NOC receipt.pdf', mime: 'application/pdf' });
    expect(file.dataUrl).toBe(pdf);

    /* Checked is the second look: only after done. */
    await people(hr).patch(`/compliance/obligations/${made.id}`, { status: 'CHECKED' }).expect(409);
    const done = (await people(hr).patch(`/compliance/obligations/${made.id}`, { status: 'DONE', reference: 'FIRE/2026/118', ownerUserId: hr.userId }).expect(200)).body.obligation;
    expect(done).toMatchObject({ status: 'DONE', doneBy: 'Kiran HR', doneOn: today(), reference: 'FIRE/2026/118', owner: 'Kiran HR', ownerName: null });
    expect(done.proofs).toEqual([expect.objectContaining({ name: 'Fire NOC receipt.pdf', uploadedBy: 'Kiran HR' })]);
    const checked = (await people(boss).patch(`/compliance/obligations/${made.id}`, { status: 'CHECKED' }).expect(200)).body.obligation;
    expect(checked).toMatchObject({ status: 'CHECKED', doneBy: 'Kiran HR', checkedBy: 'Asha Owner', checkedOn: today() });
    /* A checked proof is not swapped behind the checker's back. */
    await people(hr).post(`/compliance/obligations/${made.id}/proofs`, { name: 'other.pdf', mime: 'application/pdf', dataUrl: pdf }).expect(409);
    await people(hr).del(`/compliance/obligations/${made.id}/proofs/${proof.id}`).expect(409);
    /* Open again: done and checked are cleared; the proof can then change. */
    const reopened = (await people(hr).patch(`/compliance/obligations/${made.id}`, { status: 'OPEN' }).expect(200)).body.obligation;
    expect(reopened).toMatchObject({ status: 'DUE', doneAt: null, checkedAt: null });
    await people(hr).del(`/compliance/obligations/${made.id}/proofs/${proof.id}`).expect(204);
    /* Only the company's own deadline moves; a rule's follows the rule. */
    const moved = (await people(hr).patch(`/compliance/obligations/${made.id}`, { dueOn: plus(40), title: 'Fire licence renewal (main site)' }).expect(200)).body.obligation;
    expect(moved).toMatchObject({ dueOn: plus(40), status: 'UPCOMING', title: 'Fire licence renewal (main site)' });
    const ruleRow = (await people(hr).get('/compliance/obligations').expect(200)).body.obligations.find((o: any) => o.source === 'RULE');
    if (ruleRow) await people(hr).patch(`/compliance/obligations/${ruleRow.id}`, { dueOn: plus(3) }).expect(400);
    /* Does not apply: closed, with who said so. */
    const na = (await people(hr).patch(`/compliance/obligations/${made.id}`, { status: 'NOT_APPLICABLE' }).expect(200)).body.obligation;
    expect(na).toMatchObject({ status: 'NOT_APPLICABLE', doneBy: 'Kiran HR' });
    expect((await people(hr).get('/compliance/obligations?status=DONE,CHECKED,NOT_APPLICABLE').expect(200)).body.obligations.map((o: any) => o.id)).toContain(made.id);
  });

  it('refuses a viewer, a team-only lead and another company; an owner who is not a user here is refused', async () => {
    const made = (await people(hr).post('/compliance/obligations', { title: 'Trade licence', dueOn: plus(20) }).expect(201)).body.obligation;
    await people(viewer).post('/compliance/obligations', { title: 'x', dueOn: plus(1) }).expect(403);
    await people(viewer).patch(`/compliance/obligations/${made.id}`, { status: 'DONE' }).expect(403);
    await people(viewer).post(`/compliance/obligations/${made.id}/proofs`, { name: 'a.pdf', mime: 'application/pdf', dataUrl: pdf }).expect(403);
    await people(viewer).get('/compliance/owners').expect(403);
    await people(teamLead).patch(`/compliance/obligations/${made.id}`, { status: 'DONE' }).expect(403);
    await people(teamLead).post('/compliance/obligations', { title: 'x', dueOn: plus(1) }).expect(403);
    await people(other).patch(`/compliance/obligations/${made.id}`, { status: 'DONE' }).expect(404);
    await people(other).post(`/compliance/obligations/${made.id}/proofs`, { name: 'a.pdf', mime: 'application/pdf', dataUrl: pdf }).expect(404);
    expect((await people(other).get('/compliance/obligations').expect(200)).body.obligations.map((o: any) => o.id)).not.toContain(made.id);
    await people(hr).patch(`/compliance/obligations/${made.id}`, { ownerUserId: other.userId }).expect(400);
    await people(hr).post('/compliance/obligations', { title: 'x', dueOn: plus(1), ownerUserId: other.userId }).expect(400);
    const proof = (await people(hr).post(`/compliance/obligations/${made.id}/proofs`, { name: 'a.pdf', mime: 'application/pdf', dataUrl: pdf }).expect(201)).body.proof;
    await people(other).get(`/compliance/obligations/${made.id}/proofs/${proof.id}`).expect(404);
  });

  it('naming an owner tells them, and every obligation notice opens Compliance, not the old calendar (gap 2)', async () => {
    const made = (await people(hr).post('/compliance/obligations', { title: 'Lift inspection', dueOn: plus(5) }).expect(201)).body.obligation;
    await people(hr).patch(`/compliance/obligations/${made.id}`, { ownerUserId: boss.userId }).expect(200);
    const told = await runInTenant(boss.orgId, () => platformPrisma.notification.findMany({ where: { orgId: boss.orgId, userId: boss.userId, kind: 'people.obligation' } }));
    expect(told.length).toBeGreaterThanOrEqual(1);
    for (const n of told) expect(JSON.parse(n.linkJson || '{}')).toMatchObject({ app: 'people', screen: 'compliance' });
    expect(told.map((n) => JSON.parse(n.linkJson || '{}').params?.id)).toContain(made.id);
  });
});

describe('rules: a state rule of the company’s own', () => {
  it('a rule reaches India, every state, or a state with a work site; a new version needs checking again; two saves at once get two versions', async () => {
    await people(hr).post('/compliance/rules', { title: 'Maharashtra: night shift register', jurisdiction: 'IN-MH', obligation: 'Keep a register of women on night shifts.', legalSource: 'MH S&E Rules 2018, r.18', dueRule: { kind: 'STANDING' } }).expect(400);
    await people(hr).post('/structure/establishments', { name: 'Pune depot', kind: 'WAREHOUSE', state: 'Maharashtra' }).expect(201);
    await people(hr).post('/compliance/rules', { title: 'Bad due', jurisdiction: 'IN-MH', obligation: 'x', legalSource: 'y', dueRule: { kind: 'MONTHLY', day: 40 } }).expect(400);
    const own = (await people(hr).post('/compliance/rules', { title: 'Maharashtra: night shift register', jurisdiction: 'IN-MH', obligation: 'Keep a register of women on night shifts.', legalSource: 'MH S&E Rules 2018, r.18', dueRule: { kind: 'MONTHLY', day: 10 }, threshold: { minHeadcount: 1 }, requiredProof: ['REGISTER_COPY'] }).expect(201)).body.rule;
    expect(own).toMatchObject({ version: 1, jurisdiction: 'IN-MH', reviewStatus: 'DRAFT', dueRule: { kind: 'MONTHLY', day: 10 } });
    expect(own.ruleId).toMatch(/^IN-MH-OWN-/);
    await people(viewer).post('/compliance/rules', { ruleId: own.ruleId, obligation: 'x' }).expect(403);
    await people(hr).post(`/compliance/rules/${own.ruleId}/versions/1/check`, {}).expect(200);
    /* Two people re-version at the same moment: each gets its own number; one stays active. */
    const [a, b] = await Promise.all([
      people(hr).post('/compliance/rules', { ruleId: own.ruleId, obligation: 'Keep the register, signed weekly.' }),
      people(boss).post('/compliance/rules', { ruleId: own.ruleId, obligation: 'Keep the register, signed daily.' }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.rule.version, b.body.rule.version].sort()).toEqual([2, 3]);
    const all = (await people(hr).get('/compliance/rules?all=1').expect(200)).body.rules.filter((r: any) => r.ruleId === own.ruleId);
    expect(all.filter((r: any) => r.active)).toHaveLength(1);
    expect(all.find((r: any) => r.active)).toMatchObject({ version: 3, reviewStatus: 'DRAFT', checkedLine: 'Check with your adviser' });
    /* Another company cannot check this company's rule. */
    await people(other).post(`/compliance/rules/${own.ruleId}/versions/3/check`, {}).expect(404);
  });
});

describe('work-site registrations feed Compliance (gap 16)', () => {
  it('a registration running out becomes a renewal; renewing settles it; an S&E number settles registering; the list shows each site', async () => {
    const site = (await people(hr).post('/structure/establishments', { name: 'Hubli shop', kind: 'SHOP', state: 'Karnataka', registrations: [
      { type: 'SE_REG', number: 'KA/SE/2026/0042', validTill: plus(20) },
      { type: 'PF', number: 'KNHUB0012345000', validTill: '' },
    ] }).expect(201)).body.item;
    const regs = (await people(viewer).get('/compliance/registrations').expect(200)).body;
    expect(regs.types.map((t: any) => t.value)).toEqual(expect.arrayContaining(['SE_REG', 'PF', 'ESI', 'PT']));
    expect(regs.sites.find((s: any) => s.id === site.id).registrations).toEqual([
      { type: 'SE_REG', number: 'KA/SE/2026/0042', validTill: plus(20), label: 'Shops & Establishments registration' },
      { type: 'PF', number: 'KNHUB0012345000', validTill: null, label: 'PF code (EPFO)' },
    ]);
    const list = (await people(hr).get(`/compliance/obligations?establishmentId=${site.id}`).expect(200)).body.obligations;
    const renew = list.find((o: any) => o.source === 'REGISTRATION');
    expect(renew).toMatchObject({ ruleId: 'REG-SE_REG', dueOn: plus(20), status: 'DUE', establishment: 'Hubli shop', requiredProof: ['REGISTRATION_CERTIFICATE'] });
    expect(renew.title).toBe('Renew Shops & Establishments registration — Hubli shop (KA/SE/2026/0042)');
    expect(list.filter((o: any) => o.source === 'REGISTRATION')).toHaveLength(1);
    /* The site's S&E number means it registered. */
    expect(list.find((o: any) => o.ruleId === 'IN-SE-REG')).toMatchObject({ status: 'DONE', reference: 'KA/SE/2026/0042' });
    /* Renewed on the work site: the old renewal is settled, the next one waits for its own date. */
    await people(hr).put(`/structure/establishments/${site.id}`, { name: 'Hubli shop', registrations: [{ type: 'SE_REG', number: 'KA/SE/2026/0042', validTill: plus(170) }] }).expect(200);
    const after = (await people(hr).get(`/compliance/obligations?establishmentId=${site.id}`).expect(200)).body.obligations.filter((o: any) => o.source === 'REGISTRATION');
    expect(after.find((o: any) => o.id === renew.id)).toMatchObject({ status: 'DONE', note: 'Renewed: the work site has the new registration.' });
    expect(after.find((o: any) => o.id !== renew.id)).toMatchObject({ dueOn: plus(170), status: 'UPCOMING' });
    /* Another company sees none of it. */
    expect((await people(other).get('/compliance/registrations').expect(200)).body.sites.map((s: any) => s.id)).not.toContain(site.id);
  });
});

describe('the old calendar moves into Compliance (data migration)', () => {
  it('copies each deadline once — owner, reference, done, evidence — as the application role, which is not a superuser', async () => {
    const make = (c: Ctx, data: Record<string, unknown>) => runInTenant(c.orgId, () => peoplePrisma.complianceTask.create({ data: { accountId: 'acc', orgId: c.orgId, ...data } as any }));
    const pf = await make(boss, { code: 'PF_ECR', period: '2026-08', title: 'PF: ECR filed and paid for Aug 2026', dueDate: '2026-09-15', status: 'DONE', owner: 'Our CA', reference: 'TRRN 1234', doneAt: new Date('2026-09-14T06:00:00Z'), doneByUserId: hr.userId, evidenceName: 'challan.pdf', evidenceMime: 'application/pdf', evidenceData: Buffer.from('%PDF-1.4 x') });
    const own = await make(boss, { code: 'CUSTOM', period: `custom-${rnd()}`, title: 'Pollution board consent', dueDate: plus(60), owner: 'Plant head', note: 'Renew online' });
    const theirs = await make(other, { code: 'ESIC', period: '2026-08', title: 'ESIC for Aug 2026', dueDate: '2026-09-15', status: 'NOT_APPLICABLE' });
    const sql = readFileSync(resolve(process.cwd(), 'prisma/people/migrations/20261107090200_calendar_into_obligations/migration.sql'), 'utf8');
    const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
    /* The application role, as production runs migrations: no superuser, no BYPASSRLS. */
    const db = new PrismaClient({ datasources: { db: { url: `${process.env.PEOPLE_DATABASE_URL}&connection_limit=1` } } });
    try {
      const [role] = await db.$queryRawUnsafe<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
      for (const s of statements) await db.$executeRawUnsafe(s);
      for (const s of statements) await db.$executeRawUnsafe(s);
    } finally {
      await db.$disconnect();
    }
    const mine = await runInTenant(boss.orgId, () => peoplePrisma.obligation.findMany({ where: { orgId: boss.orgId, id: { in: [`cal_${pf.id}`, `cal_${own.id}`] } }, orderBy: { id: 'asc' } }));
    expect(mine).toHaveLength(2);
    const p = mine.find((o) => o.id === `cal_${pf.id}`)!;
    expect(p).toMatchObject({ ruleId: 'PF_ECR', ruleVersion: 0, period: '2026-08', dueOn: '2026-09-15', status: 'DONE', ownerName: 'Our CA', reference: 'TRRN 1234', source: 'STATUTORY', doneByUserId: hr.userId });
    expect(mine.find((o) => o.id === `cal_${own.id}`)).toMatchObject({ ruleId: 'OWN', source: 'OWN', status: 'UPCOMING', ownerName: 'Plant head', note: 'Renew online', dueToldAt: null });
    const proofs = await runInTenant(boss.orgId, () => peoplePrisma.obligationProof.findMany({ where: { orgId: boss.orgId, obligationId: `cal_${pf.id}` } }));
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ name: 'challan.pdf', mime: 'application/pdf' });
    expect((await runInTenant(other.orgId, () => peoplePrisma.obligation.findFirst({ where: { id: `cal_${theirs.id}` } })))).toMatchObject({ orgId: other.orgId, status: 'NOT_APPLICABLE', source: 'STATUTORY' });
    /* Shown on the Compliance screen with the rest, proof and all. */
    const shown = (await people(hr).get(`/compliance/obligations?id=cal_${pf.id}`).expect(200)).body.obligations[0];
    expect(shown).toMatchObject({ source: 'STATUTORY', owner: 'Our CA', status: 'DONE', legalSource: expect.stringContaining('EPF Scheme'), requiredProof: ['PAYMENT_CHALLAN'], link: { app: 'payroll', screen: 'reports' } });
    expect(shown.proofs).toEqual([expect.objectContaining({ name: 'challan.pdf' })]);
    /* The file itself comes across, whether its bytes sat in the row or in object storage. */
    const opened = (await people(hr).get(`/compliance/obligations/cal_${pf.id}/proofs/${shown.proofs[0].id}`).expect(200)).body.proof;
    expect(Buffer.from(opened.dataUrl.split(',')[1], 'base64').toString()).toBe('%PDF-1.4 x');
    /* Another company's row never shows here. */
    expect((await people(hr).get(`/compliance/obligations?id=cal_${theirs.id}`).expect(200)).body.obligations).toEqual([]);
  });
});
