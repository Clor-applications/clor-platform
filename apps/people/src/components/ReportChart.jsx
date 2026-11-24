import React from 'react';
import { BarChart, INK, LineChart } from '@ui/components/charts/kit';

/**
 * The one chart a People report draws, from the CLOR chart kit (24 Nov 2026):
 * bars per category, stacked or side by side, or a line a series.
 *
 * Three tones at most (UI rules, 8 Nov 2026): the first three series take the
 * kit's ink, mid grey and light grey; a series marked `other`, and anything past
 * the third, is the faint grey. The kit adds the arrow-key read-out and a table
 * of the same figures for a screen reader.
 *
 * chart: { kind: 'stacked' | 'grouped' | 'line', unit?: '%', categories: [label], series: [{ label, values: [n], other }] }
 */
export const CHART_COLOURS = 3;

export default function ReportChart({ chart, label }) {
  if (!chart?.categories?.length || !chart.series?.length) return null;
  const { categories } = chart;
  /* Round 29 pick "chartempty" C: a chart with nothing in it yet is not drawn
     as a row of empty columns; the table under it already says so in words. */
  if (!chart.series.some((s) => (s.values || []).some((v) => Number(v) > 0))) return null;
  const unit = chart.unit || '';
  const format = (v) => (v == null ? '' : `${Number(v).toLocaleString('en-IN')}${unit}`);
  const series = chart.series.map((s, i) => ({
    name: s.label,
    values: s.values || [],
    ...(s.other || i >= CHART_COLOURS ? { color: INK.faint } : {}),
  }));
  if (chart.kind === 'line') {
    return <LineChart label={label} categories={categories} series={series} format={format} height={200} />;
  }
  return (
    <BarChart
      label={label}
      categories={categories}
      series={series}
      stacked={chart.kind === 'stacked'}
      labels={categories.length <= 18}
      format={format}
      height={220}
    />
  );
}
