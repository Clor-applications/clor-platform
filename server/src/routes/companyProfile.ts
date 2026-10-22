import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { recordAudit } from '../services/auditTrail.js';

/**
 * Company details (People → Settings → Company): who the employer is, as
 * statutory forms and letters need it — legal name, PAN, TAN, CIN, the
 * registered address, and the registrations HR and payroll quote (EPF
 * establishment code, ESIC employer code, Professional Tax and Labour Welfare
 * Fund registrations). Kept in the company's profile beside what setup
 * stored; GSTIN and state are shown but not changed here, because Accounting
 * works out tax from the head-office branch.
 */
export const companyProfileRouter = Router();
const path = '/orgs/:orgId/company-profile';
companyProfileRouter.use(path, requireAuth, requireTenantContext);

const t = (max: number) => z.string().trim().max(max).optional().nullable();
const profileSchema = z.object({
  legalName: z.string().trim().min(1, 'The legal name is needed.').max(200),
  pan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, 'PAN is five letters, four digits and a letter.').optional().nullable(),
  tan: z.string().trim().toUpperCase().regex(/^([A-Z]{4}[0-9]{5}[A-Z])?$/, 'TAN is four letters, five digits and a letter.').optional().nullable(),
  cin: t(30),
  addressLine: t(300),
  city: t(80),
  pincode: z.string().trim().regex(/^(\d{6})?$/, 'PIN code is six digits.').optional().nullable(),
  phone: t(30),
  email: z.string().trim().email('Check the email.').max(160).optional().nullable().or(z.literal('')),
  website: t(200),
  industry: t(120),
  epfCode: t(40),
  esicCode: t(40),
  ptRegistration: t(60),
  lwfRegistration: t(60),
});
const FIELDS = ['cin', 'addressLine', 'city', 'pincode', 'phone', 'email', 'website', 'industry', 'epfCode', 'esicCode', 'ptRegistration', 'lwfRegistration', 'tan'] as const;

const parse = (raw: string | null | undefined) => {
  try {
    const p = JSON.parse(String(raw || '{}'));
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
};
const shape = (org: { name: string; legalName: string | null; pan: string | null; profileJson: string | null; code: string | null }) => {
  const p = parse(org.profileJson);
  return {
    name: org.name,
    code: org.code,
    legalName: org.legalName || org.name,
    pan: org.pan || '',
    ...Object.fromEntries(FIELDS.map((k) => [k, p[k] || ''])),
    state: p.state || '',
    gstin: p.gstin || '',
  };
};
const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};
const select = { name: true, legalName: true, pan: true, profileJson: true, code: true } as const;

companyProfileRouter.get(path, requirePermission('SETTINGS', PermissionAction.VIEW, 'Company Profile'), async (req, res) => {
  if (!orgOk(req, res)) return;
  const org = await platformPrisma.org.findUnique({ where: { id: req.tenant!.orgId }, select });
  if (!org) return res.status(404).json({ error: 'No such company.' });
  res.json({ company: shape(org) });
});

companyProfileRouter.put(path, requirePermission('SETTINGS', PermissionAction.EDIT, 'Company Profile'), async (req, res) => {
  if (!orgOk(req, res)) return;
  const parsed = profileSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const org = await platformPrisma.org.findUnique({ where: { id: req.tenant!.orgId }, select });
  if (!org) return res.status(404).json({ error: 'No such company.' });
  const b = parsed.data;
  const profile = { ...parse(org.profileJson), ...Object.fromEntries(FIELDS.map((k) => [k, (b as any)[k] ? String((b as any)[k]) : null])) };
  const updated = await platformPrisma.org.update({
    where: { id: req.tenant!.orgId },
    data: { legalName: b.legalName, pan: b.pan || null, profileJson: JSON.stringify(profile) },
    select,
  });
  await recordAudit(req, { entity: 'Company', entityId: req.tenant!.orgId, action: 'UPDATE', message: 'Changed company details', metadata: { fields: Object.keys(b) } });
  res.json({ company: shape(updated) });
});

export default companyProfileRouter;
