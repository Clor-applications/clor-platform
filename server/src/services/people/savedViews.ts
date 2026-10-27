import { peoplePrisma } from '../../utils/peoplePrisma.js';

/**
 * Saved views (docs/people/02-PRD.md CORE-01, RPT-02): a name for a set of
 * filters on one screen. A view is the user's own unless shared; a shared
 * view shows for everyone who can open that screen, and only its maker may
 * change or delete it.
 */
export class ViewError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const SCREEN = /^(employees|report:[a-z_]{2,40})$/;
const clean = (f: unknown) => {
  const src = (f && typeof f === 'object' && !Array.isArray(f) ? f : {}) as Record<string, unknown>;
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(src).slice(0, 30)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) continue;
    if (Array.isArray(v)) out[k] = v.map((x) => String(x ?? '').slice(0, 120)).slice(0, 50);
    else if (v != null && v !== '') out[k] = String(v).slice(0, 200);
  }
  return out;
};

export async function viewsFor(orgId: string, userId: string, screen: string) {
  if (!SCREEN.test(screen)) throw new ViewError('Unknown screen.');
  const rows = await peoplePrisma.savedView.findMany({ where: { orgId, screen, OR: [{ userId }, { shared: true }] }, orderBy: [{ shared: 'asc' }, { name: 'asc' }] });
  return rows.map((r) => ({ id: r.id, name: r.name, filters: r.filters, shared: r.shared, mine: r.userId === userId, updatedAt: r.updatedAt }));
}

export async function saveView(who: { accountId: string; orgId: string; userId: string }, input: { id?: unknown; screen?: unknown; name?: unknown; filters?: unknown; shared?: unknown }) {
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new ViewError('Name the view.');
  const filters = clean(input.filters);
  const shared = Boolean(input.shared);
  if (input.id) {
    const row = await peoplePrisma.savedView.findFirst({ where: { id: String(input.id), orgId: who.orgId } });
    if (!row || (row.userId !== who.userId && !row.shared)) throw new ViewError('No such view.', 404);
    if (row.userId !== who.userId) throw new ViewError('Only the person who made a shared view can change it.', 403);
    return peoplePrisma.savedView.update({ where: { id: row.id }, data: { name, filters, shared } });
  }
  const screen = String(input.screen ?? '');
  if (!SCREEN.test(screen)) throw new ViewError('Unknown screen.');
  const count = await peoplePrisma.savedView.count({ where: { orgId: who.orgId, userId: who.userId, screen } });
  if (count >= 50) throw new ViewError('Fifty views on one screen is the most; delete one first.');
  return peoplePrisma.savedView.create({ data: { accountId: who.accountId, orgId: who.orgId, userId: who.userId, screen, name, filters, shared } });
}

export async function deleteView(orgId: string, userId: string, id: string) {
  const row = await peoplePrisma.savedView.findFirst({ where: { id, orgId } });
  if (!row || (row.userId !== userId && !row.shared)) throw new ViewError('No such view.', 404);
  if (row.userId !== userId) throw new ViewError('Only the person who made a shared view can delete it.', 403);
  await peoplePrisma.savedView.delete({ where: { id } });
}
