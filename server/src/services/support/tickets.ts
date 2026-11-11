import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { sendTemplate } from '../mailer.js';
import { customerTitle } from '../../routes/ops.js';

/**
 * Customer tickets (Ops plan P1). A customer asks from the Workspace; CLOR
 * staff answer on ops.clor.in. The customer never sees an internal note, a
 * staff member's id, or another account's ticket.
 */

export const CATEGORIES = ['QUESTION', 'PROBLEM', 'BILLING', 'DATA', 'OTHER'] as const;
export const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'] as const;
export const STATUSES = ['OPEN', 'WAITING', 'SOLVED', 'CLOSED'] as const;
export const APPS = ['accounting', 'people', 'attendance', 'payroll', 'workspace'] as const;
/** Tickets one person may open in an hour; a form left on repeat cannot flood support. */
export const OPEN_PER_HOUR = 10;

export class TicketError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const ticketCode = (n: number) => `T-${n}`;

async function names(ids: string[]) {
  const users = ids.length ? await platformPrisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true, email: true } }) : [];
  return new Map(users.map((u) => [u.id, u.fullName || u.email]));
}

/** What a customer reads: CLOR's people are "CLOR support", internal notes are gone. */
export async function customerTicket(t: any) {
  const shown = (t.messages || []).filter((m: any) => !m.internal);
  const who = await names([t.openedByUserId, ...shown.filter((m: any) => !m.fromStaff).map((m: any) => m.authorUserId)]);
  return {
    id: t.id,
    code: ticketCode(t.number),
    subject: t.subject,
    category: t.category,
    app: t.app,
    status: t.status,
    requestId: t.requestId,
    openedBy: who.get(t.openedByUserId) || 'Someone',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: t.messages
      ? shown.map((m: any) => ({ id: m.id, fromStaff: m.fromStaff, author: m.fromStaff ? 'CLOR support' : who.get(m.authorUserId) || 'Someone', body: m.body, at: m.createdAt }))
      : undefined,
  };
}

export async function staffTicket(t: any) {
  const ids = [t.openedByUserId, t.assignedOperatorId, ...(t.messages || []).map((m: any) => m.authorUserId)].filter(Boolean);
  const [who, account, owner] = await Promise.all([
    names(ids),
    platformPrisma.account.findUnique({ where: { id: t.accountId }, select: { id: true, name: true, code: true, orgs: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
    platformPrisma.accountMembership.findFirst({ where: { accountId: t.accountId, role: 'OWNER', status: 'ACTIVE' }, select: { userId: true } }),
  ]);
  const ownerName = owner ? (await names([owner.userId])).get(owner.userId) : null;
  const opener = await platformPrisma.user.findUnique({ where: { id: t.openedByUserId }, select: { email: true, phone: true } });
  return {
    id: t.id,
    code: ticketCode(t.number),
    subject: t.subject,
    category: t.category,
    app: t.app,
    priority: t.priority,
    status: t.status,
    requestId: t.requestId,
    /* The business, not the owner's name (the same rule as the console's search box). */
    account: account ? { id: account.id, name: customerTitle(account.name, ownerName, account.orgs[0]?.name), code: account.code } : { id: t.accountId, name: 'Unknown', code: null },
    openedBy: { id: t.openedByUserId, name: who.get(t.openedByUserId) || 'Someone', email: opener?.email || null, phone: opener?.phone || null },
    assignedTo: t.assignedOperatorId ? { id: t.assignedOperatorId, name: who.get(t.assignedOperatorId) || 'Staff' } : null,
    lastCustomerAt: t.lastCustomerAt,
    lastStaffAt: t.lastStaffAt,
    solvedAt: t.solvedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: t.messages?.map((m: any) => ({ id: m.id, fromStaff: m.fromStaff, internal: m.internal, author: who.get(m.authorUserId) || 'Someone', body: m.body, at: m.createdAt })),
  };
}

/** Tell every active Support (and owner-level) staff member a ticket arrived. Best effort. */
async function tellStaff(t: { id: string; number: number; subject: string; accountId: string; priority: string }) {
  const ops = await platformPrisma.platformOperator.findMany({ where: { active: true, role: { in: ['SUPPORT', 'SUPER_ADMIN'] } }, select: { userId: true } });
  const users = ops.length ? await platformPrisma.user.findMany({ where: { id: { in: ops.map((o) => o.userId) }, isActive: true }, select: { email: true, fullName: true } }) : [];
  const account = await platformPrisma.account.findUnique({ where: { id: t.accountId }, select: { name: true } });
  await Promise.all(
    users.map((u) =>
      sendTemplate({
        templateKey: 'support.ticket_opened',
        to: u.email,
        transactional: true,
        relatedType: 'SupportTicket',
        relatedId: t.id,
        data: { userName: u.fullName || u.email, ticket: ticketCode(t.number), subject: t.subject, customer: account?.name || 'A customer', priority: t.priority.toLowerCase(), opsUrl: `${OPS_URL()}/#/tickets/${t.id}` },
      }).catch(() => null),
    ),
  );
}

const APP_URL = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const OPS_URL = () => (process.env.OPS_URL || 'https://ops.clor.in').replace(/\/$/, '');

export async function openTicket(input: { accountId: string; orgId: string | null; userId: string; subject: string; body: string; category: string; app: string | null; urgent: boolean; requestId: string | null }) {
  return outsideTenant('support: open a ticket', async () => {
    const recent = await platformPrisma.supportTicket.count({ where: { openedByUserId: input.userId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= OPEN_PER_HOUR) throw new TicketError('You have opened many tickets in the last hour. Add to an open one, or try again later.', 429);
    const now = new Date();
    const t = await platformPrisma.supportTicket.create({
      data: {
        accountId: input.accountId,
        orgId: input.orgId,
        openedByUserId: input.userId,
        subject: input.subject,
        category: input.category,
        app: input.app,
        priority: input.urgent ? 'URGENT' : 'NORMAL',
        requestId: input.requestId,
        lastCustomerAt: now,
        messages: { create: { authorUserId: input.userId, body: input.body } },
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    void tellStaff(t).catch(() => {});
    return t;
  });
}

/** A customer's tickets: everyone sees their own; account owners and admins see the account's. */
export async function ticketsFor(accountId: string, userId: string, wholeAccount: boolean) {
  return outsideTenant('support: a customer’s tickets', () =>
    platformPrisma.supportTicket.findMany({ where: { accountId, ...(wholeAccount ? {} : { openedByUserId: userId }) }, orderBy: { updatedAt: 'desc' }, take: 100 }),
  );
}

export async function ticketForCustomer(accountId: string, userId: string, wholeAccount: boolean, id: string) {
  const t = await outsideTenant('support: one ticket', () =>
    platformPrisma.supportTicket.findFirst({ where: { id, accountId, ...(wholeAccount ? {} : { openedByUserId: userId }) }, include: { messages: { orderBy: { createdAt: 'asc' } } } }),
  );
  if (!t) throw new TicketError('No such ticket.', 404);
  return t;
}

/** The customer writes back. A solved ticket opens again; a closed one is final (open a new one). */
export async function customerReply(t: { id: string; status: string }, userId: string, body: string) {
  if (t.status === 'CLOSED') throw new TicketError('This ticket is closed. Open a new one and mention its number.', 409);
  return outsideTenant('support: customer reply', async () => {
    const now = new Date();
    await platformPrisma.$transaction([
      platformPrisma.supportMessage.create({ data: { ticketId: t.id, authorUserId: userId, body } }),
      platformPrisma.supportTicket.update({ where: { id: t.id }, data: { status: 'OPEN', lastCustomerAt: now, solvedAt: null } }),
    ]);
  });
}

export async function customerSolved(t: { id: string; status: string }) {
  if (t.status === 'CLOSED' || t.status === 'SOLVED') return;
  await outsideTenant('support: customer says solved', () => platformPrisma.supportTicket.update({ where: { id: t.id }, data: { status: 'SOLVED', solvedAt: new Date() } }));
}

/**
 * Staff answer. A reply goes to the customer by email and waits on them; an
 * internal note changes nothing the customer sees.
 */
export async function staffReply(t: { id: string; number: number; subject: string; openedByUserId: string; accountId: string; status: string; assignedOperatorId: string | null }, operatorId: string, body: string, internal: boolean, solve: boolean) {
  return outsideTenant('support: staff reply', async () => {
    const now = new Date();
    const status = internal ? t.status : solve ? 'SOLVED' : 'WAITING';
    await platformPrisma.$transaction([
      platformPrisma.supportMessage.create({ data: { ticketId: t.id, authorUserId: operatorId, body, fromStaff: true, internal } }),
      platformPrisma.supportTicket.update({
        where: { id: t.id },
        /* Whoever answers first owns it, unless someone already does. */
        data: internal ? {} : { status, lastStaffAt: now, solvedAt: solve ? now : null, assignedOperatorId: t.assignedOperatorId || operatorId },
      }),
    ]);
    if (internal) return { told: false };
    const u = await platformPrisma.user.findUnique({ where: { id: t.openedByUserId }, select: { email: true, fullName: true, isActive: true } });
    if (!u?.isActive) return { told: false };
    const sent = await sendTemplate({
      templateKey: 'support.ticket_reply',
      to: u.email,
      accountId: t.accountId,
      transactional: true,
      relatedType: 'SupportTicket',
      relatedId: t.id,
      data: { userName: u.fullName || u.email, ticket: ticketCode(t.number), subject: t.subject, reply: body, ticketUrl: `${APP_URL()}/?app=admin&open=support&ticket=${t.id}`, solved: solve ? 'We think this is solved. If it is not, reply and the ticket opens again.' : 'Reply from the Workspace (Help and support) if you need anything else.' },
    }).catch(() => null);
    return { told: sent?.status === 'SENT' };
  });
}
