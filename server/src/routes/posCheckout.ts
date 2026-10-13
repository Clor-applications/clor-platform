import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { OverAllocationError } from '../services/settlement.js';
import { POS_TENDERS } from '../services/receiptAccounts.js';
import { PosCheckoutError, checkoutPosSale } from '../services/posCheckout.js';

/**
 * One endpoint for one counter sale.
 *
 * Deliberately not an extra flag on the invoice route. A POS sale is a sale
 * AND the money for it, and the invoice route creates a document and posts it
 * — it has no idea a receipt is owed, which is exactly how a till came to
 * report Paid against an untouched receivable. This route hands the whole sale
 * to one service, which either writes all of it or none of it.
 *
 * It answers to `SALES::Invoices::CREATE`: ringing up a sale raises an invoice,
 * and anyone trusted to do the second is trusted to do the first.
 */
export const posCheckoutRouter = Router();
posCheckoutRouter.use(requireAuth, requireTenantContext);

const MODULE = 'SALES';
const RESOURCE = 'Invoices';

const lineSchema = z
  .object({
    description: z.string().optional(),
    quantity: z.number().optional(),
    rate: z.number().optional(),
  })
  .passthrough();

const checkoutSchema = z.object({
  /** The till's id for this attempt. The retry carries the same one. */
  checkoutId: z.string().min(8).max(64),
  /* Case-insensitive because the screen has always shown "Cash" and "Card"
     while the accounting side speaks in CASH and CARD. Normalised below so
     only one spelling ever reaches the books. */
  tender: z.string().transform((v) => v.trim().toUpperCase()).pipe(z.enum(POS_TENDERS)),
  date: z.string().min(1),
  number: z.string().optional(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  customerMobile: z.string().optional(),
  warehouseId: z.string().optional(),
  taxType: z.string().optional(),
  placeOfSupplyState: z.string().optional(),
  subtotal: z.number(),
  cgstTotal: z.number().optional(),
  sgstTotal: z.number().optional(),
  igstTotal: z.number().optional(),
  gstTotal: z.number().optional(),
  total: z.number(),
  items: z.array(lineSchema).min(1),
});

posCheckoutRouter.post(
  '/orgs/:orgId/pos/checkout',
  requirePermission(MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (String(req.params.orgId) !== req.tenant!.orgId) {
      return res.status(403).json({ error: 'orgId mismatch' });
    }
    const body = checkoutSchema.parse(req.body);
    const { accountId, orgId, branchId } = req.tenant!;

    try {
      const result = await checkoutPosSale(
        {
          checkoutId: body.checkoutId,
          tender: body.tender,
          date: body.date,
          number: body.number ?? null,
          customerId: body.customerId ?? null,
          customerName: body.customerName ?? '',
          customerMobile: body.customerMobile ?? null,
          warehouseId: body.warehouseId ?? null,
          taxType: body.taxType ?? null,
          placeOfSupplyState: body.placeOfSupplyState ?? null,
          subtotal: body.subtotal,
          cgstTotal: body.cgstTotal ?? 0,
          sgstTotal: body.sgstTotal ?? 0,
          igstTotal: body.igstTotal ?? 0,
          gstTotal: body.gstTotal ?? 0,
          total: body.total,
          items: body.items,
        },
        { accountId, orgId, branchId, userId: req.auth!.userId }
      );

      /* 200 on a replay, 201 on a sale that was rung up by this call. The till
         does not need to tell them apart to be correct — it is told anyway,
         because "we already had this one" is worth seeing in a log. */
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (e: any) {
      // A code the till can act on: one means "an admin has to configure
      // something", the other means "stop and get a human".
      if (e instanceof PosCheckoutError) {
        return res.status(e.status).json({ error: e.message, code: e.code });
      }
      if (e instanceof OverAllocationError) {
        return res.status(e.status).json({ error: e.message, code: 'POS_OVER_ALLOCATED' });
      }
      throw e;
    }
  }
);
