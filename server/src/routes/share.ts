import { Router } from 'express';
import { randomBytes } from 'node:crypto';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';

/**
 * A read-only link to one invoice, for the person it is addressed to.
 *
 * The payment reminder carried "View invoice: …/?invoiceId=123", which only
 * worked for somebody already signed in with that company open — the business
 * itself, never the customer being chased. The customer landed on a login page,
 * which reads as a broken link sent by their supplier.
 *
 * Two routers, deliberately apart. Making a link is a tenant operation behind
 * a permission; following one cannot be, because the customer has no account
 * here and never will.
 */

const TOKEN_BYTES = 32;

/* ------------------------------------------------------------ making one */

export const shareAdminRouter = Router();
shareAdminRouter.use(requireAuth, requireTenantContext);

const SHARE_EDIT = requirePermission('SALES', PermissionAction.VIEW, 'Invoices');

shareAdminRouter.post('/orgs/:orgId/invoices/:invoiceId/share', SHARE_EDIT, async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    return res.status(403).json({ error: 'orgId mismatch' });
  }
  const { accountId, orgId } = req.tenant!;
  const docId = String(req.params.invoiceId);

  const invoice = await prisma.invoice.findFirst({ where: { id: docId, accountId, orgId }, select: { id: true } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  /*
   * One live link per invoice. Re-sending a reminder must produce the same
   * address — a customer who kept the first message and a customer who kept the
   * third should be looking at the same page, and a fresh token each time would
   * quietly break every reminder already sent.
   */
  const existing = await prisma.documentShareLink.findFirst({
    where: { accountId, orgId, docType: 'INVOICE', docId },
  });
  if (existing && !existing.revokedAt) {
    return res.json({ token: existing.token, createdAt: existing.createdAt });
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const row = existing
    ? await prisma.documentShareLink.update({
        where: { id: existing.id },
        data: { token, revokedAt: null, createdByUserId: req.auth!.userId },
      })
    : await prisma.documentShareLink.create({
        data: { accountId, orgId, docType: 'INVOICE', docId, token, createdByUserId: req.auth!.userId },
      });

  res.status(201).json({ token: row.token, createdAt: row.createdAt });
});

shareAdminRouter.delete('/orgs/:orgId/invoices/:invoiceId/share', SHARE_EDIT, async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    return res.status(403).json({ error: 'orgId mismatch' });
  }
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.documentShareLink.findFirst({
    where: { accountId, orgId, docType: 'INVOICE', docId: String(req.params.invoiceId) },
  });
  if (!existing) return res.status(404).json({ error: 'No link to revoke' });

  await prisma.documentShareLink.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  res.json({ revoked: true });
});

/* --------------------------------------------------------- following one */

export const sharePublicRouter = Router();

/**
 * No auth, no tenant headers, and nothing here may leak.
 *
 * What goes out is what is printed on the invoice the customer was sent
 * anyway: who it is from, who it is to, what was supplied and what is owed.
 * Everything else the row carries — internal ids, warehouse, who keyed it,
 * every other document — stays here.
 */
sharePublicRouter.get('/public/invoice/:token', async (req, res) => {
  const token = String(req.params.token || '');
  // Length-checked before the query so a short guess costs nothing.
  if (token.length < 20 || token.length > 200) return res.status(404).json({ error: 'Not found' });

  const link = await prisma.documentShareLink.findUnique({ where: { token } });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
    // The same answer for a wrong token, a revoked one and an expired one:
    // telling them apart tells somebody guessing which guesses are close.
    return res.status(404).json({ error: 'This link is no longer available' });
  }

  const invoice = await prisma.invoice.findFirst({ where: { id: link.docId, orgId: link.orgId } });
  if (!invoice) return res.status(404).json({ error: 'This link is no longer available' });

  const [org, headOffice] = await Promise.all([
    platformPrisma.org.findFirst({ where: { id: link.orgId }, select: { name: true } }),
    platformPrisma.branch.findFirst({
      where: { orgId: link.orgId, branchCode: 'HO' },
      select: { addressLine1: true, city: true, state: true, gstin: true },
    }),
  ]);

  let items: unknown[] = [];
  try {
    const parsed = JSON.parse(String((invoice as any).itemsJson || '[]'));
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }

  const n = (v: unknown) => {
    const x = Number(v ?? 0);
    return Number.isFinite(x) ? x : 0;
  };

  res.json({
    from: {
      name: org?.name || '',
      address: [headOffice?.addressLine1, headOffice?.city, headOffice?.state].filter(Boolean).join(', '),
      gstin: headOffice?.gstin || '',
    },
    to: {
      name: (invoice as any).customerName || '',
      gstin: (invoice as any).customerGstin || '',
    },
    invoice: {
      number: (invoice as any).number,
      date: (invoice as any).date,
      dueDate: (invoice as any).dueDate || '',
      status: (invoice as any).status || '',
      subtotal: n((invoice as any).subtotal),
      cgstTotal: n((invoice as any).cgstTotal),
      sgstTotal: n((invoice as any).sgstTotal),
      igstTotal: n((invoice as any).igstTotal),
      gstTotal: n((invoice as any).gstTotal),
      total: n((invoice as any).total),
      paidAmount: n((invoice as any).paidAmount),
      // The figure the reminder is about.
      dueAmount: Math.max(0, Math.round((n((invoice as any).total) - n((invoice as any).paidAmount)) * 100) / 100),
      items: items.map((l: any) => ({
        description: l?.description || l?.name || '',
        hsnSac: l?.hsnSac || '',
        quantity: n(l?.quantity),
        unit: l?.unit || '',
        rate: n(l?.rate),
        gstRate: n(l?.gstRate),
        amount: n(l?.taxableAmount ?? l?.amount),
      })),
    },
  });
});

export default sharePublicRouter;
