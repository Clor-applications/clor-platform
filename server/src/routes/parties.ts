import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { validateGstinOrThrow } from '../utils/gstin.js';
import { allowsEntity, resolveUserPermissions } from '../services/access.js';

/**
 * Customers and vendors.
 *
 * Both live in one `Party` table: in practice the same business is often both,
 * and splitting them duplicates every GSTIN, address and contact rule.
 * `partyType` decides which lists it appears in.
 */
export const partiesRouter = Router();
partiesRouter.use(requireAuth, requireTenantContext);

/** Routes are declared per party type so permissions stay legible. */
const RESOURCE = { CUSTOMER: 'Customers', VENDOR: 'Vendors' } as const;
type PartyKind = keyof typeof RESOURCE;

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const addressFields = {
  billingLine1: z.string().max(250).optional().nullable(),
  billingLine2: z.string().max(250).optional().nullable(),
  billingCity: z.string().max(100).optional().nullable(),
  billingState: z.string().max(100).optional().nullable(),
  billingPincode: z.string().max(12).optional().nullable(),
  billingCountry: z.string().max(100).optional().nullable(),
  billingDistrict: z.string().max(100).optional().nullable(),
  shippingSameAsBilling: z.boolean().optional(),
  shippingLine1: z.string().max(250).optional().nullable(),
  shippingLine2: z.string().max(250).optional().nullable(),
  shippingCity: z.string().max(100).optional().nullable(),
  shippingState: z.string().max(100).optional().nullable(),
  shippingPincode: z.string().max(12).optional().nullable(),
  shippingCountry: z.string().max(100).optional().nullable(),
  shippingDistrict: z.string().max(100).optional().nullable(),

  /*
   * Everything past billing and shipping, and the people at the party. Sent as
   * whole lists rather than as add/remove calls: the form edits them together
   * and saves once, so a partial save is a state the user never asked for.
   */
  extraAddresses: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        line1: z.string().max(250).optional().nullable(),
        line2: z.string().max(250).optional().nullable(),
        city: z.string().max(100).optional().nullable(),
        district: z.string().max(100).optional().nullable(),
        state: z.string().max(100).optional().nullable(),
        pincode: z.string().max(12).optional().nullable(),
        country: z.string().max(100).optional().nullable(),
      })
    )
    .max(30)
    .optional(),
  contacts: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        position: z.string().max(80).optional().nullable(),
        email: z.string().max(200).optional().nullable(),
        mobile: z.string().max(30).optional().nullable(),
        isPrimary: z.boolean().optional(),
      })
    )
    .max(30)
    .optional(),
};

const partySchema = z.object({
  code: z.string().max(40).optional().nullable(),
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).optional().nullable(),
  gstin: z.string().max(15).optional().nullable(),
  gstRegistrationType: z.enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED']).optional(),
  pan: z.string().max(10).optional().nullable(),
  placeOfSupplyState: z.string().max(100).optional().nullable(),
  email: z.string().email().max(200).optional().nullable().or(z.literal('')),
  phone: z.string().max(30).optional().nullable(),
  contactPerson: z.string().max(120).optional().nullable(),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  paymentTermName: z.string().max(60).optional().nullable(),
  creditLimit: z.number().nonnegative().optional().nullable(),
  openingBalance: z.number().optional(),
  openingBalanceType: z.enum(['DR', 'CR']).optional(),
  notes: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  partyGroup: z.string().max(80).optional().nullable(),
  currency: z.string().max(3).optional().nullable(),
  priceListId: z.string().max(60).optional().nullable(),
  msmeNumber: z.string().max(40).optional().nullable(),
  statutoryOther: z.string().max(200).optional().nullable(),
  alsoOtherType: z.boolean().optional(),
  ...addressFields,
});

/*
 * A code the user did not supply. Sequential per org and party type, so two
 * customers created on the same day do not collide and the number means
 * something to a human reading a statement. Not a NumberSeries: a party code is
 * an identifier, not a document number, and it must never consume from the same
 * counter a GST return is reconciled against.
 */
/*
 * The code format, which the business sets rather than inherits.
 *
 * `prefix` and `padding` come from the org's party-code settings; the defaults
 * are CUS-0001 and VEN-0001. Deliberately NOT a NumberSeries: a party code
 * identifies a record, and it must never draw from the counter a GST return is
 * reconciled against.
 */
async function nextPartyCode(accountId: string, orgId: string, kind: string) {
  const start = kind === 'VENDOR' ? 600000 : 200000;
  const end = kind === 'VENDOR' ? 999999 : 599999;

  /*
   * The highest code in this range, not every code in the org.
   *
   * The first version read the whole party table and built a Set to find the
   * first unused number. That is one row read per customer the business has
   * ever had, every time somebody adds one — the slowest request is the one
   * their best year produces — and listsAreBounded refused it for exactly that
   * reason. A `take` would have quietened the test and broken the function: a
   * truncated set makes a used code look free, and the next insert dies on the
   * unique index.
   *
   * So the database answers the question instead of handing over the data. One
   * row, ordered, bounded by the index.
   *
   * It does mean a deleted party's code is not handed out again. That is worth
   * having rather than working around: a code that meant one customer in March
   * and another in June makes every statement printed between them ambiguous.
   */
  const highest = await prisma.party.findFirst({
    where: { accountId, orgId, code: { gte: String(start), lte: String(end) } },
    select: { code: true },
    orderBy: { code: 'desc' },
  });

  const last = Number(highest?.code);
  const next = Number.isFinite(last) && last >= start ? last + 1 : start;
  if (next > end) {
    throw new Error(`No ${kind === 'VENDOR' ? 'vendor' : 'customer'} codes remain in the configured range`);
  }
  return String(next);
}

const validPartyCode = (kind: PartyKind, code: string) =>
  kind === 'VENDOR' ? /^[6-9]\d{5}$/.test(code) : /^[2-5]\d{5}$/.test(code);

/** The scalar columns added for the customer master. */
const extraScalars = (body: any) => ({
  billingDistrict: body.billingDistrict ?? null,
  shippingDistrict: body.shippingDistrict ?? null,
  partyGroup: body.partyGroup ?? null,
  currency: body.currency ? String(body.currency).toUpperCase() : null,
  priceListId: body.priceListId ?? null,
  msmeNumber: body.msmeNumber ?? null,
  statutoryOther: body.statutoryOther ?? null,
});

/*
 * Child rows are replaced wholesale, inside the caller's transaction. The form
 * edits the whole list and saves once, so reconciling row by row would invent a
 * half-saved state the user never asked for.
 */
async function replaceChildren(
  tx: any,
  ctx: { accountId: string; orgId: string; partyId: string },
  body: any
) {
  if (Array.isArray(body.extraAddresses)) {
    await tx.partyAddress.deleteMany({ where: { partyId: ctx.partyId } });
    await tx.partyAddress.createMany({
      data: body.extraAddresses.map((a: any, i: number) => ({
        ...ctx,
        label: a.label,
        line1: a.line1 ?? null,
        line2: a.line2 ?? null,
        city: a.city ?? null,
        district: a.district ?? null,
        state: a.state ?? null,
        pincode: a.pincode ?? null,
        country: a.country ?? 'India',
        sortOrder: i,
      })),
    });
  }
  if (Array.isArray(body.contacts)) {
    await tx.partyContact.deleteMany({ where: { partyId: ctx.partyId } });
    await tx.partyContact.createMany({
      data: body.contacts.map((c: any, i: number) => ({
        ...ctx,
        name: c.name,
        position: c.position ?? null,
        email: c.email ?? null,
        mobile: c.mobile ?? null,
        isPrimary: Boolean(c.isPrimary) || i === 0,
        sortOrder: i,
      })),
    });
  }
}

const toDecimal = (v: number | null | undefined) =>
  v === null || v === undefined ? null : new Prisma.Decimal(Number(v).toFixed(2));

/*
 * Billing and shipping live as columns and everything else lives in
 * PartyAddress, but the form should not have to know that. `addresses` is the
 * single list it reads, with the two built-in places first and named the way
 * the customer master names them.
 */
const unifiedAddresses = (row: any) => [
  {
    key: 'BILLING',
    label: 'Billing',
    builtIn: true,
    line1: row.billingLine1 ?? '',
    line2: row.billingLine2 ?? '',
    city: row.billingCity ?? '',
    district: row.billingDistrict ?? '',
    state: row.billingState ?? '',
    pincode: row.billingPincode ?? '',
    country: row.billingCountry ?? 'India',
  },
  {
    key: 'SHIPPING',
    label: 'Shipping',
    builtIn: true,
    sameAsBilling: row.shippingSameAsBilling !== false,
    line1: row.shippingLine1 ?? '',
    line2: row.shippingLine2 ?? '',
    city: row.shippingCity ?? '',
    district: row.shippingDistrict ?? '',
    state: row.shippingState ?? '',
    pincode: row.shippingPincode ?? '',
    country: row.shippingCountry ?? '',
  },
  ...(row.addresses || []).map((a: any) => ({
    key: a.id,
    label: a.label,
    builtIn: false,
    line1: a.line1 ?? '',
    line2: a.line2 ?? '',
    city: a.city ?? '',
    district: a.district ?? '',
    state: a.state ?? '',
    pincode: a.pincode ?? '',
    country: a.country ?? 'India',
  })),
];

const normalize = (row: any) => ({
  ...row,
  creditLimit: row.creditLimit === null ? null : Number(row.creditLimit),
  openingBalance: Number(row.openingBalance ?? 0),
  addresses: unifiedAddresses(row),
  contacts: row.contacts || [],
});

/** Both list and single reads honour document restrictions. */
async function assertAllowed(req: any, kind: PartyKind, partyId?: string | null) {
  const restrictions = await resolveUserPermissions(req.tenant.accountId, req.tenant.orgId, req.auth.userId);
  return allowsEntity(restrictions, kind, partyId);
}

function register(kind: PartyKind, basePath: string) {
  const resource = RESOURCE[kind];
  const VIEW = requirePermission('MASTERS', PermissionAction.VIEW, resource);
  const CREATE = requirePermission('MASTERS', PermissionAction.CREATE, resource);
  const EDIT = requirePermission('MASTERS', PermissionAction.EDIT, resource);
  const DELETE = requirePermission('MASTERS', PermissionAction.DELETE, resource);

  // A party of type BOTH belongs in both lists.
  const typeFilter = { partyType: { in: [kind, 'BOTH'] } };

  partiesRouter.get(`/orgs/:orgId/${basePath}`, VIEW, async (req, res) => {
    if (!orgOk(req, res)) return;
    const { accountId, orgId } = req.tenant!;
    const search = String(req.query.search || '').trim();
    const take = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    const rows = await prisma.party.findMany({
      where: {
        accountId,
        orgId,
        ...typeFilter,
        ...(String(req.query.includeInactive || '') === 'true' ? {} : { isActive: true }),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { code: { contains: search } },
                { gstin: { contains: search } },
                { phone: { contains: search } },
                { email: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take,
    });

    // Restricted users see only the parties they are permitted to.
    const restrictions = await resolveUserPermissions(accountId, orgId, req.auth!.userId);
    const visible = rows.filter((r) => allowsEntity(restrictions, kind, r.id));

    res.json({ [basePath]: visible.map(normalize) });
  });

  partiesRouter.get(`/orgs/:orgId/${basePath}/:partyId`, VIEW, async (req, res) => {
    if (!orgOk(req, res)) return;
    const { accountId, orgId } = req.tenant!;
    const row = await prisma.party.findFirst({
      where: { id: String(req.params.partyId), accountId, orgId, ...typeFilter },
      include: { addresses: { orderBy: { sortOrder: 'asc' } }, contacts: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!row) return res.status(404).json({ error: `${kind === 'CUSTOMER' ? 'Customer' : 'Vendor'} not found` });
    if (!(await assertAllowed(req, kind, row.id))) {
      return res.status(403).json({ error: 'You are not permitted to view this record' });
    }
    res.json({ party: normalize(row) });
  });

  partiesRouter.post(`/orgs/:orgId/${basePath}`, CREATE, async (req, res) => {
    if (!orgOk(req, res)) return;
    const { accountId, orgId } = req.tenant!;
    const body = partySchema.parse(req.body);
    const requestedCode = String(body.code || '').trim();
    if (requestedCode && !validPartyCode(kind, requestedCode)) {
      return res.status(400).json({
        error: kind === 'VENDOR'
          ? 'Vendor code must be 6 digits and start with 6, 7, 8, or 9'
          : 'Customer code must be 6 digits and start with 2, 3, 4, or 5',
      });
    }
    const partyCode = requestedCode || (await nextPartyCode(accountId, orgId, kind));
    const duplicateCode = await prisma.party.findFirst({ where: { accountId, orgId, code: partyCode }, select: { id: true } });
    if (duplicateCode) return res.status(409).json({ error: `Party code ${partyCode} is already in use` });

    if (body.gstin) {
      // Throws a 400-shaped error when the checksum or state code is wrong.
      validateGstinOrThrow(body.gstin, body.billingState || body.placeOfSupplyState || '');
    }

    const partyType = body.alsoOtherType ? 'BOTH' : kind;

    try {
      const created = await prisma.party.create({
        data: {
          accountId,
          orgId,
          partyType,
          /*
           * Nothing is allotted when the feature is off. A code the business
           * does not use is still a column somebody has to explain later.
           */
          code: partyCode,
          name: body.name.trim(),
          legalName: body.legalName ?? null,
          gstin: body.gstin ? body.gstin.trim().toUpperCase() : null,
          gstRegistrationType: body.gstRegistrationType || (body.gstin ? 'REGULAR' : 'UNREGISTERED'),
          pan: body.pan ?? null,
          placeOfSupplyState: body.placeOfSupplyState ?? body.billingState ?? null,
          email: body.email ? String(body.email) : null,
          phone: body.phone ?? null,
          contactPerson: body.contactPerson ?? null,
          paymentTermDays: body.paymentTermDays ?? 0,
          paymentTermName: body.paymentTermName ?? null,
          creditLimit: toDecimal(body.creditLimit ?? null),
          openingBalance: new Prisma.Decimal(Number(body.openingBalance ?? 0).toFixed(2)),
          openingBalanceType: body.openingBalanceType || 'DR',
          notes: body.notes ?? null,
          isActive: body.isActive ?? true,
          billingLine1: body.billingLine1 ?? null,
          billingLine2: body.billingLine2 ?? null,
          billingCity: body.billingCity ?? null,
          billingState: body.billingState ?? null,
          billingPincode: body.billingPincode ?? null,
          billingCountry: body.billingCountry ?? 'India',
          shippingSameAsBilling: body.shippingSameAsBilling ?? true,
          shippingLine1: body.shippingLine1 ?? null,
          shippingLine2: body.shippingLine2 ?? null,
          shippingCity: body.shippingCity ?? null,
          shippingState: body.shippingState ?? null,
          shippingPincode: body.shippingPincode ?? null,
          shippingCountry: body.shippingCountry ?? null,
          ...extraScalars(body),
          createdByUserId: req.auth!.userId,
        },
      });
      await replaceChildren(prisma, { accountId, orgId, partyId: created.id }, body);
      const full = await prisma.party.findUnique({
        where: { id: created.id },
        include: { addresses: { orderBy: { sortOrder: 'asc' } }, contacts: { orderBy: { sortOrder: 'asc' } } },
      });
      res.status(201).json({ party: normalize(full) });
    } catch (err: any) {
      if (String(err?.code || '') === 'P2002') {
        return res.status(409).json({ error: 'A record with that name already exists' });
      }
      throw err;
    }
  });

  partiesRouter.patch(`/orgs/:orgId/${basePath}/:partyId`, EDIT, async (req, res) => {
    if (!orgOk(req, res)) return;
    const { accountId, orgId } = req.tenant!;
    const existing = await prisma.party.findFirst({
      where: { id: String(req.params.partyId), accountId, orgId, ...typeFilter },
    });
    if (!existing) return res.status(404).json({ error: 'Record not found' });
    if (!(await assertAllowed(req, kind, existing.id))) {
      return res.status(403).json({ error: 'You are not permitted to edit this record' });
    }

    const body = partySchema.partial().parse(req.body);
    if (body.code != null && !validPartyCode(kind, String(body.code).trim())) {
      return res.status(400).json({
        error: kind === 'VENDOR'
          ? 'Vendor code must be 6 digits and start with 6, 7, 8, or 9'
          : 'Customer code must be 6 digits and start with 2, 3, 4, or 5',
      });
    }
    if (body.code != null) {
      const code = String(body.code).trim();
      const duplicateCode = await prisma.party.findFirst({
        where: { accountId, orgId, code, id: { not: existing.id } },
        select: { id: true },
      });
      if (duplicateCode) return res.status(409).json({ error: `Party code ${code} is already in use` });
    }
    if (body.gstin) {
      validateGstinOrThrow(body.gstin, body.billingState || existing.billingState || '');
    }

    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      // The child lists are rows, not columns; they are written below.
      if (v === undefined || k === 'alsoOtherType' || k === 'extraAddresses' || k === 'contacts') continue;
      if (k === 'creditLimit') data[k] = toDecimal(v as number);
      else if (k === 'openingBalance') data[k] = new Prisma.Decimal(Number(v).toFixed(2));
      else if (k === 'gstin') data[k] = v ? String(v).trim().toUpperCase() : null;
      else if (k === 'name') data[k] = String(v).trim();
      else data[k] = v;
    }
    if (body.alsoOtherType === true) data.partyType = 'BOTH';
    if (body.alsoOtherType === false && existing.partyType === 'BOTH') data.partyType = kind;

    try {
      await prisma.party.update({ where: { id: existing.id }, data });
      await replaceChildren(prisma, { accountId, orgId, partyId: existing.id }, body);
      const updated = await prisma.party.findUnique({
        where: { id: existing.id },
        include: { addresses: { orderBy: { sortOrder: 'asc' } }, contacts: { orderBy: { sortOrder: 'asc' } } },
      });
      res.json({ party: normalize(updated) });
    } catch (err: any) {
      if (String(err?.code || '') === 'P2002') {
        return res.status(409).json({ error: 'A record with that name already exists' });
      }
      throw err;
    }
  });

  /**
   * Soft delete. A party referenced by a posted document must not vanish, or
   * historical invoices lose the name they were issued to.
   */
  partiesRouter.delete(`/orgs/:orgId/${basePath}/:partyId`, DELETE, async (req, res) => {
    if (!orgOk(req, res)) return;
    const { accountId, orgId } = req.tenant!;
    const existing = await prisma.party.findFirst({
      where: { id: String(req.params.partyId), accountId, orgId, ...typeFilter },
    });
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    // Prisma's own count rather than raw SQL: the `?` placeholder is SQLite's
    // and would have to change for Postgres, and there is nothing here Prisma
    // cannot express.
    const inUse =
      (await prisma.invoice.count({ where: { accountId, orgId, customerId: existing.id } })) > 0;

    if (inUse) {
      const deactivated = await prisma.party.update({
        where: { id: existing.id },
        data: { isActive: false },
      });
      return res.json({ ok: true, deactivated: true, party: normalize(deactivated) });
    }

    await prisma.party.delete({ where: { id: existing.id } });
    res.json({ ok: true, deactivated: false });
  });
}

register('CUSTOMER', 'customers');
register('VENDOR', 'vendors');

/**
 * Due date from the party's terms, computed on the server so the browser
 * cannot quietly extend credit.
 */
export function dueDateFor(dateIso: string, paymentTermDays: number) {
  const base = new Date(`${String(dateIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + Math.max(0, Number(paymentTermDays) || 0));
  return base.toISOString().slice(0, 10);
}
