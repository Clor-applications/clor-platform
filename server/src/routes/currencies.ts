import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { isFeatureEnabled } from '../services/features.js';
import { FxError, baseCurrencyFor, decimal, isBase, rateFor } from '../services/fx.js';

/** Currencies and their dated exchange rates — requirement 8. */
export const currenciesRouter = Router();
currenciesRouter.use(requireAuth, requireTenantContext);

const VIEW = requirePermission('ACCOUNTING', PermissionAction.VIEW, 'Ledger');
const EDIT = requirePermission('ACCOUNTING', PermissionAction.EDIT, 'Ledger');

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const featureOn = async (req: any, res: any) => {
  const { accountId, orgId } = req.tenant!;
  if (await isFeatureEnabled(accountId, orgId, 'multiCurrency')) return true;
  res.status(400).json({ error: 'Multi-currency is switched off for this company' });
  return false;
};

/** The base currency, and every foreign currency set up alongside it. */
currenciesRouter.get('/orgs/:orgId/currencies', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;

  const [baseCurrency, rows] = await Promise.all([
    baseCurrencyFor(accountId, orgId),
    prisma.currency.findMany({ where: { orgId }, orderBy: { code: 'asc' } }),
  ]);

  res.json({ baseCurrency, currencies: rows });
});

const currencySchema = z.object({
  code: z.string().min(3).max(3),
  name: z.string().min(1).max(60),
  symbol: z.string().max(6).optional(),
  decimals: z.number().int().min(0).max(4).optional(),
});

currenciesRouter.post('/orgs/:orgId/currencies', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const body = currencySchema.parse(req.body);
  const code = body.code.toUpperCase();

  const base = await baseCurrencyFor(accountId, orgId);
  if (isBase(code, base)) {
    return res.status(400).json({ error: `${code} is the base currency and is always available` });
  }

  const existing = await prisma.currency.findFirst({ where: { orgId, code } });
  if (existing) return res.status(409).json({ error: `${code} is already set up` });

  const created = await prisma.currency.create({
    data: {
      accountId,
      orgId,
      code,
      name: body.name,
      symbol: body.symbol ?? '',
      decimals: body.decimals ?? 2,
      createdByUserId: req.auth!.userId,
    },
  });

  res.status(201).json({ currency: created });
});

const rateSchema = z.object({
  code: z.string().min(3).max(3),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.number().positive(),
});

/** Rates are recorded per date; re-posting the same date corrects that day only. */
currenciesRouter.post('/orgs/:orgId/exchange-rates', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const body = rateSchema.parse(req.body);
  const code = body.code.toUpperCase();

  const currency = await prisma.currency.findFirst({ where: { orgId, code } });
  if (!currency) return res.status(400).json({ error: `${code} is not set up as a currency for this company` });

  const saved = await prisma.exchangeRate.upsert({
    where: { orgId_code_date: { orgId, code, date: body.date } },
    update: { rate: decimal(body.rate) },
    create: {
      accountId,
      orgId,
      currencyId: currency.id,
      code,
      date: body.date,
      rate: decimal(body.rate),
      createdByUserId: req.auth!.userId,
    },
  });

  res.status(201).json({ rate: { ...saved, rate: Number(saved.rate) } });
});

currenciesRouter.get('/orgs/:orgId/exchange-rates', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { orgId } = req.tenant!;

  const rows = await prisma.exchangeRate.findMany({
    where: { orgId, ...(req.query.code ? { code: String(req.query.code).toUpperCase() } : {}) },
    orderBy: [{ code: 'asc' }, { date: 'desc' }],
    take: Math.min(500, Number(req.query.limit || 200)),
  });

  res.json({ rates: rows.map((r) => ({ ...r, rate: Number(r.rate) })) });
});

/**
 * The rate that would be used for a document — the same lookup posting uses.
 *
 * Exposed so a form can show the operator the rate before they save, rather
 * than having the total change after the fact.
 */
currenciesRouter.get('/orgs/:orgId/exchange-rates/resolve', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;

  try {
    const rate = await rateFor({
      accountId,
      orgId,
      currency: String(req.query.code || ''),
      date: String(req.query.date || ''),
    });
    res.json({ rate });
  } catch (e: any) {
    if (e instanceof FxError) return res.status(400).json({ error: e.message });
    throw e;
  }
});
