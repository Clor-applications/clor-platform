import { Router, type Request, type Response, type NextFunction } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, peopleRouteOk } from '../services/people/guards.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../services/payroll/guards.js';
import { teamScope } from '../services/people/scope.js';
import { recordAudit } from '../services/auditTrail.js';
import { referLimiter } from '../middleware/rateLimit.js';
import { isFeatureEnabled } from '../services/features.js';
import { decodeDocument } from '../services/people/documentFiles.js';
import { RESUME_TYPES, TalentError } from '../services/people/talent/hiring.js';
import * as referrals from '../services/people/talent/referrals.js';
import { z } from 'zod';
import { check, code, flag, idParams, list, num, q, rawText, text } from '../middleware/validate.js';

/**
 * Employee referrals (services/people/talent/referrals.ts, A20).
 *
 * HR (Recruitment): an opening's referral settings, the Referrals list and report, and the bonus
 * by hand (send to Payroll again, paid, not payable). Bonus amounts show to Recruitment edit and
 * to Payroll's adjustment readers only. The list keeps to the viewer's team when their role is
 * limited to their own people.
 *
 * Staff who use CLOR (People's own web): jobs open to me, refer, my link, apply, my referrals.
 * These need no right beyond being signed in as someone who works here; their employee record is
 * found from the session, never from the request.
 */
export const peopleReferralsRouter = Router();
const hrBase = '/orgs/:orgId/people/talent';
const meBase = '/orgs/:orgId/people/referrals/me';
peopleReferralsRouter.use(`${hrBase}/referrals`, requireAuth, requireTenantContext);
peopleReferralsRouter.use(`${hrBase}/openings/:id/referrals`, requireAuth, requireTenantContext);
peopleReferralsRouter.use(meBase, requireAuth, requireTenantContext);

const hiringOn = async (req: Request, res: Response, next: NextFunction) => {
  if (!(await peopleRouteOk(req, res))) return;
  if (!(await isFeatureEnabled(req.tenant!.accountId, req.tenant!.orgId, 'peopleHiring'))) return res.status(403).json({ error: 'Hiring is switched off for this company. Switch it on in People → Settings → Modules.', code: 'MODULE_OFF', feature: 'peopleHiring' });
  return next();
};
const can = (action: string) => requirePermission(PEOPLE_MODULE, action as any, 'Recruitment');
const has = async (req: Request, module: string, action: string, resource: string) => !(await authorize(req, module as any, action as any, resource));
const who = (req: Request) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId });
const view = async (req: Request): Promise<referrals.HrView> => ({
  money: (await has(req, PEOPLE_MODULE, 'EDIT', 'Recruitment')) || (await has(req, PAYROLL_MODULE, 'VIEW', PAYROLL_RESOURCE.adjustments)),
  scope: await teamScope(req),
});
const audit = (req: Request, entityId: string, action: string, message: string, metadata?: Record<string, unknown>) => recordAudit(req, { entity: 'Referral', entityId, action, message, metadata }).catch(() => undefined);
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof TalentError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    console.error('[referrals]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
};

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far too
 * long is refused with a 400; keys not named here are dropped; whether a field must be there, and the words for
 * it, stay the service's (talent/referrals.ts).
 */
/* A number a form may send as its text ("5000", or "" for none): the service makes the number and has the words for one that is not. */
const amount = z.union([num(-1e15, 1e15), text(40)]);
/* An id in a body: "" reads as none. */
const ref = text(200);
const SETTINGS = z.object({
  referralOpen: flag.nullish(), internalApply: flag.nullish(), referralBonus: amount.nullish(), referralBonusDays: amount.nullish(), referAudience: text(40).nullish(),
  referDepartmentIds: list(ref, 1000).nullish(), referBranchIds: list(ref, 1000).nullish(),
});
const REFER = z.object({
  openingId: ref.nullish(), name: text(2000).nullish(), email: text(2000).nullish(), phone: code(200).nullish(), relation: text(2000).nullish(), note: text(20_000).nullish(),
  /* The résumé as the browser reads it (a data URL), up to what this route's JSON may carry (app.ts: 3 MB). */
  resume: z.object({ name: text(2000).nullish(), mime: text(200).nullish(), data: rawText(3 * 1024 * 1024).nullish() }).nullish(),
});

/* ---------------------------------------------------------------------- HR */

peopleReferralsRouter.get(`${hrBase}/openings/:id/referrals`, hiringOn, can(PermissionAction.VIEW), check({ params: idParams }), handle(async (req, res) => {
  const o = await peoplePrisma.jobOpening.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId } });
  if (!o) return res.status(404).json({ error: 'No such opening.' });
  res.json({ settings: referrals.referralSettingsOf(o, (await view(req)).money) });
}));
peopleReferralsRouter.put(`${hrBase}/openings/:id/referrals`, hiringOn, can(PermissionAction.EDIT), check({ params: idParams, body: SETTINGS }), handle(async (req, res) => {
  const row = await referrals.setReferralSettings(who(req), String(req.params.id), req.body || {});
  await recordAudit(req, { entity: 'JobOpening', entityId: row.id, action: 'REFERRALS', message: `Referrals ${row.referralOpen ? 'on' : 'off'}: ${row.title}`, metadata: { bonus: row.referralBonus == null ? null : Number(row.referralBonus), bonusDays: row.referralBonusDays, audience: row.referAudience, internalApply: row.internalApply } }).catch(() => undefined);
  res.json({ settings: referrals.referralSettingsOf(row, true) });
}));

peopleReferralsRouter.get(`${hrBase}/referrals`, hiringOn, can(PermissionAction.VIEW), check({ query: z.object({ status: q(text(40)), openingId: q(ref), referrerId: q(ref), q: q(text(2000)) }) }), handle(async (req, res) => {
  const v = await view(req);
  const q = { status: String(req.query.status || 'all'), openingId: req.query.openingId ? String(req.query.openingId) : undefined, referrerId: req.query.referrerId ? String(req.query.referrerId) : undefined, q: String(req.query.q || '').slice(0, 100) };
  res.json({ ...(await referrals.listReferrals(req.tenant!.orgId, q, v)), money: v.money });
}));
/* The company's rule for a referrer who leaves before the bonus date (default: not paid; notice counts as still here). */
peopleReferralsRouter.get(`${hrBase}/referrals/rule`, hiringOn, can(PermissionAction.VIEW), handle(async (req, res) => {
  res.json(await referrals.referrerRuleOf(req.tenant!.orgId));
}));
peopleReferralsRouter.put(`${hrBase}/referrals/rule`, hiringOn, can(PermissionAction.EDIT), check({ body: z.object({ forfeitIfReferrerLeaves: flag.nullish() }) }), handle(async (req, res) => {
  const r = await referrals.setReferrerRule(who(req), req.body || {});
  await audit(req, req.tenant!.orgId, 'RULE', r.forfeitIfReferrerLeaves ? 'Referral bonus: not paid when the referrer has left' : 'Referral bonus: paid even when the referrer has left');
  res.json(r);
}));
peopleReferralsRouter.get(`${hrBase}/referrals/report`, hiringOn, can(PermissionAction.VIEW), handle(async (req, res) => {
  const v = await view(req);
  res.json({ ...(await referrals.referralReport(req.tenant!.orgId, v)), money: v.money });
}));
/* Send a due bonus to Payroll again (after HR opened a month or added the earning): Recruitment edit and the right to add payroll adjustments. */
peopleReferralsRouter.post(`${hrBase}/referrals/:id/bonus/send`, hiringOn, can(PermissionAction.EDIT), check({ params: idParams }), handle(async (req, res) => {
  if (!(await has(req, PAYROLL_MODULE, 'CREATE', PAYROLL_RESOURCE.adjustments))) return res.status(403).json({ error: 'Sending a bonus to Payroll needs the right to add payroll adjustments.' });
  const r = await referrals.sendBonusToPayroll(req.tenant!.orgId, String(req.params.id));
  await audit(req, String(req.params.id), 'BONUS_SENT', r.sent ? 'Referral bonus sent to Payroll as a draft earning' : `Referral bonus not sent: ${r.why}`);
  res.json(r);
}));
peopleReferralsRouter.post(`${hrBase}/referrals/:id/bonus/paid`, hiringOn, can(PermissionAction.EDIT), check({ params: idParams }), handle(async (req, res) => {
  await referrals.markBonusPaid(who(req), String(req.params.id));
  await audit(req, String(req.params.id), 'BONUS_PAID', 'Referral bonus marked paid by hand');
  res.json({ ok: true });
}));
peopleReferralsRouter.post(`${hrBase}/referrals/:id/bonus/forfeit`, hiringOn, can(PermissionAction.EDIT), check({ params: idParams, body: z.object({ reason: text(5000).nullish() }) }), handle(async (req, res) => {
  await referrals.forfeitBonus(who(req), String(req.params.id), req.body?.reason);
  await audit(req, String(req.params.id), 'BONUS_FORFEITED', 'Referral bonus set as not payable', { reason: String(req.body?.reason || '').slice(0, 300) });
  res.json({ ok: true });
}));

/* ------------------------------------------------- staff, on People's web */

async function referrer(req: Request, res: Response) {
  const e = await referrals.referrerByUser(req.tenant!.orgId, req.auth!.userId);
  if (!e) res.status(403).json({ error: 'Referring is for people who work here: your sign-in is not linked to an employee record.', code: 'NOT_EMPLOYEE' });
  return e;
}
const resumeOf = (raw: any) => {
  if (!raw?.data) return null;
  const f = decodeDocument(raw.data, raw.mime);
  if ('error' in f) throw new TalentError(f.error);
  if (!RESUME_TYPES.has(f.mime)) throw new TalentError('A résumé is a PDF or Word file.');
  return { name: String(raw.name || 'resume').slice(0, 200), mime: f.mime, data: f.data };
};

peopleReferralsRouter.get(meBase, hiringOn, handle(async (req, res) => {
  const e = await referrals.referrerByUser(req.tenant!.orgId, req.auth!.userId);
  if (!e) return res.json({ employee: false, jobs: [], referrals: [], applications: [] });
  res.json({ employee: true, jobs: await referrals.jobsFor(e), ...(await referrals.mine(e)) });
}));
peopleReferralsRouter.post(`${meBase}/refer`, hiringOn, ...referLimiter, check({ body: REFER }), handle(async (req, res) => {
  const e = await referrer(req, res);
  if (!e) return;
  const made = await referrals.refer(e, req.body || {}, resumeOf(req.body?.resume));
  await audit(req, made.referralId, 'CREATE', 'Referral made', { candidateId: made.candidateId, openingId: String(req.body?.openingId || '') });
  res.status(201).json({ referral: { id: made.referralId } });
}));
peopleReferralsRouter.post(`${meBase}/link`, hiringOn, check({ body: z.object({ openingId: ref.nullish() }) }), handle(async (req, res) => {
  const e = await referrer(req, res);
  if (!e) return;
  res.json(await referrals.linkFor(e, String(req.body?.openingId || '')));
}));
peopleReferralsRouter.post(`${meBase}/apply`, hiringOn, check({ body: z.object({ openingId: ref.nullish(), note: text(20_000).nullish() }) }), handle(async (req, res) => {
  const e = await referrer(req, res);
  if (!e) return;
  const c = await referrals.applyInternal(e, String(req.body?.openingId || ''), req.body || {});
  await recordAudit(req, { entity: 'Candidate', entityId: c.id, action: 'APPLIED_WITHIN', message: `Applied from within: ${e.name}` }).catch(() => undefined);
  res.status(201).json({ application: { id: c.id } });
}));
