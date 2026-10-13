import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { SalaryRevisionError, applyRevision, previewImpact } from '../services/payroll/revision.js';

/**
 * Salary revisions, and what they actually cost.
 *
 * The lifecycle is draft → reviewed → approved → applied, and only the last
 * step changes anybody's pay. The separation is the point: an increment is
 * agreed in a conversation, checked by somebody in finance, signed off, and
 * then — separately — becomes real on a date. Collapsing that into one button
 * is how a discussed number turns into a paid one nobody signed.
 *
 * The impact is computed by running the payroll engine twice, and the answer
 * shown at approval is stored on the revision. A year later, "we approved this
 * on the understanding it cost X" needs the X that was on the screen, not one
 * recomputed under today's rates.
 */
export const payrollRevisionsRouter = Router();
payrollRevisionsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.revisions;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const handle = (res: any, e: unknown) => {
  if (e instanceof SalaryRevisionError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

const shape = (r: any, extra: Record<string, unknown> = {}) => ({
  id: r.id,
  employeeId: r.employeeId,
  currentAssignmentId: r.currentAssignmentId || null,
  currentStructureId: r.currentStructureId || null,
  currentAnnualCtc: Number(r.currentAnnualCtc ?? 0),
  proposedStructureId: r.proposedStructureId,
  proposedAnnualCtc: Number(r.proposedAnnualCtc ?? 0),
  incrementPercent: Number(r.incrementPercent ?? 0),
  effectiveFrom: r.effectiveFrom,
  reason: r.reason || '',
  notes: r.notes || '',
  status: r.status,
  appliedAssignmentId: r.appliedAssignmentId || null,
  reviewedAt: r.reviewedAt || null,
  approvedAt: r.approvedAt || null,
  createdAt: r.createdAt,
  ...extra,
});

const readImpact = (json: string | null | undefined) => {
  try {
    return JSON.parse(String(json || '{}')) || {};
  } catch {
    return {};
  }
};

payrollRevisionsRouter.get(
  '/orgs/:orgId/payroll/revisions',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const employeeId = String(req.query.employeeId || '').trim();
    const status = String(req.query.status || '').trim();

    const rows = await payrollPrisma.salaryRevision.findMany({
      where: { accountId, orgId, ...(employeeId ? { employeeId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const structureIds = [...new Set(rows.flatMap((r) => [r.currentStructureId, r.proposedStructureId].filter(Boolean) as string[]))];

    const [people, structures] = await Promise.all([
      employeeIds.length
        ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, name: true, code: true } })
        : Promise.resolve([]),
      structureIds.length
        ? payrollPrisma.salaryStructure.findMany({ where: { orgId, id: { in: structureIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const byPerson = new Map(people.map((p) => [p.id, p]));
    const byStructure = new Map(structures.map((s) => [s.id, s.name]));

    res.json({
      revisions: rows.map((r) =>
        shape(r, {
          employeeName: byPerson.get(r.employeeId)?.name || 'Unknown employee',
          employeeCode: byPerson.get(r.employeeId)?.code || '',
          currentStructureName: r.currentStructureId ? byStructure.get(r.currentStructureId) || '' : '',
          proposedStructureName: byStructure.get(r.proposedStructureId) || '',
        })
      ),
    });
  }
);

payrollRevisionsRouter.get(
  '/orgs/:orgId/payroll/revisions/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const revision = await payrollPrisma.salaryRevision.findFirst({ where: { accountId, orgId, id: String(req.params.id) } });
    if (!revision) return res.status(404).json({ error: 'No such salary revision.' });

    const [person, structures] = await Promise.all([
      peoplePrisma.employee.findFirst({ where: { orgId, id: revision.employeeId }, select: { name: true, code: true } }),
      payrollPrisma.salaryStructure.findMany({
        where: { orgId, id: { in: [revision.currentStructureId, revision.proposedStructureId].filter(Boolean) as string[] } },
        select: { id: true, name: true },
      }),
    ]);
    const byStructure = new Map(structures.map((s) => [s.id, s.name]));

    /*
     * An applied or approved revision shows the impact that was stored with
     * it; anything earlier is recomputed, because a draft's numbers should
     * follow the rates and structures as they are now.
     */
    const stored = readImpact(revision.impactJson);
    const impact = ['APPROVED', 'APPLIED'].includes(revision.status) && stored.ctc
      ? stored
      : await previewImpact({
          orgId,
          employeeId: revision.employeeId,
          currentStructureId: revision.currentStructureId,
          currentAnnualCtc: Number(revision.currentAnnualCtc),
          proposedStructureId: revision.proposedStructureId,
          proposedAnnualCtc: Number(revision.proposedAnnualCtc),
          effectiveFrom: revision.effectiveFrom,
        }).catch(() => null);

    res.json({
      revision: shape(revision, {
        employeeName: person?.name || 'Unknown employee',
        employeeCode: person?.code || '',
        currentStructureName: revision.currentStructureId ? byStructure.get(revision.currentStructureId) || '' : '',
        proposedStructureName: byStructure.get(revision.proposedStructureId) || '',
        impact,
        /* Said plainly, because a stored figure and a live one mean different
           things and the screen should not have to guess. */
        impactIsStored: ['APPROVED', 'APPLIED'].includes(revision.status) && Boolean(stored.ctc),
      }),
    });
  }
);

/** The impact of terms nobody has written down yet. */
payrollRevisionsRouter.post(
  '/orgs/:orgId/payroll/revisions/impact-preview',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;

    const schema = z.object({
      employeeId: z.string().trim().min(1),
      proposedStructureId: z.string().trim().min(1),
      proposedAnnualCtc: z.number().finite().positive(),
      effectiveFrom: z.string().trim().regex(ISO_DATE),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid terms.' });

    /* What somebody is on now is read here rather than asked for: the caller
       should not be able to compare against a salary that is not theirs. */
    const current = await payrollPrisma.salaryAssignment.findFirst({
      where: { orgId, employeeId: parsed.data.employeeId, status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' },
    });

    try {
      const impact = await previewImpact({
        orgId,
        employeeId: parsed.data.employeeId,
        currentStructureId: current?.structureId || null,
        currentAnnualCtc: Number(current?.annualCtc ?? 0),
        proposedStructureId: parsed.data.proposedStructureId,
        proposedAnnualCtc: parsed.data.proposedAnnualCtc,
        effectiveFrom: parsed.data.effectiveFrom,
      });
      res.json({
        impact,
        current: current
          ? { assignmentId: current.id, structureId: current.structureId, annualCtc: Number(current.annualCtc) }
          : null,
      });
    } catch (e) {
      return handle(res, e);
    }
  }
);

const body = z.object({
  employeeId: z.string().trim().min(1, 'Say whose salary this revises.'),
  proposedStructureId: z.string().trim().min(1, 'Say which structure they move to.'),
  proposedAnnualCtc: z.number().finite().positive('Say what the new cost to company is.'),
  effectiveFrom: z.string().trim().regex(ISO_DATE, 'The date must be a date.'),
  reason: z.string().trim().max(240).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

payrollRevisionsRouter.post(
  '/orgs/:orgId/payroll/revisions',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const parsed = body.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid revision.' });

    const [employee, structure] = await Promise.all([
      peoplePrisma.employee.findFirst({ where: { orgId, id: parsed.data.employeeId }, select: { id: true } }),
      payrollPrisma.salaryStructure.findFirst({ where: { orgId, id: parsed.data.proposedStructureId }, select: { id: true, name: true, status: true } }),
    ]);
    if (!employee) return res.status(404).json({ error: 'No such employee.' });
    if (!structure) return res.status(404).json({ error: 'No such salary structure.' });
    if (structure.status === 'ARCHIVED') {
      return res.status(409).json({ error: `${structure.name} is archived, so nobody can be moved onto it.` });
    }

    /* An open revision already exists for this person: two would race to
       become their salary and the second would be refused at apply time with
       nothing to say why. */
    const open = await payrollPrisma.salaryRevision.findFirst({
      where: { orgId, employeeId: parsed.data.employeeId, status: { in: ['DRAFT', 'REVIEWED', 'APPROVED'] } },
      select: { id: true },
    });
    if (open) {
      return res.status(409).json({
        error: 'There is already a revision open for this person. Finish or reject that one first.',
        code: 'REVISION_OPEN',
      });
    }

    const current = await payrollPrisma.salaryAssignment.findFirst({
      where: { orgId, employeeId: parsed.data.employeeId, status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' },
    });
    const currentCtc = Number(current?.annualCtc ?? 0);

    const row = await payrollPrisma.salaryRevision.create({
      data: {
        accountId,
        orgId,
        employeeId: parsed.data.employeeId,
        /* Frozen on the revision: what somebody was on when this was proposed
           is part of what was proposed, and it must not move underneath. */
        currentAssignmentId: current?.id || null,
        currentStructureId: current?.structureId || null,
        currentAnnualCtc: currentCtc,
        proposedStructureId: parsed.data.proposedStructureId,
        proposedAnnualCtc: parsed.data.proposedAnnualCtc,
        incrementPercent: currentCtc > 0 ? Math.round(((parsed.data.proposedAnnualCtc - currentCtc) / currentCtc) * 10000) / 100 : 0,
        effectiveFrom: parsed.data.effectiveFrom,
        reason: parsed.data.reason?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        status: 'DRAFT',
        createdByUserId: req.auth!.userId,
      },
    });

    res.status(201).json({ revision: shape(row) });
  }
);

payrollRevisionsRouter.put(
  '/orgs/:orgId/payroll/revisions/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.salaryRevision.findFirst({ where: { accountId, orgId, id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'No such salary revision.' });
    if (!['DRAFT', 'REVIEWED'].includes(existing.status)) {
      return res.status(409).json({
        error:
          existing.status === 'APPLIED'
            ? 'This is somebody’s salary now. Raise another revision to change it again.'
            : 'An approved revision cannot be edited. Reject it and raise another.',
        code: 'REVISION_NOT_EDITABLE',
      });
    }

    const parsed = body.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid revision.' });

    const currentCtc = Number(existing.currentAnnualCtc);
    const row = await payrollPrisma.salaryRevision.update({
      where: { id: existing.id },
      data: {
        proposedStructureId: parsed.data.proposedStructureId,
        proposedAnnualCtc: parsed.data.proposedAnnualCtc,
        incrementPercent: currentCtc > 0 ? Math.round(((parsed.data.proposedAnnualCtc - currentCtc) / currentCtc) * 10000) / 100 : 0,
        effectiveFrom: parsed.data.effectiveFrom,
        reason: parsed.data.reason?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        /* Changing the numbers withdraws whatever review they had. */
        status: 'DRAFT',
        reviewedByUserId: null,
        reviewedAt: null,
      },
    });
    res.json({ revision: shape(row) });
  }
);

/**
 * Move a revision along its lifecycle.
 *
 * Approving stores the impact as it stands at that moment, because that is what
 * was approved. Recomputing it later under different rates would answer a
 * different question.
 */
const transition = (
  path: string,
  from: string[],
  to: string,
  stamp: (userId: string) => Record<string, unknown>,
  action: (typeof PermissionAction)[keyof typeof PermissionAction]
) =>
  payrollRevisionsRouter.post(
    `/orgs/:orgId/payroll/revisions/:id/${path}`,
    requirePermission(PAYROLL_MODULE, action, RESOURCE),
    async (req, res) => {
      if (!(await payrollRouteOk(req, res))) return;
      const { accountId, orgId } = req.tenant!;

      const existing = await payrollPrisma.salaryRevision.findFirst({ where: { accountId, orgId, id: String(req.params.id) } });
      if (!existing) return res.status(404).json({ error: 'No such salary revision.' });
      if (!from.includes(existing.status)) {
        return res.status(409).json({
          error: `A revision that is ${existing.status.toLowerCase()} cannot be ${path === 'submit-review' ? 'sent for review' : `${path}d`}.`,
          code: 'REVISION_WRONG_STATE',
        });
      }

      const data: Record<string, unknown> = { status: to, ...stamp(req.auth!.userId) };

      if (to === 'APPROVED') {
        const impact = await previewImpact({
          orgId,
          employeeId: existing.employeeId,
          currentStructureId: existing.currentStructureId,
          currentAnnualCtc: Number(existing.currentAnnualCtc),
          proposedStructureId: existing.proposedStructureId,
          proposedAnnualCtc: Number(existing.proposedAnnualCtc),
          effectiveFrom: existing.effectiveFrom,
        }).catch(() => null);
        if (impact) data.impactJson = JSON.stringify(impact);
      }

      const row = await payrollPrisma.salaryRevision.update({ where: { id: existing.id }, data });
      res.json({ revision: shape(row) });
    }
  );

transition('submit-review', ['DRAFT'], 'REVIEWED', (userId) => ({ reviewedByUserId: userId, reviewedAt: new Date() }), PermissionAction.EDIT);
transition('approve', ['REVIEWED'], 'APPROVED', (userId) => ({ approvedByUserId: userId, approvedAt: new Date() }), PermissionAction.APPROVE);
transition(
  'reject',
  ['DRAFT', 'REVIEWED', 'APPROVED'],
  'REJECTED',
  () => ({ approvedByUserId: null, approvedAt: null }),
  PermissionAction.APPROVE
);

/** The only step that changes anybody's pay. */
payrollRevisionsRouter.post(
  '/orgs/:orgId/payroll/revisions/:id/apply',
  requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      const { revision, assignment } = await applyRevision({
        accountId,
        orgId,
        userId: req.auth!.userId,
        revisionId: String(req.params.id),
      });
      res.json({ revision: shape(revision), assignmentId: assignment.id });
    } catch (e) {
      return handle(res, e);
    }
  }
);
