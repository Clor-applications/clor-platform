# CLOR chart kit

Seven charts that take their **shapes** from [Bklit UI](https://bklit.com) (MIT) and their
**look** from `DESIGN.md`. Owner's rule for outside references (20 Nov 2026): take the
screens, structure and features; ignore the palette, theme and fonts. So none of Bklit's
black-and-white palette, Cal Sans / Geist Mono, 10–14px radii, springs, glow or particles.

Plain SVG and CSS, no chart library: a page that uses the kit adds a few KB, not ECharts.

```jsx
import { LineChart, BarChart, CalendarHeatmap, Meter, RingProgress, Funnel, Sparkline, fmtMoney, fmtMoneyShort } from '@ui/components/charts/kit';
```

**Motion kit (DESIGN.md, 24 Nov 2026) allows bars and lines only.** Use `LineChart`, `BarChart`
and `Sparkline`. `RingProgress`, `CalendarHeatmap`, `Funnel` and `Meter` stay in the kit and
the gallery as proposals; put them on a screen only after the owner says yes. Under Motion the
page's series is the primary (`focus`), the others violet-soft or red-soft: change `INK` in
`core.jsx` when the Motion token PR adds those tokens, and every chart follows.

Gallery (dev server): `/design-system/charts/?app=people` (tabs for every surface).

## Rules the kit enforces

- Ink first. A series takes the app colour only with `focus`; a bar only with `highlight`.
- Two or more lines are told apart by dash as well as tone, and named at the line ends.
- Category colours only where the category is written out (heatmap statuses, stack legend).
- Money: ₹ in front, Indian grouping, true minus; axes use `fmtMoneyShort` (₹6.4L, ₹3.1Cr).
- Every chart has a hidden table with the same figures; line, bar and heatmap read out
  point by point with the arrow keys (Home/End, Escape).
- Nothing animates but the 120ms tooltip fade; numbers never animate.
- No box around a chart: it sits on the page ground, under the page's own hairline.

## What goes where

| Surface | Chart | Place |
|---|---|---|
| clor.in | LineChart (area), Sparkline | Product windows on app pages show a live chart, not a screenshot. Website has its own Vite build: import the kit and map `--fg`/`--act` there first. |
| Admin center | Meter, BarChart (horizontal), LineChart | Home "At a glance": seats used, storage, two-step sign-in coverage. Billing: seats by app. Members: sign-ins over 30 days. |
| Ops | LineChart (target + forecast + quarter band), Funnel, BarChart (stacked) | Revenue: MRR against target. Sign-ups: pricing visit to paid. Revenue by app. |
| Console | CalendarHeatmap, LineChart (limit line) | Releases per day; API p95 against its limit. |
| People | LineChart (year before, dashed), BarChart, Funnel, RingProgress, CalendarHeatmap | Reports (replaces `YearOnYearLine` and `ReportChart`), hiring per opening, onboarding progress, team leave by day. |
| Books | LineChart, BarChart (highlight), Meter | Proposal only: Books is the other developer's area and keeps its ECharts set (`CircularCharts.jsx`). |
| Payroll | BarChart (stacked), RingProgress, Meter | Cost by part per month, this run's steps, PF/TDS deposited of due. |
| Attendance | CalendarHeatmap (status), BarChart (highlight today), Meter, Sparkline | My attendance (replaces nothing yet), this week (replaces `WeekBars`), hours against target, late arrivals. |

## Not taken from Bklit

Candlestick, choropleth, sankey, sunburst, radar, live line and particle line: no CLOR
screen asks a question they answer. Gauge dials: a Meter says the same in one line.
