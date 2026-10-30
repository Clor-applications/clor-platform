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

export async function recoveryChain(orgId: string, rootId: string, db: any = payrollPrisma): Promise<Chain | null> {
  const root = await db.payrollAdjustment.findFirst({ where: { orgId, id: rootId }, select: { id: true, status: true, amount: true, reference: true, carriedFromId: true } });
  if (!root) return null;
  const all = root.reference
    ? await db.payrollAdjustment.findMany({ where: { orgId, OR: [{ id: rootId }, { reference: root.reference }] }, select: { id: true, status: true, amount: true, carriedFromId: true } })
    : [root];
  const children = new Map<string, any[]>();
  for (const r of all) if (r.carriedFromId) children.set(r.carriedFromId, [...(children.get(r.carriedFromId) || []), r]);
  const seen = new Set<string>([root.id]);
  const rows = [root];
  for (let i = 0; i < rows.length; i += 1) {
    for (const k of children.get(rows[i].id) || []) if (!seen.has(k.id)) { seen.add(k.id); rows.push(k); }
  }
  const sum = (s: string) => round2(rows.filter((r) => r.status === s).reduce((t, r) => t + Number(r.amount), 0));
  return {
    root: { id: root.id, status: root.status },
    taken: sum('CONSUMED'),
    open: sum('APPROVED'),
    cancelled: sum('CANCELLED'),
    draft: sum('DRAFT'),
    rows: rows.map((r) => ({ id: r.id, status: r.status, amount: Number(r.amount) })),
  };
}

/**
 * Where an advance stands against its chain. People's `recoveringAmount` is
 * what it sent and has not yet counted; what the chain has taken beyond what
 * was counted is now recovered, and what is still open in Payroll is still
 * "being taken from salary". Derived from the chain each time, so a
 * recalculation, a cancelled run or a second read moves nothing twice: a run
 * cancelled after its payslip was counted gives the amount back to open.
 */
export function foldRecovery(row: { recoveredAmount: unknown; recoveringAmount: unknown }, chain: Chain | null) {
  const recovered = round2(Number(row.recoveredAmount) || 0);
  const recovering = round2(Number(row.recoveringAmount) || 0);
  /* Deleted in Payroll: nothing was taken through it. */
  if (!chain) return { recovered, recovering: 0 };
  /* Not approved yet: unchanged. */
  if (chain.root.status === 'DRAFT') return { recovered, recovering };
  const total = round2(chain.taken + chain.open + chain.cancelled);
  /*
   * What of the chain People already counted. Never below nothing: when
   * Payroll edits a recovery down (₹5,000 sent, ₹3,000 kept), the chain holds
   * less than was sent, and the ₹2,000 cut is not recovered. It goes back to
   * open, owed by the person, and a full and final lists it (QA of #82, F1).
   */
  const counted = Math.max(0, round2(total - recovering));
  return { recovered: Math.max(0, round2(recovered + chain.taken - counted)), recovering: chain.open };
}
