import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { teamScope } from '../services/people/scope.js';
import { homeDashboard } from '../services/people/homeDashboard.js';

/**
 * People Home's dashboard, kudos stream and one-question pulse (owner's suite spec, 5–6 Nov 2026).
 *
 *  - The dashboard: anyone who may see employees; each part checks its own permission (services/people/homeDashboard.ts).
 *  - Kudos: read and given by anyone in People, to someone working here; taken down by the giver or HR.
 *  - The pulse: answered by anyone in People, once per question (an answer can be changed); asked and closed by HR.
 *    What anyone reads is counts per score, and only once PULSE_MIN people have answered.
 */
export const peopleHomeDashboardRouter = Router();
const base = '/orgs/:orgId/people';
for (const p of ['home/dashboard', 'kudos', 'pulse']) peopleHomeDashboardRouter.use(`${base}/${p}`, requireAuth, requireTenantContext);

export const PULSE_MIN = 3;
const KUDOS_SHOWN = 8;
const ppl = (action: string) => requirePermission(PEOPLE_MODULE, action as any, PEOPLE_RESOURCE.employees);
const isHr = async (req: Request) => !(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.employees)) && (await teamScope(req)).all;
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await fn(req, res);
  } catch (e) {
    console.error('[people home]', e instanceof Error ? e.message : e); // eslint-disable-line no-console
    res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
  }
};

peopleHomeDashboardRouter.get(`${base}/home/dashboard`, ppl(PermissionAction.VIEW), handle(async (req, res) => {
  res.json(await homeDashboard(req));
}));

/* -------------------------------------------------------------------- kudos */

async function kudosList(req: Request) {
  const { orgId } = req.tenant!;
  const rows = await peoplePrisma.kudos.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: KUDOS_SHOWN });
  const to = rows.length ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.toEmployeeId))] } }, select: { id: true, name: true, photoUrl: true, department: true } }) : [];
  const byId = new Map(to.map((e) => [e.id, e]));
  const hr = await isHr(req);
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    fromName: r.fromName,
    at: r.createdAt.toISOString(),
    to: { id: r.toEmployeeId, name: byId.get(r.toEmployeeId)?.name || 'Someone who has left', photoUrl: byId.get(r.toEmployeeId)?.photoUrl || null, department: byId.get(r.toEmployeeId)?.department || null },
    canRemove: hr || r.fromUserId === req.auth!.userId,
  }));
}

peopleHomeDashboardRouter.get(`${base}/kudos`, ppl(PermissionAction.VIEW), handle(async (req, res) => {
  res.json({ kudos: await kudosList(req) });
}));

peopleHomeDashboardRouter.post(`${base}/kudos`, ppl(PermissionAction.VIEW), handle(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const message = String(req.body?.message || '').trim().replace(/\s+/g, ' ').slice(0, 280);
  if (!message) return res.status(400).json({ error: 'Say what you are thanking them for.' });
  const to = await peoplePrisma.employee.findFirst({ where: { accountId, orgId, id: String(req.body?.toEmployeeId || ''), status: { not: 'LEFT' } }, select: { id: true, userId: true } });
  if (!to) return res.status(400).json({ error: 'Choose someone who works here.' });
  if (to.userId && to.userId === req.auth!.userId) return res.status(400).json({ error: 'Kudos are for someone else.' });
  const me = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { fullName: true, email: true } });
  await peoplePrisma.kudos.create({ data: { accountId, orgId, toEmployeeId: to.id, message, fromUserId: req.auth!.userId, fromName: me?.fullName || me?.email || 'A colleague' } });
  res.status(201).json({ kudos: await kudosList(req) });
}));

peopleHomeDashboardRouter.delete(`${base}/kudos/:id`, ppl(PermissionAction.VIEW), handle(async (req, res) => {
  const { orgId } = req.tenant!;
  const k = await peoplePrisma.kudos.findFirst({ where: { orgId, id: String(req.params.id) }, select: { id: true, fromUserId: true } });
  if (!k) return res.status(404).json({ error: 'Already taken down.' });
  if (k.fromUserId !== req.auth!.userId && !(await isHr(req))) return res.status(403).json({ error: 'Only the person who gave it, or HR, can take it down.' });
  await peoplePrisma.kudos.delete({ where: { id: k.id } });
  res.json({ kudos: await kudosList(req) });
}));

/* -------------------------------------------------------------------- pulse */

async function pulseOf(req: Request) {
  const { orgId } = req.tenant!;
  const q = await peoplePrisma.pulseQuestion.findFirst({ where: { orgId, closedAt: null }, orderBy: { createdAt: 'desc' } });
  const canAsk = await isHr(req);
  if (!q) return { question: null, canAsk };
  const answers = await peoplePrisma.pulseAnswer.findMany({ where: { orgId, questionId: q.id }, select: { userId: true, score: true } });
  const mine = answers.find((a) => a.userId === req.auth!.userId)?.score ?? null;
  const shown = answers.length >= PULSE_MIN;
  return {
    question: { id: q.id, text: q.text, since: q.createdAt.toISOString() },
    answered: answers.length,
    mine,
    /* Counts per score, 1 to 5; held back until enough people answered that no one answer stands out. */
    results: shown ? [1, 2, 3, 4, 5].map((s) => answers.filter((a) => a.score === s).length) : null,
    average: shown ? Math.round((answers.reduce((n, a) => n + a.score, 0) / answers.length) * 10) / 10 : null,
    showsAt: PULSE_MIN,
    canAsk,
  };
}

peopleHomeDashboardRouter.get(`${base}/pulse`, ppl(PermissionAction.VIEW), handle(async (req, res) => {
  res.json(await pulseOf(req));
}));

peopleHomeDashboardRouter.post(`${base}/pulse/answer`, ppl(PermissionAction.VIEW), handle(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const score = Number(req.body?.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) return res.status(400).json({ error: 'Choose 1 to 5.' });
  const q = await peoplePrisma.pulseQuestion.findFirst({ where: { orgId, id: String(req.body?.questionId || ''), closedAt: null }, select: { id: true } });
  if (!q) return res.status(409).json({ error: 'This question has closed.' });
  const userId = req.auth!.userId;
  await peoplePrisma.pulseAnswer.upsert({ where: { questionId_userId: { questionId: q.id, userId } }, create: { accountId, orgId, questionId: q.id, userId, score }, update: { score } });
  res.json(await pulseOf(req));
}));

/** HR asks a new question; the open one closes, its answers kept. */
peopleHomeDashboardRouter.post(`${base}/pulse`, ppl(PermissionAction.EDIT), handle(async (req, res) => {
  if (!(await isHr(req))) return res.status(403).json({ error: 'Only HR, for the whole company, can ask the pulse question.' });
  const { accountId, orgId } = req.tenant!;
  const text = String(req.body?.text || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!text) return res.status(400).json({ error: 'Write the question.' });
  await peoplePrisma.$transaction([
    peoplePrisma.pulseQuestion.updateMany({ where: { orgId, closedAt: null }, data: { closedAt: new Date() } }),
    peoplePrisma.pulseQuestion.create({ data: { accountId, orgId, text, createdByUserId: req.auth!.userId } }),
  ]);
  res.status(201).json(await pulseOf(req));
}));

peopleHomeDashboardRouter.post(`${base}/pulse/close`, ppl(PermissionAction.EDIT), handle(async (req, res) => {
  if (!(await isHr(req))) return res.status(403).json({ error: 'Only HR, for the whole company, can close the pulse question.' });
  await peoplePrisma.pulseQuestion.updateMany({ where: { orgId: req.tenant!.orgId, closedAt: null }, data: { closedAt: new Date() } });
  res.json(await pulseOf(req));
}));
