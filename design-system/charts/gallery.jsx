/* Chart kit gallery (dev only): every kit chart, placed where it would go in
   each CLOR surface, in that surface's colours. Open /design-system/charts/
   on the dev server. Sample figures only. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/figtree';
import '../../packages/ui/src/index.css';
import '../../packages/ui/src/rnd.css';
import {
  BarChart,
  CalendarHeatmap,
  Funnel,
  INK,
  LineChart,
  Meter,
  RingProgress,
  Sparkline,
  fmtMoney,
  fmtMoneyShort,
} from '../../packages/ui/src/components/charts/kit';
import ReportChart from '../../apps/people/src/components/ReportChart';

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const days = (n, f) => {
  const out = [];
  const end = new Date('2026-11-24T00:00:00Z');
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    out.push(f(d.toISOString().slice(0, 10), d.getUTCDay(), i));
  }
  return out;
};

const SURFACES = [
  { id: 'site', name: 'clor.in', attrs: {} },
  { id: 'admin', name: 'Admin center', attrs: { 'data-app': 'admin' } },
  { id: 'ops', name: 'Ops', attrs: { 'data-portal': 'ops' } },
  { id: 'console', name: 'Console', attrs: {} },
  { id: 'people', name: 'People', attrs: { 'data-app': 'people' } },
  { id: 'books', name: 'Books', attrs: { 'data-palette': 'indigo' } },
  { id: 'payroll', name: 'Payroll', attrs: { 'data-app': 'payroll' } },
  { id: 'attendance', name: 'Attendance', attrs: { 'data-app': 'attendance' } },
];

function Panel({ where, children, wide }) {
  return (
    <section className={`g-panel${wide ? ' g-wide' : ''}`}>
      <p className="g-where">{where}</p>
      {children}
    </section>
  );
}

const leaveDays = days(182, (date, dow) => {
  if (dow === 0 || dow === 6) return { date };
  const r = rnd();
  return { date, value: r > 0.55 ? Math.ceil(r * 9) - 4 : 0 };
});
const attendanceDays = days(120, (date, dow) => {
  if (dow === 0) return { date, status: 'off' };
  const r = rnd();
  return { date, status: r > 0.95 ? 'absent' : r > 0.88 ? 'leave' : r > 0.83 ? 'half' : 'present' };
});
const releaseDays = days(182, (date, dow) => ({ date, value: dow === 0 || dow === 6 ? 0 : Math.floor(rnd() * 5) }));

const SHOW = {
  site: () => (
    <>
      <Panel where="Product window on the Books page: the screenshot is a live chart, not a picture" wide>
        <LineChart
          title="Sales this year"
          figure="₹48.2L"
          categories={MONTHS.slice(0, 8)}
          series={[{ name: 'Sales', values: [310000, 420000, 380000, 560000, 610000, 590000, 720000, 830000], focus: true }]}
          kind="area"
          format={fmtMoney}
          axisFormat={fmtMoneyShort}
          height={200}
        />
      </Panel>
      <Panel where="Feature row on the People page">
        <p className="g-copy">Headcount <Sparkline values={[42, 44, 47, 47, 51, 55, 58, 61]} focus label="Headcount" /> <b>61</b></p>
        <p className="g-copy">Attrition <Sparkline values={[3, 2, 4, 1, 2, 1, 1, 0]} kind="bar" label="Leavers by month" /> <b>0 this month</b></p>
      </Panel>
    </>
  ),
  admin: () => (
    <>
      <Panel where="Home, At a glance: seats and storage">
        <div className="g-stack">
          <Meter label="Seats in use" value={46} max={50} tone="warn" status="4 left" />
          <Meter label="Storage" value={3.1} max={10} unit=" GB" format={(v) => v.toLocaleString('en-IN')} />
          <Meter label="Admins with two-step sign-in" value={3} max={4} />
        </div>
      </Panel>
      <Panel where="Billing: seats by app">
        <BarChart
          title="Seats by app"
          horizontal
          categories={['People', 'Payroll', 'Attendance', 'Books']}
          series={[{ name: 'Seats', values: [46, 40, 28, 6] }]}
        />
      </Panel>
      <Panel where="Members: sign-ins, last 30 days" wide>
        <LineChart
          title="Sign-ins"
          figure="1,284"
          note="Last 30 days"
          categories={days(30, (d) => d.slice(8))}
          series={[{ name: 'Sign-ins', values: days(30, (_, dow) => (dow === 0 || dow === 6 ? 6 + Math.floor(rnd() * 6) : 40 + Math.floor(rnd() * 25))) }]}
          height={180}
        />
      </Panel>
    </>
  ),
  ops: () => (
    <>
      <Panel where="Revenue: monthly recurring, with target and forecast" wide>
        <LineChart
          title="Monthly recurring revenue"
          figure="₹6.4L"
          categories={MONTHS}
          series={[
            { name: 'This year', values: [180000, 220000, 260000, 310000, 380000, 420000, 510000, 640000, 700000, 760000, 820000, 890000], focus: true },
            { name: 'Last year', values: [60000, 70000, 85000, 90000, 110000, 120000, 140000, 150000, 160000, 170000, 175000, 180000] },
          ]}
          reference={[{ value: 750000, label: 'Target ₹7.5L' }]}
          projectFrom={7}
          band={{ from: 6, to: 8, label: 'Q3' }}
          format={fmtMoney}
          axisFormat={fmtMoneyShort}
        />
      </Panel>
      <Panel where="Sign-ups: visit to paid">
        <Funnel
          title="Sign-up funnel"
          note="November"
          steps={[{ name: 'Pricing visits', value: 4210 }, { name: 'Demo form', value: 612 }, { name: 'Trial started', value: 238 }, { name: 'Paid', value: 41 }]}
          focus={2}
        />
      </Panel>
      <Panel where="Revenue by app, stacked">
        <BarChart
          title="Revenue by app"
          stacked
          categories={MONTHS.slice(0, 8)}
          series={[
            { name: 'People', values: [80, 95, 110, 130, 160, 170, 210, 260].map((v) => v * 1000) },
            { name: 'Payroll', values: [60, 70, 80, 100, 120, 140, 170, 210].map((v) => v * 1000) },
            { name: 'Other apps', values: [40, 55, 70, 80, 100, 110, 130, 170].map((v) => v * 1000) },
          ]}
          format={fmtMoney}
          axisFormat={fmtMoneyShort}
        />
      </Panel>
    </>
  ),
  console: () => (
    <>
      <Panel where="Releases: one square a day" wide>
        <CalendarHeatmap title="Releases" figure="214" note="Last six months" days={releaseDays} unit=" releases" />
      </Panel>
      <Panel where="Overview: API response time, with the limit" wide>
        <LineChart
          title="API p95"
          figure="182 ms"
          categories={days(14, (d) => `${Number(d.slice(8))} Nov`)}
          series={[{ name: 'p95', values: [170, 175, 168, 190, 240, 210, 180, 176, 172, 185, 178, 181, 179, 182] }]}
          reference={[{ value: 300, label: 'Limit 300 ms' }]}
          format={(v) => `${v} ms`}
          height={180}
        />
      </Panel>
    </>
  ),
  people: () => (
    <>
      <Panel where="Live: Reports, Joined and left (round 22 pick, now on the kit)" wide>
        <BarChart
          stacked
          labels
          label="Joiners and leavers each month"
          categories={MONTHS.slice(0, 8)}
          series={[{ name: 'Joined', values: [3, 2, 4, 0, 5, 4, 3, 3] }, { name: 'Left', values: [1, 0, 1, 0, 1, 0, 0, 0], down: true }]}
          height={220}
        />
      </Panel>
      <Panel where="Live: HR report chart, stacked with a grey Other (ReportChart)">
        <ReportChart label="Headcount over time" chart={{ kind: 'stacked', categories: ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026'], series: [{ label: 'Sales', values: [14, 15, 15, 16] }, { label: 'Ops', values: [11, 11, 12, 12] }, { label: 'Finance', values: [7, 7, 7, 8] }, { label: 'Other', values: [5, 5, 6, 6], other: true }] }} />
      </Panel>
      <Panel where="Live: HR report line (ReportChart, absence rate)">
        <ReportChart label="Absence rate" chart={{ kind: 'line', unit: '%', categories: ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026'], series: [{ label: 'Absence rate', values: [2.5, 4, 1.2, 3.1, 2.2] }] }} />
      </Panel>
      <Panel where="Reports: headcount, with a year before (replaces YearOnYearLine)" wide>
        <LineChart
          title="Headcount"
          figure="61"
          categories={MONTHS}
          series={[
            { name: 'This year', values: [42, 44, 47, 47, 51, 55, 58, 61, 63, 64, 66, 68], focus: true },
            { name: 'A year before', values: [30, 31, 31, 33, 35, 36, 38, 39, 40, 40, 41, 42] },
          ]}
          projectFrom={7}
        />
      </Panel>
      <Panel where="Reports: headcount by department">
        <BarChart
          title="By department"
          horizontal
          categories={['Engineering', 'Sales', 'Operations', 'Finance', 'People team']}
          series={[{ name: 'People', values: [24, 14, 11, 7, 5] }]}
        />
      </Panel>
      <Panel where="Hiring: one opening, applied to joined">
        <Funnel
          title="Senior accountant"
          steps={[{ name: 'Applied', value: 148 }, { name: 'Screened', value: 52 }, { name: 'Interviewed', value: 14 }, { name: 'Offered', value: 3 }, { name: 'Joined', value: 2 }]}
          focus={1}
        />
      </Panel>
      <Panel where="Onboarding: a new joiner's tasks">
        <RingProgress
          center="70%"
          rings={[
            { name: 'Documents', value: 6, max: 6 },
            { name: 'Accounts set up', value: 3, max: 5 },
            { name: 'Training', value: 2, max: 4 },
          ]}
        />
      </Panel>
      <Panel where="Time: team leave by day, six months">
        <CalendarHeatmap title="Team leave" note="People on leave each day" days={leaveDays} unit=" on leave" />
      </Panel>
    </>
  ),
  books: () => (
    <>
      <p className="g-flag">Books is the other developer's area: these are proposals only, nothing in Books changes.</p>
      <Panel where="Dashboard: sales and purchases" wide>
        <LineChart
          title="Sales and purchases"
          categories={MONTHS.slice(0, 8)}
          series={[
            { name: 'Sales', values: [310000, 420000, 380000, 560000, 610000, 590000, 720000, 830000], focus: true },
            { name: 'Purchases', values: [210000, 260000, 300000, 320000, 410000, 380000, 450000, 520000] },
          ]}
          format={fmtMoney}
          axisFormat={fmtMoneyShort}
        />
      </Panel>
      <Panel where="Receivables by age (the oldest bucket is the one to chase)">
        <BarChart
          title="Receivables by age"
          figure="₹9.6L"
          horizontal
          highlight={3}
          categories={['Not due', '1–30 days', '31–60 days', 'Over 60 days']}
          series={[{ name: 'Due', values: [420000, 260000, 130000, 150000] }]}
          format={fmtMoneyShort}
        />
      </Panel>
      <Panel where="GST: returns filed this year">
        <div className="g-stack">
          <Meter label="GSTR-1 filed" value={7} max={12} />
          <Meter label="GSTR-3B filed" value={6} max={12} tone="warn" status="October late" />
        </div>
      </Panel>
    </>
  ),
  payroll: () => (
    <>
      <Panel where="Pay runs: cost by part, month by month" wide>
        <BarChart
          title="Payroll cost"
          figure="₹18.4L"
          stacked
          categories={MONTHS.slice(0, 8)}
          series={[
            { name: 'Net pay', values: [12.1, 12.3, 12.6, 12.6, 13.4, 13.9, 14.2, 14.6].map((v) => v * 1e5) },
            { name: 'Tax and PF', values: [2.4, 2.4, 2.5, 2.5, 2.7, 2.8, 2.8, 2.9].map((v) => v * 1e5) },
            { name: 'Employer cost', values: [0.8, 0.8, 0.8, 0.8, 0.9, 0.9, 0.9, 0.9].map((v) => v * 1e5) },
          ]}
          format={fmtMoney}
          axisFormat={fmtMoneyShort}
        />
      </Panel>
      <Panel where="This month's pay run: how far along">
        <RingProgress
          center="3 of 4"
          rings={[
            { name: 'Attendance locked', value: 61, max: 61 },
            { name: 'Payslips checked', value: 48, max: 61, focus: true },
            { name: 'Approved', value: 0, max: 1 },
          ]}
        />
      </Panel>
      <Panel where="Statutory: what is paid of what is due">
        <div className="g-stack">
          <Meter label="PF deposited" value={287400} max={287400} format={fmtMoney} />
          <Meter label="TDS deposited" value={92000} max={141000} format={fmtMoney} tone="warn" status="Due 7 Dec" />
        </div>
      </Panel>
    </>
  ),
  attendance: () => (
    <>
      <Panel where="My attendance: four months, a word for every status" wide>
        <CalendarHeatmap
          title="Attendance"
          figure="96%"
          days={attendanceDays}
          statuses={[
            { key: 'present', label: 'Present', color: 'rgb(var(--fg) / 0.55)' },
            { key: 'half', label: 'Half day', color: INK.warn },
            { key: 'leave', label: 'On leave', color: INK.act2 },
            { key: 'absent', label: 'Absent', color: INK.neg },
            { key: 'off', label: 'Weekly off', color: 'rgb(var(--border))' },
          ]}
        />
      </Panel>
      <Panel where="Portal: this week, today marked">
        <BarChart
          title="This week"
          figure="31h 20m"
          categories={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']}
          series={[{ name: 'Hours', values: [8.5, 9.1, 7.2, 6.5, 0, 0] }]}
          highlight={3}
          format={(v) => `${v}h`}
          height={180}
        />
      </Panel>
      <Panel where="Portal: hours against the week's target">
        <div className="g-stack">
          <Meter label="Hours this week" value={31.3} max={48} target={45} unit="h" format={(v) => v.toLocaleString('en-IN')} />
          <p className="g-copy">Late arrivals <Sparkline values={[3, 1, 2, 4, 0, 1, 2, 1]} kind="bar" label="Late arrivals by week" /> <b>1 this week</b></p>
        </div>
      </Panel>
    </>
  ),
};

function Gallery() {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get('app') || 'people');
  useEffect(() => {
    const html = document.documentElement;
    ['data-app', 'data-portal', 'data-palette'].forEach((a) => html.removeAttribute(a));
    Object.entries(SURFACES.find((s) => s.id === id).attrs).forEach(([k, v]) => html.setAttribute(k, v));
    history.replaceState(null, '', `?app=${id}`);
  }, [id]);
  const Body = SHOW[id];
  return (
    <main className="g-page">
      <header className="g-header">
        <h1 className="g-h1">Chart kit</h1>
        <p className="g-count">7 charts · Bklit UI shapes in CLOR's look · sample figures</p>
        <nav className="g-tabs" aria-label="Surface">
          {SURFACES.map((s) => (
            <button key={s.id} type="button" aria-current={s.id === id ? 'page' : undefined} onClick={() => setId(s.id)}>
              {s.name}
            </button>
          ))}
        </nav>
      </header>
      <div className="g-grid">
        <Body />
      </div>
    </main>
  );
}

const css = document.createElement('style');
css.textContent = `
  body { margin: 0; background: rgb(var(--app-bg)); color: rgb(var(--fg)); font-family: 'Figtree Variable', system-ui, sans-serif; }
  .g-page { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
  .g-h1 { font-size: 24px; line-height: 32px; font-weight: 700; margin: 0; }
  .g-count { font-size: 14px; color: rgb(var(--fg-muted)); margin: 4px 0 16px; }
  .g-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid rgb(var(--border)); margin-bottom: 24px; }
  .g-tabs button { font: inherit; font-size: 14px; height: 36px; padding: 0 12px; border: 0; background: none; color: rgb(var(--fg-muted)); border-bottom: 2px solid transparent; cursor: pointer; border-radius: 8px 8px 0 0; }
  .g-tabs button:hover { background: rgb(var(--hover)); color: rgb(var(--fg)); }
  .g-tabs button:focus-visible { outline: 2px solid rgb(var(--act)); outline-offset: -2px; }
  .g-tabs button[aria-current='page'] { color: rgb(var(--act-ink)); border-bottom-color: rgb(var(--act)); font-weight: 600; }
  .g-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 32px 40px; }
  .g-panel { min-width: 0; padding-top: 16px; border-top: 1px solid rgb(var(--border)); }
  .g-wide { grid-column: 1 / -1; }
  .g-where { font-size: 12px; line-height: 16px; color: rgb(var(--fg-muted)); margin: 0 0 12px; }
  .g-stack { display: flex; flex-direction: column; gap: 20px; }
  .g-copy { font-size: 14px; display: flex; align-items: center; gap: 12px; margin: 0 0 12px; }
  .g-copy b { font-variant-numeric: tabular-nums; font-weight: 600; }
  .g-flag { grid-column: 1 / -1; font-size: 14px; margin: 0; padding: 8px 12px; border-radius: 8px; background: rgb(var(--warn-soft)); color: rgb(var(--warn-ink)); }
  @media (max-width: 420px) { .g-grid { grid-template-columns: 1fr; } }
`;
document.head.appendChild(css);

/* Keep one root across hot reloads. */
window.__chartKitRoot ||= createRoot(document.getElementById('root'));
window.__chartKitRoot.render(<Gallery />);
