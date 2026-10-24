import { Router } from 'express';
import { anyAppLive, appLive, closing } from '../services/principalAllowed.js';
import { randomBytes } from 'node:crypto';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { enterTenant, outsideTenant } from '../utils/tenantScope.js';
import { authorize } from '../middleware/rbac.js';
import { recordAudit } from '../services/auditTrail.js';
import { actorFrom, verifyCredential } from '../services/credentials.js';
import { hashLegacyLink, linkForInvoice, revokeInvoiceLink, shareKind } from '../services/shareLinks.js';

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

/* Fetching the invoice's live link is for anyone who can see invoices (reminders); making a new one, or revoking one, takes edit (A-32). */
const SHARE_VIEW = requirePermission('SALES', PermissionAction.VIEW, 'Invoices');
const SHARE_EDIT = requirePermission('SALES', PermissionAction.EDIT, 'Invoices');

shareAdminRouter.post('/orgs/:orgId/invoices/:invoiceId/share', SHARE_VIEW, async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    return res.status(403).json({ error: 'orgId mismatch' });
  }
  const { accountId, orgId } = req.tenant!;
  const docId = String(req.params.invoiceId);
  /*
   * One live link per invoice. Re-sending a reminder must produce the same
   * address — a customer who kept the first message and a customer who kept the
   * third should be looking at the same page, and a fresh token each time would
   * quietly break every reminder already sent. Only its hash and an encrypted
   * copy are kept (A-32).
   */
  const mayMint = !(await authorize(req, 'SALES', PermissionAction.EDIT, 'Invoices'));
  const r = await linkForInvoice({ accountId, orgId }, docId, { mayMint, actor: { ...actorFrom(req), id: req.auth!.userId } });
  if ('refused' in r) {
    if (r.refused === 'NOT_FOUND') return res.status(404).json({ error: 'Invoice not found' });
    return res.status(403).json({ error: 'This invoice has no link yet. Someone who can edit invoices has to make one.', code: 'SHARE_LINK_NEEDS_EDIT' });
  }
  if (r.minted) await recordAudit(req, { entity: 'Invoice', entityId: docId, action: 'SHARE_LINK_CREATED', message: 'Made a link to this invoice for its customer', metadata: { expiresAt: r.expiresAt?.toISOString() ?? null } });
  res.status(r.minted ? 201 : 200).json({ token: r.token, createdAt: r.createdAt, expiresAt: r.expiresAt });
});

shareAdminRouter.delete('/orgs/:orgId/invoices/:invoiceId/share', SHARE_EDIT, async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    return res.status(403).json({ error: 'orgId mismatch' });
  }
  const done = await revokeInvoiceLink(req.tenant!, String(req.params.invoiceId), actorFrom(req), 'revoked by staff');
  if (!done) return res.status(404).json({ error: 'No link to revoke' });
  await recordAudit(req, { entity: 'Invoice', entityId: String(req.params.invoiceId), action: 'SHARE_LINK_REVOKED', message: 'Revoked the link to this invoice' });
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
  /* A-32 (R13): never cached, never indexed, never sent on as a referrer. Following a link changes nothing. */
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const token = String(req.params.token || '');
  // Length-checked before the query so a short guess costs nothing.
  if (token.length < 20 || token.length > 200) return res.status(404).json({ error: 'Not found' });

  /* A link made before A-32 gets its hash the first time it is followed. */
  await hashLegacyLink(token);
  /* A-35: the token is how the company is found; the registry and the link's row must both allow it (Batch 5). */
  const v = await verifyCredential('SHARE_LINK', token, shareKind);
  if (!v.ok) {
    /* Paused because its invoice was cancelled: say so, rather than a broken link. */
    if (v.block === 'SUSPENDED' && v.row) {
      const org = await outsideTenant('share link: who cancelled it', () => platformPrisma.org.findFirst({ where: { id: v.row!.orgId }, select: { name: true } }));
      return res.status(410).json({ error: `This invoice was cancelled by ${org?.name || 'the seller'}.`, code: 'INVOICE_CANCELLED', from: { name: org?.name || '' } });
    }
    // The same answer for a wrong token, a revoked one and an expired one:
    // telling them apart tells somebody guessing which guesses are close.
    return res.status(404).json({ error: 'This link is no longer available' });
  }
  const link = v.row;

  /* A-11: a shared invoice is Accounting's; it stops being served when Accounting is off, unpaid, or the company is closing. */
  if (await appLive(link.accountId, link.orgId, 'accounting')) return res.status(404).json({ error: 'This link is no longer available' });
  /* A-30: the rest of this request runs as the company the token named. */
  enterTenant(link.orgId);

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
