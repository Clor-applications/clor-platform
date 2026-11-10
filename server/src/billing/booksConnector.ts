import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { istDate } from '../utils/istDate.js';
import { PaymentsError } from './providers.js';
import { invoicing, type BooksLink } from './invoicing.js';
import { getInvoice, type Buyer, type Line } from './invoices.js';

/**
 * The CLOR Books connector (roadmap item 10): each invoice CLOR issues is
 * copied into CLOR's own company in CLOR Books, as a DRAFT invoice with the
 * same number, for the customer as a Books customer.
 *
 * A draft, deliberately, like a repeating invoice's: nothing reaches CLOR's
 * ledger or its GST returns until someone (the CA) opens it in Books and
 * saves it. Sending twice never makes two: the Books invoice is keyed to this
 * one (sourceSystem + sourceKey, unique in Books). Off until switched on in
 * the operator console, Money, Invoice settings.
 */
export const SOURCE_SYSTEM = 'clor-billing';

const rupees = (paise: number) => new Prisma.Decimal((paise / 100).toFixed(2));

type Target = { accountId: string; orgId: string; branchId: string; ownerUserId: string; orgName: string; branchName: string };

/** Where invoices go, checked: the account, its company and branch, and the owner the drafts are made in the name of. */
async function target(link: BooksLink): Promise<Target> {
  if (!link.accountId || !link.orgId || !link.branchId) throw new PaymentsError('Choose CLOR’s Books company and branch first.', 400);
  return outsideTenant('billing: the CLOR Books company', async () => {
    const org = await platformPrisma.org.findFirst({ where: { id: link.orgId!, accountId: link.accountId! }, select: { id: true, name: true } });
    if (!org) throw new PaymentsError('That Books company is not in that account any more. Choose it again.', 400);
    const branch = await platformPrisma.branch.findFirst({ where: { id: link.branchId!, orgId: org.id }, select: { id: true, branchName: true, isActive: true } });
    if (!branch) throw new PaymentsError('That branch is not in the Books company any more. Choose it again.', 400);
    if (!branch.isActive) throw new PaymentsError(`The branch ${branch.branchName} is switched off in Books.`, 400);
    const owner = await platformPrisma.accountMembership.findFirst({ where: { accountId: link.accountId!, role: 'OWNER', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
    if (!owner) throw new PaymentsError('That account has no owner to make the invoices in the name of.', 400);
    return { accountId: link.accountId!, orgId: org.id, branchId: branch.id, ownerUserId: owner.userId, orgName: org.name, branchName: branch.branchName };
  });
}

/** Companies and branches to choose from, for an account typed by name or client ID. */
export async function booksChoices(q: string) {
  return outsideTenant('billing: Books companies to choose from', async () => {
    const text = q.trim().slice(0, 80);
    const byCompany = text ? await platformPrisma.org.findMany({ where: { name: { contains: text, mode: 'insensitive' } }, select: { accountId: true }, take: 10 }) : [];
    const accounts = await platformPrisma.account.findMany({
      where: text ? { OR: [{ name: { contains: text, mode: 'insensitive' } }, { code: { startsWith: text } }, { id: { in: byCompany.map((o) => o.accountId) } }] } : {},
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
      take: 10,
    });
    const orgs = await platformPrisma.org.findMany({ where: { accountId: { in: accounts.map((a) => a.id) } }, select: { id: true, name: true, accountId: true }, orderBy: { name: 'asc' } });
    const branches = await platformPrisma.branch.findMany({ where: { orgId: { in: orgs.map((o) => o.id) }, isActive: true }, select: { id: true, branchName: true, orgId: true }, orderBy: { branchName: 'asc' } });
    return accounts.map((a) => ({
      ...a,
      companies: orgs.filter((o) => o.accountId === a.id).map((o) => ({ id: o.id, name: o.name, branches: branches.filter((b) => b.orgId === o.id).map((b) => ({ id: b.id, name: b.branchName })) })),
    }));
  });
}

/** Test connection: the company is there, reachable, and how many CLOR invoices it holds. Writes nothing. */
export async function testBooks(): Promise<{ ok: boolean; message: string }> {
  const { books } = await invoicing();
  try {
    const t = await target(books);
    const held = await runInTenant(t.orgId, () => prisma.invoice.count({ where: { orgId: t.orgId, sourceSystem: SOURCE_SYSTEM } }));
    return { ok: true, message: `Connected to ${t.orgName}, branch ${t.branchName}. It holds ${held} ${held === 1 ? 'invoice' : 'invoices'} sent from here.${books.enabled ? '' : ' The connector is off: switch it on to send invoices.'}` };
  } catch (e) {
    if (e instanceof PaymentsError) return { ok: false, message: e.message };
    return { ok: false, message: 'Could not reach the Books company. Try again in a minute.' };
  }
}

/** The customer in CLOR's Books: found by GSTIN, else by name; made when new. */
async function partyFor(tx: Prisma.TransactionClient, t: Target, buyer: Buyer) {
  const base = { accountId: t.accountId, orgId: t.orgId, partyType: { in: ['CUSTOMER', 'BOTH'] } };
  const found =
    (buyer.gstin ? await tx.party.findFirst({ where: { ...base, gstin: buyer.gstin }, select: { id: true } }) : null) ||
    (await tx.party.findFirst({ where: { ...base, name: { equals: buyer.name, mode: 'insensitive' } }, select: { id: true } }));
  if (found) return found.id;
  const made = await tx.party.create({
    data: {
      accountId: t.accountId,
      orgId: t.orgId,
      partyType: 'CUSTOMER',
      name: buyer.name,
      gstin: buyer.gstin,
      gstRegistrationType: buyer.gstin ? 'REGULAR' : 'UNREGISTERED',
      placeOfSupplyState: buyer.state || buyer.stateCode,
      email: buyer.email,
      billingLine1: buyer.address,
      billingState: buyer.state,
      createdByUserId: t.ownerUserId,
    },
    select: { id: true },
  });
  return made.id;
}

/** Send one issued invoice to CLOR's Books as a draft. Safe to repeat. */
export async function sendToBooks(id: string) {
  const inv = await getInvoice(id);
  if (inv.status !== 'ISSUED' && inv.status !== 'PAID') throw new PaymentsError('Only an issued or paid invoice goes to Books.', 409);
  const { books } = await invoicing();
  if (!books.enabled) throw new PaymentsError('The CLOR Books connector is off. Switch it on in Invoice settings.', 409);
  try {
    const t = await target(books);
    const buyer = inv.buyer as Buyer;
    const tax = (inv.tax || {}) as { ratePercent?: number; cgst?: number; sgst?: number; igst?: number; kind?: string };
    const seller = (inv.seller || {}) as { sac?: string | null };
    const rate = Number(tax.ratePercent || 0);
    const items = (inv.lines as Line[]).map((l) => {
      const taxable = l.amount / 100;
      const gst = (taxable * rate) / 100;
      return { description: l.description, hsnSac: seller.sac || undefined, quantity: l.quantity, rate: l.unitAmount / 100, gstRate: rate, taxableAmount: taxable, gstAmount: gst, lineTotal: taxable + gst };
    });
    const booksId = await runInTenant(t.orgId, () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.invoice.findFirst({ where: { orgId: t.orgId, sourceSystem: SOURCE_SYSTEM, sourceKey: inv.id }, select: { id: true } });
        if (existing) return existing.id;
        const customerId = await partyFor(tx, t, buyer);
        const made = await tx.invoice.create({
          data: {
            accountId: t.accountId,
            orgId: t.orgId,
            branchId: t.branchId,
            number: inv.number!,
            date: istDate(inv.issueDate!),
            dueDate: inv.dueDate ? istDate(inv.dueDate) : null,
            customerId,
            customerName: buyer.name,
            customerGstin: buyer.gstin,
            placeOfSupplyState: buyer.state || buyer.stateCode,
            taxType: tax.kind === 'IGST' ? 'IGST' : tax.kind === 'CGST_SGST' ? 'CGST_SGST' : null,
            subtotal: rupees(inv.subtotal),
            cgstTotal: rupees(tax.cgst || 0),
            sgstTotal: rupees(tax.sgst || 0),
            igstTotal: rupees(tax.igst || 0),
            gstTotal: rupees(inv.taxTotal),
            total: rupees(inv.total),
            baseTotal: rupees(inv.total),
            paidAmount: 0,
            status: 'Draft',
            itemsJson: JSON.stringify(items),
            sourceSystem: SOURCE_SYSTEM,
            sourceKey: inv.id,
            createdByUserId: t.ownerUserId,
          },
          select: { id: true },
        });
        return made.id;
      }),
    );
    await outsideTenant('billing: sent to Books', () =>
      platformPrisma.billingInvoice.update({ where: { id }, data: { booksStatus: 'SENT', booksInvoiceId: booksId, booksError: null, booksSentAt: new Date(), booksAttempts: { increment: 1 } } }),
    );
    return { ok: true as const, booksInvoiceId: booksId, message: `Sent to ${t.orgName} as a draft, ${inv.number}.` };
  } catch (e) {
    const message = e instanceof PaymentsError ? e.message : 'Books did not take it. Retry in a minute; if it fails again, check the Books company.';
    if (!(e instanceof PaymentsError)) console.error('[books connector] send failed', id, e instanceof Error ? e.message : e);
    await outsideTenant('billing: could not send to Books', () => platformPrisma.billingInvoice.update({ where: { id }, data: { booksStatus: 'FAILED', booksError: message, booksAttempts: { increment: 1 } } }));
    return { ok: false as const, message };
  }
}

/** After issuing: send at once when the connector is on and set to send by itself. Never fails the issue. */
export async function autoSend(id: string) {
  const { books } = await invoicing();
  if (!books.enabled || !books.autoSend) return null;
  return sendToBooks(id).catch(() => null);
}
