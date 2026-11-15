import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Download, Printer, Settings2, X } from 'lucide-react';
import { buildLedgerStatement } from '../../data/db';
import { monthBounds } from './profitLossModel';
import { buildCashFlow } from './cashFlowModel';
import { displayReportPeriod, formatReportAmount, reportComparisonRanges, reportPeriodLines } from './reportComparison';
import ReportPeriodFilters from './ReportPeriodFilters';
import { useDismissable } from '@ui/components/ui/useDismissable';

const sectionNames = { operating: 'Operating activities', investing: 'Investing activities', financing: 'Financing activities' };
const addressOf = company => {
  const address = company?.registeredAddress || company?.address;
  const profile = company?.profile?.companySettings || {};
  if (typeof address === 'string') return [address, company?.city || profile.regCity, company?.state || profile.regStateName, company?.pincode || profile.regPincode].filter(Boolean).join(', ');
  if (address && typeof address === 'object') return [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  return [profile.regAddress1, profile.regAddress2, profile.regCity, profile.regStateName, profile.regPincode].filter(Boolean).join(', ');
};

export default function CashFlowReport({ db, currentCompany, onBack }) {
  const [periodMode, setPeriodMode] = useState('month');
  const [month] = useState(() => new Date().toISOString().slice(0, 7));
  const [customStart, setCustomStart] = useState(() => monthBounds(new Date().toISOString().slice(0, 7)).start);
  const [customEnd, setCustomEnd] = useState(() => monthBounds(new Date().toISOString().slice(0, 7)).end);
  const [comparison, setComparison] = useState('none');
  const [comparisonCount, setComparisonCount] = useState(1);
  const [baseCustom, setBaseCustom] = useState(() => monthBounds(new Date().toISOString().slice(0, 7)));
  const [viewOpen, setViewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useDismissable(exportOpen, () => setExportOpen(false));
  const [showZero, setShowZero] = useState(false);
  const [openSections, setOpenSections] = useState(() => new Set(Object.keys(sectionNames)));
  const [showLinked, setShowLinked] = useState(() => new Set());
  const [openCash, setOpenCash] = useState(() => new Set(['opening', 'closing']));
  const [selectedLedger, setSelectedLedger] = useState(null);
  const range = useMemo(() => {
    const today = new Date();
    const iso = value => value.toISOString().slice(0, 10);
    if (periodMode === 'year') return { start: `${today.getFullYear()}-01-01`, end: iso(today) };
    if (periodMode === '30days') { const start = new Date(today); start.setDate(start.getDate() - 29); return { start: iso(start), end: iso(today) }; }
    if (periodMode === 'custom') return { start: customStart, end: customEnd };
    return monthBounds(month);
  }, [periodMode, month, customStart, customEnd]);
  const compareRanges = useMemo(() => reportComparisonRanges(range, comparison, comparisonCount, periodMode, month, baseCustom), [range, comparison, comparisonCount, periodMode, month, baseCustom]);
  const valid = range.start && range.end && range.start <= range.end && compareRanges.every(item => item.start && item.end && item.start <= item.end);
  const current = useMemo(() => valid ? buildCashFlow(db, currentCompany.id, range) : null, [db, currentCompany.id, range, valid]);
  const comparisons = useMemo(() => valid ? compareRanges.map(item => buildCashFlow(db, currentCompany.id, item)) : [], [db, currentCompany.id, compareRanges, valid]);
  const allModels = [current, ...comparisons];
  const allRanges = [range, ...compareRanges];
  const flip = (setter, key) => setter(previous => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const lineRows = section => {
    const ids = new Set(allModels.flatMap(model => model?.sections[section] || []).map(line => line.ledgerId || `unlinked:${line.label}`));
    if (showZero || showLinked.has(section)) for (const ledger of current?.sectionLedgers[section] || []) ids.add(String(ledger.id));
    return [...ids].map(id => {
      const found = allModels.map(model => model?.sections[section]?.find(line => (line.ledgerId || `unlinked:${line.label}`) === id));
      const linked = (current?.sectionLedgers[section] || []).find(ledger => String(ledger.id) === String(id));
      return { id, label: found.find(Boolean)?.label || linked?.name || 'Unclassified cash movement', values: found.map(line => line?.amount || 0), linked: !String(id).startsWith('unlinked:') };
    }).filter(line => showZero || showLinked.has(section) || line.values.some(Boolean)).sort((a, b) => a.label.localeCompare(b.label));
  };
  const cashRows = () => {
    const ids = new Set(allModels.flatMap(model => model?.cashBalances || []).map(row => String(row.id)));
    return [...ids].map(id => {
      const found = allModels.map(model => model?.cashBalances.find(row => String(row.id) === id));
      return { id, name: found.find(Boolean)?.name || 'Cash / Bank ledger', openings: found.map(row => row?.opening || 0), closings: found.map(row => row?.closing || 0) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  };
  const printReport = () => {
    document.body.classList.add('cash-flow-printing');
    const cleanup = () => document.body.classList.remove('cash-flow-printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    try { window.print(); } catch (error) { cleanup(); throw error; }
  };
  const exportExcel = async () => {
    if (!current) return;
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const data = [];
    const columnCount = allModels.length + 1;
    const add = (label, values, bold = false) => data.push([{ value: label, type: String, fontWeight: bold ? 'bold' : undefined }, ...values.map(value => ({ value: Number(value) || 0, type: Number, format: '#,##,##0', align: 'right', fontWeight: bold ? 'bold' : undefined }))]);
    data.push([{ value: currentCompany.name, type: String, fontWeight: 'bold', columnSpan: columnCount }]);
    data.push([{ value: 'Cash Flow Statement', type: String, fontWeight: 'bold', columnSpan: columnCount }]);
    data.push([{ value: displayReportPeriod(range), type: String, columnSpan: columnCount }]);
    data.push([{ value: 'Particulars', type: String, fontWeight: 'bold' }, ...allRanges.map(item => ({ value: displayReportPeriod(item), type: String, fontWeight: 'bold' }))]);
    for (const [section, label] of Object.entries(sectionNames)) {
      add(`Cash flow from ${label.toLowerCase()}`, allModels.map(() => 0), true);
      if (openSections.has(section)) for (const line of lineRows(section)) add(`  ${line.label}`, line.values);
      add(`Net cash from ${label.toLowerCase()}`, allModels.map(model => model?.totals[section]), true);
    }
    add('Net change in cash and cash equivalents', allModels.map(model => model?.net), true);
    for (const kind of ['opening', 'closing']) {
      add(`${kind === 'opening' ? 'Opening' : 'Closing'} cash and cash equivalents`, allModels.map(model => model?.[kind]), true);
      if (openCash.has(kind)) for (const row of cashRows()) add(`  ${row.name}`, kind === 'opening' ? row.openings : row.closings);
    }
    await writeXlsxFile(data, { sheet: 'Cash Flow', columns: [{ width: 48 }, ...allModels.map(() => ({ width: 22 }))] }).toFile(`Cash Flow ${range.start} to ${range.end}.xlsx`);
    setExportOpen(false);
  };
  const openLedger = (id, periodIndex = 0, context = 'activity') => setSelectedLedger({ id, periodIndex, context });
  const ledgerRange = allRanges[selectedLedger?.periodIndex || 0] || range;
  const statement = useMemo(() => selectedLedger ? buildLedgerStatement(db, currentCompany.id, selectedLedger.id) : null, [db, currentCompany.id, selectedLedger]);
  const statementRows = (statement?.rows || []).filter(row => String(row.date || '').slice(0, 10) >= ledgerRange.start && String(row.date || '').slice(0, 10) <= ledgerRange.end);
  const beforeRows = (statement?.rows || []).filter(row => String(row.date || '').slice(0, 10) < ledgerRange.start);
  const openingBalance = beforeRows.length ? beforeRows[beforeRows.length - 1].runningBalance : statement?.openingBalance || 0;
  const closingBalance = statementRows.length ? statementRows[statementRows.length - 1].runningBalance : openingBalance;
  if (!current) return <div className="p-4"><button className="ui-btn ui-btn-ghost" onClick={onBack}><ArrowLeft size={15}/> Reports</button><p className="mt-3">Choose a valid period.</p></div>;
  if (selectedLedger) {
    const selectedModel = allModels[selectedLedger.periodIndex];
    const cash = selectedModel?.cashBalances.find(row => String(row.id) === String(selectedLedger.id));
    const activity = Object.values(selectedModel?.sections || {}).flat().find(line => String(line.ledgerId) === String(selectedLedger.id));
    const contribution = selectedLedger.context === 'opening' ? cash?.opening : selectedLedger.context === 'closing' ? cash?.closing : activity?.amount;
    return <div className="space-y-3 p-3 lg:p-5"><div className="flex items-center gap-2 rounded-lg bg-[rgb(var(--app-bg))] px-3 py-2"><button className="ui-icon-btn" aria-label="Back to Cash Flow" onClick={() => setSelectedLedger(null)}><ArrowLeft size={16}/></button><div><h1 className="ui-t-page">{statement?.account?.name || 'Ledger Statement'}</h1><p className="text-xs ui-muted">{displayReportPeriod(ledgerRange)}</p></div></div><div className="rounded-lg border ui-border-c p-3"><div className="flex justify-between font-semibold"><span>{selectedLedger.context === 'activity' ? 'Cash Flow contribution' : `${selectedLedger.context === 'opening' ? 'Opening' : 'Closing'} cash balance`}</span><span>{formatReportAmount(contribution)}</span></div><p className="mt-1 text-xs ui-muted">The ledger below includes all postings for this period.</p></div><div className="overflow-x-auto rounded-lg border ui-border-c"><table className="w-full text-xs"><thead className="bg-[rgb(var(--heading-bg))]"><tr>{['Date','Voucher Type','Voucher No.','Particulars','Narration','Debit','Credit','Balance'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody><tr className="font-semibold"><td className="px-3 py-2">{ledgerRange.start}</td><td colSpan={6} className="px-3 py-2">Opening Balance</td><td className="px-3 py-2 text-right">{formatReportAmount(openingBalance)}</td></tr>{statementRows.map((row, index) => <tr key={index} className="border-t ui-border-c"><td className="px-3 py-2">{String(row.date).slice(0, 10)}</td><td className="px-3 py-2">{row.voucherType}</td><td className="px-3 py-2">{row.voucherNo}</td><td className="px-3 py-2">{row.particulars}</td><td className="px-3 py-2">{row.narration}</td><td className="px-3 py-2 text-right">{row.debit ? formatReportAmount(row.debit) : '–'}</td><td className="px-3 py-2 text-right">{row.credit ? formatReportAmount(row.credit) : '–'}</td><td className="px-3 py-2 text-right">{formatReportAmount(row.runningBalance)}</td></tr>)}<tr className="border-t ui-border-c font-semibold"><td className="px-3 py-2">{ledgerRange.end}</td><td colSpan={6} className="px-3 py-2">Closing Balance</td><td className="px-3 py-2 text-right">{formatReportAmount(closingBalance)}</td></tr></tbody></table></div></div>;
  }
  const amountCell = (value, ledgerId, periodIndex = 0, context = 'activity') => <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{ledgerId ? <button className="text-[rgb(var(--link))] hover:underline" onClick={() => openLedger(ledgerId, periodIndex, context)}>{formatReportAmount(value)}</button> : formatReportAmount(value)}</td>;
  const cashBreakdown = kind => openCash.has(kind) && cashRows().map(row => <tr key={`${kind}:${row.id}`}><td className="sticky left-0 z-[1] bg-[rgb(var(--surface))] px-7 py-1.5"><button className="text-left text-[rgb(var(--link))] hover:underline" onClick={() => openLedger(row.id, 0, kind)}>{row.name}</button></td>{(kind === 'opening' ? row.openings : row.closings).map((value, index) => <React.Fragment key={index}>{amountCell(value, row.id, index, kind)}</React.Fragment>)}</tr>);
  const amountWidth = 16;
  const particularsWidth = Math.max(30, 100 - amountWidth * allModels.length);
  const totalWidth = particularsWidth + amountWidth * allModels.length;
  const printHeading = <div className="cash-flow-print-heading text-center"><strong>{currentCompany.name}</strong><div>{addressOf(currentCompany)}</div><strong>Cash Flow Statement</strong><div>{displayReportPeriod(range)}{compareRanges.length ? ` · Compare with ${compareRanges.map(displayReportPeriod).join(' · ')}` : ''}</div></div>;
  return <div className="cash-flow-report space-y-2 p-2 lg:p-3 print:p-0">
    <header className="flex items-center gap-2 rounded-lg border ui-border-c bg-[rgb(var(--app-bg))] px-3 py-1.5"><h1 className="ui-t-page shrink-0 whitespace-nowrap">Cash Flow Statement</h1><ReportPeriodFilters currentRange={range} periodMode={periodMode} onPeriodMode={setPeriodMode} customStart={customStart} customEnd={customEnd} onCustomRange={(start, end) => { setCustomStart(start); setCustomEnd(end); setPeriodMode('custom'); }} comparisonRanges={compareRanges} comparisonType={comparison} comparisonCount={comparisonCount} onComparison={(type, count, custom) => { setComparison(type); setComparisonCount(count); if (type === 'custom') setBaseCustom(custom); }}/><div className="ml-auto flex shrink-0 items-center gap-1.5 print:hidden"><button className="ui-btn ui-btn-secondary ui-btn-sm h-8" onClick={() => setViewOpen(true)}><Settings2 size={14}/> View</button><div className="relative" ref={exportRef}><button className="ui-btn ui-btn-secondary ui-btn-sm h-8" onClick={() => setExportOpen(!exportOpen)}><Download size={14}/> Export <ChevronDown size={12}/></button>{exportOpen && <div className="absolute right-0 top-full z-30 mt-1 w-28 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-1 shadow-lg"><button className="w-full px-2 py-1 text-left text-sm hover:bg-[rgb(var(--heading-bg))]" onClick={exportExcel}>Excel</button><button className="w-full px-2 py-1 text-left text-sm hover:bg-[rgb(var(--heading-bg))]" onClick={() => { setExportOpen(false); printReport(); }}>PDF</button></div>}</div><button className="ui-btn ui-btn-secondary ui-btn-sm h-8" onClick={printReport}><Printer size={14}/> Print</button></div></header>
    <div className="cash-flow-print-area rounded-lg border ui-border-c">{printHeading}<div className="cash-flow-table-wrapper overflow-x-auto"><table className="cash-flow-table pnl-report-table table-fixed text-xs" style={totalWidth > 100 ? { width: `${totalWidth}%`, maxWidth: 'none' } : { width: '100%' }}><colgroup><col style={{ width: `${particularsWidth / totalWidth * 100}%` }}/>{allModels.map((_, index) => <col key={index} style={{ width: `${amountWidth / totalWidth * 100}%` }}/>)}</colgroup><thead className="bg-[rgb(var(--heading-bg))]"><tr><th className="pnl-particulars-heading sticky left-0 z-20 bg-[rgb(var(--heading-bg))] px-2 py-2 text-center">Particulars</th>{allRanges.map(item => <th key={item.start} className="pnl-period-heading px-1 py-1 text-center" aria-label={displayReportPeriod(item)}><span className="pnl-period-label">{reportPeriodLines(item).map((line, index) => <span key={index}>{line}</span>)}</span></th>)}</tr></thead><tbody>
      {Object.entries(sectionNames).map(([section, label]) => { const lines = lineRows(section); const hasMovement = allModels.some(model => model?.sections[section]?.length); return <React.Fragment key={section}><tr className="report-section-heading"><td className="sticky left-0 z-[1] bg-[rgb(var(--surface))] px-3 py-2"><button className="inline-flex items-center gap-1 text-left" onClick={() => flip(setOpenSections, section)}>{openSections.has(section) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>} Cash flow from {label.toLowerCase()}</button></td>{allModels.map((_, index) => <td key={index}/>)}</tr>{openSections.has(section) && <>{lines.map(line => <tr key={line.id}><td className="sticky left-0 z-[1] bg-[rgb(var(--surface))] px-7 py-1.5">{line.linked ? <button className="text-left text-[rgb(var(--link))] hover:underline" onClick={() => openLedger(line.id)}>{line.label}</button> : line.label}</td>{line.values.map((value, index) => <React.Fragment key={index}>{amountCell(value, line.linked ? line.id : '', index)}</React.Fragment>)}</tr>)}{!lines.length && <tr><td className="sticky left-0 z-[1] bg-[rgb(var(--surface))] px-7 py-1.5 ui-muted">No cash movements</td>{allModels.map((_, index) => <td key={index} className="px-3 py-1.5 text-right">–</td>)}</tr>}{!hasMovement && !showZero && !showLinked.has(section) && Boolean(current?.sectionLedgers[section].length) && <tr className="cash-flow-ui-only"><td className="px-7 pb-2"><button className="text-xs text-[rgb(var(--link))] hover:underline" onClick={() => flip(setShowLinked, section)}>Show linked ledgers</button></td>{allModels.map((_, index) => <td key={index}/>)}</tr>}{showLinked.has(section) && !showZero && <tr className="cash-flow-ui-only"><td className="px-7 pb-2"><button className="text-xs text-[rgb(var(--link))] hover:underline" onClick={() => flip(setShowLinked, section)}>Hide zero ledgers</button></td>{allModels.map((_, index) => <td key={index}/>)}</tr>}</>}<tr className="font-semibold"><td className="sticky left-0 z-[1] bg-[rgb(var(--surface))] px-3 py-2">Net cash from {label.toLowerCase()}</td>{allModels.map((model, index) => <React.Fragment key={index}>{amountCell(model?.totals[section])}</React.Fragment>)}</tr></React.Fragment>; })}
      <tr className="border-t ui-border-c font-bold"><td className="sticky left-0 z-[1] bg-[rgb(var(--surface))] px-3 py-2">Net change in cash and cash equivalents</td>{allModels.map((model, index) => <React.Fragment key={index}>{amountCell(model?.net)}</React.Fragment>)}</tr>
      {['opening', 'closing'].map(kind => <React.Fragment key={kind}><tr className={kind === 'closing' ? 'border-t ui-border-c font-bold' : ''}><td className="sticky left-0 z-[1] bg-[rgb(var(--surface))] px-3 py-2"><button className="inline-flex items-center gap-1 text-left" onClick={() => flip(setOpenCash, kind)}>{openCash.has(kind) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>} {kind === 'opening' ? 'Opening' : 'Closing'} cash and cash equivalents</button></td>{allModels.map((model, index) => <React.Fragment key={index}>{amountCell(model?.[kind])}</React.Fragment>)}</tr>{cashBreakdown(kind)}</React.Fragment>)}
    </tbody></table></div>{!current.cashAccounts.length && <p className="p-4 text-sm ui-muted">No cash or bank ledgers are configured. Add a ledger under Cash-in-Hand or Bank Accounts to populate this statement.</p>}{current.cashAccounts.length > 0 && Math.abs(current.reconciliation) > 0.01 && <p className="p-3 text-xs text-[rgb(var(--neg))]">Unclassified cash difference: {formatReportAmount(current.reconciliation)}. Review cash and bank ledger postings.</p>}</div>
    {viewOpen && <div className="fixed inset-0 z-50 flex justify-end ui-scrim" onClick={() => setViewOpen(false)}><aside className="h-full w-full max-w-sm bg-[rgb(var(--surface))] shadow-xl" onClick={event => event.stopPropagation()}><div className="flex items-center justify-between border-b ui-border-c p-4"><h2 className="font-semibold">View</h2><button className="ui-icon-btn" aria-label="Close view" onClick={() => setViewOpen(false)}><X size={18}/></button></div><div className="space-y-4 p-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={showZero} onChange={event => setShowZero(event.target.checked)}/> Show all linked ledgers, including zero balances</label></div><div className="border-t ui-border-c p-4 text-right"><button className="ui-btn ui-btn-primary" onClick={() => setViewOpen(false)}>Done</button></div></aside></div>}
  </div>;
}
