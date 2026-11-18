/**
 * Round 26 pick: men and women in each team as a table with counts AND the
 * percent of women. The gender report already gives Women, Men and Total per
 * group; this adds a "% women" column worked out from those counts. Where the
 * counts are masked ("Fewer than 5") the percent is left blank, so small
 * groups stay private.
 */
export function withWomenShare(d) {
  if (!d || d.id !== 'gender' || !Array.isArray(d.columns) || !Array.isArray(d.rows)) return d;
  if (!d.columns.some((c) => c.key === 'FEMALE') || d.columns.some((c) => c.key === 'womenPct')) return d;
  const pct = (row) => {
    if (!row) return row;
    const women = row.FEMALE;
    const total = row.total;
    const value = typeof women === 'number' && typeof total === 'number' && total > 0 ? (women / total) * 100 : null;
    return { ...row, womenPct: value };
  };
  /* All counts masked: a column of dashes says nothing, so leave the table as it is. */
  if (!d.rows.some((r) => typeof r.FEMALE === 'number' && typeof r.total === 'number' && r.total > 0)) return d;
  return {
    ...d,
    columns: [...d.columns, { key: 'womenPct', label: '% women', align: 'right', kind: 'pct' }],
    rows: d.rows.map(pct),
    totals: d.totals ? pct(d.totals) : d.totals,
  };
}
