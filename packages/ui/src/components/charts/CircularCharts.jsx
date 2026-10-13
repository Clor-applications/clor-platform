import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

import { prefersReducedMotion, resolveTokenColor, tooltipStyle, useChartTheme } from './useChartTheme';

/**
 * Circular charts for the dashboard.
 *
 * Used where "share of a whole" is genuinely the question — receivables by
 * age, customer concentration, collection rate. A donut is a poor tool for
 * comparing many similar values, so each of these caps its slices and pushes
 * the tail into a single "Other", and every one is paired with a labelled
 * legend carrying the exact figures. The ring is decoration on top of numbers
 * that are already readable.
 */

const common = (t) => ({
  animation: !prefersReducedMotion(),
  animationDuration: 520,
  animationEasing: 'cubicOut',
  tooltip: { ...tooltipStyle(t), trigger: 'item' },
  textStyle: { fontFamily: 'Inter, sans-serif' },
});

/**
 * Donut with the headline figure in the hole.
 *
 * The centre is where the eye lands, so it carries the total rather than a
 * label repeating what the card title already said.
 */
export function DonutChart({ data = [], centerLabel, centerValue, height = 230, formatter }) {
  const t = useChartTheme();

  const option = useMemo(
    () => ({
      ...common(t),
      legend: { show: false },
      series: [
        {
          type: 'pie',
          radius: ['62%', '86%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          padAngle: 2,
          itemStyle: { borderRadius: 6, borderColor: t.surface, borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: { shadowBlur: 14, shadowColor: 'rgba(17,24,39,0.18)' },
          },
          data: data.map((d) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: resolveTokenColor(d.color, t.subtle) },
          })),
        },
      ],
    }),
    [t, data]
  );

  const total = data.reduce((s, d) => s + Number(d.value || 0), 0);

  return (
    <div className="relative" style={{ height }}>
      <ReactECharts
        option={option}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'svg' }}
        notMerge
      />
      {/* Centre text sits outside the canvas so it inherits the app's font and
          stays selectable and readable to a screen reader. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="ui-t-label ui-subtle uppercase tracking-wider">{centerLabel}</span>
        <span className="ui-money-lg mt-0.5">
          {centerValue ?? (formatter ? formatter(total) : total)}
        </span>
      </div>
    </div>
  );
}

/**
 * Radial gauge for a single percentage.
 *
 * A gauge answers "how far along" better than a bar because the arc has a
 * visible end — you can see the remaining distance, not just the fill.
 */
/**
 * `centerText` replaces the percentage in the middle.
 *
 * A percentage is the right centre when the ratio is the point — share of
 * capacity, share of target. It is the wrong one for a countdown: "18%" tells
 * a filer nothing, "9d left" tells them whether to open the return today. The
 * arc still carries the ratio; only the words in the hole change.
 */
export function RadialGauge({ value = 0, label, height = 230, tone, centerText = null }) {
  const t = useChartTheme();
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const color = tone === 'pos' ? t.pos : tone === 'neg' ? t.neg : t.brand;

  const option = useMemo(
    () => ({
      ...common(t),
      tooltip: { show: false },
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: '96%',
          center: ['50%', '56%'],
          progress: { show: true, width: 16, roundCap: true, itemStyle: { color } },
          axisLine: { lineStyle: { width: 16, color: [[1, t.sunken]] }, roundCap: true },
          pointer: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          detail: {
            valueAnimation: !prefersReducedMotion(),
            offsetCenter: [0, '4%'],
            fontSize: centerText ? 26 : 34,
            fontWeight: 700,
            fontFamily: 'Inter, sans-serif',
            color: t.fg,
            formatter: () => centerText || `${pct}%`,
          },
          // No in-arc title: a money string long enough to be useful always
          // collides with the value. Callers render the detail below instead.
          title: { show: false },
          data: [{ value: pct }],
        },
      ],
    }),
    [t, pct, color, centerText]
  );

  return (
    <div className="w-full" style={{ height }} role="img" aria-label={centerText ? `${label}: ${centerText}` : `${label}: ${pct} percent`}>
      <ReactECharts
        option={option}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'svg' }}
        notMerge
      />
    </div>
  );
}

/**
 * Pie for composition, capped so it stays readable, with its legend beside it.
 *
 * Anything past `maxSlices` collapses into "Other" — a pie with fifteen slivers
 * communicates nothing. The legend carries the exact figures, because a circle
 * cannot convey precision and the reader usually wants both.
 */
export function CompositionPie({ data = [], height = 230, maxSlices = 5, palette, formatter }) {
  const t = useChartTheme();

  const rows = useMemo(() => {
    const colors = palette || [t.brand, t.info, t.pos, t.warn, t.neg];
    const sorted = [...data].sort((a, b) => b.value - a.value);
    const head = sorted.slice(0, maxSlices);
    const tail = sorted.slice(maxSlices);
    const out = head.map((d, i) => ({ ...d, color: d.color || colors[i % colors.length] }));
    if (tail.length) {
      out.push({
        name: `Other (${tail.length})`,
        value: tail.reduce((sum, d) => sum + Number(d.value || 0), 0),
        color: t.subtle,
      });
    }
    return out;
  }, [data, maxSlices, palette, t]);

  const option = useMemo(
    () => ({
      ...common(t),
      legend: { show: false },
      series: [
        {
          type: 'pie',
          radius: '78%',
          center: ['50%', '50%'],
          padAngle: 1.5,
          itemStyle: { borderRadius: 4, borderColor: t.surface, borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 5 },
          data: rows.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: resolveTokenColor(d.color, t.subtle) } })),
        },
      ],
    }),
    [t, rows]
  );

  // Stacked, not side by side: these cards sit in a half-width column, and
  // splitting that again squeezed customer names down to "Custome…". The
  // legend is the part that has to stay readable.
  return (
    <div className="space-y-6">
      <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />
      <ChartLegend rows={rows} formatter={formatter} />
    </div>
  );
}

/** Legend rows carrying the exact figures a circle cannot convey precisely. */
export function ChartLegend({ rows = [], total, formatter }) {
  const sum = total ?? rows.reduce((s, r) => s + Number(r.value || 0), 0);

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const share = sum > 0 ? Math.round((r.value / sum) * 100) : 0;
        return (
          <li key={r.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
                aria-hidden="true"
              />
              <span className="truncate">{r.name}</span>
            </span>
            <span className="flex flex-shrink-0 items-baseline gap-2">
              <span className="ui-subtle text-xs tabular-nums">{share}%</span>
              <span className="tabular-nums">
                {formatter ? formatter(r.value) : r.value}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Vertical bars for a value per period.
 *
 * Minimal axis and no grid: the bars carry the comparison, and gridlines at
 * this size compete with them. Values arrive on hover rather than as permanent
 * labels, which keeps a twelve-bar series readable.
 */
export function PeriodBars({ data = [], height = 240, formatter, tone = 'brand' }) {
  const t = useChartTheme();
  // Money-in charts keep the brand orange; money-out charts take the deeper
  // accent so two bar charts on one dashboard never read as the same series.
  const barColor = tone === 'deep' ? t.brandDeep : t[tone] || t.brand;

  const option = useMemo(
    () => ({
      ...common(t),
      grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
      tooltip: {
        ...tooltipStyle(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `${t.sunken}` } },
        valueFormatter: (v) => (formatter ? formatter(v) : v),
      },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.label),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 11, interval: 0, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
        axisLabel: {
          color: t.muted,
          fontSize: 11,
          formatter: (v) => (formatter ? formatter(v) : v),
        },
      },
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.value),
          barMaxWidth: 26,
          itemStyle: { color: barColor, borderRadius: [6, 6, 0, 0] },
          emphasis: { itemStyle: { color: barColor, opacity: 0.85 } },
        },
      ],
    }),
    [t, data, formatter, barColor]
  );

  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />;
}

/**
 * Horizontal bars for a ranked comparison.
 *
 * Horizontal because the labels are names: rotating a customer name to fit
 * under a vertical bar is how a chart stops being readable. Sorted descending,
 * so the eye starts at the value that matters.
 */
export function RankedBars({ data = [], height = 240, formatter }) {
  const t = useChartTheme();
  const rows = useMemo(() => [...data].sort((a, b) => a.value - b.value), [data]);

  const option = useMemo(
    () => ({
      ...common(t),
      grid: { left: 8, right: 24, top: 8, bottom: 4, containLabel: true },
      tooltip: {
        ...tooltipStyle(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: `${t.sunken}` } },
        valueFormatter: (v) => (formatter ? formatter(v) : v),
      },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
        axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => (formatter ? formatter(v) : v) },
      },
      yAxis: {
        type: 'category',
        data: rows.map((d) => d.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((d) => d.value),
          barMaxWidth: 18,
          itemStyle: { color: t.brand, borderRadius: [0, 6, 6, 0] },
          label: {
            show: true,
            position: 'right',
            color: t.muted,
            fontSize: 11,
            formatter: ({ value }) => (formatter ? formatter(value) : value),
          },
        },
      ],
    }),
    [t, rows, formatter]
  );

  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />;
}

/**
 * Two bar series and a line over the same periods.
 *
 * The module overviews ask one question the single-series bars cannot answer:
 * of what was billed in a period, how much actually arrived, and what is still
 * outstanding. Three numbers per period, and the comparison only works if they
 * share an axis — two charts side by side make the eye do arithmetic.
 *
 * Bars for the two quantities that are compared to each other, a line for the
 * one that is a running level rather than a total. Outstanding is not "more
 * bar", it is where the balance sat, and drawing it as a third bar invites
 * people to add all three together.
 *
 * @param data    [{ label, invoiced, received, outstanding }]
 * @param series  labels for the three, so a purchase overview can say
 *                "Billed / Paid / Payable" without a second component
 */
export function SeriesBars({
  data = [],
  height = 300,
  formatter,
  series = { bar1: 'Invoiced', bar2: 'Received', line: 'Outstanding' },
  /*
   * Which field on a row feeds each series.
   *
   * The keys used to be hard-coded to the sales words, so the purchase page
   * handed it rows of `billed` / `paid` / `payable` and got a chart of three
   * empty series and an axis running to ₹1 — a chart that looks broken rather
   * than one that says nothing was bought.
   */
  keys = { bar1: 'invoiced', bar2: 'received', line: 'outstanding' },
}) {
  const t = useChartTheme();

  const option = useMemo(
    () => ({
      ...common(t),
      /* The analytics palette, never the brand: a chart is a dataset, not an
         action. The third series was the brand orange, which made the line
         read last the loudest mark on the chart.

         Purple leads because it is the one hue on the page that nothing else
         claims — the module identities run blue, green, amber and red, and
         the brand is orange — so the bar a reader is meant to follow cannot
         be mistaken for a status or a thing to press. Blue pairs with it for
         the second bar; the line stays muted so it sits behind both. */
      color: [t.chartPurple, t.chartBlue, t.chartMuted],
      grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
      legend: { show: false },
      tooltip: {
        ...tooltipStyle(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: t.sunken } },
        valueFormatter: (v) => (formatter ? formatter(v) : v),
      },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.label),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        // Whole rupees only. Without this a series whose maximum is small gets
        // a 0-to-1 axis with fractional ticks, and a compact money formatter
        // renders those as "₹0 ₹0 ₹0 ₹1 ₹1 ₹1" — six labels, three distinct
        // values, and no way to tell which is which.
        minInterval: 1,
        splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
        axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => (formatter ? formatter(v) : v) },
      },
      series: [
        {
          name: series.bar1,
          type: 'bar',
          data: data.map((d) => Number(d[keys.bar1] || 0)),
          barMaxWidth: 18,
          itemStyle: { color: t.ovBlue, borderRadius: [4, 4, 0, 0] },
        },
        {
          name: series.bar2,
          type: 'bar',
          data: data.map((d) => Number(d[keys.bar2] || 0)),
          barMaxWidth: 18,
          itemStyle: { color: t.ovGreen, borderRadius: [4, 4, 0, 0] },
        },
        {
          name: series.line,
          type: 'line',
          data: data.map((d) => Number(d[keys.line] || 0)),
          smooth: false,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { color: t.brand, width: 2 },
          itemStyle: { color: t.brand },
        },
      ],
    }),
    [t, data, formatter, series, keys]
  );

  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />;
}
