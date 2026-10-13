/**
 * Period presets for document lists, and the words that describe a view.
 *
 * A plain module with no component imports: both toolbars need these, and
 * having one import the other created a cycle that ES modules tolerate right
 * up until the moment initialisation order changes.
 */
export const LIST_PERIODS = [
  { key: 'all', label: 'All time' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'thisYear', label: 'This year (FY)' },
  { key: 'custom', label: 'Custom range' },
];

/*
 * Local date parts, never toISOString().
 *
 * toISOString() converts to UTC first, so midnight on 1 September in IST is
 * 18:30 on 31 August in UTC — every preset landed a day early for anybody east
 * of Greenwich, and "This month" on the 1st returned the previous month.
 */
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * `{ from, to }` for a preset, or null for a range the caller types.
 *
 * "This year" is the Indian financial year, April to March — the year every
 * other figure in this product is reported against. A calendar year here would
 * quietly disagree with every report beside it.
 */
export const periodRange = (key, today = new Date()) => {
  if (key === 'all') return { from: '', to: '' };
  if (key === 'custom') return null;
  const to = new Date(today);
  let from = new Date(today);
  if (key === 'last30') from.setDate(from.getDate() - 29);
  if (key === 'thisMonth') from = new Date(today.getFullYear(), today.getMonth(), 1);
  if (key === 'thisYear') {
    const fyStart = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    from = new Date(fyStart, 3, 1);
  }
  return { from: iso(from), to: iso(to) };
};

/** What is filtering the view, in words, so an export says so on its face. */
export const describeView = ({ period, dateFrom, dateTo, status, search, statusLabel }) => {
  const parts = [LIST_PERIODS.find((p) => p.key === period)?.label || 'All time'];
  if (dateFrom || dateTo) parts.push(`${dateFrom || 'start'} to ${dateTo || 'today'}`);
  if (status) parts.push(statusLabel || status);
  if (String(search || '').trim()) parts.push(`matching “${String(search).trim()}”`);
  return parts.join(' · ');
};

