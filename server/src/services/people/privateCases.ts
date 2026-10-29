import { randomBytes } from 'node:crypto';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { notifyUsers } from '../notifications.js';
import { decodeDocument } from './documentFiles.js';
import { openBytes, openText, seal } from './caseBox.js';

/**
 * Private cases (docs/people/02-PRD.md PRIV-01..06; compliance matrix
 * C-POSH-01..05). A POSH complaint goes to the Internal Committee, a
 * grievance to the grievance committee; the members named on the committee
 * are the case's members, less anyone the conflict check excludes. Only a
 * member opens a case — a company admin who is not named gets "no such
 * case". The summary and evidence are sealed; every open is logged and the
 * presiding officer sees the log. The legal clock runs from the incident and
 * the receipt: three months to file (extendable by three with a reason), 90
 * days to inquire, 10 to report, 60 to act. The annual report is counts only.
 */

export const CASE_KINDS = ['POSH', 'GRIEVANCE', 'OTHER'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];
const COMMITTEE_OF: Record<CaseKind, string> = { POSH: 'POSH_IC', GRIEVANCE: 'GRIEVANCE', OTHER: 'GRIEVANCE' };
export const COMMITTEE_KINDS = ['POSH_IC', 'GRIEVANCE'] as const;
const ROLES = ['PRESIDING', 'MEMBER', 'EXTERNAL', 'OFFICER'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const addMonths = (d: string, n: number) => {
  const [y, m, day] = d.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
};

export class CaseError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Who = { accountId: string; orgId: string; userId: string | null };
type Member = { userId: string; role: (typeof ROLES)[number]; gender?: string; external?: boolean; termStart?: string; termEnd?: string; name?: string };

// ---------------------------------------------------------------------------
// The committee (PRIV-06)
// ---------------------------------------------------------------------------

/** What the rule asks of a POSH committee, said as warnings (POSH Act s.4; C-POSH-01). */
export function committeeWarnings(kind: string, members: Member[], today = todayIst()): string[] {
  const out: string[] = [];
  if (!members.length) return ['Nobody is named yet: a complaint would have nobody to go to.'];
  if (kind === 'POSH_IC') {
    const presiding = members.filter((m) => m.role === 'PRESIDING');
    if (presiding.length !== 1) out.push('Name exactly one presiding officer.');
    else if (presiding[0].gender !== 'FEMALE') out.push('The presiding officer must be a senior woman employee.');
    const employees = members.filter((m) => !m.external && m.role !== 'EXTERNAL');
    if (employees.filter((m) => m.role === 'MEMBER').length < 2) out.push('Name at least two employee members.');
    if (!members.some((m) => m.external || m.role === 'EXTERNAL')) out.push('Name one external member (from an NGO or someone familiar with sexual harassment issues).');
    const women = members.filter((m) => m.gender === 'FEMALE').length;
    if (women * 2 < members.length) out.push(`At least half the members must be women: ${women} of ${members.length} are.`);
  }
  if (kind === 'GRIEVANCE' && members.length > 10) out.push('A grievance committee has at most ten members.');
  for (const m of members) {
    if (m.termStart && m.termEnd && ISO.test(m.termStart) && ISO.test(m.termEnd)) {
      if (addMonths(m.termStart, 36) < m.termEnd) out.push(`${m.name || 'A member'}: a term is three years at most.`);
      if (m.termEnd < today) out.push(`${m.name || 'A member'}: their term ended on ${m.termEnd}.`);
    }
  }
  return out;
}

export async function committeeOf(orgId: string, kind: string) {
  const row = await peoplePrisma.committeeSetup.findUnique({ where: { orgId_kind: { orgId, kind } } });
  const members = ((row?.members as Member[]) || []);
  const names = await namesOf(members.map((m) => m.userId));
  const shaped = members.map((m) => ({ ...m, name: m.name || names.get(m.userId) || '' }));
  return { kind, members: shaped, warnings: committeeWarnings(kind, shaped), updatedAt: row?.updatedAt ?? null };
}

export async function saveCommittee(who: Who, kind: string, input: { members?: unknown }) {
  if (!COMMITTEE_KINDS.includes(kind as any)) throw new CaseError('The committee is POSH_IC or GRIEVANCE.');
  const raw = Array.isArray(input.members) ? input.members : [];
  const members: Member[] = [];
  for (const m of raw as Array<Record<string, unknown>>) {
    const userId = String(m.userId || '').trim();
    const role = String(m.role || 'MEMBER').toUpperCase() as Member['role'];
    if (!userId) throw new CaseError('Each member must be a user.');
    if (!ROLES.includes(role)) throw new CaseError('A member is presiding, a member, external, or the officer.');
    if (members.some((x) => x.userId === userId)) throw new CaseError('A person can be named once.');
    /* A user of this company, not any CLOR user: members are told when a case comes in. */
    if (!(await platformPrisma.userOrgMembership.findFirst({ where: { accountId: who.accountId, orgId: who.orgId, userId }, select: { userId: true } }))) throw new CaseError('That member is not a user here.');
    members.push({ userId, role, gender: String(m.gender || '').toUpperCase() || undefined, external: Boolean(m.external) || role === 'EXTERNAL', termStart: String(m.termStart || '') || undefined, termEnd: String(m.termEnd || '') || undefined, name: String(m.name || '').trim().slice(0, 120) || undefined });
  }
  await peoplePrisma.committeeSetup.upsert({ where: { orgId_kind: { orgId: who.orgId, kind } }, create: { accountId: who.accountId, orgId: who.orgId, kind, members: members as any, updatedByUserId: who.userId }, update: { members: members as any, updatedByUserId: who.userId } });
  return committeeOf(who.orgId, kind);
}

async function namesOf(ids: string[]) {
  const set = [...new Set(ids.filter(Boolean))];
  const users = set.length ? await platformPrisma.user.findMany({ where: { id: { in: set } }, select: { id: true, fullName: true, email: true } }) : [];
  return new Map(users.map((u) => [u.id, u.fullName || u.email]));
}

// ---------------------------------------------------------------------------
// Intake (PRIV-02) and the clock (PRIV-03)
// ---------------------------------------------------------------------------

function clock(incidentOn: string, receivedOn: string, extendedTo?: string | null) {
  return { filingDeadline: extendedTo || addMonths(incidentOn, 3), inquiryDue: addDays(receivedOn, 90) };
}

/** A case comes in: from the person, or from someone taking it on their behalf. The committee's members, less any conflicted, are its members. */
export async function intake(who: Who & { employeeId?: string | null }, input: { kind?: string; complainantEmployeeId?: string | null; respondentEmployeeIds?: unknown; summary?: string; incidentOn?: string; onBehalf?: boolean }) {
  const kind = String(input.kind || '').toUpperCase() as CaseKind;
  if (!CASE_KINDS.includes(kind)) throw new CaseError('Say where it goes: the Internal Committee (POSH) or the grievance committee.');
  const summary = String(input.summary || '').trim();
  if (summary.length < 10) throw new CaseError('Say what happened, in a few sentences.');
  if (summary.length > 20_000) throw new CaseError('Keep the account under 20,000 characters; add documents as evidence.');
  const incidentOn = String(input.incidentOn || '').trim();
  const receivedOn = todayIst();
  if (!ISO.test(incidentOn) || incidentOn > receivedOn) throw new CaseError('Give the date it happened (YYYY-MM-DD), not in the future.');
  const complainantEmployeeId = who.employeeId ?? (String(input.complainantEmployeeId || '').trim() || null);
  const respondents = Array.isArray(input.respondentEmployeeIds) ? [...new Set(input.respondentEmployeeIds.map((x) => String(x)).filter(Boolean))].slice(0, 10) : [];
  const people = await peoplePrisma.employee.findMany({ where: { orgId: who.orgId, id: { in: [...respondents, ...(complainantEmployeeId ? [complainantEmployeeId] : [])] } }, select: { id: true, userId: true, reportingManagerId: true } });
  if (people.filter((p) => respondents.includes(p.id)).length !== respondents.length) throw new CaseError('Every person named must be someone here.');
  if (complainantEmployeeId && !people.some((p) => p.id === complainantEmployeeId)) throw new CaseError('No such complainant.');

  const committee = await peoplePrisma.committeeSetup.findUnique({ where: { orgId_kind: { orgId: who.orgId, kind: COMMITTEE_OF[kind] } } });
  const named = (committee?.members as Member[]) || [];
  if (!named.length) throw new CaseError(kind === 'POSH' ? 'The Internal Committee is not set up yet. Ask HR to name it under Settings → Private cases.' : 'The grievance committee is not set up yet.', 409);
  /* The conflict check: a member who is a respondent, or manages one, or is the complainant, does not hear the case. */
  const respondentUsers = new Set(people.filter((p) => respondents.includes(p.id)).map((p) => p.userId).filter(Boolean));
  const managers = await peoplePrisma.employee.findMany({ where: { orgId: who.orgId, id: { in: people.filter((p) => respondents.includes(p.id)).map((p) => p.reportingManagerId).filter((x): x is string => Boolean(x)) } }, select: { userId: true } });
  const managerUsers = new Set(managers.map((m) => m.userId).filter(Boolean));
  /* A committee member can file a complaint too; they cannot then sit in judgment on their own case. */
  const complainantUser = complainantEmployeeId ? people.find((p) => p.id === complainantEmployeeId)?.userId || null : null;
  const excluded: Array<{ userId: string; why: string }> = [];
  const members = named.filter((m) => {
    if (respondentUsers.has(m.userId)) { excluded.push({ userId: m.userId, why: 'named as a respondent' }); return false; }
    if (managerUsers.has(m.userId)) { excluded.push({ userId: m.userId, why: 'manages a respondent' }); return false; }
    if (complainantUser && m.userId === complainantUser) { excluded.push({ userId: m.userId, why: 'is the complainant' }); return false; }
    return true;
  });
  if (!members.length) throw new CaseError('Every committee member has a conflict with this case. Name an alternate on the committee first.', 409);

  const year = receivedOn.slice(0, 4);
  const { filingDeadline, inquiryDue } = clock(incidentOn, receivedOn);
  /* The reference is the year's next number; two complaints filed at the same moment take the next free one rather than failing. */
  let row: Awaited<ReturnType<typeof peoplePrisma.privateCase.create>> | null = null;
  for (let attempt = 0; !row; attempt += 1) {
    const count = await peoplePrisma.privateCase.count({ where: { orgId: who.orgId, reference: { startsWith: `PC-${year}-` } } });
    const id = `pc_${randomBytes(12).toString('hex')}`;
    try {
      row = await peoplePrisma.privateCase.create({
        data: {
          id, accountId: who.accountId, orgId: who.orgId, kind, reference: `PC-${year}-${String(count + 1 + attempt).padStart(3, '0')}`, complainantEmployeeId, raisedByUserId: who.userId, onBehalf: Boolean(input.onBehalf) || (!who.employeeId && Boolean(complainantEmployeeId)),
          respondentEmployeeIds: respondents, summaryEnc: seal(id, summary), incidentOn, receivedOn, filingDeadline, inquiryDue, excluded,
          members: { create: members.map((m) => ({ accountId: who.accountId, orgId: who.orgId, userId: m.userId, role: m.role })) },
        },
      });
    } catch (e: any) {
      if (e?.code !== 'P2002' || attempt >= 4) throw e;
    }
  }
  /* Members are told a case has come in — the reference only, nothing about who or what. */
  await notifyUsers(who.accountId, who.orgId, members.map((m) => m.userId), { kind: 'people.private_case', title: `A new ${kind === 'POSH' ? 'POSH complaint' : 'grievance'} has come to you: ${row.reference}`, body: 'Open Private cases to read it.', link: { app: 'people', screen: 'privateCases' } as any }).catch(() => undefined);
  return { id: row.id, reference: row.reference, kind: row.kind, receivedOn, filingDeadline, inquiryDue, lateFiling: receivedOn > filingDeadline };
}

// ---------------------------------------------------------------------------
// Reading: members only (PRIV-01), every open logged (PRIV-03)
// ---------------------------------------------------------------------------

async function membership(orgId: string, caseId: string, userId: string | null) {
  if (!userId) return null;
  return peoplePrisma.privateCaseMember.findFirst({ where: { orgId, caseId, userId } });
}

/** The cases this person is named on. Nobody else learns a case exists. */
export async function myCases(orgId: string, userId: string) {
  const mine = await peoplePrisma.privateCaseMember.findMany({ where: { orgId, userId }, select: { caseId: true, role: true } });
  if (!mine.length) return [];
  const rows = await peoplePrisma.privateCase.findMany({ where: { orgId, id: { in: mine.map((m) => m.caseId) } }, orderBy: { receivedOn: 'desc' } });
  const roleOf = new Map(mine.map((m) => [m.caseId, m.role]));
  const today = todayIst();
  return rows.map((c) => ({ id: c.id, reference: c.reference, kind: c.kind, status: c.status, receivedOn: c.receivedOn, inquiryDue: c.inquiryDue, reportDue: c.reportDue, actionDue: c.actionDue, myRole: roleOf.get(c.id), overdue: overdueOf(c, today) }));
}

function overdueOf(c: { status: string; inquiryDue: string; reportDue: string | null; actionDue: string | null }, today: string) {
  if (c.status === 'RECEIVED' || c.status === 'INQUIRY') return c.inquiryDue < today ? 'Inquiry past 90 days' : null;
  if (c.status === 'REPORT_DUE') return c.reportDue && c.reportDue < today ? 'Report past 10 days' : null;
  if (c.status === 'ACTION_DUE') return c.actionDue && c.actionDue < today ? 'Action past 60 days' : null;
  return null;
}

export async function openCase(orgId: string, caseId: string, userId: string | null) {
  const m = await membership(orgId, caseId, userId);
  if (!m) throw new CaseError('No such case.', 404);
  const c = await peoplePrisma.privateCase.findFirst({ where: { id: caseId, orgId }, include: { members: true, evidence: { select: { id: true, titleEnc: true, mime: true, size: true, addedByUserId: true, createdAt: true } } } });
  if (!c) throw new CaseError('No such case.', 404);
  await peoplePrisma.privateCaseAccess.create({ data: { accountId: c.accountId, orgId, caseId, userId: userId!, what: 'OPEN' } });
  const ids = [...c.members.map((x) => x.userId), ...((c.excluded as Array<{ userId: string }>) || []).map((x) => x.userId)];
  const names = await namesOf(ids);
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...((c.respondentEmployeeIds as string[]) || []), ...(c.complainantEmployeeId ? [c.complainantEmployeeId] : [])] } }, select: { id: true, name: true, code: true } });
  const nameOf = new Map(people.map((p) => [p.id, `${p.name}${p.code ? ` (${p.code})` : ''}`]));
  const today = todayIst();
  const access = m.role === 'PRESIDING' ? await accessLog(orgId, caseId) : null;
  return {
    id: c.id, reference: c.reference, kind: c.kind, status: c.status, outcome: c.outcome, myRole: m.role,
    complainant: c.complainantEmployeeId ? nameOf.get(c.complainantEmployeeId) || 'Someone here' : 'Not named', onBehalf: c.onBehalf,
    respondents: ((c.respondentEmployeeIds as string[]) || []).map((id) => nameOf.get(id) || 'Someone here'),
    summary: openText(c.id, c.summaryEnc),
    clock: { incidentOn: c.incidentOn, receivedOn: c.receivedOn, filingDeadline: c.filingDeadline, extendedTo: c.extendedTo, extensionReason: c.extensionReason, inquiryDue: c.inquiryDue, inquiryClosedOn: c.inquiryClosedOn, reportDue: c.reportDue, reportOn: c.reportOn, actionDue: c.actionDue, actionOn: c.actionOn, lateFiling: c.receivedOn > (c.extendedTo || c.filingDeadline), overdue: overdueOf(c, today) },
    members: c.members.map((x) => ({ userId: x.userId, name: names.get(x.userId) || '', role: x.role })),
    excluded: ((c.excluded as Array<{ userId: string; why: string }>) || []).map((x) => ({ name: names.get(x.userId) || '', why: x.why })),
    evidence: c.evidence.map((e) => ({ id: e.id, title: openText(c.id, e.titleEnc), mime: e.mime, size: e.size, addedAt: e.createdAt })),
    access,
  };
}

async function accessLog(orgId: string, caseId: string) {
  const rows = await peoplePrisma.privateCaseAccess.findMany({ where: { orgId, caseId }, orderBy: { at: 'desc' }, take: 200 });
  const names = await namesOf(rows.map((r) => r.userId));
  return rows.map((r) => ({ who: names.get(r.userId) || '', what: r.what, evidenceId: r.evidenceId, at: r.at }));
}

export async function addEvidence(who: Who, caseId: string, input: { title?: string; data?: unknown; mime?: unknown }) {
  const m = await membership(who.orgId, caseId, who.userId);
  if (!m) throw new CaseError('No such case.', 404);
  const title = String(input.title || '').trim().slice(0, 200);
  if (!title) throw new CaseError('Name the evidence.');
  const file = decodeDocument(input.data, input.mime);
  if ('error' in file) throw new CaseError(file.error);
  const row = await peoplePrisma.privateCaseEvidence.create({ data: { accountId: who.accountId, orgId: who.orgId, caseId, titleEnc: seal(caseId, title), mime: file.mime, size: file.data.length, dataEnc: seal(caseId, file.data), addedByUserId: who.userId } });
  return { id: row.id, title, mime: row.mime, size: row.size };
}

export async function openEvidence(who: Who, caseId: string, evidenceId: string) {
  const m = await membership(who.orgId, caseId, who.userId);
  if (!m) throw new CaseError('No such case.', 404);
  const e = await peoplePrisma.privateCaseEvidence.findFirst({ where: { id: evidenceId, orgId: who.orgId, caseId } });
  if (!e) throw new CaseError('No such evidence.', 404);
  await peoplePrisma.privateCaseAccess.create({ data: { accountId: who.accountId, orgId: who.orgId, caseId, userId: who.userId!, what: 'EVIDENCE', evidenceId } });
  return { id: e.id, title: openText(caseId, e.titleEnc), mime: e.mime, dataUrl: `data:${e.mime};base64,${openBytes(caseId, e.dataEnc).toString('base64')}` };
}

/** Move the case along its legal clock: start the inquiry, close it (report due in 10 days), report (action due in 60), act and close; or extend the filing window with a reason. */
export async function advance(who: Who, caseId: string, input: { step?: string; on?: string; reason?: string; outcome?: string }) {
  const m = await membership(who.orgId, caseId, who.userId);
  if (!m) throw new CaseError('No such case.', 404);
  if (m.role !== 'PRESIDING' && m.role !== 'OFFICER') throw new CaseError('Only the presiding officer or the grievance officer moves the case along.', 403);
  const c = await peoplePrisma.privateCase.findFirst({ where: { id: caseId, orgId: who.orgId } });
  if (!c) throw new CaseError('No such case.', 404);
  const on = input.on && ISO.test(input.on) ? input.on : todayIst();
  const step = String(input.step || '').toUpperCase();
  const data: Record<string, unknown> = {};
  if (step === 'EXTEND') {
    const reason = String(input.reason || '').trim().slice(0, 500);
    if (!reason) throw new CaseError('Say why the filing window is extended.');
    if (c.extendedTo) throw new CaseError('The filing window has been extended once already.', 409);
    data.extendedTo = addMonths(c.filingDeadline, 3);
    data.extensionReason = reason;
  } else if (step === 'START_INQUIRY') {
    if (c.status !== 'RECEIVED') throw new CaseError('The inquiry has started already.', 409);
    data.status = 'INQUIRY';
  } else if (step === 'CLOSE_INQUIRY') {
    if (!['RECEIVED', 'INQUIRY'].includes(c.status)) throw new CaseError('The inquiry is not open.', 409);
    data.status = 'REPORT_DUE'; data.inquiryClosedOn = on; data.reportDue = addDays(on, 10);
  } else if (step === 'REPORT') {
    if (c.status !== 'REPORT_DUE') throw new CaseError('Close the inquiry first.', 409);
    data.status = 'ACTION_DUE'; data.reportOn = on; data.actionDue = addDays(on, 60);
  } else if (step === 'CLOSE') {
    if (c.status !== 'ACTION_DUE') throw new CaseError('Report first.', 409);
    const outcome = String(input.outcome || '').trim().slice(0, 1000);
    if (!outcome) throw new CaseError('Record the action taken.');
    data.status = 'CLOSED'; data.actionOn = on; data.outcome = seal(caseId, outcome);
  } else throw new CaseError('The step is extend, start inquiry, close inquiry, report, or close.');
  /* Who moved the case on, and to what, sits in the case's own access log with the move (the outcome itself stays sealed). */
  await peoplePrisma.$transaction([
    peoplePrisma.privateCase.update({ where: { id: c.id }, data }),
    peoplePrisma.privateCaseAccess.create({ data: { accountId: c.accountId, orgId: who.orgId, caseId, userId: who.userId!, what: `STEP:${step}` } }),
  ]);
  return openCase(who.orgId, caseId, who.userId);
}

// ---------------------------------------------------------------------------
// The annual report: counts only (PRIV-05; POSH Act s.21, Rule 14)
// ---------------------------------------------------------------------------

export async function annualReport(orgId: string, year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = await peoplePrisma.privateCase.findMany({ where: { orgId, kind: 'POSH' }, select: { receivedOn: true, status: true, actionOn: true, inquiryDue: true, reportOn: true } });
  const pendingStart = rows.filter((r) => r.receivedOn < from && (!r.actionOn || r.actionOn >= from)).length;
  const received = rows.filter((r) => r.receivedOn >= from && r.receivedOn <= to).length;
  const disposed = rows.filter((r) => r.actionOn && r.actionOn >= from && r.actionOn <= to).length;
  const pendingEnd = rows.filter((r) => r.receivedOn <= to && (!r.actionOn || r.actionOn > to)).length;
  const over90 = rows.filter((r) => r.receivedOn <= to && (!r.reportOn || r.reportOn > to) && r.inquiryDue < to).length;
  return { year, pendingAtStart: pendingStart, received, disposed, pendingAtEnd: pendingEnd, pendingOver90Days: over90, note: 'Counts only. Workshops held and action taken are added by the presiding officer before filing.' };
}
