/**
 * A list page's figures as count-line items (DESIGN.md "Page header", calm register):
 * the same figures the tiles showed, as one line under the title. CountLine leaves out
 * a figure at zero or still loading; a figure that filtered the list still does.
 */
const TONE = { overdue: 'neg', outstanding: 'warn' };

const figure = (v) => (typeof v === 'number' ? v.toLocaleString('en-IN') : v);

export const countItems = (cards) => (cards || []).filter(Boolean).map((c) => ({
  key: c.key || c.label,
  label: c.label,
  value: figure(c.value),
  tone: TONE[c.tone],
  onClick: c.onSelect,
  active: c.active,
}));

export default countItems;
