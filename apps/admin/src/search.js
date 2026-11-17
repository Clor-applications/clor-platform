import { memberDirectory } from '@platform/admin/account';

/**
 * People and companies of this account, for the search bar (owner, 17 Nov 2026:
 * "info should be available right away instead of searching everything").
 * Typing a name found nothing: the bar knew page names only. A person opens
 * their access on Members; a company opens its page in Companies.
 *
 * The directory is the one Members reads, so the server decides who may see it
 * (owners and administrators); for anybody else it refuses and nothing is
 * listed. Read once and kept for a minute: the bar asks on every keystroke.
 */
let kept = null;
const KEEP_MS = 60_000;

const directory = () => {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.read;
  const read = memberDirectory().catch(() => null);
  kept = { at: Date.now(), read };
  return read;
};

/** For tests: forget what was read. */
export const forgetWorkspaceSearch = () => {
  kept = null;
};

export async function findInWorkspace(q) {
  const needle = String(q || '').trim().toLowerCase();
  if (needle.length < 2) return [];
  const d = await directory();
  if (!d) return [];
  const people = (d.members || [])
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
  const companies = (d.companies || [])
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
  return [...people, ...companies];
}
