import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { notifyPermission, notifyUsers } from '../notifications.js';
import { writeEvent } from './outbox.js';

/**
 * The rule library and the obligations it produces (docs/people/02-PRD.md
 * COMP-01..06; docs/people/05-INDIA-COMPLIANCE-MATRIX.md). A company starts
 * with CLOR's catalogue, each rule unchecked — "Check with your adviser" —
 * until a named person confirms it (COMP-05). Every edit is a new version;
 * nothing is overwritten (COMP-01). Obligations are worked out from the
 * company's establishments and headcount (COMP-02): a Maharashtra shop
 * brings Maharashtra items, and without one there are none. Each opens to
 * its source, scope, proof, owner and history; there is no score (COMP-03).
 */

export type DueRule = { kind: 'MONTHLY'; day: number } | { kind: 'ANNUAL'; month: number; day: number } | { kind: 'HALF_YEARLY'; months: [number, number]; day: number } | { kind: 'ONCE'; days: number } | { kind: 'STANDING' };
export type CatalogueRule = {
  ruleId: string; title: string; jurisdiction: string; establishmentKinds: string[]; employeeCategories: string[]; legalSource: string; notificationRef?: string | null;
  effectiveFrom: string; obligation: string; threshold?: { minHeadcount?: number } | null; ownerRole: string; dueRule: DueRule; requiredProof: string[];
};

/** CLOR's catalogue, from the compliance matrix. Figures and dates are the matrix's; each company confirms them with its adviser. */
export const CATALOGUE: CatalogueRule[] = [
  { ruleId: 'IN-POSH-IC', title: 'POSH: Internal Committee', jurisdiction: 'IN', establishmentKinds: [], employeeCategories: ['ALL'], legalSource: 'Sexual Harassment of Women at Workplace Act 2013, s.4; matrix C-POSH-01', effectiveFrom: '2013-12-09', obligation: 'Constitute an Internal Committee: a senior woman presiding, at least two employee members, one external member, at least half women; term up to three years.', threshold: { minHeadcount: 10 }, ownerRole: 'HR', dueRule: { kind: 'STANDING' }, requiredProof: ['COMMITTEE_ORDER'] },
  { ruleId: 'IN-POSH-REPORT', title: 'POSH: annual report of the Internal Committee', jurisdiction: 'IN', establishmentKinds: [], employeeCategories: ['ALL'], legalSource: 'POSH Act s.21; matrix C-POSH-01', effectiveFrom: '2013-12-09', obligation: 'File the Internal Committee’s annual report with the District Officer for the calendar year.', threshold: { minHeadcount: 10 }, ownerRole: 'HR', dueRule: { kind: 'ANNUAL', month: 1, day: 31 }, requiredProof: ['FILING_RECEIPT'] },
  { ruleId: 'IN-IR-GRC', title: 'Grievance Redressal Committee', jurisdiction: 'IN', establishmentKinds: [], employeeCategories: ['ALL'], legalSource: 'Industrial Relations Code 2020 s.4; matrix C-LC-09', effectiveFrom: '2025-11-21', obligation: 'Set up a Grievance Redressal Committee (up to ten members) where twenty or more workers are employed.', threshold: { minHeadcount: 20 }, ownerRole: 'HR', dueRule: { kind: 'STANDING' }, requiredProof: ['COMMITTEE_ORDER'] },
  { ruleId: 'IN-CRECHE', title: 'Crèche facility', jurisdiction: 'IN', establishmentKinds: [], employeeCategories: ['ALL'], legalSource: 'Maternity Benefit Act s.11A; matrix C-LC-11', effectiveFrom: '2017-04-01', obligation: 'Provide a crèche, or the allowance the state sets, where fifty or more people are employed.', threshold: { minHeadcount: 50 }, ownerRole: 'HR', dueRule: { kind: 'STANDING' }, requiredProof: ['FACILITY_RECORD'] },
  { ruleId: 'IN-IR-STANDING-ORDERS', title: 'Standing orders', jurisdiction: 'IN', establishmentKinds: ['FACTORY', 'SITE', 'WAREHOUSE', 'SHOP', 'OFFICE'], employeeCategories: ['ALL'], legalSource: 'Industrial Relations Code 2020 ch. IV; matrix C-LC-10', effectiveFrom: '2025-11-21', obligation: 'Certify standing orders where three hundred or more workers are employed.', threshold: { minHeadcount: 300 }, ownerRole: 'HR', dueRule: { kind: 'STANDING' }, requiredProof: ['CERTIFIED_ORDERS'] },
  { ruleId: 'IN-SE-REG', title: 'Shops & Establishments registration', jurisdiction: 'IN-STATE', establishmentKinds: ['SHOP', 'OFFICE', 'WAREHOUSE'], employeeCategories: ['ALL'], legalSource: 'State Shops & Establishments Acts; matrix C-ST-01', effectiveFrom: '2000-01-01', obligation: 'Register each shop or commercial establishment with the state within its timeline (30 to 90 days), and keep the registration current.', ownerRole: 'HR', dueRule: { kind: 'ONCE', days: 30 }, requiredProof: ['REGISTRATION_CERTIFICATE'] },
  { ruleId: 'IN-ANNUAL-RETURN', title: 'Annual return to the state labour department', jurisdiction: 'IN-STATE', establishmentKinds: [], employeeCategories: ['ALL'], legalSource: 'State rules under the labour codes; matrix C-LC-08', effectiveFrom: '2000-01-01', obligation: 'File the unified annual return for each establishment, where the state asks for one.', ownerRole: 'HR', dueRule: { kind: 'ANNUAL', month: 2, day: 1 }, requiredProof: ['FILING_RECEIPT'] },
  { ruleId: 'IN-LWF', title: 'Labour Welfare Fund contribution', jurisdiction: 'IN-STATE', establishmentKinds: [], employeeCategories: ['ALL'], legalSource: 'State Labour Welfare Fund Acts; matrix C-ST-07', effectiveFrom: '2000-01-01', obligation: 'Deduct and pay the Labour Welfare Fund contribution on the state’s cycle; rates and the cycle are the state’s and Payroll computes them.', ownerRole: 'PAYROLL', dueRule: { kind: 'HALF_YEARLY', months: [7, 1], day: 15 }, requiredProof: ['PAYMENT_CHALLAN'] },
  { ruleId: 'IN-KA-SERVICE-CERT', title: 'Karnataka: service certificate within 7 days', jurisdiction: 'IN-KA', establishmentKinds: [], employeeCategories: ['ALL'], legalSource: 'Karnataka Shops & Commercial Establishments (Amendment) 2026; matrix C-ST-02', effectiveFrom: '2026-09-04', obligation: 'Give a service certificate within seven days of asking; never retain an employee’s original documents; notify changes within seven days.', ownerRole: 'HR', dueRule: { kind: 'STANDING' }, requiredProof: [] },
  { ruleId: 'IN-TN-365', title: 'Tamil Nadu: 365-day working permission conditions', jurisdiction: 'IN-TN', establishmentKinds: ['SHOP', 'OFFICE'], employeeCategories: ['ALL'], legalSource: 'Tamil Nadu notification, 24 Aug 2026; matrix C-ST-03', effectiveFrom: '2026-08-24', obligation: 'Where the establishment works all days: rotate the weekly holiday, take women’s written consent for night work, and keep the Internal Committee under POSH.', ownerRole: 'HR', dueRule: { kind: 'STANDING' }, requiredProof: ['PERMISSION_ORDER'] },
  { ruleId: 'IN-TS-SE-REG', title: 'Telangana: register within 30 days, changes within 15', jurisdiction: 'IN-TS', establishmentKinds: ['SHOP', 'OFFICE', 'WAREHOUSE'], employeeCategories: ['ALL'], legalSource: 'Telangana Shops & Establishments Act; matrix C-ST-04', effectiveFrom: '2000-01-01', obligation: 'Register a new establishment within thirty days (deemed registration applies); notify changes within fifteen days.', ownerRole: 'HR', dueRule: { kind: 'ONCE', days: 30 }, requiredProof: ['REGISTRATION_CERTIFICATE'] },
  { ruleId: 'IN-OSH-WOMEN-NIGHT', title: 'Women at night: consent and safeguards', jurisdiction: 'IN', establishmentKinds: [], employeeCategories: ['ALL'], legalSource: 'OSH Code 2020 s.43; matrix C-LC-06', effectiveFrom: '2025-11-21', obligation: 'Where women work before 6 am or after 7 pm: written consent on file, transport, CCTV and POSH measures in place.', ownerRole: 'HR', dueRule: { kind: 'STANDING' }, requiredProof: ['CONSENT_RECORDS'] },
];

const STATE_CODES: Record<string, string> = { karnataka: 'KA', maharashtra: 'MH', 'tamil nadu': 'TN', tamilnadu: 'TN', telangana: 'TS', delhi: 'DL', gujarat: 'GJ', haryana: 'HR', 'uttar pradesh': 'UP', 'west bengal': 'WB', kerala: 'KL', 'andhra pradesh': 'AP', rajasthan: 'RJ', 'madhya pradesh': 'MP', punjab: 'PB', bihar: 'BR', odisha: 'OR', goa: 'GA', assam: 'AS' };
export const stateCode = (state: string | null | undefined) => (state ? STATE_CODES[state.trim().toLowerCase()] || state.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) : null);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** A date with the day held inside the month: 31 January stays 31, 31 February becomes the 28th or 29th. */
const ymd = (y: number, m: number, d: number) => { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; };

export class ComplianceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type RuleRow = Awaited<ReturnType<typeof peoplePrisma.complianceRule.findFirst>> & object;
const shapeRule = (r: RuleRow, names: Map<string, string>) => ({
  id: r.id, ruleId: r.ruleId, version: r.version, title: r.title, jurisdiction: r.jurisdiction, establishmentKinds: r.establishmentKinds as string[], employeeCategories: r.employeeCategories as string[],
  legalSource: r.legalSource, notificationRef: r.notificationRef, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, supersedesVersion: r.supersedesVersion, obligation: r.obligation, threshold: (r.threshold as { minHeadcount?: number } | null) || null,
  ownerRole: r.ownerRole, dueRule: r.dueRule as DueRule, requiredProof: r.requiredProof as string[], reviewStatus: r.reviewStatus, active: r.active,
  checkedBy: r.checkedByUserId ? names.get(r.checkedByUserId) || '' : '', checkedAt: r.checkedAt, checkedLine: r.reviewStatus === 'CHECKED' && r.checkedAt ? `Last checked by ${names.get(r.checkedByUserId || '') || 'someone'} on ${new Date(r.checkedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10)}` : 'Check with your adviser', createdAt: r.createdAt,
});

/** The library, seeded from the catalogue the first time it is read. */
export async function rulesOf(accountId: string, orgId: string, opts: { all?: boolean } = {}) {
  const have = await peoplePrisma.complianceRule.count({ where: { orgId } });
  if (!have) {
    await peoplePrisma.complianceRule.createMany({ data: CATALOGUE.map((c) => ({ accountId, orgId, ruleId: c.ruleId, version: 1, title: c.title, jurisdiction: c.jurisdiction, establishmentKinds: c.establishmentKinds, employeeCategories: c.employeeCategories, legalSource: c.legalSource, notificationRef: c.notificationRef ?? null, effectiveFrom: c.effectiveFrom, obligation: c.obligation, threshold: (c.threshold ?? undefined) as any, ownerRole: c.ownerRole, dueRule: c.dueRule as any, requiredProof: c.requiredProof })), skipDuplicates: true });
  }
  const rows = await peoplePrisma.complianceRule.findMany({ where: { orgId, ...(opts.all ? {} : { active: true }) }, orderBy: [{ ruleId: 'asc' }, { version: 'desc' }] });
  const names = await namesOf(rows.map((r) => r.checkedByUserId));
  return rows.map((r) => shapeRule(r, names));
}

async function namesOf(ids: Array<string | null>) {
  const set = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const users = set.length ? await platformPrisma.user.findMany({ where: { id: { in: set } }, select: { id: true, fullName: true, email: true } }) : [];
  return new Map(users.map((u) => [u.id, u.fullName || u.email]));
}

/** Edit a rule: a new version, the old one closed the day before and kept; a rule the company writes itself gets its own id. */
export async function saveRuleVersion(who: { accountId: string; orgId: string; userId: string | null }, input: { ruleId?: string; title?: string; jurisdiction?: string; establishmentKinds?: unknown; employeeCategories?: unknown; legalSource?: string; notificationRef?: string | null; effectiveFrom?: string; obligation?: string; threshold?: unknown; ownerRole?: string; dueRule?: unknown; requiredProof?: unknown }) {
  const ruleId = String(input.ruleId || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 60);
  if (!ruleId) throw new ComplianceError('A rule needs an id, e.g. IN-KA-OWN-01.');
  const latest = await peoplePrisma.complianceRule.findFirst({ where: { orgId: who.orgId, ruleId }, orderBy: { version: 'desc' } });
  const title = String(input.title ?? latest?.title ?? '').trim().slice(0, 160);
  const obligation = String(input.obligation ?? latest?.obligation ?? '').trim().slice(0, 4000);
  const legalSource = String(input.legalSource ?? latest?.legalSource ?? '').trim().slice(0, 400);
  if (!title || !obligation || !legalSource) throw new ComplianceError('A rule needs a title, what it obliges, and its legal source.');
  const effectiveFrom = String(input.effectiveFrom ?? latest?.effectiveFrom ?? todayIst()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new ComplianceError('Effective from is YYYY-MM-DD.');
  const dueRule = (input.dueRule ?? latest?.dueRule ?? { kind: 'STANDING' }) as DueRule;
  if (!['MONTHLY', 'ANNUAL', 'HALF_YEARLY', 'ONCE', 'STANDING'].includes((dueRule as any)?.kind)) throw new ComplianceError('The due rule is monthly, annual, half-yearly, once after an event, or standing.');
  const list = (v: unknown, fallback: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : (fallback as string[]) || []);
  const row = await peoplePrisma.$transaction(async (tx) => {
    if (latest?.active) await tx.complianceRule.update({ where: { id: latest.id }, data: { active: false, effectiveTo: latest.effectiveTo || addDays(effectiveFrom, -1) } });
    return tx.complianceRule.create({ data: {
      accountId: who.accountId, orgId: who.orgId, ruleId, version: (latest?.version ?? 0) + 1, title, jurisdiction: String(input.jurisdiction ?? latest?.jurisdiction ?? 'IN').toUpperCase(),
      establishmentKinds: list(input.establishmentKinds, latest?.establishmentKinds), employeeCategories: list(input.employeeCategories, latest?.employeeCategories ?? ['ALL']), legalSource, notificationRef: input.notificationRef !== undefined ? String(input.notificationRef || '').trim() || null : latest?.notificationRef ?? null,
      effectiveFrom, supersedesVersion: latest?.version ?? null, obligation, threshold: (input.threshold !== undefined ? input.threshold : latest?.threshold ?? undefined) as any, ownerRole: String(input.ownerRole ?? latest?.ownerRole ?? 'HR').toUpperCase(), dueRule: dueRule as any, requiredProof: list(input.requiredProof, latest?.requiredProof), createdByUserId: who.userId,
    } });
  });
  return shapeRule(row, new Map());
}

/** A named person confirms the rule with their adviser (COMP-05). */
export async function checkRule(who: { orgId: string; userId: string | null }, ruleId: string, version: number) {
  const row = await peoplePrisma.complianceRule.findFirst({ where: { orgId: who.orgId, ruleId, version } });
  if (!row) throw new ComplianceError('No such rule version.', 404);
  if (!who.userId) throw new ComplianceError('Sign in to check a rule.', 401);
  const updated = await peoplePrisma.complianceRule.update({ where: { id: row.id }, data: { reviewStatus: 'CHECKED', checkedByUserId: who.userId, checkedAt: new Date() } });
  return shapeRule(updated, await namesOf([who.userId]));
}

/** Does this rule reach this establishment, given the company's headcount? */
function reaches(rule: { jurisdiction: string; establishmentKinds: string[]; threshold: { minHeadcount?: number } | null }, est: { kind: string; state: string | null } | null, headcount: number) {
  if (rule.threshold?.minHeadcount && headcount < rule.threshold.minHeadcount) return false;
  if (rule.jurisdiction === 'IN') return est ? !rule.establishmentKinds.length || rule.establishmentKinds.includes(est.kind) : true;
  if (!est) return false;
  const code = stateCode(est.state);
  if (rule.jurisdiction === 'IN-STATE') return Boolean(code) && (!rule.establishmentKinds.length || rule.establishmentKinds.includes(est.kind));
  return rule.jurisdiction === `IN-${code}` && (!rule.establishmentKinds.length || rule.establishmentKinds.includes(est.kind));
}

/** The periods a due rule has inside the window, each with its due day. */
function periodsOf(rule: DueRule, est: { createdAt: Date } | null, from: string, to: string, today: string): Array<{ period: string; dueOn: string }> {
  const out: Array<{ period: string; dueOn: string }> = [];
  const fy = Number(from.slice(0, 4));
  const ty = Number(to.slice(0, 4));
  /* A standing duty is due now and stays due until it is done. */
  if (rule.kind === 'STANDING') return [{ period: 'STANDING', dueOn: today }];
  if (rule.kind === 'ONCE') {
    const start = est ? new Date(est.createdAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) : from;
    return [{ period: 'ONCE', dueOn: addDays(start, rule.days) }];
  }
  for (let y = fy - 1; y <= ty; y += 1) {
    if (rule.kind === 'ANNUAL') out.push({ period: String(y - 1), dueOn: ymd(y, rule.month, rule.day) });
    if (rule.kind === 'HALF_YEARLY') for (const m of rule.months) out.push({ period: `${m === rule.months[0] ? y : y}-H${m === rule.months[0] ? 1 : 2}`, dueOn: ymd(m < rule.months[0] ? y + 1 : y, m, rule.day) });
    if (rule.kind === 'MONTHLY') for (let m = 1; m <= 12; m += 1) { const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1]; out.push({ period: `${y}-${String(m).padStart(2, '0')}`, dueOn: ymd(ny, nm, rule.day) }); }
  }
  return out.filter((p) => p.dueOn >= from && p.dueOn <= to);
}

/**
 * Work out the obligations for the window (two months back, six ahead),
 * adding what is missing and never touching one somebody has acted on.
 * Then move statuses along: UPCOMING → DUE within 14 days → OVERDUE after.
 */
export async function buildObligations(accountId: string, orgId: string, now = new Date()) {
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const from = addDays(today, -62);
  const to = addDays(today, 183);
  const [rules, ests, headcount] = await Promise.all([
    rulesOf(accountId, orgId),
    peoplePrisma.establishment.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true, kind: true, state: true, createdAt: true } }),
    peoplePrisma.employee.count({ where: { orgId, status: { not: 'LEFT' } } }),
  ]);
  const rows: Array<{ ruleId: string; ruleVersion: number; establishmentId: string | null; period: string; title: string; dueOn: string }> = [];
  for (const r of rules) {
    const targets: Array<{ id: string; name: string; kind: string; state: string | null; createdAt: Date } | null> = r.jurisdiction === 'IN' && !r.establishmentKinds.length ? [null] : ests;
    for (const est of targets) {
      if (!reaches(r, est ? { kind: est.kind, state: est.state } : null, headcount)) continue;
      for (const p of periodsOf(r.dueRule, est, from, to, today)) {
        rows.push({ ruleId: r.ruleId, ruleVersion: r.version, establishmentId: est?.id ?? null, period: p.period, title: `${r.title}${est ? ` — ${est.name}` : ''}${p.period !== 'STANDING' && p.period !== 'ONCE' ? ` (${p.period})` : ''}`, dueOn: p.dueOn });
      }
    }
  }
  /* A company-wide row has no establishment, and Postgres treats two nulls as different keys; so what exists is read first and skipped here. */
  const existing = new Set((await peoplePrisma.obligation.findMany({ where: { orgId }, select: { ruleId: true, establishmentId: true, period: true } })).map((o) => `${o.ruleId}|${o.establishmentId || ''}|${o.period}`));
  const fresh = rows.filter((o) => !existing.has(`${o.ruleId}|${o.establishmentId || ''}|${o.period}`));
  if (fresh.length) await peoplePrisma.obligation.createMany({ data: fresh.map((o) => ({ accountId, orgId, ...o, proofDocIds: [] })), skipDuplicates: true });
  /* Statuses move with the calendar; done and checked ones are left alone. */
  const soon = addDays(today, 14);
  await peoplePrisma.obligation.updateMany({ where: { orgId, status: { in: ['UPCOMING', 'DUE'] }, dueOn: { lt: today } }, data: { status: 'OVERDUE' } });
  await peoplePrisma.obligation.updateMany({ where: { orgId, status: 'UPCOMING', dueOn: { gte: today, lte: soon } }, data: { status: 'DUE' } });
  return rows.length;
}

export async function obligationsOf(accountId: string, orgId: string, where: { status?: string; establishmentId?: string } = {}) {
  await buildObligations(accountId, orgId);
  const rows = await peoplePrisma.obligation.findMany({ where: { orgId, ...(where.status ? { status: where.status } : {}), ...(where.establishmentId ? { establishmentId: where.establishmentId } : {}) }, orderBy: [{ dueOn: 'asc' }, { title: 'asc' }] });
  const ests = await peoplePrisma.establishment.findMany({ where: { orgId }, select: { id: true, name: true, state: true } });
  const estOf = new Map(ests.map((e) => [e.id, e]));
  const names = await namesOf(rows.flatMap((r) => [r.ownerUserId, r.doneByUserId, r.checkedByUserId]));
  const rules = await peoplePrisma.complianceRule.findMany({ where: { orgId, ruleId: { in: [...new Set(rows.map((r) => r.ruleId))] } }, select: { ruleId: true, version: true, reviewStatus: true, legalSource: true, requiredProof: true, ownerRole: true } });
  const ruleOf = new Map(rules.map((r) => [`${r.ruleId}@${r.version}`, r]));
  return rows.map((o) => {
    const rule = ruleOf.get(`${o.ruleId}@${o.ruleVersion}`);
    return {
      id: o.id, ruleId: o.ruleId, ruleVersion: o.ruleVersion, establishmentId: o.establishmentId, establishment: o.establishmentId ? estOf.get(o.establishmentId)?.name || null : null, state: o.establishmentId ? estOf.get(o.establishmentId)?.state || null : null,
      period: o.period, title: o.title, dueOn: o.dueOn, status: o.status, ownerUserId: o.ownerUserId, owner: o.ownerUserId ? names.get(o.ownerUserId) || '' : rule?.ownerRole || 'HR',
      proofDocIds: (o.proofDocIds as string[]) || [], requiredProof: (rule?.requiredProof as string[]) || [], legalSource: rule?.legalSource || '', ruleChecked: rule?.reviewStatus === 'CHECKED', note: o.note,
      doneAt: o.doneAt, doneBy: o.doneByUserId ? names.get(o.doneByUserId) || '' : '', checkedAt: o.checkedAt, checkedBy: o.checkedByUserId ? names.get(o.checkedByUserId) || '' : '',
    };
  });
}

export async function updateObligation(who: { orgId: string; userId: string | null }, id: string, input: { status?: string; ownerUserId?: string | null; note?: string | null; proofDocIds?: unknown }) {
  const row = await peoplePrisma.obligation.findFirst({ where: { id, orgId: who.orgId } });
  if (!row) throw new ComplianceError('No such obligation.', 404);
  const data: Record<string, unknown> = {};
  if (input.status !== undefined) {
    const st = String(input.status).toUpperCase();
    if (!['UPCOMING', 'DUE', 'OVERDUE', 'DONE', 'CHECKED'].includes(st)) throw new ComplianceError('Status is upcoming, due, overdue, done or checked.');
    data.status = st;
    if (st === 'DONE') { data.doneAt = new Date(); data.doneByUserId = who.userId; }
    if (st === 'CHECKED') { data.checkedAt = new Date(); data.checkedByUserId = who.userId; if (!row.doneAt) { data.doneAt = new Date(); data.doneByUserId = who.userId; } }
  }
  if (input.ownerUserId !== undefined) {
    const uid = String(input.ownerUserId || '').trim() || null;
    if (uid && !(await platformPrisma.userOrgMembership.findFirst({ where: { accountId: row.accountId, orgId: who.orgId, userId: uid }, select: { userId: true } }))) throw new ComplianceError('That owner is not a user here.');
    data.ownerUserId = uid;
    if (uid && uid !== who.userId) await notifyUsers(row.accountId, who.orgId, [uid], { kind: 'people.obligation', title: `Yours: ${row.title}`, body: `Due ${row.dueOn}.`, link: { app: 'people', screen: 'complianceCalendar' } as any }).catch(() => undefined);
  }
  if (input.note !== undefined) data.note = String(input.note || '').trim().slice(0, 2000) || null;
  if (input.proofDocIds !== undefined) {
    const ids = Array.isArray(input.proofDocIds) ? input.proofDocIds.map((x) => String(x)).filter(Boolean).slice(0, 20) : [];
    const found = ids.length ? await peoplePrisma.employeeDocument.count({ where: { orgId: who.orgId, id: { in: ids } } }) : 0;
    if (found !== ids.length) throw new ComplianceError('Every proof must be a document on file.');
    data.proofDocIds = ids;
  }
  return peoplePrisma.obligation.update({ where: { id: row.id }, data });
}

/** What is due inside fourteen days is announced once, to the owner or to HR, with the event other apps read (`people.obligation.due.v1`). */
export async function runObligationDues(now = new Date()) {
  const orgs = await outsideTenant('job: obligation dues', () => peoplePrisma.establishment.findMany({ where: { isActive: true }, select: { orgId: true, accountId: true }, distinct: ['orgId'] }));
  let told = 0;
  for (const { orgId, accountId } of orgs) {
    told += await runInTenant(orgId, async () => {
      await buildObligations(accountId, orgId, now);
      const due = await peoplePrisma.obligation.findMany({ where: { orgId, status: { in: ['DUE', 'OVERDUE'] }, dueToldAt: null } });
      let n = 0;
      for (const o of due) {
        await peoplePrisma.$transaction(async (tx) => {
          await tx.obligation.update({ where: { id: o.id }, data: { dueToldAt: now } });
          await writeEvent(tx, { accountId, orgId, correlationId: `obligation_${o.id}` }, 'people.obligation.due.v1', { obligationId: o.id, ruleId: o.ruleId, ruleVersion: o.ruleVersion, establishmentId: o.establishmentId, period: o.period, title: o.title, dueOn: o.dueOn, status: o.status });
        });
        const notice = { kind: 'people.obligation', title: `${o.status === 'OVERDUE' ? 'Overdue' : 'Due soon'}: ${o.title}`, body: `Due ${o.dueOn}.`, link: { app: 'people', screen: 'complianceCalendar' } as any };
        if (o.ownerUserId) await notifyUsers(accountId, orgId, [o.ownerUserId], notice).catch(() => undefined);
        else await notifyPermission(accountId, orgId, 'PEOPLE::Employees::EDIT', notice).catch(() => undefined);
        n += 1;
      }
      return n;
    });
  }
  return told;
}

export function startObligationDues({ intervalMs = 6 * 3_600_000, startupDelayMs = 240_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => exclusive('people.obligation-dues', leaseFor(intervalMs), () => runObligationDues()).catch((e) => console.error('[obligation-dues] failed:', e instanceof Error ? e.message : e));
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}

/** The employee register for an establishment (COMP-06): the fields the codes name, from the record. */
export async function employeeRegister(orgId: string, establishmentId: string | null) {
  const rows = await peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, ...(establishmentId ? { establishmentId } : {}) }, orderBy: [{ code: 'asc' }, { name: 'asc' }] });
  const est = establishmentId ? await peoplePrisma.establishment.findFirst({ where: { id: establishmentId, orgId }, select: { name: true, state: true, address: true } }) : null;
  const columns = ['Sl. no.', 'Employee ID', 'Name', 'Father’s / guardian’s name', 'Date of birth', 'Gender', 'Designation', 'Department', 'Date of joining', 'Employee type', 'Phone', 'Address', 'UAN / ESIC: in Payroll'];
  const data = rows.map((e, i) => [String(i + 1), e.code || '', e.name, e.guardianName || '', e.dateOfBirth || '', e.gender || '', e.designation || '', e.department || '', e.dateOfJoining || '', '', e.phone || '', [e.addressLine, e.city, e.state, e.pincode].filter(Boolean).join(', '), 'see Payroll']);
  const types = await peoplePrisma.employeeType.findMany({ where: { orgId }, select: { id: true, name: true } });
  const typeOf = new Map(types.map((t) => [t.id, t.name]));
  rows.forEach((e, i) => { data[i][9] = e.employeeTypeId ? typeOf.get(e.employeeTypeId) || '' : ''; });
  return { establishment: est, columns, rows: data, generatedOn: todayIst() };
}

/** The leave register view (COMP-06): approved leave in a range, by person — the leave engine's records, read here. */
export async function leaveRegister(orgId: string, establishmentId: string | null, from: string, to: string) {
  const people = await peoplePrisma.employee.findMany({ where: { orgId, ...(establishmentId ? { establishmentId } : {}) }, select: { id: true, name: true, code: true } });
  const ids = people.map((p) => p.id);
  const leaves = ids.length ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: to }, toDate: { gte: from } }, orderBy: [{ fromDate: 'asc' }] }) : [];
  const types = await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true } });
  const typeOf = new Map(types.map((t) => [t.id, t.name]));
  const of = new Map(people.map((p) => [p.id, p]));
  return { from, to, columns: ['Employee ID', 'Name', 'Leave type', 'From', 'To', 'Days', 'Approved on'], rows: leaves.map((l) => [of.get(l.employeeId)?.code || '', of.get(l.employeeId)?.name || '', typeOf.get(l.leaveTypeId) || '', l.fromDate, l.toDate, String(l.days), l.reviewedAt ? new Date(l.reviewedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) : '']) };
}
