import React, { useMemo } from 'react';
import { Percent, UserMinus, UserPlus, Users } from '@ui/components/ui/lineIcons';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { leavingReasons } from '../api/engagement';

/**
 * People report (People audit gap 21): headcount, joiners, leavers and
 * attrition month by month, worked out on the server from each person's
 * stints of employment (routes/people.ts → services/people/headcount.ts),
 * so a month in the past reads as it was, not from today's status.
 * Attrition is leavers over the month's average headcount; over the period,
 * leavers over the average of the months.
 */

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthWord = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const lastOf = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const pct = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);
const REASONS = { RESIGNED: 'Resigned', TERMINATED: 'Let go', RETIRED: 'Retired', ABSCONDED: 'Absconded', CONTRACT_ENDED: 'Contract ended', DECEASED: 'Died', NOT_SAID: 'Not said' };

/** The periods a small business asks about: the last year, and the financial years (April to March). */
function periodsOf(today = todayIst()) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  const back = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);
  return [
    { value: 'last12', label: 'Last 12 months', from: back, to: today },
    { value: 'thisFy', label: `This financial year (${fy}–${String((fy + 1) % 100).padStart(2, '0')})`, from: `${fy}-04-01`, to: today },
    { value: 'lastFy', label: `Last financial year (${fy - 1}–${String(fy % 100).padStart(2, '0')})`, from: `${fy - 1}-04-01`, to: lastOf(fy, 3) },
    { value: 'thisYear', label: `This calendar year (${y})`, from: `${y}-01-01`, to: today },
  ];
}

/**
 * Why people leave (WORKFLOW-GAP-RESEARCH 4.9): the main reason from exit interviews, month by month,
 * with how many leavers answered, how many HR thinks could have been kept, and how many stayed.
 * Shown to whoever may read why someone leaves (Lifecycle); others simply do not get it.
 */
function LeavingReasons() {
  const req = useRequest(() => leavingReasons(12).catch(() => null), []);
  const d = req.data;
  if (!d || !Array.isArray(d.reasons) || !Array.isArray(d.months)) return null;
  const months = d.months.filter((m) => m.leavers || m.answered);
  const top = d.reasons.slice(0, 4);
  return (
    <section aria-labelledby="why-leave" className="mt-8 space-y-3">
      <h2 id="why-leave" className="ui-t-sec">Why people leave</h2>
      {!months.length ? <p className="text-sm ui-muted">No leavers in the last 12 months.</p> : (
        <>
          {d.reasons.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Main reasons, last 12 months">
              {d.reasons.map((r) => <li key={r.code} className="ui-pill ui-pill-neutral"><span>{r.label}</span> <span className="tabular-nums">{r.count}</span></li>)}
            </ul>
          ) : <p className="text-sm ui-muted">No exit interviews answered yet.</p>}
          <div className="ui-table-scroll">
            <table className="ui-table w-full">
              <thead><tr><th scope="col">Month</th><th scope="col" className="text-right">Leavers</th><th scope="col" className="text-right">Answered</th>{top.map((r) => <th key={r.code} scope="col" className="text-right">{r.label}</th>)}<th scope="col" className="text-right">Could have kept</th><th scope="col" className="text-right">Stayed</th></tr></thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month}>
                    <th scope="row" className="font-normal text-left whitespace-nowrap">{monthWord(m.month)}</th>
                    <td className="text-right tabular-nums">{m.leavers || '—'}</td>
                    <td className="text-right tabular-nums">{m.answered || '—'}</td>
                    {top.map((r) => <td key={r.code} className="text-right tabular-nums">{m.reasons?.[r.code] || '—'}</td>)}
                    <td className="text-right tabular-nums">{m.couldKeep || '—'}</td>
                    <td className="text-right tabular-nums">{m.retained || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ui-caption">From exit interviews. Could have kept: HR’s view after the interview.</p>
        </>
      )}
    </section>
  );
}

const headcount = (from, to) => apiFetch(`/orgs/${encodeURIComponent(orgId())}/people/headcount?from=${from}&to=${to}`, { skipWarehouseHeader: true });

export default function PeopleReports({ params = {}, updateParams }) {
  const periods = useMemo(() => periodsOf(), []);
  const period = periods.find((p) => p.value === params.period) || periods[0];
  const req = useRequest(() => headcount(period.from, period.to), [period.from, period.to]);
  const d = req.data;
  const months = d?.months || [];
  const t = d?.totals;
  const reasons = Object.entries(months.reduce((acc, m) => { for (const [k, n] of Object.entries(m.leaversByReason || {})) acc[k] = (acc[k] || 0) + n; return acc; }, {}));

  const columns = [
    { key: 'month', label: 'Month' }, { key: 'start', label: 'Headcount at start' }, { key: 'joiners', label: 'Joiners' },
    { key: 'leavers', label: 'Leavers' }, { key: 'end', label: 'Headcount at end' }, { key: 'attrition', label: 'Attrition' },
  ];
  const exportRows = () => [
    ...months.map((m) => ({ month: monthWord(m.month), start: m.headcountAtStart, joiners: m.joiners, leavers: m.leavers, end: m.headcountAtEnd, attrition: pct(m.attritionPct) })),
    ...(t ? [{ month: 'Whole period', start: t.headcountAtStart, joiners: t.joiners, leavers: t.leavers, end: t.headcountAtEnd, attrition: pct(t.attritionPct) }] : []),
  ];
  const onExport = (key) => {
    const format = exportFormatFromKey(key);
    if (!format || !months.length) return;
    runListExport({ format, title: 'People report', subtitle: `${period.label}: headcount, joiners, leavers and attrition`, fileName: `people-report-${period.from}-to-${period.to}`, label: 'months', rows: exportRows(), columns, footNote: 'Attrition: leavers over the month’s average headcount; whole period: leavers over the average of the months.' });
  };

  return (
    <DocumentListShell title="People report" entity="people" tight
      moreItems={[exportMenuItem('Export')]} onMoreSelect={onExport}
      cards={t ? [
        { label: 'Headcount today', value: d.headcount, count: true, Icon: Users, tone: 'sent' },
        { label: 'Joiners', value: t.joiners, count: true, Icon: UserPlus, tone: 'paid' },
        { label: 'Leavers', value: t.leavers, count: true, Icon: UserMinus, tone: t.leavers ? 'outstanding' : 'draft' },
        { label: 'Attrition', value: pct(t.attritionPct), count: true, Icon: Percent, tone: 'draft' },
      ] : null}
      above={(
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-80"><PopupSelect showValueSubtext={false} label="Period" value={period.value} onChange={(v) => updateParams?.({ period: v && v !== 'last12' ? v : null }, { push: false })} options={periods.map((p) => ({ value: p.value, label: p.label }))} /></div>
          {t ? <p className="ui-caption">{[`Attrition: leavers over the average headcount of the months (${t.averageHeadcount})`, reasons.length ? `Left: ${reasons.map(([k, n]) => `${REASONS[k] || k} ${n}`).join(', ')}` : null].filter(Boolean).join(' · ')}</p> : null}
        </div>
      )}>
      <>
      {req.error && !d ? <div className="p-4"><ErrorState error={req.error} onRetry={req.reload} body={req.error?.status === 403 ? 'The people report covers the whole company; your role covers your own team.' : undefined} /></div>
        : !d ? <SkeletonCard lines={8} />
          : !months.length || (!t.headcountAtEnd && !t.joiners && !t.leavers) ? <EmptyState title="Nobody in this period" description="Add employees with their joining dates; their months show here." />
            : (
              <div className="ui-table-scroll">
                <table className="ui-table w-full">
                  <thead><tr>{columns.map((c, i) => <th key={c.key} className={i ? 'text-right' : ''} scope="col">{c.label}</th>)}</tr></thead>
                  <tbody>
                    {months.map((m) => (
                      <tr key={m.month}>
                        <th scope="row" className="font-normal text-left whitespace-nowrap">{monthWord(m.month)}</th>
                        <td className="text-right tabular-nums">{m.headcountAtStart}</td>
                        <td className="text-right tabular-nums">{m.joiners || '—'}</td>
                        <td className="text-right tabular-nums">{m.leavers || '—'}</td>
                        <td className="text-right tabular-nums">{m.headcountAtEnd}</td>
                        <td className="text-right tabular-nums">{pct(m.attritionPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium">
                      <th scope="row" className="text-left">Whole period</th>
                      <td className="text-right tabular-nums">{t.headcountAtStart}</td>
                      <td className="text-right tabular-nums">{t.joiners}</td>
                      <td className="text-right tabular-nums">{t.leavers}</td>
                      <td className="text-right tabular-nums">{t.headcountAtEnd}</td>
                      <td className="text-right tabular-nums">{pct(t.attritionPct)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
      {d ? <LeavingReasons /> : null}
      </>
    </DocumentListShell>
  );
}
