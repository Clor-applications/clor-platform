/**
 * The item a stale document line meant — see scripts/backfillLineItemIds.ts.
 *
 * Pure, so it can be tested without a database.
 */
export type LegacyItem = { id: string; name: string; hsnSac: string | null; gstRate: any; createdAt: Date };

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The item a stale reference meant, or null when it cannot be told for certain. */
export function resolveLegacyItem(
  line: any,
  items: LegacyItem[],
  writtenAt: Date | null
): { id: string; how: 'name' | 'position' } | null {
  const want = norm(line?.description ?? line?.name ?? line?.itemName);
  if (want) {
    const byName = items.filter((i) => norm(i.name) === want);
    if (byName.length === 1) return { id: byName[0].id, how: 'name' };
  }
  const n = num(line?.itemId);
  if (n !== null && Number.isInteger(n) && n > 0 && writtenAt) {
    const then = items
      .filter((i) => i.createdAt <= writtenAt)
      // As the database sorts names (locale order, not code points).
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const guess = then[n - 1];
    if (guess) {
      const hsnOk = norm(line?.hsnSac ?? line?.hsn) === norm(guess.hsnSac);
      const lineRate = num(line?.gstRate ?? line?.taxRate);
      const rateOk = lineRate !== null && lineRate === num(guess.gstRate);
      if (hsnOk && rateOk) return { id: guess.id, how: 'position' };
    }
  }
  return null;
}

