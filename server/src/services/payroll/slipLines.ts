/**
 * A payslip's lines as a person reads them (QA of PR #82, F4).
 *
 * - A line of nothing says nothing: a variable component nobody entered an
 *   amount for ("Fine ₹0.00") is left out.
 * - A deduction or earning somebody entered says why: "Fine: Broken display
 *   unit", from the reason recorded on the adjustment the payslip took
 *   (its snapshot), so two fines are two reasons rather than "Fine" twice.
 */
type Line = { componentId?: string | null; componentName: string; amount: unknown; displayOrder?: number | null; type: string };
type Snap = { id?: string; componentId?: string; amount?: number; type?: string; reason?: string | null };

/** Entered adjustments are written at display order 900 (run.ts); recoveries at 940/950 carry their own words. */
const ENTERED = 900;

export function readableLines<T extends Line>(lines: T[], adjustmentSnapshotJson: string | null | undefined): Array<T & { componentName: string }> {
  let snap: Snap[] = [];
  try {
    const parsed = JSON.parse(adjustmentSnapshotJson || '[]');
    if (Array.isArray(parsed)) snap = parsed;
  } catch {
    /* an old payslip without the snapshot */
  }
  const used = new Set<number>();
  return lines
    .filter((l) => Math.abs(Number(l.amount) || 0) >= 0.005)
    .map((l) => {
      if (l.displayOrder !== ENTERED) return l;
      const i = snap.findIndex((s, n) => !used.has(n) && s.componentId === l.componentId && Math.abs(Number(s.amount) - Number(l.amount)) < 0.005);
      if (i < 0) return l;
      used.add(i);
      const reason = String(snap[i].reason || '').trim();
      /* Corrections and late-mark penalties already use the reason as the line's name. */
      if (!reason || l.componentName === reason || l.componentName.includes(reason)) return l;
      return { ...l, componentName: `${l.componentName}: ${reason}`.slice(0, 120) };
    });
}

/** A line's count × rate (22 meals at ₹30), when it came from one; nothing otherwise. */
export function countOf(l: { quantity?: unknown; rate?: unknown; unit?: string | null }): { quantity?: number; rate?: number; unit?: string | null } {
  if (l.quantity == null || l.rate == null) return {};
  return { quantity: Number(l.quantity), rate: Number(l.rate), unit: l.unit || null };
}

/**
 * The salary changed inside the period (run.ts salaryAcross): each salary and
 * the days paid at it, from the payslip's own snapshot. Null when one salary
 * covered the whole period, or the structure itself changed (paid on the new
 * one and noted on the run instead).
 */
export function splitOf(assignmentSnapshot: any): { from: string; days: number; annualCtc: number; monthly: number }[] | null {
  const parts = Array.isArray(assignmentSnapshot?.parts) ? assignmentSnapshot.parts : [];
  if (parts.length < 2 || assignmentSnapshot?.paidOnAnnualCtc == null) return null;
  return parts.map((p: any) => ({ from: String(p.from), days: Number(p.days) || 0, annualCtc: Number(p.annualCtc) || 0, monthly: Math.round(((Number(p.annualCtc) || 0) / 12) * 100) / 100 }));
}
