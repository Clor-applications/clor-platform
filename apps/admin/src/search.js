import { listInvitations, memberDirectory } from '@platform/admin/account';
import { apiFetch } from '@platform/http';

/**
 * People and companies of this account, for the search bar (owner, 17 Nov 2026:
 * "info should be available right away instead of searching everything").
 * Typing a name found nothing: the bar knew page names only. A person opens
 * their access on Members; a company opens its page in Companies.
 *
 * The directory is the one Members reads, so the server decides who may see it
 * (owners and administrators); for anybody else it refuses and nothing is
 * listed. Read once and kept for a minute: the bar asks on every keystroke.
 *
 * CLOR's invoices to the account are found by their number, and invitations
 * by the address they went to (20 Nov 2026: "INV-0042" and an invited
 * person's email found nothing). Each list is its own read with its own gate
 * on the server (invoices: the people who look after the account;
 * invitations: owners and administrators); one that is refused lists nothing
 * and does not hide the others.
 */
const KEEP_MS = 60_000;
const kept = new Map();
const keep = (name, read) => () => {
  const had = kept.get(name);
  if (had && Date.now() - had.at < KEEP_MS) return had.read;
  const fresh = read().catch(() => null);
  kept.set(name, { at: Date.now(), read: fresh });
  return fresh;
};

const directory = keep('directory', () => memberDirectory());
const invoices = keep('invoices', () => apiFetch('/billing/invoices'));
const invitations = keep('invitations', () => listInvitations());

/** For tests: forget what was read. */
export const forgetWorkspaceSearch = () => {
  kept.clear();
};

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const DAY = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
/* Paise, as the server keeps CLOR's invoice totals. */
const rupees = (paise) => (paise == null ? '' : INR.format(Number(paise) / 100));
const INVOICE_STATE = { PAID: 'Paid', ISSUED: 'To pay', VOID: 'Cancelled', DRAFT: 'Draft' };
const INVITE_STATE = { PENDING: 'Waiting to join', ACCEPTED: 'Joined', EXPIRED: 'Link expired', REVOKED: 'Withdrawn' };
/** Letters and digits only, so "inv 42", "INV-0042" and "inv/0042" all find CLOR/INV-0042. */
const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function findInWorkspace(q) {
  const needle = String(q || '').trim().toLowerCase();
  if (needle.length < 2) return [];
  const [d, inv, sent] = await Promise.all([directory(), invoices(), invitations()]);
  const people = (d?.members || [])
    .filter((m) => `${m.name || ''} ${m.email || ''}`.toLowerCase().includes(needle))
    .slice(0, 6)
    .map((m) => ({
      key: `member:${m.userId}`,
      label: m.name || m.email,
      detail: [m.name ? m.email : null, m.status === 'SUSPENDED' ? 'Suspended' : null].filter(Boolean).join(' · '),
      group: 'Members',
      screen: 'members',
      params: { member: m.userId },
    }));
  const companies = (d?.companies || [])
    .filter((c) => `${c.name || ''} ${c.gstin || ''}`.toLowerCase().includes(needle))
    .slice(0, 4)
    .map((c) => ({
      key: `company:${c.orgId}`,
      label: c.name,
      detail: c.gstin || 'Company',
      group: 'Companies',
      screen: 'companies',
      params: { open: c.orgId },
    }));
  const number = plain(needle);
  const bills = number.length < 2 ? [] : (inv?.invoices || [])
    .filter((i) => plain(i.number).includes(number))
    .slice(0, 5)
    .map((i) => ({
      key: `invoice:${i.id}`,
      label: i.number,
      detail: [rupees(i.total), i.overdue ? 'Overdue' : INVOICE_STATE[i.status] || null, DAY(i.issueDate)].filter(Boolean).join(' · '),
      group: 'Invoices',
      screen: 'invoices',
      params: { invoice: i.id },
    }));
  /* Somebody who joined is already under Members; their old invitation would only be the same name twice. */
  const invited = (sent?.invitations || [])
    .filter((r) => r.status !== 'ACCEPTED' && String(r.email || '').toLowerCase().includes(needle))
    .slice(0, 5)
    .map((r) => ({
      key: `invitation:${r.id}`,
      label: r.email,
      detail: INVITE_STATE[r.status] || 'Invited',
      group: 'Invitations',
      screen: 'invitations',
      params: { email: r.email },
    }));
  return [...people, ...companies, ...bills, ...invited];
}
