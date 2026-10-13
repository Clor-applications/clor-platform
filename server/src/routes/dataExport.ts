import { Router } from 'express';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';

/**
 * A company's own books and its own settings, in files its owner can keep.
 *
 * Two scopes, because they are two different things with two different uses.
 *
 * **Data** is what the business did: parties, documents, payments, the ledger.
 * It is large, it only grows, and restoring it into a company that already has
 * some is genuinely hard.
 *
 * **Configuration** is how the company is set up: branches, the chart of
 * accounts, numbering series, roles and permissions, tax rates, approval rules,
 * the reference lists. It is small, it changes rarely, and it is the thing you
 * want when somebody has broken the invoice numbering, or when a practice is
 * setting up its eleventh client company the way it set up the tenth.
 *
 * Asking for both in one file would mean a config restore had to carry a year
 * of invoices with it, which is why they are separate.
 *
 * Not the same thing as the server backup, and the difference matters. The
 * SQLite backup is an operator's tool: it is the whole multi-tenant database,
 * every customer's books in one file, and no customer should ever be handed
 * one. This is the other thing — one company's own data, for the people whose
 * data it is.
 *
 * Which is also why it is worth having beyond convenience: a customer who
 * cannot get their books out is a customer who is locked in, and under the DPDP
 * Act a data principal is entitled to their data in a portable form.
 *
 * bounded-file: every read here is deliberately unbounded.
 *
 * This is the company's own copy of its own books, so a page of it would be the
 * wrong answer rather than a partial one — a backup missing the invoices after
 * row 500 is not a backup. The limit that matters here is not a row count, it
 * is the org filter on every query below.
 *
 * Scoped to the active org throughout. The one defect that would matter here is
 * one company's export containing another's, so every query is filtered by
 * account and org, and a test asserts a second company's rows never appear.
 */
export const dataExportRouter = Router();
dataExportRouter.use(requireAuth, requireTenantContext);

/*
 * Gated on Company Profile rather than on a document permission. Taking a copy
 * of everything the company holds is an owner's act, not a clerk's — somebody
 * who may raise invoices should not thereby be able to walk out with the
 * customer list.
 */
const EXPORT = requirePermission('SETTINGS', PermissionAction.EXPORT, 'Company data');

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Decimal columns come back as objects; a file should hold numbers. */
const plain = (rows: any[]): any[] =>
  rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v && typeof v === 'object' && typeof (v as any).toFixed === 'function') out[k] = num(v);
      else if (v instanceof Date) out[k] = v.toISOString();
      else out[k] = v;
    }
    return out;
  });

dataExportRouter.get('/orgs/:orgId/export', EXPORT, async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    return res.status(403).json({ error: 'orgId mismatch' });
  }
  const { accountId, orgId } = req.tenant!;
  const scope = { accountId, orgId };

  /*
   * `data`, `configuration`, or both. Defaulting to both keeps the plain
   * /export URL meaning what it did before this was split.
   */
  const asked = String(req.query.scope || 'all').toLowerCase();
  const wantData = asked === 'all' || asked === 'data';
  const wantConfiguration = asked === 'all' || asked === 'configuration';
  if (!wantData && !wantConfiguration) {
    return res.status(400).json({ error: "scope must be 'data', 'configuration' or 'all'" });
  }

  const org = await platformPrisma.org.findFirst({
    where: { id: orgId, accountId },
    select: { id: true, name: true, slug: true, profileJson: true },
  });
  if (!org) return res.status(404).json({ error: 'Company not found' });

  /*
   * Secrets are stripped, not exported.
   *
   * The email and e-invoice settings carry encrypted passwords and client
   * secrets. Configuration is meant to be readable, copied between companies
   * and stored where a customer keeps files — none of which is anywhere a
   * credential should be, even an encrypted one.
   */
  const SECRET_FIELDS = ['passwordEnc', 'clientSecretEnc', 'publicKeyPem'];
  const withoutSecrets = (rows: any[]) =>
    rows.map((r) => {
      const out: Record<string, unknown> = { ...r };
      for (const f of SECRET_FIELDS) delete out[f];
      return out;
    });

  const data: Record<string, any[]> = {};
  const configuration: Record<string, any[]> = {};

  if (wantData) {
    const [
      parties, partyAddresses, partyContacts, items,
      invoices, bills, estimates, salesOrders, purchaseOrders, deliveryChallans,
      creditNotes, debitNotes, expenses, payments, paymentAllocations,
      journals, journalEntries, journalLines, salesmen, fixedAssets, bankBook, posDayCloses,
    ] = await Promise.all([
      prisma.party.findMany({ where: scope }),
      prisma.partyAddress.findMany({ where: scope }),
      prisma.partyContact.findMany({ where: scope }),
      prisma.itemMaster.findMany({ where: scope }),
      prisma.invoice.findMany({ where: scope }),
      prisma.bill.findMany({ where: scope }),
      prisma.estimate.findMany({ where: scope }),
      prisma.salesOrderDoc.findMany({ where: scope }),
      prisma.purchaseOrderDoc.findMany({ where: scope }),
      prisma.deliveryChallan.findMany({ where: scope }),
      prisma.creditNote.findMany({ where: scope }),
      prisma.debitNote.findMany({ where: scope }),
      prisma.expense.findMany({ where: scope }),
      prisma.payment.findMany({ where: scope }),
      prisma.paymentAllocation.findMany({ where: scope }),
      prisma.journal.findMany({ where: scope }),
      prisma.journalEntry.findMany({ where: scope }),
      prisma.journalLine.findMany({ where: { entry: scope } }),
      prisma.salesman.findMany({ where: scope }),
      prisma.fixedAsset.findMany({ where: scope }),
      prisma.bankBookEntry.findMany({ where: scope }),
      // The till counts. A backup that leaves out the cash controls is not a
      // backup of the business's books.
      prisma.posDayClose.findMany({ where: scope }),
    ]);
    Object.assign(data, {
      parties, partyAddresses, partyContacts, items,
      invoices, bills, estimates, salesOrders, purchaseOrders, deliveryChallans,
      creditNotes, debitNotes, expenses, payments, paymentAllocations,
      journals, journalEntries, journalLines, salesmen, fixedAssets, bankBook, posDayCloses,
    });
  }

  if (wantConfiguration) {
    const [
      branches, warehouses, ledgerAccounts, masters, numberSeries,
      roles, rolePermissions, featureSettings, approvalRules,
      fiscalYears, emailSettings, einvoiceSettings, recurring,
    ] = await Promise.all([
      platformPrisma.branch.findMany({ where: scope }),
      prisma.warehouse.findMany({ where: scope }),
      prisma.ledgerAccount.findMany({ where: scope }),
      prisma.orgMaster.findMany({ where: scope }),
      prisma.numberSeries.findMany({ where: scope }),
      platformPrisma.role.findMany({ where: scope }),
      platformPrisma.rolePermission.findMany({ where: scope, include: { permission: true } }),
      platformPrisma.featureSetting.findMany({ where: scope }),
      prisma.approvalRule.findMany({ where: scope }),
      prisma.fiscalYear.findMany({ where: scope }),
      platformPrisma.emailSetting.findMany({ where: scope }),
      prisma.eInvoiceSetting.findMany({ where: scope }),
      prisma.recurringSchedule.findMany({ where: scope }),
    ]);
    Object.assign(configuration, {
      companyProfile: [{ id: org.id, name: org.name, handle: org.slug || null, profileJson: org.profileJson || null }],
      branches, warehouses, ledgerAccounts, masters, numberSeries,
      roles, rolePermissions, featureSettings, approvalRules, fiscalYears,
      emailSettings: withoutSecrets(emailSettings),
      einvoiceSettings: withoutSecrets(einvoiceSettings),
      recurringSchedules: recurring,
    });
  }

  const counts: Record<string, number> = {};
  const outData: Record<string, any[]> = {};
  const outConfig: Record<string, any[]> = {};
  for (const [name, rows] of Object.entries(data)) {
    counts[name] = rows.length;
    outData[name] = plain(rows);
  }
  for (const [name, rows] of Object.entries(configuration)) {
    counts[name] = rows.length;
    outConfig[name] = plain(rows);
  }

  res.json({
    /*
     * A header that says what this is and what it covers, because a file found
     * on a shared drive in two years' time has to explain itself.
     */
    export: {
      format: 'clor/company-export',
      version: 1,
      scope: asked,
      company: { id: org.id, name: org.name, handle: org.slug || null },
      takenAt: new Date().toISOString(),
      counts,
      note:
        'Belongs to this company alone. It contains no other company’s records, ' +
        'no users or sessions, and no passwords or API credentials.',
    },
    ...(wantData ? { data: outData } : {}),
    ...(wantConfiguration ? { configuration: outConfig } : {}),
  });
});

export default dataExportRouter;
