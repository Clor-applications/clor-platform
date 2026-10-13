/**
 * What is left to return.
 *
 * A credit note returns goods against a sales invoice; a debit note returns
 * them against a purchase bill. Either way the same rule holds: you cannot
 * return more than was sold or bought, and returning the same line twice is a
 * mistake the software should refuse rather than a judgement call.
 *
 * Nothing is stored. Returned quantities are always counted from the notes
 * themselves, so cancelling a note gives the quantity straight back.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round3 = (n) => Math.round(n * 1000) / 1000;

const isLiveNote = (note) => {
  const status = String(note?.status || '').trim().toLowerCase();
  return status !== 'cancelled';
};

/** Quantity already returned per item id, across every live note. */
export function returnedQtyByItem(notes, linkKey, sourceId, { excludeNoteId } = {}) {
  const map = new Map();
  for (const note of Array.isArray(notes) ? notes : []) {
    if (String(note?.[linkKey] ?? '') !== String(sourceId ?? '')) continue;
    if (!isLiveNote(note)) continue;
    if (excludeNoteId != null && String(note?.id) === String(excludeNoteId)) continue;
    for (const line of note.items || []) {
      const key = String(line?.itemId ?? '');
      if (!key) continue;
      map.set(key, round3((map.get(key) || 0) + num(line.quantity)));
    }
  }
  return map;
}

/**
 * The source document's lines with what is still returnable on each, and a
 * verdict for the document as a whole.
 */
export function returnableLines(source, notes, linkKey, { excludeNoteId } = {}) {
  const returned = returnedQtyByItem(notes, linkKey, source?.id, { excludeNoteId });

  const lines = (source?.items || []).map((line) => {
    const sold = num(line.quantity);
    const already = returned.get(String(line.itemId ?? '')) || 0;
    return {
      ...line,
      soldQty: sold,
      returnedQty: Math.min(sold, already),
      remainingQty: round3(Math.max(0, sold - already)),
    };
  });

  const totalSold = lines.reduce((t, l) => t + l.soldQty, 0);
  const totalReturned = lines.reduce((t, l) => t + l.returnedQty, 0);

  return {
    lines,
    open: lines.filter((l) => l.remainingQty > 0),
    totalSold: round3(totalSold),
    totalReturned: round3(totalReturned),
    fullyReturned: totalSold > 0 && totalReturned >= totalSold - 0.0001,
    partlyReturned: totalReturned > 0.0001 && totalReturned < totalSold - 0.0001,
  };
}

/** "Returned" / "Partly returned" / "" — for a list column or a document badge. */
export function returnStatusLabel(source, notes, linkKey) {
  const state = returnableLines(source, notes, linkKey);
  if (state.fullyReturned) return 'Returned';
  if (state.partlyReturned) return 'Partly returned';
  return '';
}
