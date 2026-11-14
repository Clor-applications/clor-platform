import React, { useCallback, useEffect, useRef, useState } from 'react';
import { History, Upload } from '@ui/components/ui/lineIcons';
import Drawer from '@ui/components/ui/Drawer';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { wholeRupees as money } from '@ui/utils/money';
import { importOpeningYtd, listOpeningYtd, setFirstPayrollYear } from '../api/payrollTaxDeclarations';

/**
 * Earlier this year, before CLOR: everyone's opening figures for the year in
 * one place, a file to bring them all in at once, and the owner's answer for
 * a company that only began paying salaries this year. A first payroll after
 * April is refused until each person has figures (nil is a figure) or the
 * owner has answered.
 */
export default function OpeningYtdPanel({ fy, onOpenPerson }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setOpen(true)}>
        <History size={14} aria-hidden="true" /> Earlier this year
      </button>
      {open ? <Panel fy={fy} onClose={() => setOpen(false)} onOpenPerson={(id) => { setOpen(false); onOpenPerson?.(id); }} /> : null}
    </>
  );
}

const TEMPLATE_COLUMNS = [
  { key: 'code', label: 'code', value: (p) => p.code || '' },
  { key: 'gross', label: 'gross', value: (p) => p.opening?.grossPay ?? '' },
  { key: 'taxable', label: 'taxable', value: (p) => p.opening?.taxablePay ?? '' },
  { key: 'tds', label: 'tds', value: (p) => p.opening?.tds ?? '' },
  { key: 'pt', label: 'pt', value: (p) => p.opening?.professionalTax ?? '' },
  { key: 'pf', label: 'pf', value: (p) => p.opening?.employeePf ?? '' },
  { key: 'basic', label: 'basic', value: (p) => p.opening?.basicDa ?? '' },
  { key: 'hra', label: 'hra', value: (p) => p.opening?.hraReceived ?? '' },
  { key: 'nps', label: 'nps', value: (p) => p.opening?.employerNps ?? '' },
  /* As words ("Sep 2026"): a spreadsheet turns 2026-09 into a date. The import takes either. */
  { key: 'through', label: 'through', value: (p) => throughWords(p.opening?.throughMonth) },
  { key: 'note', label: 'note', value: (p) => p.opening?.note ?? '' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const throughWords = (ym) => (ym && /^\d{4}-\d{2}$/.test(ym) ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');

function Panel({ fy, onClose, onOpenPerson }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState([]);
  const file = useRef(null);

  const load = useCallback(() => {
    listOpeningYtd(fy)
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load the figures.')));
  }, [fy]);
  useEffect(() => {
    load();
  }, [load]);

  const first = data?.firstPayrollYear || null;
  const start = Number(String(fy).slice(0, 4));

  const answer = async (firstYear) => {
    setBusy(true);
    try {
      await setFirstPayrollYear(fy, firstYear, reason.trim());
      notify.success(firstYear ? 'Recorded. A first payroll after April needs no earlier figures this year.' : 'Taken back. Earlier figures are needed again.');
      setReason('');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };

  const template = () => downloadCsv({ fileName: `Earlier this year FY ${fy}`, columns: TEMPLATE_COLUMNS, rows: data?.people || [] });

  const importFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    setProblems([]);
    try {
      const r = await importOpeningYtd(fy, await f.text());
      notify.success(`Saved figures for ${r.saved} ${r.saved === 1 ? 'person' : 'people'}.`);
      load();
    } catch (err) {
      setProblems(err?.data?.problems || []);
      notify.error(String(err?.message || 'Nothing was saved.'));
    } finally {
      setBusy(false);
    }
  };

  const people = data?.people || [];
  /* Only the people the payroll will ask about (the server's rule), not everyone without a row. */
  const missing = people.filter((p) => p.needsFigures).length;

  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(44rem,96vw)]"
      title={`Earlier this year · FY ${fy}`}
      description="What this company paid from April, or from joining, until payroll moved to CLOR, so income tax for the rest of the year starts from the right place."
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-ghost" disabled={!data} onClick={template}>Download the file to fill</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !data} onClick={() => file.current?.click()}>
            <Upload size={14} aria-hidden="true" /> Import the file
          </button>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose the file to import" onChange={importFile} />
        </>
      }
    >
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {!data ? (
        error ? null : <SkeletonCard lines={5} />
      ) : (
        <div className="space-y-5">
          {problems.length ? (
            <div role="alert" className="rounded-xl p-3 text-sm" style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' }}>
              <p className="font-medium">Nothing was saved. Correct these rows and import again:</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={`${p.line}-${p.message}`}>Row {p.line}: {p.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <section className="space-y-2" aria-labelledby="first-year-h">
            <h3 id="first-year-h" className="ui-label">First year of paying salaries</h3>
            {first ? (
              <>
                <p className="text-sm">
                  Recorded: {fy} is this company’s first year of paying salaries, so nobody has earlier pay to bring in. <span className="ui-caption">“{first.reason}”</span>
                </p>
                {data.canSetFirstYear ? (
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => answer(false)}>Take it back</button>
                ) : null}
              </>
            ) : data.canSetFirstYear ? (
              <>
                <p className="ui-caption">If the company only began paying salaries this year, there is nothing earlier to enter. Say so once and the first payroll goes ahead.</p>
                <label className="ui-label" htmlFor="first-year-why">Why</label>
                <SuggestInput id="first-year-why" value={reason} onChange={setReason} maxLength={300} placeholder={`e.g. Company registered in August ${start}`} suggestions={[]} aria-label="Why this is the first year" />
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || reason.trim().length < 5} onClick={() => answer(true)}>
                  This is our first year
                </button>
              </>
            ) : (
              <p className="ui-caption">If the company only began paying salaries this year, the owner can say so here.</p>
            )}
          </section>

          <section className="space-y-2" aria-labelledby="opening-list-h">
            <h3 id="opening-list-h" className="ui-label">
              Everyone in payroll{missing && !first ? ` · ${missing} without figures` : ''}
            </h3>
            <div className="ui-table-scroll">
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col" className="ui-col-h-right">Gross pay</th>
                    <th scope="col" className="ui-col-h-right">Income tax</th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {people.map((p) => (
                    <tr key={p.employeeId} className="ui-row-click" onClick={() => onOpenPerson(p.employeeId)}>
                      <td className="ui-col-entity">
                        {p.name}
                        {p.code ? <span className="ui-caption"> · {p.code}</span> : null}
                      </td>
                      <td className="ui-col-amount">{p.opening ? money(p.opening.grossPay) : <span className="ui-caption">{p.needsFigures ? 'Needed' : 'Not entered'}</span>}</td>
                      <td className="ui-col-amount">{p.opening ? money(p.opening.tds) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ui-caption">Open someone to enter or change their figures. The file takes the same columns: code, gross, taxable, tds, pt, pf, basic, hra, nps, through and note. A previous employer’s pay goes in Form 12B, not here.</p>
          </section>
        </div>
      )}
    </Drawer>
  );
}
