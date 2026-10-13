import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Download, Search } from 'lucide-react';

import DocumentListShell from '@ui/components/list/DocumentListShell';
import { EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import { formatMoney } from '@ui/utils/money';
import { exportListXlsx } from '@ui/utils/listXlsx';
import { companyTdsProfile } from './engine';
import { TDS_NATURES, natureByCode } from './ruleMaster';
import { datasetChecksum, filingFor, quarterValidation, returnCsv, returnDataset } from './returns';
import {
  challanRegister,
  monthWise,
  partyWise,
  quarterWise,
  isLive,
  tdsEvents,
  tdsExceptions,
  tdsReconciliation,
} from './reports';

/**
 * Where a company looks at its TDS.
 *
 * One screen, six views, because they answer six versions of one question and
 * splitting them across the rail would make a person navigate to find out
 * whether the number they just saw was the same number. Everything on it is
 * read from the normalized events — nothing is recomputed from a document, so
 * what is shown here is what was actually deducted and posted.
 */

const REPORTS = [
  { value: 'payable', label: 'TDS Payable Register', view: 'register', side: 'PAYABLE' },
  { value: 'receivable', label: 'TDS Receivable Register', view: 'register', side: 'RECEIVABLE' },
  { value: 'challans', label: 'Challan Register', view: 'challans', side: 'PAYABLE' },
  { value: 'outstanding', label: 'TDS Outstanding', view: 'register', side: 'PAYABLE' },
  { value: 'reconciliation', label: 'TDS Reconciliation', view: 'reconciliation', side: 'PAYABLE' },
  { value: 'party', label: 'Deductee-wise Summary', view: 'party', side: '' },
  { value: 'nature', label: 'Section-wise Summary', view: 'nature', side: '' },
  { value: 'return', label: 'Return Preparation', view: 'return', side: 'PAYABLE' },
];

const SEVERITY_STYLE = {
  BLOCK: 'text-[rgb(var(--neg-ink))]',
  WARNING: 'text-[rgb(var(--warn-ink,var(--fg)))]',
  INFO: 'ui-muted',
};

export default function TdsModule({ db, setDb = null, currentCompany, onBack = null, onOpenSettings = null }) {
  const companyId = currentCompany?.id;
  const profile = companyTdsProfile(currentCompany);
  const [view, setView] = useState('nature');
  const [selectedReport, setSelectedReport] = useState('nature');
  const [search, setSearch] = useState('');
  const compactLayout = false;
  const [quarter, setQuarter] = useState('');
  const [periodMode, setPeriodMode] = useState('quarter');
  const [periodKeys, setPeriodKeys] = useState([]);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [side, setSide] = useState('PAYABLE');
  const [natureCode, setNatureCode] = useState('');

  const selectReport = (value) => {
    const report = REPORTS.find((item) => item.value === value) || REPORTS[0];
    setSelectedReport(report.value);
    setView(report.value === 'payable' ? 'nature' : report.view);
    setSide(report.side);
    setNatureCode('');
  };

  const filter = useMemo(
    () => ({ quarter, side, natureCode }),
    [quarter, side, natureCode]
  );

  /* Every option list is derived from the events themselves — the report
     offers only what the data actually contains. */
  const allEvents = useMemo(() => tdsEvents(db, companyId, {}).filter(isLive), [db, companyId]);

  const events = useMemo(() => tdsEvents(db, companyId, filter).filter(isLive), [db, companyId, filter]);
  const visibleEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      const periodKey = periodMode === 'month' ? String(event.transactionDate || '').slice(0, 7) : String(event.returnQuarter || '');
      if (periodKeys.length && !periodKeys.includes(periodKey)) return false;
      return !query || [event.partyName, event.panSnapshot, event.sourceNumber, event.sourceType, event.sectionReference, event.sectionCode, event.returnQuarter].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [events, search, periodKeys, periodMode]);
  const filingPeriods = useMemo(() => [...new Set(allEvents.map((event) => periodMode === 'month' ? String(event.transactionDate || '').slice(0, 7) : String(event.returnQuarter || '')).filter(Boolean))].sort(), [allEvents, periodMode]);
  const sectionSummary = useMemo(() => {
    const grouped = new Map();
    for (const event of visibleEvents) {
      const key = `${event.side}:${event.natureCode}`;
      const row = grouped.get(key) || { side: event.side, natureCode: event.natureCode, natureName: natureByCode(event.natureCode)?.name || event.natureCode, references: new Set(), baseAmount: 0, tdsAmount: 0, count: 0 };
      if (event.sectionReference || event.sectionCode) row.references.add(event.sectionReference || event.sectionCode);
      row.baseAmount += Number(event.baseAmount || 0); row.tdsAmount += Number(event.tdsAmount || 0); row.count += 1;
      grouped.set(key, row);
    }
    return [...grouped.values()].map((row) => ({ ...row, references: [...row.references] }));
  }, [visibleEvents]);
  const challans = useMemo(() => challanRegister(db, companyId), [db, companyId]);
  const exceptions = useMemo(() => tdsExceptions(db, companyId, filter), [db, companyId, filter]);
  const recon = useMemo(() => tdsReconciliation(db, companyId, filter), [db, companyId, filter]);
  const quarters = useMemo(() => quarterWise(db, companyId, {}), [db, companyId]);

  /*
   * The quarter, checked and set out as it would be filed.
   *
   * V1 does not file — but a quarter is either complete or it is not, and that
   * is a handful of checks somebody would otherwise do by eye in April.
   */
  const validation = useMemo(() => quarterValidation(db, companyId, quarter), [db, companyId, quarter]);
  const dataset = useMemo(() => returnDataset(db, companyId, quarter), [db, companyId, quarter]);

  /* The quarter's filing lifecycle: Open → Frozen → Filed. The freeze pins
     the dataset's signature; the screen says so when the data moves after. */
  const filing = useMemo(() => filingFor(db, companyId, quarter), [db, companyId, quarter]);
  const checksumNow = useMemo(() => datasetChecksum(dataset), [dataset]);
  const frozenDrift = Boolean(filing && filing.checksum && filing.checksum !== checksumNow);
  const who = () => {
    try {
      return String(localStorage.getItem('userEmail') || '').trim() || 'User';
    } catch {
      return 'User';
    }
  };
  const [ackNo, setAckNo] = useState('');

  const freezeQuarter = () => {
    if (!setDb || !quarter || !validation.ready) return;
    setDb((prev) => {
      const rows = Array.isArray(prev.tdsFilings) ? prev.tdsFilings : [];
      if (rows.some((f) => Number(f.companyId) === Number(companyId) && f.quarter === quarter)) return prev;
      const id = rows.reduce((m, f) => Math.max(m, Number(f?.id) || 0), 0) + 1;
      return {
        ...prev,
        tdsFilings: [
          ...rows,
          { id, companyId, quarter, status: 'Frozen', checksum: checksumNow, frozenAt: new Date().toISOString(), frozenBy: who(), exports: [] },
        ],
      };
    });
  };

  const recordExport = () => {
    if (!setDb || !filing) return 0;
    const version = (filing.exports?.length || 0) + 1;
    setDb((prev) => ({
      ...prev,
      tdsFilings: (prev.tdsFilings || []).map((f) =>
        f.id === filing.id
          ? {
              ...f,
              status: f.status === 'Filed' ? 'Filed' : 'Frozen',
              exports: [
                ...(f.exports || []),
                { version, at: new Date().toISOString(), by: who(), checksum: checksumNow, totals: { ...dataset.totals } },
              ],
            }
          : f
      ),
    }));
    return version;
  };

  const recordAcknowledgement = () => {
    if (!setDb || !filing || !String(ackNo).trim()) return;
    setDb((prev) => ({
      ...prev,
      tdsFilings: (prev.tdsFilings || []).map((f) =>
        f.id === filing.id
          ? { ...f, status: 'Filed', acknowledgementNo: String(ackNo).trim(), filedAt: new Date().toISOString(), filedBy: who() }
          : f
      ),
    }));
    setAckNo('');
  };

  const downloadReturn = () => {
    /* A frozen quarter's export is a VERSION on the filing record; before
       the freeze it is only a draft preview and says so in its name. */
    const version = filing ? recordExport() : 0;
    const csv = returnCsv(dataset);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const base = `tds-${String(quarter || 'quarter').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`;
    link.download = version ? `${base}-v${version}.csv` : `${base}-draft.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportRegister = () => exportListXlsx({
    fileName: `${selectedReport}-tds-report`, sheetName: 'TDS Filing Data',
    subtitle: periodKeys.join(', ') || 'All periods', rows: visibleEvents,
    columns: [
      { key: 'transactionDate', label: 'Date' }, { key: 'partyName', label: 'Party' }, { key: 'panSnapshot', label: 'PAN' },
      { key: 'sourceNumber', label: 'Voucher No.' }, { key: 'sectionReference', label: 'TDS Section' },
      { key: 'baseAmount', label: 'Base Amount', type: 'number', align: 'right' }, { key: 'rate', label: 'Rate', type: 'number', align: 'right' },
      { key: 'tdsAmount', label: 'TDS Amount', type: 'number', align: 'right' }, { key: 'status', label: 'Status' },
    ],
  });

  /* TDS switched off is not an empty register — it is a company that does not
     deduct, and saying so is more use than showing it six empty tables. */
  if (!profile.enabled) {
    return (
      <DocumentListShell title="TDS" company={currentCompany}>
        <EmptyState
          title="TDS is switched off for this company"
          message="Settings → Tax compliances turns it on, along with the TAN and deductor details a challan and a return need."
          routes={
            onOpenSettings
              ? [{ label: 'Open tax settings', description: 'Enable TDS and record the TAN.', onSelect: () => onOpenSettings('settingsTds') }]
              : undefined
          }
        />
      </DocumentListShell>
    );
  }

  return (
    <DocumentListShell
      title={<span className="inline-flex items-center gap-2">{onBack ? <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}><ArrowLeft size={15} /> Back</button> : null}<span>TDS</span></span>}
      description="View, analyse and manage TDS compliance"
      company={currentCompany}
      headerExtras={<><div className="w-48"><label className="ui-label" htmlFor="tds-header-report">Select Report</label><select id="tds-header-report" className="ui-select w-full" value={selectedReport} onChange={(e) => selectReport(e.target.value)}>{REPORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div><label className="ui-label">Period</label><div className="ui-segmented" role="tablist" aria-label="TDS period type">{[['month','Month'],['quarter','Quarter']].map(([value,label]) => <button key={value} type="button" role="tab" aria-selected={periodMode === value} className="ui-segment" onClick={() => { setPeriodMode(value); setPeriodKeys([]); setQuarter(''); setPeriodOpen(false); }}>{label}</button>)}</div></div><div className="relative w-44"><label className="ui-label" htmlFor="tds-header-period">{periodMode === 'month' ? 'Months' : 'Quarters'}</label><button id="tds-header-period" type="button" className="ui-input flex w-full cursor-pointer items-center justify-between text-start" aria-haspopup="listbox" aria-expanded={periodOpen} onClick={() => setPeriodOpen((open) => !open)}><span className="truncate">{periodKeys.length ? `${periodKeys.length} selected` : `All ${periodMode === 'month' ? 'months' : 'quarters'}`}</span><ChevronDown size={14} /></button>{periodOpen ? <div className="absolute end-0 top-[calc(100%+0.3rem)] z-50 max-h-64 w-56 overflow-auto rounded-lg border bg-white p-2 shadow-lg ui-border-c" role="listbox" aria-multiselectable="true">{filingPeriods.length ? filingPeriods.map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100"><input type="checkbox" className="ui-checkbox" checked={periodKeys.includes(value)} onChange={(e) => { const values = e.target.checked ? [...periodKeys, value] : periodKeys.filter((item) => item !== value); setPeriodKeys(values); setQuarter(periodMode === 'quarter' && values.length === 1 ? values[0] : ''); }} /><span>{value}</span></label>) : <div className="px-2 py-3 text-sm ui-muted">No periods with TDS data</div>}</div> : null}</div><button type="button" className="ui-btn ui-btn-secondary self-end" onClick={exportRegister}><Download size={15} /> Export</button></>}

    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b ui-border-c px-3 py-2"><div><h2 className="ui-t-sec">{REPORTS.find((item) => item.value === selectedReport)?.label}</h2><p className="ui-caption">TDS compliance report for the selected period</p></div><div className="relative"><Search size={15} className="ui-muted absolute start-3 top-1/2 -translate-y-1/2" /><input aria-label="Search TDS report" className="ui-input w-64 ps-9" placeholder="Search party, PAN, voucher…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
      <div className="ui-table-scroll overflow-auto" data-fill-viewport style={{ '--table-scroll-h': 'calc(100dvh - 9.5rem)' }}>
        {view === 'register' ? (
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Party</th>
                <th scope="col">PAN</th>
                {!compactLayout ? <th scope="col">Nature</th> : null}
                <th scope="col">Section</th>
                <th scope="col">Source</th>
                <th scope="col" className="text-end">Base</th>
                <th scope="col" className="text-end">Rate</th>
                <th scope="col" className="text-end">TDS</th>
                {!compactLayout ? <th scope="col">Quarter</th> : null}
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.length === 0 ? (
                <tr>
                  <td colSpan={compactLayout ? 9 : 11}>
                    <EmptyState
      title="Nothing deducted in this window"
                      message="A bill, a payment or a receipt that deducts writes its record here, with the rule it was computed under."
                    />
                  </td>
                </tr>
              ) : (
                visibleEvents.map((e) => (
                  <tr key={e.id}>
                    <td>{e.transactionDate}</td>
                    <td className="truncate">{e.partyName || '—'}</td>
                    <td className="ui-mono">{e.panSnapshot || '—'}</td>
                    {!compactLayout ? <td className="truncate">{natureByCode(e.natureCode)?.name || e.natureCode || '—'}</td> : null}
                    {/* The reference it carried when it was posted, not the one
                        in force today — that is the whole point of the snapshot. */}
                    <td className="ui-mono">{e.sectionReference || e.sectionCode || '—'}</td>
                    <td className="truncate">
                      {e.sourceType} {e.sourceNumber ? `· ${e.sourceNumber}` : ''}
                    </td>
                    <td className="ui-money">{formatMoney(e.baseAmount, currentCompany)}</td>
                    <td className="ui-money">{Number(e.rate || 0)}%</td>
                    <td className={`ui-money ${String(e.side).toUpperCase() === 'RECEIVABLE' ? 'text-[rgb(var(--pos-ink))]' : ''}`}>
                      {formatMoney(e.tdsAmount, currentCompany)}
                    </td>
                    {!compactLayout ? <td>{e.returnQuarter || '—'}</td> : null}
                    <td><StatusPill status={e.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : null}

        {view === 'party' ? (
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Party</th>
                <th scope="col">PAN</th>
                <th scope="col">Side</th>
                <th scope="col" className="text-end">Base</th>
                <th scope="col" className="text-end">TDS</th>
                <th scope="col" className="text-end">Entries</th>
              </tr>
            </thead>
            <tbody>
              {partyWise(db, companyId, filter).map((r) => (
                <tr key={`${r.side}-${r.partyId}`}>
                  <td className="truncate">{r.partyName || '—'}</td>
                  <td className="ui-mono">{r.pan || '—'}</td>
                  <td>{r.side === 'RECEIVABLE' ? 'Receivable' : 'Payable'}</td>
                  <td className="ui-money">{formatMoney(r.baseAmount, currentCompany)}</td>
                  <td className="ui-money">{formatMoney(r.tdsAmount, currentCompany)}</td>
                  <td className="ui-money">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {view === 'nature' ? (
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Nature</th>
                <th scope="col">Statutory references used</th>
                <th scope="col">Side</th>
                <th scope="col" className="text-end">Base</th>
                <th scope="col" className="text-end">TDS</th>
                <th scope="col" className="text-end">Entries</th>
              </tr>
            </thead>
            <tbody>
              {sectionSummary.map((r) => (
                <tr key={`${r.side}-${r.natureCode}`} className="cursor-pointer ui-hover-sunken" onClick={() => { setNatureCode(r.natureCode); setSelectedReport(r.side === 'RECEIVABLE' ? 'receivable' : 'payable'); setSide(r.side); setView('register'); }}>
                  <td className="truncate"><span className="ui-link font-semibold">{r.natureName}</span></td>
                  {/* Both sides of April 2026 legitimately appear together. */}
                  <td className="ui-mono truncate">{r.references.join(', ') || '—'}</td>
                  <td>{r.side === 'RECEIVABLE' ? 'Receivable' : 'Payable'}</td>
                  <td className="ui-money">{formatMoney(r.baseAmount, currentCompany)}</td>
                  <td className="ui-money">{formatMoney(r.tdsAmount, currentCompany)}</td>
                  <td className="ui-money">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {view === 'periods' ? (
          <div className="space-y-6">
            <div>
              <div className="ui-t-label mb-2">Quarter-wise</div>
              <table className="ui-table ui-table-wide">
                <thead>
                  <tr>
                    <th scope="col">Quarter</th>
                    <th scope="col" className="text-end">TDS</th>
                    <th scope="col" className="text-end">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {quarters.map((q) => (
                    <tr key={q.quarter}>
                      <td>{q.quarter}</td>
                      <td className="ui-money">{formatMoney(q.tdsAmount, currentCompany)}</td>
                      <td className="ui-money">{q.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="ui-t-label mb-2">Month-wise</div>
              <table className="ui-table ui-table-wide">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Side</th>
                    <th scope="col" className="text-end">Base</th>
                    <th scope="col" className="text-end">TDS</th>
                    <th scope="col" className="text-end">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {monthWise(db, companyId, filter).map((m) => (
                    <tr key={`${m.month}-${m.side}`}>
                      <td className="ui-mono">{m.month}</td>
                      <td>{m.side === 'RECEIVABLE' ? 'Receivable' : 'Payable'}</td>
                      <td className="ui-money">{formatMoney(m.baseAmount, currentCompany)}</td>
                      <td className="ui-money">{formatMoney(m.tdsAmount, currentCompany)}</td>
                      <td className="ui-money">{m.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {view === 'challans' ? (
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Challan</th>
                <th scope="col">TAN</th>
                <th scope="col">Tax Year</th>
                <th scope="col">Paid on</th>
                <th scope="col">Bank / BSR</th>
                <th scope="col" className="text-end">Tax</th>
                <th scope="col" className="text-end">Interest</th>
                <th scope="col" className="text-end">Late fee</th>
                <th scope="col" className="text-end">Total</th>
                <th scope="col" className="text-end">Allocated</th>
                <th scope="col">Status</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {challans.length === 0 ? (
                <tr>
                  <td colSpan={12}>
                    <EmptyState
      title="No challans recorded"
                      message="Record what was paid to the department, then allocate it against the deductions it covers."
                    />
                  </td>
                </tr>
              ) : (
                challans.map((c) => (
                  <tr key={c.id}>
                    <td className="ui-mono">{c.number || '—'}</td>
                    <td className="ui-mono">{c.tan || '—'}</td>
                    <td>{c.taxYear || '—'}</td>
                    <td>{c.paymentDate || '—'}</td>
                    <td className="truncate">{[c.bankName, c.bsrCode].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="ui-money">{formatMoney(c.taxAmount, currentCompany)}</td>
                    <td className="ui-money">{formatMoney(c.interest, currentCompany)}</td>
                    <td className="ui-money">{formatMoney(c.lateFee, currentCompany)}</td>
                    <td className="ui-money">{formatMoney(c.totalAmount, currentCompany)}</td>
                    <td className="ui-money">{formatMoney(c.allocated, currentCompany)}</td>
                    <td><StatusPill status={c.status} /></td>
                    <td>
                      {/* The last step before Return Ready: a fully allocated
                          challan is CONFIRMED against the bank / 26Q by a
                          person, never marked by arithmetic alone. */}
                      {setDb && c.status === 'Fully allocated' ? (
                        <button
                          type="button"
                          className="ui-btn ui-btn-secondary ui-btn-sm"
                          onClick={() =>
                            setDb((prev) => ({
                              ...prev,
                              tdsChallans: (prev.tdsChallans || []).map((row) =>
                                row.companyId === companyId && String(row.id) === String(c.id)
                                  ? { ...row, reconciled: true, reconciledAt: new Date().toISOString() }
                                  : row
                              ),
                            }))
                          }
                        >
                          Mark reconciled
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : null}

        {view === 'exceptions' ? (
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Severity</th>
                <th scope="col">Party</th>
                <th scope="col">What is wrong</th>
                <th scope="col">Entry</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
      title="Nothing standing in the way"
                      message="Every deduction in this window has a PAN, a ledger, a rule version and a challan behind it."
                    />
                  </td>
                </tr>
              ) : (
                exceptions.map((x, i) => (
                  <tr key={`${x.eventId}-${x.code}-${i}`}>
                    <td className={SEVERITY_STYLE[x.severity] || ''}>{x.severity}</td>
                    <td className="truncate">{x.party || '—'}</td>
                    <td>{x.message}</td>
                    <td className="ui-mono">#{x.eventId}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : null}

        {view === 'return' ? (
          <div className="space-y-4">
            {!quarter ? (
              <EmptyState
      title="Choose a quarter"
                message="A return is prepared one quarter at a time. Pick one above and this becomes the return it would file."
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="ui-t-label">{quarter}</div>
                      <StatusPill status={filing ? filing.status : 'Open'} />
                    </div>
                    <p className="ui-caption">
                      {validation.ready
                        ? `Ready — ${dataset.totals.deductees} deductee(s), ${formatMoney(dataset.totals.tdsAmount, currentCompany)} deducted.`
                        : validation.blocking.length
                          ? `${validation.blocking.length} thing(s) must be fixed before this can be filed.`
                          : 'Nothing deducted in this quarter.'}
                      {filing?.exports?.length ? ` ${filing.exports.length} export(s), latest v${filing.exports.length}.` : ''}
                      {filing?.acknowledgementNo ? ` Filed — acknowledgement ${filing.acknowledgementNo}.` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!filing && setDb ? (
                      /* The freeze pins the dataset's signature; exports from
                         here on are numbered versions of a known state. */
                      <button
                        type="button"
                        onClick={freezeQuarter}
                        className="ui-btn ui-btn-secondary"
                        disabled={!validation.ready}
      title={validation.ready ? undefined : 'Resolve the blocking problems first.'}
                      >
                        Freeze quarter
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={downloadReturn}
                      className="ui-btn ui-btn-secondary"
                      disabled={!dataset.lines.length}
                    >
                      <Download size={16} aria-hidden="true" />
                      {filing ? ` Export v${(filing.exports?.length || 0) + 1}` : ' Download draft'}
                    </button>
                    {filing && filing.status !== 'Filed' && setDb ? (
                      <>
                        <input
                          type="text"
                          className="ui-input ui-mono w-44"
                          placeholder="Acknowledgement no."
                          aria-label="Acknowledgement number"
                          value={ackNo}
                          onChange={(e) => setAckNo(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={recordAcknowledgement}
                          className="ui-btn ui-btn-primary"
                          disabled={!String(ackNo).trim()}
                        >
                          Record filing
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {frozenDrift ? (
                  <p className="ui-caption text-[rgb(var(--neg-ink))]">
                    The quarter has CHANGED since it was frozen on {String(filing.frozenAt || '').slice(0, 10)} — the
                    next export will be a new version that no longer matches the frozen signature.
                  </p>
                ) : null}

                {validation.problems.length ? (
                  <ul className="space-y-1">
                    {validation.problems.map((p, i) => (
                      <li key={`${p.code}-${p.eventId}-${i}`} className="text-sm">
                        <span className={SEVERITY_STYLE[p.severity] || ''}>{p.severity}</span>{' '}
                        <span className="ui-muted">{p.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* One line per deductee, section and rate — a 26Q is
                    deductee-wise, not document-wise. */}
                <table className="ui-table ui-table-wide">
                  <thead>
                    <tr>
                      <th scope="col">Deductee</th>
                      <th scope="col">PAN</th>
                      <th scope="col">Section</th>
                      <th scope="col" className="text-end">Rate</th>
                      <th scope="col" className="text-end">Paid / credited</th>
                      <th scope="col" className="text-end">TDS</th>
                      <th scope="col" className="text-end">Deposited</th>
                      <th scope="col">Challans</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataset.lines.map((l) => (
                      <tr key={`${l.deducteeId}-${l.sectionCode}-${l.rate}`}>
                        <td className="truncate">{l.deductee || '—'}</td>
                        <td className="ui-mono">{l.pan || '—'}</td>
                        <td className="ui-mono">{l.sectionReference}</td>
                        <td className="ui-money">{l.rate}%</td>
                        <td className="ui-money">{formatMoney(l.baseAmount, currentCompany)}</td>
                        <td className="ui-money">{formatMoney(l.tdsAmount, currentCompany)}</td>
                        <td className={`ui-money ${l.unpaidAmount > 0.005 ? 'text-[rgb(var(--neg-ink))]' : ''}`}>
                          {formatMoney(l.paidAmount, currentCompany)}
                        </td>
                        <td className="ui-mono truncate">{l.challans.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        ) : null}

        {view === 'reconciliation' ? (
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Ledger</th>
                <th scope="col" className="text-end">Deducted</th>
                <th scope="col" className="text-end">Paid over</th>
                <th scope="col" className="text-end">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {recon.ledgers.map((l) => (
                <tr key={l.ledgerId || 'unmapped'}>
                  <td className="truncate">{l.name}</td>
                  <td className="ui-money">{formatMoney(l.deducted, currentCompany)}</td>
                  <td className="ui-money">{formatMoney(l.allocated, currentCompany)}</td>
                  <td className={`ui-money ${l.outstanding > 0.005 ? 'text-[rgb(var(--neg-ink))]' : ''}`}>
                    {formatMoney(l.outstanding, currentCompany)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="font-medium">All ledgers</td>
                <td className="ui-money">{formatMoney(recon.register, currentCompany)}</td>
                <td className="ui-money">{formatMoney(recon.paid, currentCompany)}</td>
                <td className="ui-money">{formatMoney(recon.outstanding, currentCompany)}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </div>
    </DocumentListShell>
  );
}
