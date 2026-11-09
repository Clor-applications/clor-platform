import { employeeStatusChanged } from '../services/portalSessions.js';
import { trackFirst } from '../services/productEvents.js';
import { actorFrom } from '../services/credentials.js';
import { Router } from 'express';
import { ownRecordRefusal, ownWorkRefusal } from '../services/makerChecker.js';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { levelFor, resolveAccess } from '../services/access.js';
import { pushEmployeeToReaders, readerFieldsChanged, revokeFromReaders } from '../services/attendance/readerSync.js';
import { PAYROLL_HISTORY, PAYROLL_SETUP, lockPayrollEmployee } from '../services/payroll/employeeLock.js';
import { emit as emitWebhook, employeeEvent } from '../services/attendance/webhooks.js';
import { BANK_FIELDS, BankChangeError, approveBankChange, maskNumber, rejectBankChange, routeBankUpdate } from '../services/payroll/bankChanges.js';
import { requirePayrollStepUp, stepUpIfEnrolledRefusal } from '../services/stepUp.js';
import { REGIME_LOCKED_MESSAGE, financialYearOf, regimeFixedForYear, regimeInForce } from '../services/payroll/taxDeclaration.js';
import { todayIst } from '../utils/istDate.js';
import { recordAudit } from '../services/auditTrail.js';
import { nomineesOf } from '../services/payroll/statutoryWrite.js';
import { costCentreRefusal } from '../services/payroll/accounting/references.js';
import { ownPayRefusal } from '../services/payroll/ownPay.js';

/**
 * The people payroll pays, and the payroll-specific things known about them.
 *
 * Two records, deliberately. `Employee` is the person — a name, a code, a
 * designation, when they joined — and is meant to be shared: attendance and
 * leave will attach to the same row when they arrive, which is what stops a
 * second employee list growing beside this one. `EmployeePayrollProfile` holds
 * what only payroll needs, and is where the sensitive part lives: a bank
 * account number, a PAN, the statutory identifiers.
 *
 * ## Masking is the server's job, not the screen's
 *
 * A bank account number and a PAN are the two fields payroll holds that are
 * worth stealing, and a mask applied in the browser is not a mask — the full
 * value still crossed the network and still sits in whatever logged the
 * response. So the value is truncated here, and only a caller holding the field
 * level actually receives it. Everybody else gets the last four digits, which
 * is enough to confirm an account and useless for using one.
 */
export const payrollEmployeesRouter = Router();
payrollEmployeesRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.profile;

/** The level that has to be granted before a full bank account or PAN is sent. */
const SENSITIVE_LEVEL = 1;

const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'LEFT', 'SUSPENDED'] as const;
const PAYROLL_STATUSES = ['IN_PAYROLL', 'EXCLUDED', 'ON_HOLD'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.object({
  name: z.string().trim().min(1, 'An employee needs a name.').max(120),
  code: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email('That is not an email address.').max(160).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(40).optional().nullable(),
  designation: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  dateOfJoining: z.string().trim().regex(ISO_DATE).optional().nullable().or(z.literal('')),
  dateOfLeaving: z.string().trim().regex(ISO_DATE).optional().nullable().or(z.literal('')),
  status: z.enum(EMPLOYEE_STATUSES).default('ACTIVE'),
  branchId: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),

  /* The payroll half. Optional as a block — an employee can exist before
     anybody has decided how they are paid. */
  payroll: z
    .object({
      /* Left out means unchanged, as for PF/ESI/PT below (re-review of #145, N1): a default here reset OLD to NEW on every save that omitted it. A new profile takes the column default. */
      payrollStatus: z.enum(PAYROLL_STATUSES).optional(),
      payGroupId: z.string().trim().optional().nullable(),
      costCenterId: z.string().trim().optional().nullable(),
      bankAccountName: z.string().trim().max(120).optional().nullable(),
      bankAccountNumber: z.string().trim().max(40).optional().nullable(),
      bankIfsc: z.string().trim().max(20).optional().nullable(),
      bankName: z.string().trim().max(120).optional().nullable(),
      pan: z.string().trim().max(20).optional().nullable(),
      uan: z.string().trim().max(30).optional().nullable(),
      pfNumber: z.string().trim().max(40).optional().nullable(),
      esiNumber: z.string().trim().max(40).optional().nullable(),
      taxRegime: z.enum(['OLD', 'NEW']).optional(),
      professionalTaxState: z.string().trim().max(60).optional().nullable(),
      /* Left out means unchanged: a form without the switches must not turn PF and PT off (QA of #82, F9). New profiles start off. */
      pfApplicable: z.boolean().optional(),
      esiApplicable: z.boolean().optional(),
      ptApplicable: z.boolean().optional(),
    })
    .optional(),
});

const blank = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** The last four, and a run of dots for everything before them. */
const maskTail = (value: string | null, keep = 4) => {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= keep) return '•'.repeat(s.length);
  return `${'•'.repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}`;
};

/** A PAN reads ABCDE1234F; the useful confirmation is the first and last. */
const maskPan = (value: string | null) => {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return '';
  if (s.length <= 4) return '•'.repeat(s.length);
  return `${s.slice(0, 3)}${'•'.repeat(Math.max(3, s.length - 4))}${s.slice(-1)}`;
};

/** What a caller sees in full: PAN and bank by Payroll's field level; UAN, PF and ESI numbers also with People's Full identifiers. */
type Reveal = { sensitive: boolean; ids: boolean };

const shape = (row: any, reveal: Reveal) => {
  const p = row.payroll || null;
  const revealSensitive = reveal.sensitive;
  return {
    id: row.id,
    name: row.name,
    code: row.code || '',
    email: row.email || '',
    phone: row.phone || '',
    designation: row.designation || '',
    department: row.department || '',
    dateOfJoining: row.dateOfJoining || null,
    dateOfLeaving: row.dateOfLeaving || null,
    status: row.status,
    branchId: row.branchId || null,
    notes: row.notes || '',
    payroll: p
      ? {
          payrollStatus: p.payrollStatus,
          payGroupId: p.payGroupId || null,
          costCenterId: p.costCenterId || null,
          bankAccountName: p.bankAccountName || '',
          bankName: p.bankName || '',
          bankIfsc: p.bankIfsc || '',
          /* Sent in full only to a caller holding the level; everybody else
             gets a confirmation, not a usable number. */
          bankAccountNumber: revealSensitive ? p.bankAccountNumber || '' : maskTail(p.bankAccountNumber),
          pan: revealSensitive ? p.pan || '' : maskPan(p.pan),
          bankAccountNumberMasked: !revealSensitive && Boolean(p.bankAccountNumber),
          panMasked: !revealSensitive && Boolean(p.pan),
          /* Statutory numbers are identifiers too (owner, 8 Nov 2026): a read-only role gets the tail, never the number. */
          uan: reveal.ids ? p.uan || '' : maskTail(p.uan),
          pfNumber: reveal.ids ? p.pfNumber || '' : maskTail(p.pfNumber),
          esiNumber: reveal.ids ? p.esiNumber || '' : maskTail(p.esiNumber),
          statutoryMasked: !reveal.ids && Boolean(p.uan || p.pfNumber || p.esiNumber),
          taxRegime: p.taxRegime,
          professionalTaxState: p.professionalTaxState || '',
          pfApplicable: !!p.pfApplicable,
          esiApplicable: !!p.esiApplicable,
          ptApplicable: !!p.ptApplicable,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

/** Whether this caller may see a whole bank account number and PAN, and whole UAN, PF and ESI numbers. */
async function mayRevealSensitive(req: any): Promise<Reveal> {
  const { accountId, orgId, branchId } = req.tenant!;
  const access = await resolveAccess(accountId, orgId, req.auth!.userId, branchId);
  const sensitive = levelFor(access, PAYROLL_MODULE, RESOURCE, PermissionAction.VIEW) >= SENSITIVE_LEVEL;
  return { sensitive, ids: sensitive || access.isAdmin || access.permissions.has('PEOPLE::Full Identifiers::VIEW') };
}

/** The payroll half, as it goes into the database. */
const payrollData = (p: NonNullable<z.infer<typeof bodySchema>['payroll']>) => ({
  ...(p.payrollStatus !== undefined ? { payrollStatus: p.payrollStatus } : {}),
  payGroupId: blank(p.payGroupId),
  costCenterId: blank(p.costCenterId),
  bankAccountName: blank(p.bankAccountName),
  bankAccountNumber: blank(p.bankAccountNumber),
  bankIfsc: blank(p.bankIfsc)?.toUpperCase() ?? null,
  bankName: blank(p.bankName),
  pan: blank(p.pan)?.toUpperCase() ?? null,
  uan: blank(p.uan),
  pfNumber: blank(p.pfNumber),
  esiNumber: blank(p.esiNumber),
  ...(p.taxRegime !== undefined ? { taxRegime: p.taxRegime } : {}),
  /* Same for the PT state: left out is unchanged; sent blank clears it. */
  ...(p.professionalTaxState !== undefined ? { professionalTaxState: blank(p.professionalTaxState) } : {}),
  ...(p.pfApplicable !== undefined ? { pfApplicable: p.pfApplicable } : {}),
  ...(p.esiApplicable !== undefined ? { esiApplicable: p.esiApplicable } : {}),
  ...(p.ptApplicable !== undefined ? { ptApplicable: p.ptApplicable } : {}),
});

/** Profile fields that change what is deducted from somebody's pay (ownPayRefusal on edit). */
const OWN_STATUTORY_FIELDS = ['pfApplicable', 'esiApplicable', 'ptApplicable', 'taxRegime', 'professionalTaxState', 'pan', 'payrollStatus'];
/** What a profile not yet on file holds, so sending the defaults is not a change. */
const STATUTORY_DEFAULTS: Record<string, unknown> = { pfApplicable: false, esiApplicable: false, ptApplicable: false, taxRegime: 'NEW', payrollStatus: 'IN_PAYROLL' };

payrollEmployeesRouter.get(
  '/orgs/:orgId/payroll/employees',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const reveal = await mayRevealSensitive(req);

    const search = String(req.query.q || '').trim();
    const rows = await peoplePrisma.employee.findMany({
      where: {
        accountId,
        orgId,
        ...(String(req.query.status || '').trim() ? { status: String(req.query.status) } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { code: { contains: search } },
                { email: { contains: search } },
                { designation: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      take: Math.min(500, Math.max(1, Number(req.query.limit || 200))),
    });

    /* One query for the profiles rather than one per employee: a list of four
       hundred people must not be four hundred round trips. */
    const profiles = await payrollPrisma.employeePayrollProfile.findMany({
      where: { orgId, employeeId: { in: rows.map((r) => r.id) } },
    });
    const byEmployee = new Map(profiles.map((p) => [p.employeeId, p]));

    res.json({
      employees: rows.map((r) => shape({ ...r, payroll: byEmployee.get(r.id) || null }, reveal)),
      sensitiveVisible: reveal.sensitive,
    });
  }
);

payrollEmployeesRouter.get(
  '/orgs/:orgId/payroll/employees/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const row = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!row) return res.status(404).json({ error: 'No such employee.' });
    const payroll = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId: row.id } });
    const reveal = await mayRevealSensitive(req);
    /* PF nominees (Form 2): names and shares, from the joining form or entered here. */
    res.json({ employee: shape({ ...row, payroll }, reveal), sensitiveVisible: reveal.sensitive, nominees: await nomineesOf(orgId, row.id) });
  }
);

payrollEmployeesRouter.post(
  '/orgs/:orgId/payroll/employees',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid employee.' });
    const body = parsed.data;

    if (body.dateOfLeaving && body.dateOfJoining && body.dateOfLeaving < body.dateOfJoining) {
      return res.status(400).json({ error: 'Somebody cannot leave before they joined.' });
    }

    const ccRefused = await costCentreRefusal(accountId, orgId, blank(body.payroll?.costCenterId));
    if (ccRefused) return res.status(400).json({ error: ccRefused });

    const code = blank(body.code);
    if (code) {
      const clash = await peoplePrisma.employee.findFirst({ where: { orgId, code }, select: { id: true } });
      if (clash) return res.status(409).json({ error: `An employee with the code ${code} already exists.` });
    }

    const row = await peoplePrisma.employee.create({
      data: {
        accountId,
        orgId,
        branchId: blank(body.branchId),
        name: body.name,
        code,
        email: blank(body.email),
        phone: blank(body.phone),
        designation: blank(body.designation),
        department: blank(body.department),
        dateOfJoining: blank(body.dateOfJoining),
        dateOfLeaving: blank(body.dateOfLeaving),
        status: body.status,
        notes: blank(body.notes),
        createdByUserId: req.auth!.userId,
      },
    });

    void trackFirst(orgId, req.auth!.userId, 'employee_added', { source: 'payroll', app: 'payroll' });

    const payroll = body.payroll
      ? await payrollPrisma.employeePayrollProfile.create({
          data: { accountId, orgId, employeeId: row.id, createdByUserId: req.auth!.userId, ...payrollData(body.payroll) },
        })
      : null;
    /* First details on file apply at once, and go in the history of where pay goes. */
    if (payroll && (payroll.bankAccountNumber || payroll.bankIfsc)) {
      await routeBankUpdate({ accountId, orgId, employeeId: row.id, userId: req.auth!.userId, current: null, incoming: payroll });
    }

    res.status(201).json({ employee: shape({ ...row, payroll }, await mayRevealSensitive(req)) });
    emitWebhook(orgId, 'employee.created', employeeEvent(row));
  }
);

payrollEmployeesRouter.put(
  '/orgs/:orgId/payroll/employees/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!existing) return res.status(404).json({ error: 'No such employee.' });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid employee.' });
    const body = parsed.data;

    if (body.dateOfLeaving && body.dateOfJoining && body.dateOfLeaving < body.dateOfJoining) {
      return res.status(400).json({ error: 'Somebody cannot leave before they joined.' });
    }

    /*
     * The tax regime is fixed for the year once a payslip went out on it
     * (CBDT Circular 04/2023; review of #146, 10). Here it is the profile's
     * regime, which counts only while the year has no declaration (the
     * declaration's wins). An owner or administrator may override, with a
     * reason and a fresh authenticator code where they have one.
     */
    let regimeOverride: { fy: string; from: string; to: string; reason: string } | null = null;
    if (body.payroll?.taxRegime) {
      const fy = financialYearOf(todayIst());
      const inForce = await regimeInForce(orgId, existing.id, fy);
      const declared = await payrollPrisma.taxDeclaration.count({ where: { orgId, employeeId: existing.id, financialYear: fy } });
      if (!declared && body.payroll.taxRegime !== inForce && (await regimeFixedForYear(orgId, existing.id, fy))) {
        const reason = String((req.body?.payroll as any)?.regimeOverrideReason || '').trim().slice(0, 300);
        if (!reason) return res.status(409).json({ error: REGIME_LOCKED_MESSAGE, code: 'REGIME_LOCKED' });
        if (!req.isAdmin) return res.status(403).json({ error: 'Only an owner or administrator can change the tax regime once the year has started.', code: 'ADMIN_ONLY' });
        if (reason.length < 5) return res.status(400).json({ error: 'Say in a few words why the regime changes mid-year.', code: 'NO_REASON' });
        const stepUp = await stepUpIfEnrolledRefusal(req);
        if (stepUp) return res.status(stepUp.status).json(stepUp.body);
        /* Audited once the save has gone through (re-review of #146), below. */
        regimeOverride = { fy, from: inForce, to: body.payroll.taxRegime, reason };
      }
    }

    const code = blank(body.code);
    if (code && code !== existing.code) {
      const clash = await peoplePrisma.employee.findFirst({
        where: { orgId, code, NOT: { id: existing.id } },
        select: { id: true },
      });
      if (clash) return res.status(409).json({ error: `An employee with the code ${code} already exists.` });
    }

    /*
     * Nobody switches their own PF, ESI, PT, tax regime, PAN or payroll status
     * (review of #145, S4): each one changes what is deducted from their own
     * pay. Their name or phone they may; these, somebody else does.
     */
    if (body.payroll) {
      const before = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId: existing.id } });
      const after = payrollData(body.payroll) as Record<string, unknown>;
      /* A caller shown the PAN masked sends it back masked, and it is kept as it was below. */
      const fields = (await mayRevealSensitive(req)) ? OWN_STATUTORY_FIELDS : OWN_STATUTORY_FIELDS.filter((k) => k !== 'pan');
      const changed = fields.filter((k) => k in after && after[k] !== undefined && (after[k] ?? null) !== ((before as any)?.[k] ?? STATUTORY_DEFAULTS[k] ?? null));
      if (changed.length) {
        const own = await ownPayRefusal(req, existing.id, { what: 'tax and statutory settings', does: 'change them', module: PAYROLL_MODULE, resource: RESOURCE, action: 'EDIT', entity: 'EMPLOYEE_PAYROLL_PROFILE', entityId: before?.id || existing.id });
        if (own) return res.status(own.status).json(own.body);
      }
    }

    const row = await peoplePrisma.employee.update({
      where: { id: existing.id },
      data: {
        branchId: blank(body.branchId),
        name: body.name,
        code,
        email: blank(body.email),
        phone: blank(body.phone),
        designation: blank(body.designation),
        department: blank(body.department),
        dateOfJoining: blank(body.dateOfJoining),
        dateOfLeaving: blank(body.dateOfLeaving),
        status: body.status,
        notes: blank(body.notes),
      },
    });
    /* A-33: suspended or gone, their employee-app sign-ins end. */
    await employeeStatusChanged(row, existing.status, row.status, actorFrom(req));
    /* The same reader rules as the People app: leaving ends door access; a new name or code goes to the readers. */
    if (row.status === 'LEFT' && existing.status !== 'LEFT') await revokeFromReaders(orgId, existing, req.auth!.userId);
    else if (row.status !== 'LEFT' && readerFieldsChanged(existing, row)) await pushEmployeeToReaders(orgId, row, req.auth!.userId, existing);

    let payroll = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId: row.id } });
    let bankChangePending = false;

    if (body.payroll) {
      const reveal = await mayRevealSensitive(req);
      const incoming = payrollData(body.payroll);
      const ccRefused = await costCentreRefusal(accountId, orgId, incoming.costCenterId, payroll?.costCenterId);
      if (ccRefused) return res.status(400).json({ error: ccRefused });

      /*
       * A caller who cannot see these fields cannot overwrite them either.
       *
       * They were sent the masked value, so saving the form back would write
       * "••••4821" into the account number and quietly destroy it. The stored
       * value is kept instead of whatever came back.
       */
      if (!reveal.sensitive) {
        incoming.bankAccountNumber = payroll?.bankAccountNumber ?? null;
        incoming.pan = payroll?.pan ?? null;
      }
      /* Nor do UAN, PF and ESI numbers sent back masked overwrite the real ones; a number typed in full is taken. */
      if (!reveal.ids) {
        for (const k of ['uan', 'pfNumber', 'esiNumber'] as const) {
          if (String(incoming[k] ?? '').includes('•') || (incoming[k] ?? null) === (maskTail(payroll?.[k] ?? null) || null)) incoming[k] = payroll?.[k] ?? null;
        }
      }

      /*
       * Where pay goes is not changed by a save: a change to bank details
       * already on file waits for approval (services/payroll/bankChanges.ts).
       * IFSC and bank name included — they redirect pay as surely as the number.
       */
      const bank = Object.fromEntries(BANK_FIELDS.map((k) => [k, (incoming as any)[k]]));
      for (const k of BANK_FIELDS) delete (incoming as any)[k];
      const routed = await routeBankUpdate({ accountId, orgId, employeeId: row.id, userId: req.auth!.userId, current: payroll, incoming: bank });
      Object.assign(incoming, routed.apply);
      bankChangePending = Boolean(routed.pending);

      payroll = payroll
        ? await payrollPrisma.employeePayrollProfile.update({ where: { id: payroll.id }, data: incoming })
        : await payrollPrisma.employeePayrollProfile.create({
            data: { accountId, orgId, employeeId: row.id, createdByUserId: req.auth!.userId, ...incoming },
          });
    }

    if (regimeOverride) {
      /*
       * A year with payslips keeps the regime its first payslip went out on
       * (yearRegimes), not the profile's; so the override is written as that
       * year's declaration regime, which the payroll reads first.
       */
      await payrollPrisma.taxDeclaration.upsert({
        where: { orgId_employeeId_financialYear: { orgId, employeeId: existing.id, financialYear: regimeOverride.fy } },
        create: { accountId, orgId, employeeId: existing.id, financialYear: regimeOverride.fy, regime: regimeOverride.to, updatedByUserId: req.auth!.userId },
        update: { regime: regimeOverride.to, updatedByUserId: req.auth!.userId },
      });
      await recordAudit(req, {
        entity: 'EMPLOYEE_PAYROLL_PROFILE',
        entityId: existing.id,
        action: 'REGIME_OVERRIDE',
        message: `Changed ${existing.name}’s tax regime for ${regimeOverride.fy} from ${regimeOverride.from} to ${regimeOverride.to} after payslips went out: ${regimeOverride.reason}`,
        metadata: { employeeId: existing.id, financialYear: regimeOverride.fy, from: regimeOverride.from, to: regimeOverride.to, reason: regimeOverride.reason },
      });
    }

    res.json({ employee: shape({ ...row, payroll }, await mayRevealSensitive(req)), bankChangePending });
    emitWebhook(orgId, row.status === 'LEFT' && existing.status !== 'LEFT' ? 'employee.left' : 'employee.updated', employeeEvent(row));
  }
);

/* ---------------------------------------------------------------- bank changes */

const APPROVE_BANK = requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, PAYROLL_RESOURCE.runs);
const bankError = (res: any, e: unknown) => {
  if (e instanceof BankChangeError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

/** Bank detail changes: waiting ones by default, or the history (`?status=ALL`, `?employeeId=`). */
payrollEmployeesRouter.get('/orgs/:orgId/payroll/bank-changes', requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE), async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const status = String(req.query.status || 'PENDING');
  const employeeId = req.query.employeeId ? String(req.query.employeeId) : undefined;
  const rows = await payrollPrisma.bankDetailChange.findMany({
    where: { accountId, orgId, ...(status === 'ALL' ? {} : { status }), ...(employeeId ? { employeeId } : {}) },
    orderBy: { requestedAt: 'desc' },
    take: 200,
  });
  const people = new Map(
    (await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true } })).map((p) => [p.id, p])
  );
  /* Account numbers by their last four only, here: the list is for deciding, not for copying. */
  res.json({
    changes: rows.map(({ oldAccountNumber, newAccountNumber, ...r }) => ({
      ...r,
      oldAccount: maskNumber(oldAccountNumber),
      newAccount: maskNumber(newAccountNumber),
      employeeName: people.get(r.employeeId)?.name || null,
      employeeCode: people.get(r.employeeId)?.code || null,
      mine: r.requestedByUserId === req.auth!.userId,
    })),
  });
});

payrollEmployeesRouter.post('/orgs/:orgId/payroll/bank-changes/:id/approve', APPROVE_BANK, requirePayrollStepUp, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  /*
   * A-13: never where your own pay goes; and the person who entered a change
   * approves it only as the company's maker-checker setting allows (and, as
   * before, not within 24 hours — approveBankChange).
   */
  const pending = await payrollPrisma.bankDetailChange.findFirst({ where: { orgId: req.tenant!.orgId, id: String(req.params.id) }, select: { id: true, employeeId: true, requestedByUserId: true } });
  if (pending) {
    const refused =
      (await ownRecordRefusal(req, pending.employeeId, 'bank account')) ||
      (await ownWorkRefusal(req, { makers: [pending.requestedByUserId], module: PAYROLL_MODULE, resource: PAYROLL_RESOURCE.runs, entity: 'PAYROLL_BANK_CHANGE', entityId: pending.id, what: 'bank change' }));
    if (refused) return res.status(refused.status).json(refused.body);
  }
  try {
    const change = await approveBankChange(req.tenant!.orgId, String(req.params.id), req.auth!.userId);
    res.json({ change: { id: change.id, status: change.status } });
  } catch (e) {
    return bankError(res, e);
  }
});

payrollEmployeesRouter.post('/orgs/:orgId/payroll/bank-changes/:id/reject', APPROVE_BANK, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  try {
    const change = await rejectBankChange(req.tenant!.orgId, String(req.params.id), req.auth!.userId, req.body?.note ? String(req.body.note) : null);
    res.json({ change: { id: change.id, status: change.status } });
  } catch (e) {
    return bankError(res, e);
  }
});

payrollEmployeesRouter.delete(
  '/orgs/:orgId/payroll/employees/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.DELETE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!existing) return res.status(404).json({ error: 'No such employee.' });

    /*
     * Somebody with payroll history is a permanent record. Marking them as
     * left is what ending employment means; deleting them would take that
     * history with them — or, as it did (A-39), leave eleven payroll tables
     * pointing at nobody, since only payslips and assignments were checked.
     *
     * The check, removing their payroll setup and deleting them happen under
     * one lock on this person (services/payroll/employeeLock.ts), which every
     * writer of their payroll records also takes: nothing can be added for
     * them between the check and the delete.
     */
    const refused = await payrollPrisma.$transaction(async (tx: any) => {
      await lockPayrollEmployee(tx, existing.id);
      for (const [model, what] of PAYROLL_HISTORY) {
        if (await tx[model].count({ where: { orgId, employeeId: existing.id } })) return what;
      }
      for (const model of PAYROLL_SETUP) await tx[model].deleteMany({ where: { orgId, employeeId: existing.id } });
      /* Off the readers first, or the next read of a reader brings them back as a new employee. */
      await revokeFromReaders(orgId, existing, req.auth!.userId);
      /* Still holding the lock: a writer waiting on it finds them gone. If this fails, their setup comes back. */
      await peoplePrisma.employee.delete({ where: { id: existing.id } });
      return null;
    }, { timeout: 30_000 });
    if (refused) {
      return res.status(409).json({
        error: `This employee has ${refused}, so the record cannot be deleted. Set them to Left instead.`,
        code: 'EMPLOYEE_IN_USE',
      });
    }
    res.json({ ok: true });
  }
);
