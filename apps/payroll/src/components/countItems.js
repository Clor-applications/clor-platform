import { formatMoney, wholeRupees } from '@ui/utils/money';

/*
 * A list's figures as count-line items (DESIGN.md "Page header": a count line under the title, never figure
 * tiles). Takes the tile shape these screens already build ({ label, value, count?, whole?, tone?, onSelect? }),
 * keeps the same figures, formats money the way the tiles did, and leaves a figure at zero out.
 */

export function countItems(cards) {
  return (cards || []).filter(Boolean).map((c) => {
    const raw = c.value;
    const zero = raw === null || raw === undefined || raw === '' || (typeof raw === 'number' && raw === 0) || /^₹?\s?0(\.0+)?%?$/.test(String(raw).trim());
    const value = zero ? 0 : c.count ? String(raw) : c.whole ? wholeRupees(raw) : typeof raw === 'number' ? formatMoney(raw) : raw;
    return { key: c.label, label: c.label, value, tone: c.count && c.tone === 'overdue' ? 'neg' : undefined, onClick: c.onSelect };
  });
}
