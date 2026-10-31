import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { round2 } from '../../utils/money.js';

/**
 * A recovery People hands Payroll (payrollBridge.ts `advance-recover:<id>:<period>`)
 * is one adjustment when it starts, and can become several: a run that may
 * take only part of it within the share of wages carries the rest as a new
 * row (run.ts, deductionCap.ts), a full and final takes a row, or part of one
 * and carries the rest. The rows share the first one's reference and point
 * back through `carriedFromId`, so the chain is read from its first row.
 *
 * What People may count as recovered is what the chain has *taken* (rows on a
 * payslip or a settlement, CONSUMED), never what is merely approved.
 */

export type Chain = {
  root: { id: string; status: string };
  /** What the advance had recovered when this was sent (plus a full and final's line since); null on a chain made before 31 Oct 2026. */
  base: number | null;
  taken: number;
  open: number;
  cancelled: number;
  draft: number;
  rows: Array<{ id: string; status: string; amount: number }>;
};

/** The link People keeps on an advance: an adjustment id, or `settlement:<id>` (closed by a full and final), or `settlement:<id>|<adjustment id>` (closed there, with a recovery still live in Payroll). */
export function liveLink(link: string | null | undefined): string | null {
  if (!link) return null;
  if (link.startsWith('settlement:')) {
    const bar = link.indexOf('|');
    return bar > 0 ? link.slice(bar + 1) : null;
  }
  return link;
}

const SELECT = { id: true, status: true, amount: true, reference: true, carriedFromId: true, recoveryBase: true } as const;

/**
 * Every row of a recovery, from its first: by the shared reference, and by
 * `carriedFromId` from row to row, so a row whose reference was lost is
 * still found.
 */
export async function recoveryChain(orgId: string, rootId: string, db: any = payrollPrisma): Promise<Chain | null> {
  const root = await db.payrollAdjustment.findFirst({ where: { orgId, id: rootId }, select: SELECT });
  if (!root) return null;
  const byRef = root.reference
    ? await db.payrollAdjustment.findMany({ where: { orgId, OR: [{ id: rootId }, { reference: root.reference }] }, select: SELECT })
    : [root];
  const seen = new Set<string>();
  const rows: any[] = [];
  const add = (r: any) => { if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); } };
  add(root);
  const known = new Map<string, any[]>();
  for (const r of byRef) if (r.carriedFromId) known.set(r.carriedFromId, [...(known.get(r.carriedFromId) || []), r]);
  for (let i = 0; i < rows.length && i < 200; i += 1) {
    const kids = known.get(rows[i].id) ?? (await db.payrollAdjustment.findMany({ where: { orgId, carriedFromId: rows[i].id }, select: SELECT }));
    for (const k of kids) add(k);
  }
  const sum = (st: string) => round2(rows.filter((r) => r.status === st).reduce((t, r) => t + Number(r.amount), 0));
  return {
    root: { id: root.id, status: root.status },
    base: root.recoveryBase == null ? null : round2(Number(root.recoveryBase)),
    taken: sum('CONSUMED'),
    open: sum('APPROVED'),
    cancelled: sum('CANCELLED'),
    draft: sum('DRAFT'),
    rows: rows.map((r) => ({ id: r.id, status: r.status, amount: Number(r.amount) })),
  };
}

/**
 * Where an advance stands against its chain.
 *
 * With the chain's starting figure (every recovery sent since 31 Oct 2026):
 * recovered is that figure plus what the chain has taken (a payslip, a full
 * and final), and "being taken from salary" is what it still holds, approved
 * or back for approval. Whatever was cut (edited down, corrected, cancelled)
 * is in neither, so it is open again, owed by the person, and a full and
 * final lists it. Worked out from the rows alone, so reading it twice, or a
 * correction after a split, moves nothing twice (re-review of #82).
 *
 * Without it (an older chain), the figure is inferred from what People still
 * shows as being taken: right only while the chain holds what was sent, which
 * is why ensureRecoveryBase records it before the first change.
 */
export function foldRecovery(row: { recoveredAmount: unknown; recoveringAmount: unknown }, chain: Chain | null) {
  const recovered = round2(Number(row.recoveredAmount) || 0);
  const recovering = round2(Number(row.recoveringAmount) || 0);
  /* Deleted in Payroll: nothing was taken through it. */
  if (!chain) return { recovered, recovering: 0 };
  const holding = round2(chain.open + chain.draft);
  /*
   * With its starting figure, a draft (just sent, or edited and back for
   * approval) is read like any other row: People shows the amount waiting,
   * the new one after an edit, and the cut as open (QA retest of #82).
   */
  if (chain.base != null) return { recovered: round2(chain.base + chain.taken), recovering: holding };
  /* An older chain not approved yet: unchanged. */
  if (chain.root.status === 'DRAFT') return { recovered, recovering };
  const total = round2(chain.taken + chain.open + chain.cancelled + chain.draft);
  /* Never below nothing: a chain edited down holds less than was sent, and the cut is not recovered. */
  const counted = Math.max(0, round2(total - recovering));
  return { recovered: Math.max(0, round2(recovered + chain.taken - counted)), recovering: holding };
}

/** The first row of the recovery a row belongs to, when it is one People sent. */
export async function recoveryRootOf(orgId: string, rowId: string, db: any = payrollPrisma): Promise<string | null> {
  let id: string | null = rowId;
  for (let i = 0; id && i < 50; i += 1) {
    const r: { id: string; carriedFromId: string | null; reference: string | null } | null = await db.payrollAdjustment.findFirst({ where: { orgId, id }, select: { id: true, carriedFromId: true, reference: true } });
    if (!r) return null;
    if (!r.carriedFromId) return r.id.startsWith('advance-recover:') ? r.id : r.reference?.startsWith('advance-recover:') ? r.reference : null;
    id = r.carriedFromId;
  }
  return null;
}

/**
 * Before a recovery's amounts change by hand (edited, corrected, cancelled):
 * its starting figure, worked out once from People's advance while the chain
 * still holds what was sent, and kept on its first row. A no-op when it is
 * there already or the row is not a recovery People sent.
 */
export async function ensureRecoveryBase(orgId: string, rowId: string): Promise<void> {
  const rootId = await recoveryRootOf(orgId, rowId);
  if (!rootId) return;
  const root = await payrollPrisma.payrollAdjustment.findFirst({ where: { orgId, id: rootId }, select: { recoveryBase: true, status: true } });
  if (!root || root.recoveryBase != null || root.status === 'DRAFT') return;
  const { peoplePrisma } = await import('../../utils/peoplePrisma.js');
  const advances = await peoplePrisma.employeeAdvance.findMany({ where: { orgId, payrollAdjustmentId: { endsWith: rootId } }, select: { recoveredAmount: true, recoveringAmount: true, payrollAdjustmentId: true } });
  const a = advances.find((x) => liveLink(x.payrollAdjustmentId) === rootId);
  if (!a) return;
  const chain = await recoveryChain(orgId, rootId);
  if (!chain) return;
  const f = foldRecovery(a, chain);
  await payrollPrisma.payrollAdjustment.updateMany({ where: { orgId, id: rootId, recoveryBase: null }, data: { recoveryBase: Math.max(0, round2(f.recovered - chain.taken)) } });
}
