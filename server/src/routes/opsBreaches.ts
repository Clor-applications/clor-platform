import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { sendTemplate } from '../services/mailer.js';
import { ACCOUNT_ADMINS } from '../services/accountMembership.js';
import { audit } from './ops.js';

/**
 * A breach of customer data, recorded on ops.clor.in before it is ever needed
 * (round 67 pick "breachops"): what happened, when, which customers, what was
 * done. "Tell their admins" emails every owner and administrator of each
 * customer named, once, and keeps when and how many. A company's own breach
 * of its staff's data is recorded by that company (routes/dataProtection.ts);
 * this is CLOR's, as the processor.
 */
export const opsBreachesRouter = Router();
opsBreachesRouter.use('/ops/breaches', requireAuth, requireOperator);

const WRITERS = ['SUPPORT'] as const;
const STAFF_ONLY = { customerLog: false };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date.');
const breachBody = z.object({
  what: z.string().trim().min(10, 'Say what happened, in a sentence or two.').max(2000),
  dataKinds: z.string().trim().min(3, 'Say what data was involved.').max(600),
  stepsTaken: z.string().trim().min(5, 'Say what CLOR has done.').max(2000),
  stepsForCustomer: z.string().trim().max(1000).nullish(),
  happenedOn: day,
  foundOn: day,
  accountIds: z.array(z.string().min(1).max(40)).min(1, 'Choose at least one customer.').max(500),
});

const asDay = (d: string) => new Date(`${d}T00:00:00+05:30`);
const view = (b: any, names: Map<string, string>) => ({
  id: b.id,
  what: b.what,
  dataKinds: b.dataKinds,
  stepsTaken: b.stepsTaken,
  stepsForCustomer: b.stepsForCustomer,
  happenedAt: b.happenedAt,
  foundAt: b.foundAt,
  accounts: (b.accountIds as string[]).map((id) => ({ id, name: names.get(id) || null })),
  notifiedAt: b.notifiedAt,
  notifiedCount: b.notifiedCount,
  createdAt: b.createdAt,
});

/** A customer by its first company's name (an account is often named after its owner), else the account's. */
async function namesFor(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, string>();
  const [accounts, orgs] = await Promise.all([
    platformPrisma.account.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    platformPrisma.org.findMany({ where: { accountId: { in: unique } }, orderBy: { id: 'asc' }, select: { accountId: true, name: true } }),
  ]);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const seen = new Set<string>();
  for (const o of orgs) if (!seen.has(o.accountId)) (seen.add(o.accountId), names.set(o.accountId, o.name));
  return names;
}

opsBreachesRouter.get('/ops/breaches', (_req, res) =>
  outsideTenant('ops: data breaches', async () => {
    const rows = await platformPrisma.opsBreach.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const names = await namesFor(rows.flatMap((r) => r.accountIds));
    res.json({ breaches: rows.map((r) => view(r, names)) });
  }),
);

opsBreachesRouter.post('/ops/breaches', requireOperatorRole(...WRITERS), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: record a data breach', async () => {
    const parsed = breachBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the breach details.' });
    const d = parsed.data;
    if (d.foundOn < d.happenedOn) return res.status(400).json({ error: 'It was found before it happened: check the dates.' });
    const known = await platformPrisma.account.findMany({ where: { id: { in: d.accountIds } }, select: { id: true } });
    if (known.length !== new Set(d.accountIds).size) return res.status(400).json({ error: 'One of the customers chosen is not known.' });
    const row = await platformPrisma.opsBreach.create({
      data: { what: d.what, dataKinds: d.dataKinds, stepsTaken: d.stepsTaken, stepsForCustomer: d.stepsForCustomer || null, happenedAt: asDay(d.happenedOn), foundAt: asDay(d.foundOn), accountIds: [...new Set(d.accountIds)], createdByUserId: req.auth!.userId },
    });
    await audit(req, 'BREACH_RECORDED', {}, { id: row.id, accounts: row.accountIds.length }, STAFF_ONLY);
    res.status(201).json(view(row, await namesFor(row.accountIds)));
  }),
);

/** Tell their admins: every owner and administrator of each customer named, once. */
opsBreachesRouter.post('/ops/breaches/:id/notify', requireOperatorRole(...WRITERS), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: tell customers about a breach', async () => {
    const b = await platformPrisma.opsBreach.findUnique({ where: { id: String(req.params.id) } });
    if (!b) return res.status(404).json({ error: 'No such breach record.' });
    if (b.notifiedAt) return res.status(409).json({ error: 'Their administrators were told already.' });
    const claimed = await platformPrisma.opsBreach.updateMany({ where: { id: b.id, notifiedAt: null }, data: { notifiedAt: new Date(), notifiedByUserId: req.auth!.userId } });
    if (!claimed.count) return res.status(409).json({ error: 'Their administrators were told a moment ago.' });
    const names = await namesFor(b.accountIds);
    const members = await platformPrisma.accountMembership.findMany({ where: { accountId: { in: b.accountIds }, role: { in: ACCOUNT_ADMINS } }, select: { accountId: true, userId: true } });
    const users = await platformPrisma.user.findMany({ where: { id: { in: [...new Set(members.map((m) => m.userId))] } }, select: { id: true, email: true, fullName: true } });
    const userOf = new Map(users.map((u) => [u.id, u]));
    const when = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    let sent = 0;
    for (const m of members) {
      const u = userOf.get(m.userId);
      if (!u?.email) continue;
      await sendTemplate({
        templateKey: 'platform.breach_notice',
        to: u.email,
        toName: u.fullName || undefined,
        accountId: m.accountId,
        transactional: true,
        relatedType: 'OpsBreach',
        relatedId: b.id,
        data: { name: u.fullName || 'there', accountName: names.get(m.accountId) || 'your account', what: b.what, when: when(b.happenedAt), found: when(b.foundAt), dataKinds: b.dataKinds, stepsTaken: b.stepsTaken, stepsForCustomer: b.stepsForCustomer || 'Nothing is needed from you now. We will write again if that changes.' },
      });
      sent += 1;
    }
    const row = await platformPrisma.opsBreach.update({ where: { id: b.id }, data: { notifiedCount: sent } });
    await audit(req, 'BREACH_NOTIFIED', {}, { id: b.id, sent }, STAFF_ONLY);
    res.json(view(row, names));
  }),
);
