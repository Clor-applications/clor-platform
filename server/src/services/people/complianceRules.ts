import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { notifyPermission, notifyUsers } from '../notifications.js';
import { writeEvent } from './outbox.js';
import { registerJob } from '../jobRegistry.js';
import { verifiedMime } from '../fileType.js';
import { applicability, dueDates } from './compliance.js';
import { addDays, istDate, todayIst } from '../../utils/istDate.js';

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
  checkedBy: r.checkedByUserId ? names.get(r.checkedByUserId) || '' : '', checkedAt: r.checkedAt, checkedLine: r.reviewStatus === 'CHECKED' && r.checkedAt ? `Last checked by ${names.get(r.checkedByUserId || '') || 'someone'} on ${istDate(r.checkedAt)}` : 'Check with your adviser', createdAt: r.createdAt,
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

/** Where a rule may reach: all of India, every state, or a state the company has a work site in. */
async function jurisdictionsOf(orgId: string) {
  const ests = await peoplePrisma.establishment.findMany({ where: { orgId, isActive: true }, select: { state: true } });
  return new Set(['IN', 'IN-STATE', ...ests.map((e) => stateCode(e.state)).filter(Boolean).map((c) => `IN-${c}`)]);
}

function checkDueRule(rule: any): DueRule {
  const kind = rule?.kind;
  const int = (v: unknown, lo: number, hi: number) => Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi;
  if (kind === 'STANDING') return { kind };
  if (kind === 'MONTHLY' && int(rule.day, 1, 31)) return { kind, day: Number(rule.day) };
  if (kind === 'ANNUAL' && int(rule.month, 1, 12) && int(rule.day, 1, 31)) return { kind, month: Number(rule.month), day: Number(rule.day) };
  if (kind === 'HALF_YEARLY' && Array.isArray(rule.months) && rule.months.length === 2 && rule.months.every((m: unknown) => int(m, 1, 12)) && int(rule.day, 1, 31)) return { kind, months: [Number(rule.months[0]), Number(rule.months[1])], day: Number(rule.day) };
  if (kind === 'ONCE' && int(rule.days, 1, 365)) return { kind, days: Number(rule.days) };
  throw new ComplianceError('The due rule is monthly (a day), yearly (a day and month), half-yearly (two months and a day), once some days after a site opens, or standing.');
}

/**
 * Edit a rule: a new version, the old one closed the day before and kept; a
 * rule the company writes itself gets its own id. A new version starts
 * unchecked, so a named person confirms it again. Two saves of the same rule
 * at once are put one after the other (an advisory lock), so each gets its
 * own version number.
 */
export async function saveRuleVersion(who: { accountId: string; orgId: string; userId: string | null }, input: { ruleId?: string; title?: string; jurisdiction?: string; establishmentKinds?: unknown; employeeCategories?: unknown; legalSource?: string; notificationRef?: string | null; effectiveFrom?: string; obligation?: string; threshold?: unknown; ownerRole?: string; dueRule?: unknown; requiredProof?: unknown }) {
  let ruleId = String(input.ruleId || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 60);
  const allowed = await jurisdictionsOf(who.orgId);
  const list = (v: unknown, fallback: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : (fallback as string[]) || []);
  const threshold = (v: unknown, fallback: unknown) => {
    if (v === undefined) return fallback ?? undefined;
    const n = Number((v as any)?.minHeadcount);
    if (v === null || !(v as any)?.minHeadcount) return null;
    if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new ComplianceError('From how many people: a whole number.');
    return { minHeadcount: n };
  };
  return peoplePrisma.$transaction(async (tx) => {
    if (!ruleId) {
      const j = String(input.jurisdiction || 'IN').trim().toUpperCase();
      ruleId = `${j === 'IN-STATE' ? 'IN' : j}-OWN-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`compliance-rule:${who.orgId}:${ruleId}`}))`;
    const latest = await tx.complianceRule.findFirst({ where: { orgId: who.orgId, ruleId }, orderBy: { version: 'desc' } });
    const title = String(input.title ?? latest?.title ?? '').trim().slice(0, 160);
    const obligation = String(input.obligation ?? latest?.obligation ?? '').trim().slice(0, 4000);
    const legalSource = String(input.legalSource ?? latest?.legalSource ?? '').trim().slice(0, 400);
    if (!title || !obligation || !legalSource) throw new ComplianceError('A rule needs a title, what it obliges, and its legal source.');
    const effectiveFrom = String(input.effectiveFrom ?? todayIst()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new ComplianceError('Effective from is YYYY-MM-DD.');
    /* A version replaces the one before from the day it starts; the old one closes the day before, so the new one starts strictly later. */
    if (latest && effectiveFrom <= latest.effectiveFrom) throw new ComplianceError(`The new version has to start after ${latest.effectiveFrom}, when version ${latest.version} did.`);
    const jurisdiction = String(input.jurisdiction ?? latest?.jurisdiction ?? 'IN').trim().toUpperCase();
    /* A company writes rules for India, every state, or a state it works in; a rule already in the library keeps where it reaches. */
    if (jurisdiction !== latest?.jurisdiction && !allowed.has(jurisdiction)) throw new ComplianceError('A rule reaches all of India, every state, or a state where you have a work site.');
    const dueRule = checkDueRule(input.dueRule ?? latest?.dueRule ?? { kind: 'STANDING' });
    if (latest?.active) await tx.complianceRule.update({ where: { id: latest.id }, data: { active: false, effectiveTo: latest.effectiveTo || addDays(effectiveFrom, -1) } });
    const row = await tx.complianceRule.create({ data: {
      accountId: who.accountId, orgId: who.orgId, ruleId, version: (latest?.version ?? 0) + 1, title, jurisdiction,
      establishmentKinds: list(input.establishmentKinds, latest?.establishmentKinds).map((k) => k.toUpperCase()).filter((k) => ['SHOP', 'FACTORY', 'OFFICE', 'SITE', 'WAREHOUSE'].includes(k)), employeeCategories: list(input.employeeCategories, latest?.employeeCategories ?? ['ALL']), legalSource, notificationRef: input.notificationRef !== undefined ? String(input.notificationRef || '').trim().slice(0, 200) || null : latest?.notificationRef ?? null,
      effectiveFrom, supersedesVersion: latest?.version ?? null, obligation, threshold: threshold(input.threshold, latest?.threshold) as any, ownerRole: String(input.ownerRole ?? latest?.ownerRole ?? 'HR').toUpperCase().slice(0, 20), dueRule: dueRule as any, requiredProof: list(input.requiredProof, latest?.requiredProof), createdByUserId: who.userId,
    } });
    return shapeRule(row, new Map());
  });
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
    const start = est ? istDate(est.createdAt) : from;
    return [{ period: 'ONCE', dueOn: addDays(start, rule.days) }];
  }
  for (let y = fy - 1; y <= ty; y += 1) {
    if (rule.kind === 'ANNUAL') out.push({ period: String(y - 1), dueOn: ymd(y, rule.month, rule.day) });
    if (rule.kind === 'HALF_YEARLY') for (const m of rule.months) out.push({ period: `${m === rule.months[0] ? y : y}-H${m === rule.months[0] ? 1 : 2}`, dueOn: ymd(m < rule.months[0] ? y + 1 : y, m, rule.day) });
    if (rule.kind === 'MONTHLY') for (let m = 1; m <= 12; m += 1) { const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1]; out.push({ period: `${y}-${String(m).padStart(2, '0')}`, dueOn: ymd(ny, nm, rule.day) }); }
  }
  return out.filter((p) => p.dueOn >= from && p.dueOn <= to);
}

/** Work-site registrations (People audit gap 16): the kinds a small Indian employer holds, as the work site form offers them. */
export const REGISTRATION_TYPES: Record<string, string> = {
  SE_REG: 'Shops & Establishments registration', PF: 'PF code (EPFO)', ESI: 'ESI code (ESIC)', PT: 'Professional Tax registration', LWF: 'Labour Welfare Fund registration',
  CLRA: 'Contract labour licence', FACTORY: 'Factory licence', TRADE: 'Trade licence', FIRE: 'Fire safety certificate', OTHER: 'Registration',
};
export const registrationLabel = (type: string) => REGISTRATION_TYPES[String(type || '').toUpperCase()] || String(type || 'Registration');
type Registration = { type: string; number: string; validTill: string | null };
export const registrationsOf = (v: unknown): Registration[] => (Array.isArray(v) ? v.filter((r) => r && typeof r === 'object' && (r as any).type).map((r: any) => ({ type: String(r.type).toUpperCase(), number: String(r.number || '').trim(), validTill: /^\d{4}-\d{2}-\d{2}$/.test(String(r.validTill || '')) ? String(r.validTill) : null })) : []);

/** The statutory deadlines Compliance makes from Payroll's settings (what the old calendar listed): where each comes from and the proof it needs. */
const STATUTORY: Record<string, { legalSource: string; requiredProof: string[]; owner: string }> = {
  PF_ECR: { legalSource: 'EPF Scheme 1952, para 38: ECR and payment by the 15th', requiredProof: ['PAYMENT_CHALLAN'], owner: 'PAYROLL' },
  ESIC: { legalSource: 'ESI (Central) Regulations, reg. 31: contribution by the 15th', requiredProof: ['PAYMENT_CHALLAN'], owner: 'PAYROLL' },
  TDS_DEPOSIT: { legalSource: 'Income-tax Rules, rule 30: TDS deposited by the 7th (30 April for March)', requiredProof: ['PAYMENT_CHALLAN'], owner: 'PAYROLL' },
  TDS_24Q: { legalSource: 'Income-tax Rules, rule 31A: quarterly statement in Form 24Q', requiredProof: ['FILING_RECEIPT'], owner: 'PAYROLL' },
  FORM16: { legalSource: 'Income-tax Rules, rule 31: Form 16 by 15 June', requiredProof: ['ISSUE_RECORD'], owner: 'PAYROLL' },
  BONUS: { legalSource: 'Payment of Bonus Act 1965, s.19: within eight months of the year closing', requiredProof: ['PAYMENT_RECORD'], owner: 'PAYROLL' },
  POSH_REPORT: { legalSource: 'POSH Act s.21: the Internal Committee’s annual report', requiredProof: ['FILING_RECEIPT'], owner: 'HR' },
};
const statutoryOf = (code: string) => STATUTORY[code] || (code.startsWith('PT_') ? { legalSource: 'State Professional Tax Act: monthly payment and return', requiredProof: ['PAYMENT_CHALLAN'], owner: 'PAYROLL' } : null);
const DONE_STATES = ['DONE', 'CHECKED', 'NOT_APPLICABLE'];

/**
 * Work out the obligations for the window (two months back, six ahead),
 * adding what is missing and never touching one somebody has acted on. Four
 * sources, one list: the rule library; the statutory deadlines Payroll's
 * settings bring (PF, ESIC, TDS, PT… — what the old calendar showed); each
 * work site's registrations that run out; and the company's own deadlines,
 * added by hand. Then move statuses along: UPCOMING → DUE within 14 days (30
 * for a registration to renew) → OVERDUE after.
 */
export async function buildObligations(accountId: string, orgId: string, now = new Date()) {
  const today = todayIst(now);
  const from = addDays(today, -62);
  const to = addDays(today, 183);
  const [rules, ests, headcount, applies, org] = await Promise.all([
    rulesOf(accountId, orgId),
    peoplePrisma.establishment.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true, kind: true, state: true, createdAt: true, registrations: true } }),
    peoplePrisma.employee.count({ where: { orgId, status: { not: 'LEFT' } } }),
    applicability(accountId, orgId),
    platformPrisma.org.findUnique({ where: { id: orgId }, select: { createdAt: true } }),
  ]);
  const rows: Array<{ ruleId: string; ruleVersion: number; establishmentId: string | null; period: string; title: string; dueOn: string; source: string }> = [];
  for (const r of rules) {
    const targets: Array<{ id: string; name: string; kind: string; state: string | null; createdAt: Date } | null> = r.jurisdiction === 'IN' && !r.establishmentKinds.length ? [null] : ests;
    for (const est of targets) {
      if (!reaches(r, est ? { kind: est.kind, state: est.state } : null, headcount)) continue;
      for (const p of periodsOf(r.dueRule, est, from, to, today)) {
        rows.push({ ruleId: r.ruleId, ruleVersion: r.version, establishmentId: est?.id ?? null, period: p.period, title: `${r.title}${est ? ` — ${est.name}` : ''}${p.period !== 'STANDING' && p.period !== 'ONCE' ? ` (${p.period})` : ''}`, dueOn: p.dueOn, source: 'RULE' });
      }
    }
  }
  /* Statutory deadlines from Payroll's settings; nothing from before the company was on CLOR. The POSH report comes from the library instead. */
  const joined = org ? istDate(org.createdAt) : from;
  for (const d of dueDates(applies, joined > from ? joined : from, to)) {
    if (d.code === 'POSH_REPORT') continue;
    rows.push({ ruleId: d.code, ruleVersion: 0, establishmentId: null, period: d.period, title: d.title, dueOn: d.dueDate, source: 'STATUTORY' });
  }
  /* A registration that runs out is a renewal to do, due the day it lapses; a lapsed one stays until it is renewed. */
  const current = new Set<string>();
  for (const est of ests) {
    for (const reg of registrationsOf(est.registrations)) {
      if (!reg.validTill || reg.validTill > to) continue;
      const ruleId = `REG-${reg.type}`;
      const period = `${reg.number || 'no number'} until ${reg.validTill}`.slice(0, 120);
      current.add(`${ruleId}|${est.id}|${period}`);
      rows.push({ ruleId, ruleVersion: 0, establishmentId: est.id, period, title: `Renew ${registrationLabel(reg.type)} — ${est.name}${reg.number ? ` (${reg.number})` : ''}`, dueOn: reg.validTill, source: 'REGISTRATION' });
    }
  }
  /*
   * The writes run one company at a time (an advisory lock): a company-wide row has
   * no establishment, and Postgres treats two nulls as different keys, so two reads
   * at once (Home and Compliance opening together) would otherwise both add it.
   */
  const note = (was: string | null, line: string) => (was && was.includes(line) ? was : [was, line].filter(Boolean).join('\n').slice(0, 2000));
  await peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`obligations:${orgId}`}))`;
    const existing = new Set((await tx.obligation.findMany({ where: { orgId }, select: { ruleId: true, establishmentId: true, period: true } })).map((o) => `${o.ruleId}|${o.establishmentId || ''}|${o.period}`));
    const fresh = rows.filter((o) => !existing.has(`${o.ruleId}|${o.establishmentId || ''}|${o.period}`));
    if (fresh.length) await tx.obligation.createMany({ data: fresh.map((o) => ({ accountId, orgId, ...o, proofDocIds: [] })), skipDuplicates: true });
    /* A renewal is settled only by a newer registration of the same kind on the same site; one removed from the site stays open for someone to close. */
    const latestTill = new Map<string, string>();
    for (const est of ests) for (const r of registrationsOf(est.registrations)) if (r.validTill && (latestTill.get(`${est.id}|${r.type}`) || '') < r.validTill) latestTill.set(`${est.id}|${r.type}`, r.validTill);
    const open = await tx.obligation.findMany({ where: { orgId, source: 'REGISTRATION', status: { notIn: DONE_STATES } }, select: { id: true, ruleId: true, establishmentId: true, period: true, dueOn: true, note: true } });
    for (const o of open) {
      if (current.has(`${o.ruleId}|${o.establishmentId}|${o.period}`)) continue;
      const newer = latestTill.get(`${o.establishmentId}|${o.ruleId.replace(/^REG-/, '')}`);
      if (!newer || newer <= o.dueOn) continue;
      await tx.obligation.update({ where: { id: o.id }, data: { status: 'DONE', doneAt: now, note: note(o.note, `Renewed: the work site has it valid till ${newer}.`) } });
    }
    /* A work site with its Shops & Establishments number on file has registered. */
    for (const est of ests) {
      const se = registrationsOf(est.registrations).find((r) => r.type === 'SE_REG' && r.number);
      if (!se) continue;
      const due = await tx.obligation.findMany({ where: { orgId, establishmentId: est.id, ruleId: { in: ['IN-SE-REG', 'IN-TS-SE-REG'] }, status: { notIn: DONE_STATES } }, select: { id: true, note: true, reference: true } });
      for (const o of due) await tx.obligation.update({ where: { id: o.id }, data: { status: 'DONE', doneAt: now, reference: o.reference || se.number, note: note(o.note, 'Registration number on the work site.') } });
    }
    /* Statuses move with the calendar; done and checked ones are left alone. */
    await tx.obligation.updateMany({ where: { orgId, status: { in: ['UPCOMING', 'DUE'] }, dueOn: { lt: today } }, data: { status: 'OVERDUE' } });
    await tx.obligation.updateMany({ where: { orgId, status: 'UPCOMING', dueOn: { gte: today, lte: addDays(today, 14) } }, data: { status: 'DUE' } });
    await tx.obligation.updateMany({ where: { orgId, source: 'REGISTRATION', status: 'UPCOMING', dueOn: { gte: today, lte: addDays(today, 30) } }, data: { status: 'DUE' } });
  });
  return rows.length;
}

const STATUSES = ['UPCOMING', 'DUE', 'OVERDUE', 'DONE', 'CHECKED', 'NOT_APPLICABLE'];

export async function obligationsOf(accountId: string, orgId: string, where: { status?: string; establishmentId?: string; id?: string; statutory?: boolean } = {}) {
  await buildObligations(accountId, orgId);
  const statuses = String(where.status || '').toUpperCase().split(',').filter((x) => STATUSES.includes(x));
  const rows = await peoplePrisma.obligation.findMany({ where: { orgId, ...(statuses.length ? { status: { in: statuses } } : {}), ...(where.establishmentId ? { establishmentId: where.establishmentId } : {}), ...(where.id ? { id: where.id } : {}), ...(where.statutory === false ? { source: { not: 'STATUTORY' } } : {}) }, orderBy: [{ dueOn: 'asc' }, { title: 'asc' }] });
  const ests = await peoplePrisma.establishment.findMany({ where: { orgId }, select: { id: true, name: true, state: true } });
  const estOf = new Map(ests.map((e) => [e.id, e]));
  const proofs = rows.length ? await peoplePrisma.obligationProof.findMany({ where: { orgId, obligationId: { in: rows.map((r) => r.id) }, removedAt: null }, select: { id: true, obligationId: true, name: true, mime: true, size: true, uploadedByUserId: true, createdAt: true }, orderBy: { createdAt: 'asc' } }) : [];
  const names = await namesOf([...rows.flatMap((r) => [r.ownerUserId, r.doneByUserId, r.checkedByUserId]), ...proofs.map((p) => p.uploadedByUserId)]);
  const rules = await peoplePrisma.complianceRule.findMany({ where: { orgId, ruleId: { in: [...new Set(rows.map((r) => r.ruleId))] } }, select: { ruleId: true, version: true, reviewStatus: true, legalSource: true, requiredProof: true, ownerRole: true } });
  const ruleOf = new Map(rules.map((r) => [`${r.ruleId}@${r.version}`, r]));
  const day = (d: Date | null) => (d ? istDate(d) : null);
  return rows.map((o) => {
    const rule = ruleOf.get(`${o.ruleId}@${o.ruleVersion}`);
    const statutory = o.source === 'STATUTORY' ? statutoryOf(o.ruleId) : null;
    const legalSource = rule?.legalSource || statutory?.legalSource || (o.source === 'REGISTRATION' ? `${registrationLabel(o.ruleId.replace(/^REG-/, ''))}, as on the work site` : o.source === 'OWN' ? 'Your own deadline' : '');
    return {
      id: o.id, source: o.source, ruleId: o.ruleId, ruleVersion: o.ruleVersion, establishmentId: o.establishmentId, establishment: o.establishmentId ? estOf.get(o.establishmentId)?.name || null : null, state: o.establishmentId ? estOf.get(o.establishmentId)?.state || null : null,
      period: o.period, title: o.title, dueOn: o.dueOn, status: o.status,
      ownerUserId: o.ownerUserId, ownerName: o.ownerName, owner: o.ownerUserId ? names.get(o.ownerUserId) || '' : o.ownerName || (rule?.ownerRole === 'PAYROLL' || statutory?.owner === 'PAYROLL' ? 'Payroll' : 'HR'), ownerSet: Boolean(o.ownerUserId || o.ownerName),
      proofDocIds: (o.proofDocIds as string[]) || [], proofs: proofs.filter((p) => p.obligationId === o.id).map((p) => ({ id: p.id, name: p.name, mime: p.mime, size: p.size, uploadedBy: p.uploadedByUserId ? names.get(p.uploadedByUserId) || '' : '', uploadedAt: p.createdAt })),
      requiredProof: (rule?.requiredProof as string[]) || statutory?.requiredProof || (o.source === 'REGISTRATION' ? ['REGISTRATION_CERTIFICATE'] : []), legalSource,
      /* Only a library rule is "checked with your adviser"; Payroll's dates, a site's own registration and your own deadline are facts, not readings of the law. */
      ruleChecked: o.source === 'RULE' ? rule?.reviewStatus === 'CHECKED' : true, note: o.note, reference: o.reference,
      doneAt: o.doneAt, doneOn: day(o.doneAt), doneBy: o.doneByUserId ? names.get(o.doneByUserId) || '' : o.doneAt ? 'CLOR' : '', checkedAt: o.checkedAt, checkedOn: day(o.checkedAt), checkedBy: o.checkedByUserId ? names.get(o.checkedByUserId) || '' : '',
      link: o.source === 'STATUTORY' && o.ruleId !== 'POSH_REPORT' ? { app: 'payroll', screen: o.ruleId === 'BONUS' ? 'runs' : 'reports' } : null,
    };
  });
}

/** Someone who may own an obligation: a user of this company. */
async function memberOf(accountId: string, orgId: string, userId: string) {
  return Boolean(await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { userId: true } }));
}
const ownerLink = (id: string) => ({ app: 'people', screen: 'compliance', params: { id } });

/**
 * Owner (a user, or a name outside CLOR such as the company's CA), note,
 * reference, status; for the company's own deadline, its title and date too.
 * Done records who and when; Checked — a second look at the proof — is only
 * for something done, and records who and when as well. Opening it again
 * clears both.
 */
export async function updateObligation(who: { orgId: string; userId: string | null }, id: string, input: { status?: string; ownerUserId?: string | null; ownerName?: string | null; note?: string | null; reference?: string | null; proofDocIds?: unknown; title?: string; dueOn?: string }) {
  const row = await peoplePrisma.obligation.findFirst({ where: { id, orgId: who.orgId } });
  if (!row) throw new ComplianceError('No such obligation.', 404);
  const data: Record<string, unknown> = {};
  if (input.status !== undefined) {
    const st = String(input.status).toUpperCase();
    if (!['OPEN', ...STATUSES].includes(st)) throw new ComplianceError('Status is open, done, checked or does not apply.');
    const keep = Boolean(row.doneAt) && row.status !== 'NOT_APPLICABLE';
    if (st === 'DONE') Object.assign(data, { status: st, doneAt: keep ? row.doneAt : new Date(), doneByUserId: keep ? row.doneByUserId : who.userId, checkedAt: null, checkedByUserId: null });
    else if (st === 'CHECKED') {
      if (row.status !== 'DONE' && row.status !== 'CHECKED') throw new ComplianceError('Mark it done first; checked is the second look at the proof.', 409);
      Object.assign(data, { status: st, checkedAt: new Date(), checkedByUserId: who.userId });
    } else if (st === 'NOT_APPLICABLE') Object.assign(data, { status: st, doneAt: new Date(), doneByUserId: who.userId, checkedAt: null, checkedByUserId: null });
    /* Open again: the date decides upcoming, due or overdue on the next read. */
    else Object.assign(data, { status: 'UPCOMING', doneAt: null, doneByUserId: null, checkedAt: null, checkedByUserId: null });
  }
  if (input.ownerUserId !== undefined || input.ownerName !== undefined) {
    const uid = String(input.ownerUserId || '').trim() || null;
    const name = uid ? null : String(input.ownerName || '').trim().slice(0, 120) || null;
    if (uid && !(await memberOf(row.accountId, who.orgId, uid))) throw new ComplianceError('That owner is not a user here.');
    data.ownerUserId = uid;
    data.ownerName = name;
    if (uid && uid !== who.userId && uid !== row.ownerUserId) await notifyUsers(row.accountId, who.orgId, [uid], { kind: 'people.obligation', title: `Yours: ${row.title}`, body: `Due ${row.dueOn}.`, link: ownerLink(row.id) }).catch(() => undefined);
  }
  if (input.note !== undefined) data.note = String(input.note || '').trim().slice(0, 2000) || null;
  if (input.reference !== undefined) data.reference = String(input.reference || '').trim().slice(0, 120) || null;
  if (input.title !== undefined || input.dueOn !== undefined) {
    if (row.source !== 'OWN') throw new ComplianceError('Only a deadline you added can be renamed or moved; the others follow their rule.');
    if (input.title !== undefined) {
      const t = String(input.title || '').trim().slice(0, 200);
      if (!t) throw new ComplianceError('Name the deadline.');
      data.title = t;
    }
    if (input.dueOn !== undefined && input.dueOn !== row.dueOn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.dueOn))) throw new ComplianceError('Choose the due date.');
      data.dueOn = String(input.dueOn);
      data.dueToldAt = null;
      if (!DONE_STATES.includes(row.status) && data.status === undefined) data.status = 'UPCOMING';
    }
  }
  if (input.proofDocIds !== undefined) {
    const ids = Array.isArray(input.proofDocIds) ? input.proofDocIds.map((x) => String(x)).filter(Boolean).slice(0, 20) : [];
    const found = ids.length ? await peoplePrisma.employeeDocument.count({ where: { orgId: who.orgId, id: { in: ids } } }) : 0;
    if (found !== ids.length) throw new ComplianceError('Every proof must be a document on file.');
    data.proofDocIds = ids;
  }
  return peoplePrisma.obligation.update({ where: { id: row.id }, data });
}

/** A deadline of the company's own (a licence renewal, an inspection, a filing the library does not know). */
export async function addOwnObligation(who: { accountId: string; orgId: string; userId: string | null }, input: { title?: string; dueOn?: string; establishmentId?: string | null; ownerUserId?: string | null; ownerName?: string | null; note?: string | null }) {
  const title = String(input.title || '').trim().slice(0, 200);
  const dueOn = String(input.dueOn || '');
  if (!title) throw new ComplianceError('Name the deadline.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new ComplianceError('Choose the due date.');
  const establishmentId = String(input.establishmentId || '').trim() || null;
  if (establishmentId && !(await peoplePrisma.establishment.findFirst({ where: { id: establishmentId, orgId: who.orgId }, select: { id: true } }))) throw new ComplianceError('That work site is not in this company.');
  const ownerUserId = String(input.ownerUserId || '').trim() || null;
  if (ownerUserId && !(await memberOf(who.accountId, who.orgId, ownerUserId))) throw new ComplianceError('That owner is not a user here.');
  const row = await peoplePrisma.obligation.create({ data: {
    accountId: who.accountId, orgId: who.orgId, ruleId: 'OWN', ruleVersion: 0, establishmentId, period: `own-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, title, dueOn, source: 'OWN',
    ownerUserId, ownerName: ownerUserId ? null : String(input.ownerName || '').trim().slice(0, 120) || null, note: String(input.note || '').trim().slice(0, 2000) || null, proofDocIds: [], createdByUserId: who.userId,
  } });
  if (ownerUserId && ownerUserId !== who.userId) await notifyUsers(who.accountId, who.orgId, [ownerUserId], { kind: 'people.obligation', title: `Yours: ${title}`, body: `Due ${dueOn}.`, link: ownerLink(row.id) }).catch(() => undefined);
  return row;
}

const MAX_PROOF = 5 * 1024 * 1024;
const PROOF_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const LOCKED = 'It has been checked with this proof; open it again to change the proof.';

/** The obligation, locked for the rest of the transaction: a proof is added or removed against what it is now (checked or not, how many files). */
async function lockedObligation(tx: any, orgId: string, id: string) {
  const rows = await tx.$queryRaw`SELECT "id", "accountId", "status" FROM "Obligation" WHERE "id" = ${id} AND "orgId" = ${orgId} FOR UPDATE`;
  return (rows as Array<{ id: string; accountId: string; status: string }>)[0] || null;
}

/** A proof file (PDF, PNG or JPEG, up to 5 MB), its bytes checked against what it says it is. Not on one already checked. */
export async function addProof(who: { accountId: string; orgId: string; userId: string | null }, id: string, input: { name?: string; mime?: string; dataUrl?: string }) {
  const mime = String(input.mime || '').toLowerCase();
  if (!PROOF_TYPES.includes(mime)) throw new ComplianceError('Proof is a PDF, PNG or JPEG.');
  const bytes = Buffer.from(String(input.dataUrl || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!bytes.length || bytes.length > MAX_PROOF) throw new ComplianceError('Proof is up to 5 MB.');
  if (!verifiedMime(bytes, mime, (t) => PROOF_TYPES.includes(t))) throw new ComplianceError('That file is not what its name says. Upload the PDF or picture itself.');
  const p = await peoplePrisma.$transaction(async (tx) => {
    const row = await lockedObligation(tx, who.orgId, id);
    if (!row) throw new ComplianceError('No such obligation.', 404);
    if (row.status === 'CHECKED') throw new ComplianceError(LOCKED, 409);
    if ((await tx.obligationProof.count({ where: { orgId: who.orgId, obligationId: row.id, removedAt: null } })) >= 10) throw new ComplianceError('Ten files at most; remove one first.');
    return tx.obligationProof.create({ data: { accountId: who.accountId, orgId: who.orgId, obligationId: row.id, name: String(input.name || 'Proof').trim().slice(0, 200) || 'Proof', mime, size: bytes.length, data: bytes, uploadedByUserId: who.userId } });
  });
  return { id: p.id, name: p.name, mime: p.mime, size: p.size };
}

export async function proofFile(orgId: string, id: string, proofId: string, opts: { statutory?: boolean } = {}) {
  /* A statutory deadline's challan carries Payroll's figures: only for those who see statutory details. */
  if (opts.statutory === false && (await peoplePrisma.obligation.count({ where: { id, orgId, source: 'STATUTORY' } }))) throw new ComplianceError('No such file.', 404);
  const p = await peoplePrisma.obligationProof.findFirst({ where: { id: proofId, obligationId: id, orgId, removedAt: null }, select: { name: true, mime: true, data: true } });
  if (!p || !p.data?.length) throw new ComplianceError('No such file.', 404);
  return { name: p.name, mime: p.mime, dataUrl: `data:${p.mime};base64,${Buffer.from(p.data).toString('base64')}` };
}

/** Taken off the obligation, never erased: the row stays with who removed it and when, as the record of what was once shown as proof. */
export async function removeProof(who: { orgId: string; userId: string | null }, id: string, proofId: string) {
  await peoplePrisma.$transaction(async (tx) => {
    const row = await lockedObligation(tx, who.orgId, id);
    if (!row) throw new ComplianceError('No such obligation.', 404);
    if (row.status === 'CHECKED') throw new ComplianceError(LOCKED, 409);
    const n = await tx.obligationProof.updateMany({ where: { id: proofId, obligationId: id, orgId: who.orgId, removedAt: null }, data: { removedAt: new Date(), removedByUserId: who.userId } });
    if (!n.count) throw new ComplianceError('No such file.', 404);
  });
}

/** What is due inside fourteen days is announced once, to the owner or to HR, with the event other apps read (`people.obligation.due.v1`). */
export async function runObligationDues(now = new Date()) {
  const orgs = await outsideTenant('job: obligation dues', async () => {
    const [a, b] = await Promise.all([
      peoplePrisma.establishment.findMany({ where: { isActive: true }, select: { orgId: true, accountId: true }, distinct: ['orgId'] }),
      peoplePrisma.obligation.findMany({ select: { orgId: true, accountId: true }, distinct: ['orgId'] }),
    ]);
    return [...new Map([...a, ...b].map((o) => [o.orgId, o])).values()];
  });
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
        const notice = { kind: 'people.obligation', title: `${o.status === 'OVERDUE' ? 'Overdue' : 'Due soon'}: ${o.title}`, body: `Due ${o.dueOn}.`, link: ownerLink(o.id) };
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
  registerJob('startObligationDues', tick, intervalMs);
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
  return { from, to, columns: ['Employee ID', 'Name', 'Leave type', 'From', 'To', 'Days', 'Approved on'], rows: leaves.map((l) => [of.get(l.employeeId)?.code || '', of.get(l.employeeId)?.name || '', typeOf.get(l.leaveTypeId) || '', l.fromDate, l.toDate, String(l.days), l.reviewedAt ? istDate(l.reviewedAt) : '']) };
}
