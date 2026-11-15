import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Download, Printer, Settings2, X } from 'lucide-react';
import { buildLedgerStatement } from '../../data/db';
import { buildProfitLoss, monthBounds, offsetMonth, previousPeriod, priorYearPeriod } from './profitLossModel';
import { branchTransferValue } from '../inventory/branchAccounts';
import { formatDateIn } from '@ui/utils/dates';
import { formatReportAmount } from './reportComparison';

const labels = { sales: 'Sales', cogs: 'Cost of Goods Sold', openingStock: 'Opening Stock', purchases: 'Purchases', directExpenses: 'Direct Expenses', closingStock: 'Closing Stock', grossProfit: 'Gross Profit', indirectIncome: 'Indirect Income', indirectExpenses: 'Indirect Expenses', netProfit: 'Net Profit' };
const children = ['openingStock', 'purchases', 'directExpenses', 'closingStock'];
const pct = (part, whole) => whole ? `${Math.round(part / whole * 100)}%` : '-';
const variancePct = (now, before) => before ? `${Math.round((now - before) / Math.abs(before) * 100)}%` : now ? 'New' : '-';
const csvValue = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const displayPeriod = range => {
  return `${formatDateIn(range.start)} – ${formatDateIn(range.end)}`;
};
const compactPeriod = range => {
  if (!range?.start || !range?.end) return 'Choose dates';
  return displayPeriod(range);
};
const tablePeriod = range => {
  return <span>{displayPeriod(range)}</span>;
};
const companyAddress = company => {
  const profile = company?.profile?.companySettings || {};
  const address = company?.registeredAddress || company?.address;
  if (typeof address === 'string' && address.trim()) return [address, company?.city || profile.regCity, company?.state || profile.regStateName, company?.pincode || profile.regPincode].filter(Boolean).join(', ');
  if (address && typeof address === 'object') return [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  return [profile.regAddress1, profile.regAddress2, company?.city || profile.regCity, company?.state || profile.regStateName, company?.pincode || profile.regPincode].filter(Boolean).join(', ');
};

export default function ProfitLossReport({ db, currentCompany, onBack, onLoadSamples }) {
  const [periodMode, setPeriodMode] = useState('month');
  const [month] = useState(() => new Date().toISOString().slice(0, 7));
  const [customStart, setCustomStart] = useState(() => monthBounds(new Date().toISOString().slice(0, 7)).start);
  const [customEnd, setCustomEnd] = useState(() => monthBounds(new Date().toISOString().slice(0, 7)).end);
  const [periodMenu, setPeriodMenu] = useState(null);
  const [periodChoice, setPeriodChoice] = useState('month');
  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);
  const [comparison, setComparison] = useState('previousMonth');
  const [comparisonCount, setComparisonCount] = useState(1);
  const [draftComparison, setDraftComparison] = useState('previousMonth');
  const [draftComparisonCount, setDraftComparisonCount] = useState(1);
  const [baseCustomStart, setBaseCustomStart] = useState(() => monthBounds(offsetMonth(new Date().toISOString().slice(0, 7), -1)).start);
  const [baseCustomEnd, setBaseCustomEnd] = useState(() => monthBounds(offsetMonth(new Date().toISOString().slice(0, 7), -1)).end);
  const [baseDraftStart, setBaseDraftStart] = useState(baseCustomStart);
  const [baseDraftEnd, setBaseDraftEnd] = useState(baseCustomEnd);
  const [layout, setLayout] = useState('horizontal');
  const [configOpen, setConfigOpen] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const [showPercent, setShowPercent] = useState(true);
  const [showVariance, setShowVariance] = useState(true);
  const [configDraft, setConfigDraft] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(['sales', 'cogs', ...children, 'indirectIncome', 'indirectExpenses']));
  const [selectedLedger, setSelectedLedger] = useState(null);
  const [detailPeriod, setDetailPeriod] = useState('current');
  const currentRange = useMemo(() => {
    const today = new Date();
    const iso = value => value.toISOString().slice(0, 10);
    if (periodMode === 'year') return { start: `${today.getFullYear()}-01-01`, end: iso(today) };
    if (periodMode === '30days') { const start = new Date(today); start.setDate(start.getDate() - 29); return { start: iso(start), end: iso(today) }; }
    if (periodMode === 'custom') return { start: customStart, end: customEnd };
    return monthBounds(month);
  }, [periodMode, month, customStart, customEnd]);
  const compareRanges = useMemo(() => {
    if (comparison === 'none') return [];
    if (comparison === 'custom') return [{ start: baseCustomStart, end: baseCustomEnd }];
    const ranges = [];
    for (let index = 1; index <= comparisonCount; index += 1) {
      if (comparison === 'previousYear') ranges.push(priorYearPeriod(ranges[index - 2] || currentRange));
      else if (periodMode === 'month') ranges.push(monthBounds(offsetMonth(month, -index)));
      else ranges.push(previousPeriod(ranges[index - 2] || currentRange));
    }
    return ranges;
  }, [comparison, comparisonCount, currentRange, periodMode, month, baseCustomStart, baseCustomEnd]);
  const compareRange = compareRanges[0] || currentRange;
  const validRange = Boolean(currentRange.start && currentRange.end && currentRange.start <= currentRange.end && (comparison !== 'custom' || (compareRange.start && compareRange.end && compareRange.start <= compareRange.end)));
  const model = useMemo(() => validRange ? buildProfitLoss(db, currentCompany.id, currentRange, compareRange) : null, [db, currentCompany.id, currentRange, compareRange, validRange]);
  const additionalModels = useMemo(() => validRange ? compareRanges.slice(1).map(range => buildProfitLoss(db, currentCompany.id, currentRange, range)) : [], [db, currentCompany.id, currentRange, compareRanges, validRange]);
  const hasComparison = compareRanges.length > 0;
  const multiComparison = compareRanges.length > 1;
  const effectivePercent = showPercent && !multiComparison;
  const effectiveVariance = showVariance && hasComparison && !multiComparison;
  const money = formatReportAmount;
  const rangeLabel = range => displayPeriod(range);
  const openPeriodMenu = type => {
    setPeriodMenu(type);
    setPeriodChoice(type === 'current' ? periodMode : comparison);
    setDraftComparison(comparison); setDraftComparisonCount(comparisonCount);
    setDraftStart(customStart); setDraftEnd(customEnd);
    setBaseDraftStart(baseCustomStart); setBaseDraftEnd(baseCustomEnd);
  };
  const choosePeriod = value => {
    setPeriodChoice(value);
    if (value === 'custom') return;
    if (periodMenu === 'current') setPeriodMode(value);
    else setComparison(value);
    setPeriodMenu(null);
  };
  const applyCustomPeriod = () => {
    const start = periodMenu === 'current' ? draftStart : baseDraftStart;
    const end = periodMenu === 'current' ? draftEnd : baseDraftEnd;
    if (!start || !end || start > end) return;
    if (periodMenu === 'current') { setCustomStart(start); setCustomEnd(end); setPeriodMode('custom'); }
    else { setBaseCustomStart(start); setBaseCustomEnd(end); setComparison('custom'); }
    setPeriodMenu(null);
  };
  const applyComparison = () => {
    if (draftComparison === 'custom' && (!baseDraftStart || !baseDraftEnd || baseDraftStart > baseDraftEnd)) return;
    if (draftComparison === 'custom') { setBaseCustomStart(baseDraftStart); setBaseCustomEnd(baseDraftEnd); }
    setComparison(draftComparison);
    setComparisonCount(draftComparisonCount);
    setPeriodMenu(null);
  };
  const toggle = key => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const detailRange = detailPeriod === 'previous' ? compareRange : currentRange;
  const detail = useMemo(() => selectedLedger ? buildLedgerStatement(db, currentCompany.id, selectedLedger.id) : null, [db, currentCompany.id, selectedLedger]);
  const detailRows = (detail?.rows || []).filter(row => String(row.date || '').slice(0, 10) >= detailRange.start && String(row.date || '').slice(0, 10) <= detailRange.end).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const handlePrint = () => {
    if (typeof window.print !== 'function') return;
    document.body.classList.add('pnl-report-printing');
    const cleanup = () => document.body.classList.remove('pnl-report-printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    try { window.print(); }
    catch (error) { cleanup(); throw error; }
  };
  const printHeading = <div className="pnl-print-heading"><div className="pnl-print-company">{currentCompany?.name || currentCompany?.companyName}</div><div className="pnl-print-address">{companyAddress(currentCompany)}</div><div className="pnl-print-title">Profit &amp; Loss Account</div><div className="pnl-print-period">Current period: {displayPeriod(currentRange)}{hasComparison && <> &nbsp; | &nbsp; Compare with: {compareRanges.map(displayPeriod).join(' · ')}</>}</div></div>;

  if (!model) return <div className="p-4"><button className="ui-btn ui-btn-ghost" onClick={onBack}><ArrowLeft size={15}/> Reports</button><p className="mt-4 text-sm text-[rgb(var(--neg))]">Choose a valid period. The start date must be on or before the end date.</p><div className="flex gap-2 mt-3"><input aria-label="Start date" type="date" className="ui-input" value={customStart} onChange={e => setCustomStart(e.target.value)}/><input aria-label="End date" type="date" className="ui-input" value={customEnd} onChange={e => setCustomEnd(e.target.value)}/></div></div>;

  const rows = [];
  const addSection = (key, depth = 0) => {
    rows.push({ key, label: labels[key], kind: 'section', depth, current: model.current[key], previous: model.previous[key] });
    const ledgers = new Map([...model.sections[key], ...additionalModels.flatMap(item => item.sections[key])].map(ledger => [String(ledger.id), ledger]));
    if (expanded.has(key)) for (const ledger of ledgers.values()) {
      if (!showZero && !ledger.current && !ledger.previous && !additionalModels.some(item => item.sections[key].some(other => String(other.id) === String(ledger.id) && other.previous))) continue;
      const firstLedger = model.sections[key].find(item => String(item.id) === String(ledger.id));
      rows.push({ ...ledger, current: firstLedger?.current || 0, previous: firstLedger?.previous || 0, section: key, key: `${key}-${ledger.id}`, label: ledger.name, kind: 'ledger', depth: depth + 1 });
    }
  };
  addSection('sales');
  rows.push({ key: 'cogs', label: labels.cogs, kind: 'section', depth: 0, current: model.current.cogs, previous: model.previous.cogs });
  if (expanded.has('cogs')) children.forEach(key => addSection(key, 1));
  rows.push({ key: 'grossProfit', label: labels.grossProfit, kind: 'total', depth: 0, current: model.current.grossProfit, previous: model.previous.grossProfit });
  addSection('indirectIncome'); addSection('indirectExpenses');
  rows.push({ key: 'netProfit', label: labels.netProfit, kind: 'net', depth: 0, current: model.current.netProfit, previous: model.previous.netProfit });
  const branchTransfers = (db.stockTransfers || []).filter(transfer => String(transfer.companyId) === String(currentCompany.id) && transfer.sourceBranchId && transfer.targetBranchId && String(transfer.sourceBranchId) !== String(transfer.targetBranchId) && !['draft', 'submitted', 'cancelled', 'rejected'].includes(String(transfer.status || '').toLowerCase()));
  const branchNames = new Map();
  branchTransfers.forEach(transfer => {
    branchNames.set(String(transfer.sourceBranchId), transfer.sourceBranchName || String(transfer.sourceBranchId));
    branchNames.set(String(transfer.targetBranchId), transfer.targetBranchName || String(transfer.targetBranchId));
  });
  const branchAmount = (branchId, side, range) => Math.round(branchTransfers.filter(transfer => String(transfer.date || '').slice(0, 10) >= range.start && String(transfer.date || '').slice(0, 10) <= range.end && String(transfer[side === 'invoice' ? 'sourceBranchId' : 'targetBranchId']) === branchId).reduce((sum, transfer) => sum + branchTransferValue(transfer), 0) * 100) / 100;
  if (branchTransfers.length) {
    rows.push({ key: 'branch-heading', label: 'BRANCH TRANSFERS · INTERNAL', kind: 'memoHeading', depth: 0, current: 0, previous: 0 });
    for (const [branchId, name] of branchNames) for (const side of ['invoice', 'purchase']) {
      const current = branchAmount(branchId, side, currentRange);
      const previous = branchAmount(branchId, side, compareRange);
      if (showZero || current || previous || compareRanges.slice(1).some(range => branchAmount(branchId, side, range))) rows.push({ key: `branch-${branchId}-${side}`, label: `${side === 'invoice' ? 'Branch invoice' : 'Branch purchase'} · ${name}`, kind: 'branchMemo', depth: 1, branchId, side, current, previous });
    }
  }
  const comparisonValue = (row, index) => {
    if (index === 0) return row.previous;
    if (row.kind === 'branchMemo') return branchAmount(row.branchId, row.side, compareRanges[index]);
    if (row.kind === 'memoHeading') return 0;
    const comparisonModel = additionalModels[index - 1];
    if (!comparisonModel) return 0;
    if (row.kind !== 'ledger') return comparisonModel.previous[row.key] || 0;
    return comparisonModel.sections[row.section]?.find(ledger => String(ledger.id) === String(row.id))?.previous || 0;
  };

  const exportCsv = () => {
    const requested = window.prompt('Export as: excel or pdf', 'excel')?.trim().toLowerCase();
    if (requested === 'pdf') { handlePrint(); return; }
    if (requested && requested !== 'excel' && requested !== 'csv') return;
    const heading = ['Particulars', `Amount ${rangeLabel(currentRange)}`, ...(effectivePercent ? ['% of Sales'] : []), ...compareRanges.flatMap(range => [`Amount ${rangeLabel(range)}`, ...(effectivePercent ? ['% of Sales'] : [])]), ...(effectiveVariance ? ['Variance', 'Variance %'] : [])];
    const lines = [heading, ...rows.map(row => [row.label, row.current, ...(effectivePercent ? [pct(row.current, model.current.sales)] : []), ...compareRanges.flatMap((range, index) => { const value = comparisonValue(row, index); return [value, ...(effectivePercent ? [pct(value, index === 0 ? model.previous.sales : additionalModels[index - 1].previous.sales)] : [])]; }), ...(effectiveVariance ? [row.current - row.previous, variancePct(row.current, row.previous)] : [])])];
    const url = URL.createObjectURL(new Blob(['\uFEFF', lines.map(line => line.map(csvValue).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `Profit and Loss ${currentRange.start} to ${currentRange.end}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const numberCells = (value, sales) => <><td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap">{money(value)}</td>{effectivePercent && <td className="px-1 py-1.5 text-right tabular-nums ui-muted whitespace-nowrap">{pct(value, sales)}</td>}</>;
  const varianceCells = row => { const difference = row.current - row.previous; const tone = difference < 0 ? 'text-[rgb(var(--neg))]' : difference > 0 ? 'text-[rgb(var(--pos))]' : ''; return <><td className={`px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap ${tone}`}>{money(difference)}</td><td className={`px-1 py-1.5 text-right tabular-nums whitespace-nowrap ${tone}`}>{variancePct(row.current, row.previous)}</td></>; };
  const labelCell = row => <td className="sticky left-0 z-[1] bg-[rgb(var(--surface))] px-3 py-1.5" style={{ paddingLeft: `${12 + row.depth * 16}px` }}>{row.kind === 'section' ? <button type="button" className="flex items-center gap-1 text-left w-full" onClick={() => toggle(row.key)}>{expanded.has(row.key) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}<span>{row.label}</span></button> : row.kind === 'ledger' && row.source === 'ledger' ? <button type="button" className="text-left text-[rgb(var(--link))] hover:underline" onClick={() => { setSelectedLedger(row); setDetailPeriod('current'); }}>{showCodes && row.code ? `${row.code} · ` : ''}{row.label}</button> : <span>{row.label}</span>}</td>;

  if (selectedLedger) return <div className="p-3 lg:p-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[rgb(var(--heading-bg))] px-3 py-2"><div className="flex items-center gap-2"><button type="button" className="ui-icon-btn" aria-label="Back to Profit and Loss" onClick={() => setSelectedLedger(null)}><ArrowLeft size={16}/></button><div><h1 className="ui-t-page">{selectedLedger.name}</h1><p className="ui-muted text-xs">Ledger details · {rangeLabel(detailRange)}</p></div></div><select aria-label="Ledger period" className="ui-select" value={detailPeriod} onChange={e => setDetailPeriod(e.target.value)}><option value="current">Selected period</option>{hasComparison && <option value="previous">Comparison period</option>}</select></div><div className="overflow-x-auto rounded-lg border ui-border-c"><table className="w-full text-xs"><thead className="bg-[rgb(var(--heading-bg))]"><tr>{['Date','Voucher Type','Voucher No.','Particulars','Narration','Debit','Credit'].map(label => <th key={label} className={`px-3 py-2 ${['Debit','Credit'].includes(label) ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead><tbody>{detailRows.map((row, index) => <tr key={`${row.date}-${row.voucherNo}-${index}`} className="border-t ui-border-c"><td className="px-3 py-2 whitespace-nowrap">{String(row.date).slice(0, 10)}</td><td className="px-3 py-2">{row.voucherType}</td><td className="px-3 py-2">{row.voucherNo}</td><td className="px-3 py-2">{row.particulars}</td><td className="px-3 py-2">{row.narration}</td><td className="px-3 py-2 text-right tabular-nums">{row.debit ? money(row.debit) : '—'}</td><td className="px-3 py-2 text-right tabular-nums">{row.credit ? money(row.credit) : '—'}</td></tr>)}</tbody><tfoot><tr className="font-semibold bg-[rgb(var(--heading-bg))]"><td colSpan="5" className="px-3 py-2">Total · {detailRows.length} entries</td><td className="px-3 py-2 text-right">{money(detailRows.reduce((sum, row) => sum + Number(row.debit || 0), 0))}</td><td className="px-3 py-2 text-right">{money(detailRows.reduce((sum, row) => sum + Number(row.credit || 0), 0))}</td></tr></tfoot></table>{!detailRows.length && <p className="p-6 text-sm ui-muted">No entries for this ledger in the selected period.</p>}</div></div>;

  const statementTable = () => {
    const dataWidths = multiComparison ? [Math.max(28, 100 - 14 * (compareRanges.length + 1)), ...Array(compareRanges.length + 1).fill(14)] : [35, 14, ...(effectivePercent ? [9] : []), ...(hasComparison ? [14, ...(effectivePercent ? [9] : []), ...(effectiveVariance ? [12, 7] : [])] : [])];
    const totalWidth = dataWidths.reduce((sum, width) => sum + width, 0);
    const blankWidth = Math.max(0, 100 - totalWidth);
    const tableStyle = multiComparison && totalWidth > 100 ? { width: `${totalWidth}%`, maxWidth: 'none' } : undefined;
    return (
      <div className={`profit-loss-table-wrapper ${multiComparison ? 'pnl-multi-comparison' : ''} min-h-[calc(100dvh-11rem)] min-w-0 rounded-lg border ui-border-c bg-[rgb(var(--surface))]`}>{printHeading}
        <table className="profit-loss-statement pnl-report-table text-xs" style={tableStyle}>
          <colgroup>
            {dataWidths.map((width, index) => <col key={index} style={{ width: `${multiComparison ? width / Math.max(100, totalWidth) * 100 : width}%` }}/>)}
            {blankWidth > 0 && <col style={{ width: `${blankWidth}%` }}/>}
          </colgroup>
          <thead className="bg-[rgb(var(--heading-bg))]">
            <tr>
              <th className="pnl-particulars-heading sticky left-0 z-20 bg-[rgb(var(--heading-bg))] px-2 py-2 text-center">Particulars</th>
              <th colSpan={effectivePercent ? 2 : 1} className="pnl-period-heading px-1 py-1 text-center" aria-label={displayPeriod(currentRange)}><span className="pnl-period-label">{tablePeriod(currentRange)}</span></th>
              {compareRanges.map(range => <th key={`${range.start}-${range.end}`} colSpan={effectivePercent ? 2 : 1} className="pnl-period-heading px-1 py-1 text-center" aria-label={displayPeriod(range)}><span className="pnl-period-label">{tablePeriod(range)}</span></th>)}
              {effectiveVariance && <th colSpan="2" className="px-2 py-2 text-center">Variance</th>}
              {blankWidth > 0 && <th rowSpan="2" aria-hidden="true" className="profit-loss-blank-cell"/>}
            </tr>
            <tr>
              <th className="pnl-particulars-heading sticky left-0 z-20 bg-[rgb(var(--heading-bg))]"/>
              <th className="pnl-amount-heading px-2 py-1 text-right">Amount (₹)</th>
              {effectivePercent && <th className="px-1 py-1 text-right">% of Sales</th>}
              {compareRanges.map(range => <React.Fragment key={`${range.start}-${range.end}`}><th className="pnl-amount-heading px-2 py-1 text-right">Amount (₹)</th>{effectivePercent && <th className="px-1 py-1 text-right">% of Sales</th>}</React.Fragment>)}
              {effectiveVariance && <><th className="px-2 py-1 text-right">Amount (₹)</th><th className="px-1 py-1 text-right">%</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => <tr key={row.key} className={`${row.kind === 'net' || row.kind === 'total' ? 'font-bold' : row.kind === 'section' ? 'font-semibold' : ''} border-t ui-border-c`}>
              {labelCell(row)}
              {numberCells(row.current, model.current.sales)}
              {compareRanges.map((range, index) => <React.Fragment key={`${range.start}-${range.end}`}>{numberCells(comparisonValue(row, index), index === 0 ? model.previous.sales : additionalModels[index - 1].previous.sales)}</React.Fragment>)}
              {effectiveVariance && varianceCells(row)}
              {blankWidth > 0 && <td aria-hidden="true" className="profit-loss-blank-cell"/>}
            </tr>)}
          </tbody>
        </table>
      </div>
    );
  };

  const verticalStatement = side => {
    const keys = side === 'expenses' ? ['cogs', ...children, 'indirectExpenses'] : ['sales', 'grossProfit', 'indirectIncome', 'netProfit'];
    const sectionRows = rows.filter(row => keys.some(key => row.key === key || row.key.startsWith(`${key}-`)));
    const totalCurrent = side === 'expenses' ? model.current.cogs + model.current.indirectExpenses : model.current.sales + model.current.indirectIncome;
    const totalPrevious = side === 'expenses' ? model.previous.cogs + model.previous.indirectExpenses : model.previous.sales + model.previous.indirectIncome;
    return <div className={`profit-loss-table-wrapper ${side === 'expenses' ? 'border-r ui-border-c' : ''}`}><table className="profit-loss-statement border-collapse text-xs w-full"><thead className="bg-[rgb(var(--heading-bg))]"><tr><th className="px-3 py-2 text-left">Particulars</th><th className="px-2 py-2 text-right whitespace-nowrap">{rangeLabel(currentRange)}</th><th className="px-2 py-2 text-right whitespace-nowrap">{rangeLabel(compareRange)}</th></tr></thead><tbody>{sectionRows.map(row => <tr key={row.key} className={`${row.kind === 'net' || row.kind === 'total' ? 'font-bold' : row.kind === 'section' ? 'font-semibold' : ''} border-t ui-border-c`}>{labelCell(row)}<td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(row.current)}</td><td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(row.previous)}</td></tr>)}</tbody><tfoot><tr className="font-bold border-t-2 ui-border-c bg-[rgb(var(--heading-bg))]"><td className="px-3 py-2">Total</td><td className="px-2 py-2 text-right tabular-nums">{money(totalCurrent)}</td><td className="px-2 py-2 text-right tabular-nums">{money(totalPrevious)}</td></tr></tfoot></table></div>;
  };

  const openConfig = () => { setConfigDraft({ comparison, layout, showVariance, showPercent, showZero, showCodes }); setConfigOpen(true); };
  const saveConfig = () => { if (!configDraft) return; setComparison(configDraft.comparison); setLayout('horizontal'); setShowVariance(configDraft.showVariance); setShowPercent(configDraft.showPercent); setShowZero(configDraft.showZero); setShowCodes(configDraft.showCodes); setConfigOpen(false); };
  const periodControls = <div className="flex min-w-0 items-center gap-1.5 print:hidden">
    <div className="relative w-[220px] shrink-0">
      <button type="button" className="ui-btn ui-btn-secondary h-8 w-full justify-between gap-1 px-2 text-xs" aria-label="Current Period" aria-expanded={periodMenu === 'current'} onClick={() => periodMenu === 'current' ? setPeriodMenu(null) : openPeriodMenu('current')}>
        <span className="font-semibold whitespace-nowrap">Current</span><span className="min-w-0 whitespace-nowrap text-right font-normal" title={displayPeriod(currentRange)}>{compactPeriod(currentRange)}</span><ChevronDown size={13} className="shrink-0"/>
      </button>
      {periodMenu === 'current' && <div className="absolute left-0 top-[calc(100%+0.25rem)] z-40 w-72 max-w-[calc(100vw-2rem)] rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-3 shadow-xl">
        <label className="ui-label block">Current Period<select aria-label="Current Period selection" className="ui-select mt-1 w-full text-xs" value={periodChoice} onChange={e => choosePeriod(e.target.value)}><option value="month">This month</option><option value="year">This year</option><option value="30days">Last 30 days</option><option value="custom">Custom</option></select></label>
        {periodChoice === 'custom' && <><div className="mt-2 grid grid-cols-2 gap-2"><label className="ui-label">From<input aria-label="Current Period from" className="ui-input mt-1 w-full text-xs" type="date" value={draftStart} onChange={e => setDraftStart(e.target.value)}/></label><label className="ui-label">To<input aria-label="Current Period to" className="ui-input mt-1 w-full text-xs" type="date" min={draftStart} value={draftEnd} onChange={e => setDraftEnd(e.target.value)}/></label></div><div className="mt-3 flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setPeriodMenu(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={!draftStart || !draftEnd || draftStart > draftEnd} onClick={applyCustomPeriod}>Apply</button></div></>}
      </div>}
    </div>
    <div className="relative w-[250px] shrink-0">
      <button type="button" className="ui-btn ui-btn-secondary h-8 w-full justify-between gap-1 px-2 text-xs" aria-label="Compare with" aria-expanded={periodMenu === 'base'} onClick={() => periodMenu === 'base' ? setPeriodMenu(null) : openPeriodMenu('base')}>
        <span className="font-semibold whitespace-nowrap">Compare</span><span className="min-w-0 whitespace-nowrap text-right font-normal" title={compareRanges.map(displayPeriod).join(', ')}>{!hasComparison ? 'None' : multiComparison ? `${compareRanges.length} ${comparison === 'previousYear' ? 'years' : 'periods'}` : compactPeriod(compareRange)}</span><ChevronDown size={13} className="shrink-0"/>
      </button>
      {periodMenu === 'base' && <div className="absolute left-0 top-[calc(100%+0.25rem)] z-40 w-72 max-w-[calc(100vw-2rem)] rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-3 shadow-xl">
        <label className="ui-label block">Comparison type<select aria-label="Comparison type" className="ui-select mt-1 w-full text-xs" value={draftComparison} onChange={e => setDraftComparison(e.target.value)}><option value="none">No comparison</option><option value="previousMonth">Previous period(s)</option><option value="previousYear">Previous year(s)</option><option value="custom">Custom range</option></select></label>
        {draftComparison !== 'none' && draftComparison !== 'custom' && <label className="ui-label mt-3 block">Number of {draftComparison === 'previousYear' ? 'years' : 'periods'}<select aria-label="Number of comparison periods" className="ui-select mt-1 w-full text-xs" value={draftComparisonCount} onChange={e => setDraftComparisonCount(Number(e.target.value))}>{Array.from({ length: 32 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>}
        {draftComparison === 'custom' && <div className="mt-2 grid grid-cols-2 gap-2"><label className="ui-label">From<input aria-label="Compare with from" className="ui-input mt-1 w-full text-xs" type="date" value={baseDraftStart} onChange={e => setBaseDraftStart(e.target.value)}/></label><label className="ui-label">To<input aria-label="Compare with to" className="ui-input mt-1 w-full text-xs" type="date" min={baseDraftStart} value={baseDraftEnd} onChange={e => setBaseDraftEnd(e.target.value)}/></label></div>}
        <div className="mt-3 flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setPeriodMenu(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={draftComparison === 'custom' && (!baseDraftStart || !baseDraftEnd || baseDraftStart > baseDraftEnd)} onClick={applyComparison}>Apply</button></div>
      </div>}
    </div>
  </div>;
  const reportHeader = <div className="rounded-lg border ui-border-c bg-[rgb(var(--app-bg))] px-3 py-1.5 print:bg-white">
    <div className="flex items-center gap-2">
      <h1 className="ui-t-page shrink-0 whitespace-nowrap">Profit &amp; Loss Account</h1>
      {periodControls}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 print:hidden">
        {onLoadSamples && !(db.sampleScenarioSets || []).some((entry) => String(entry.companyId) === String(currentCompany.id) && String(entry.key).startsWith('linked-v1:')) ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm h-8 px-2.5" onClick={onLoadSamples}>Add sample entries</button> : null}
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm h-8 px-2.5" aria-expanded={configOpen} onClick={openConfig}><Settings2 size={14}/> View</button>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm h-8 px-2.5" onClick={exportCsv}><Download size={14}/> Export</button>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm h-8 px-2.5" onClick={handlePrint}><Printer size={14}/> Print</button>
      </div>
    </div>
  </div>;
  return <div className="p-2 lg:p-3 space-y-2 print:p-0">{reportHeader}
    {configOpen && configDraft && <><button type="button" className="settings-drawer-backdrop print:hidden" aria-label="Close report options" onClick={() => setConfigOpen(false)} /><aside className="settings-side-drawer branch-detail-card space-y-3 print:hidden"><div className="settings-drawer-heading flex items-center justify-between"><div><div className="ui-t-sec">P&amp;L view options</div><div className="ui-caption">Choose the columns and display style</div></div><button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label="Close" onClick={() => setConfigOpen(false)}><X size={16}/></button></div><label className="ui-label block">Comparison<select className="ui-select w-full mt-1" value={configDraft.comparison} onChange={e => setConfigDraft({ ...configDraft, comparison: e.target.value })}><option value="none">No comparison</option><option value="previousMonth">Previous period</option><option value="previousYear">Same period last year</option></select></label><label className="ui-label block">Layout<select className="ui-select w-full mt-1" value={configDraft.layout} onChange={e => setConfigDraft({ ...configDraft, layout: e.target.value })}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>{configDraft.comparison !== 'none' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configDraft.showVariance} onChange={e => setConfigDraft({ ...configDraft, showVariance: e.target.checked })}/> Show variance and variance %</label>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configDraft.showPercent} onChange={e => setConfigDraft({ ...configDraft, showPercent: e.target.checked })}/> Show % of sales</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configDraft.showZero} onChange={e => setConfigDraft({ ...configDraft, showZero: e.target.checked })}/> Show zero balances</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configDraft.showCodes} onChange={e => setConfigDraft({ ...configDraft, showCodes: e.target.checked })}/> Show ledger codes</label><div className="mt-auto flex justify-end gap-2 border-t ui-border-c pt-3"><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setConfigOpen(false)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={saveConfig}>Save</button></div></aside></>}
    {layout === 'vertical' && hasComparison && !multiComparison ? <div className="grid grid-cols-2 gap-0 rounded-lg border ui-border-c overflow-hidden">{verticalStatement('expenses', 'Expenses & Cost of Goods Sold')}{verticalStatement('income', 'Income & Profit')}</div> : statementTable()}
  </div>;
}

