import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { correlationOf } from '../services/people/employees.js';
import type { Actor, ChangeSource } from '../services/people/changeLog.js';
import { CATEGORY_LABEL, NOTICE_LANGUAGES, POLICY_CATEGORIES, PRIVACY_PURPOSES, PolicyError, noticeLanguages, saveNoticeLanguages, addVersion, conflicts, createPolicy, listPolicies, peopleInScope, cleanAppliesTo, policiesFor, policyDetail, retireVersion, submitVersion, updatePolicy, updateVersion } from '../services/people/policies.js';
import { AckError, remind, report } from '../services/people/acknowledgements.js';
import { inScope, teamScope } from '../services/people/scope.js';
import { z } from 'zod';
import { check, flag, id, idParams, jsonObject, list, q, text } from '../middleware/validate.js';

/**
 * Policies (docs/people/02-PRD.md POL-01..06): the library, versions, who
 * each applies to, publishing through the rule, acceptance and reminders.
 */
export const peoplePoliciesRouter = Router();
peoplePoliciesRouter.use(requireAuth, requireTenantContext);

const { policies: POLICIES, employees: EMPLOYEES } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const base = '/orgs/:orgId/people';
const actorOf = (req: Request, source: ChangeSource = 'FORM', reason: string | null = null): Actor => ({
  accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null, source, correlationId: correlationOf(req as any), reason,
});
const sendError = (res: any, e: unknown) => {
  if (e instanceof PolicyError || e instanceof AckError) return res.status(e.status).json({ error: e.message });
  console.error('[people-policies]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};
const versionParam = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far too
 * long is refused with a 400; keys not named here are dropped; whether a field must be there, and the words for
 * it, stay the service's (policies.ts). A version number that is not one is still "No such version.", and an
 * as-of or retire date that is not one is still read as today, as before.
 */
/* A day that may be left empty (the service says what it then needs); any other must be YYYY-MM-DD, in the service's words. */
const day = (words: string) => z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, words);
/* An id in a body: "" reads as none. */
const ref = text(200);
const names = list(text(200), 5000).nullish();
const APPLIES_TO = z.object({ establishmentIds: names, states: names, departmentIds: names, employeeTypeIds: names, gradeIds: names, workTypeIds: names });
const POLICY = z.object({ title: text(2000).nullish(), category: text(40).nullish(), purpose: text(80).nullish(), description: text(20_000).nullish(), ownerUserId: ref.nullish(), isActive: flag.nullish() });
const VERSION = z.object({
  /* The text may be as long as the JSON limit: the service keeps the first 100,000 characters. */
  body: text(1024 * 1024).nullish(), documentId: ref.nullish(), effectiveFrom: day('Say from which day it applies (YYYY-MM-DD).').nullish(), effectiveTo: day('Dates are YYYY-MM-DD.').nullish(),
  appliesTo: APPLIES_TO.nullish(), needsAcceptance: flag.nullish(),
  /* The notice in other languages, keyed by language: the service checks each key against the languages switched on. */
  translations: jsonObject().nullish(),
});
const AS_OF = z.object({ asOf: q(text(40)) });
const VERSION_PARAMS = z.object({ id, v: text(40) });

peoplePoliciesRouter.get(`${base}/policies`, can(PermissionAction.VIEW, POLICIES), check({ query: z.object({ q: q(text(2000)), category: q(text(40)), all: q(text(10)) }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ policies: await listPolicies(req.tenant!.orgId, { q: String(req.query.q || ''), category: String(req.query.category || '') || undefined, includeInactive: req.query.all === '1' }), categories: POLICY_CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c] })), purposes: Object.entries(PRIVACY_PURPOSES).map(([key, label]) => ({ key, label })), languages: (await noticeLanguages(req.tenant!.orgId)).map((key) => ({ key, label: NOTICE_LANGUAGES[key] })) });
});

peoplePoliciesRouter.get(`${base}/policies/conflicts`, can(PermissionAction.VIEW, POLICIES), check({ query: AS_OF }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : undefined;
  res.json({ conflicts: await conflicts(req.tenant!.orgId, asOf) });
});

/** Who a rule would reach, before it is saved. */
peoplePoliciesRouter.post(`${base}/policies/scope`, can(PermissionAction.VIEW, POLICIES), check({ body: z.object({ appliesTo: APPLIES_TO.nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const people = await peopleInScope(req.tenant!.orgId, cleanAppliesTo(req.body?.appliesTo));
  res.json({ count: people.length, sample: people.slice(0, 8).map((p) => ({ id: p.id, name: p.name, code: p.code })) });
});

/** The languages privacy notices are offered in besides English (PRV-01). */
peoplePoliciesRouter.get(`${base}/policies/notice-languages`, can(PermissionAction.VIEW, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ enabled: await noticeLanguages(req.tenant!.orgId), offered: Object.entries(NOTICE_LANGUAGES).map(([key, label]) => ({ key, label })) });
});

peoplePoliciesRouter.put(`${base}/policies/notice-languages`, can(PermissionAction.EDIT, POLICIES), check({ body: z.object({ languages: list(text(40), 200).nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ enabled: await saveNoticeLanguages(actorOf(req), req.body?.languages) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.post(`${base}/policies`, can(PermissionAction.CREATE, POLICIES), check({ body: POLICY }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const p = await createPolicy(actorOf(req), req.body || {});
    res.status(201).json({ policy: await policyDetail(req.tenant!.orgId, p.id) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.get(`${base}/policies/:id`, can(PermissionAction.VIEW, POLICIES), check({ params: idParams }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ policy: await policyDetail(req.tenant!.orgId, String(req.params.id)) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.put(`${base}/policies/:id`, can(PermissionAction.EDIT, POLICIES), check({ params: idParams, body: POLICY }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await updatePolicy(actorOf(req), String(req.params.id), req.body || {});
    res.json({ policy: await policyDetail(req.tenant!.orgId, String(req.params.id)) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.post(`${base}/policies/:id/versions`, can(PermissionAction.EDIT, POLICIES), check({ params: idParams, body: VERSION }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ version: await addVersion(actorOf(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.put(`${base}/policies/:id/versions/:v`, can(PermissionAction.EDIT, POLICIES), check({ params: VERSION_PARAMS, body: VERSION }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  if (!v) return res.status(404).json({ error: 'No such version.' });
  try {
    res.json({ version: await updateVersion(actorOf(req), String(req.params.id), v, req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

/** Send for publishing: the policy's owner or anyone with Policies EDIT; with a rule it waits, without one it goes live now. */
peoplePoliciesRouter.post(`${base}/policies/:id/versions/:v/submit`, can(PermissionAction.EDIT, POLICIES), check({ params: VERSION_PARAMS }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  if (!v) return res.status(404).json({ error: 'No such version.' });
  try {
    res.json(await submitVersion(actorOf(req), String(req.params.id), v));
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.post(`${base}/policies/:id/versions/:v/retire`, can(PermissionAction.EDIT, POLICIES), check({ params: VERSION_PARAMS, body: z.object({ effectiveTo: text(40).nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  if (!v) return res.status(404).json({ error: 'No such version.' });
  try {
    res.json({ version: await retireVersion(actorOf(req), String(req.params.id), v, req.body?.effectiveTo) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.get(`${base}/policies/:id/versions/:v/acknowledgements`, can(PermissionAction.VIEW, POLICIES), check({ params: VERSION_PARAMS }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  const row = v ? await peoplePrisma.policyVersion.findFirst({ where: { policyId: String(req.params.id), version: v, orgId: req.tenant!.orgId }, select: { id: true } }) : null;
  if (!row) return res.status(404).json({ error: 'No such version.' });
  res.json(await report(req.tenant!.orgId, 'POLICY_VERSION', row.id));
});

peoplePoliciesRouter.post(`${base}/policies/:id/versions/:v/remind`, can(PermissionAction.EDIT, POLICIES), check({ params: VERSION_PARAMS }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  const row = v ? await peoplePrisma.policyVersion.findFirst({ where: { policyId: String(req.params.id), version: v, orgId: req.tenant!.orgId }, include: { policy: { select: { title: true } } } }) : null;
  if (!row) return res.status(404).json({ error: 'No such version.' });
  const { accountId, orgId } = req.tenant!;
  res.json({ reminded: await remind({ accountId, orgId, userId: req.auth!.userId }, 'POLICY_VERSION', row.id, { title: `Please read and accept: ${row.policy.title}`, body: `Version ${row.version}, from ${row.effectiveFrom}.` }) });
});

/** What applies to one person on a day: HR's view of what the person sees. */
peoplePoliciesRouter.get(`${base}/employees/:id/policies`, can(PermissionAction.VIEW, EMPLOYEES), check({ params: idParams, query: AS_OF }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  /* Someone outside a team-limited role's team reads as absent, as on the record itself. */
  if (!inScope(await teamScope(req), String(req.params.id))) return res.status(404).json({ error: 'No such employee.' });
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : undefined;
  res.json({ policies: await policiesFor(req.tenant!.orgId, String(req.params.id), asOf) });
});
