import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Download, Printer, Settings2, X } from 'lucide-react';
import { buildLedgerStatement } from '../../data/db';
import { buildBalanceSheet } from './balanceSheetModel';
import { monthBounds } from './profitLossModel';
import { compactReportPeriod, displayReportPeriod, formatReportAmount, reportComparisonRanges } from './reportComparison';
import ReportPeriodFilters from './ReportPeriodFilters';
import { formatDateIn } from '@ui/utils/dates';

const sectionNames = { assets: 'Assets', liabilities: 'Liabilities', equity: 'Equity' };
const pct = (value, total) => total ? `${Math.round(value / Math.abs(total) * 100)}%` : '-';
const variancePct = (current, base) => base ? `${Math.round((current - base) / Math.abs(base) * 100)}%` : current ? 'New' : '-';
const csvValue = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const asAtDate = range => formatDateIn(range.end);
const addressOf = company => {
  const profile = company?.profile?.companySettings || {};
  const address = company?.registeredAddress || company?.address;
  if (typeof address === 'string') return [address, company?.city || profile.regCity, company?.state || profile.regStateName, company?.pincode || profile.regPincode].filter(Boolean).join(', ');
  if (address && typeof address === 'object') return [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  return [profile.regAddress1, profile.regAddress2, profile.regCity, profile.regStateName, profile.regPincode].filter(Boolean).join(', ');
};

export default function BalanceSheetReport({ db, currentCompany, onBack }) {
  const [periodMode, setPeriodMode] = useState('month');
  const [month] = useState(() => new Date().toISOString().slice(0, 7));
  const [customStart, setCustomStart] = useState(() => monthBounds(new Date().toISOString().slice(0, 7)).start);
  const [customEnd, setCustomEnd] = useState(() => monthBounds(new Date().toISOString().slice(0, 7)).end);
  const [comparison, setComparison] = useState('previousMonth');
  const [comparisonCount, setComparisonCount] = useState(1);
  const [baseCustom, setBaseCustom] = useState(() => monthBounds(new Date().toISOString().slice(0, 7)));
  const [layout, setLayout] = useState('horizontal');
  const [showPercent, setShowPercent] = useState(true);
  const [showVariance, setShowVariance] = useState(true);
  const [showZero, setShowZero] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(Object.keys(sectionNames)));
  const [selectedLedger, setSelectedLedger] = useState(null);
  const [detailIndex, setDetailIndex] = useState(-1);
  const currentRange = useMemo(() => {
    const today = new Date();
    const iso = value => value.toISOString().slice(0, 10);
    if (periodMode === 'year') return { start: `${today.getFullYear()}-01-01`, end: iso(today) };
    if (periodMode === '30days') { const start = new Date(today); start.setDate(start.getDate() - 29); return { start: iso(start), end: iso(today) }; }
    if (periodMode === 'custom') return { start: customStart, end: customEnd };
    return monthBounds(month);
  }, [periodMode, month, customStart, customEnd]);
  const compareRanges = useMemo(() => reportComparisonRanges(currentRange, comparison, comparisonCount, periodMode, month, baseCustom), [currentRange, comparison, comparisonCount, periodMode, month, baseCustom]);
  const validRange = currentRange.start && currentRange.end && currentRange.start <= currentRange.end && compareRanges.every(range => range.start && range.end && range.start <= range.end);
  const models = useMemo(() => validRange ? [buildBalanceSheet(db, currentCompany.id, currentRange, compareRanges[0] || currentRange), ...compareRanges.slice(1).map(range => buildBalanceSheet(db, currentCompany.id, currentRange, range))] : [], [db, currentCompany.id, currentRange, compareRanges, validRange]);
  const model = models[0];
  const multiComparison = compareRanges.length > 1;
  const effectivePercent = showPercent && !multiComparison;
  const effectiveVariance = showVariance && compareRanges.length === 1;
  const toggle = key => setExpanded(previous => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const valueFor = (row, index = -1) => {
    const source = models[Math.max(0, index)];
    if (!source) return 0;
    const field = index < 0 ? 'current' : 'previous';
    if (row.kind === 'section') return source[field][row.section] || 0;
    if (row.kind === 'total') return source[field][row.totalKey] || 0;
    const ledgers = source.sections[row.section] || [];
    if (row.kind === 'group') return ledgers.filter(ledger => ledger.groupPath?.includes(row.groupId)).reduce((total, ledger) => total + Number(ledger[field] || 0), 0);
    return ledgers.find(ledger => String(ledger.id) === String(row.id))?.[field] || 0;
  };
  const rows = [];
  const addSection = (section, depth = 0) => {
    rows.push({ key: section, label: sectionNames[section], kind: 'section', section, depth });
    if (expanded.has(section)) {
      const groups = model.groups[section];
      const addLedgers = (groupId, groupKey, ledgerDepth) => {
        const ledgers = new Map(models.flatMap(item => item.sections[section]).filter(ledger => ledger.groupId === groupId).map(ledger => [String(ledger.id), ledger]));
        for (const ledger of ledgers.values()) {
          const row = { key: `${groupKey}:${ledger.id}`, id: ledger.id, code: ledger.code, label: ledger.name, kind: 'ledger', source: ledger.source, section, depth: ledgerDepth };
          if (showZero || valueFor(row) || compareRanges.some((_, index) => valueFor(row, index))) rows.push(row);
        }
      };
      const addGroups = (parentGroupId, groupDepth, visited = new Set()) => {
        for (const group of groups.filter(item => item.parentGroupId === parentGroupId && !visited.has(item.id))) {
          const groupKey = `${section}:${group.id}`;
          rows.push({ key: groupKey, label: group.name, kind: 'group', section, groupId: group.id, depth: groupDepth });
          if (expanded.has(groupKey)) {
            addLedgers(group.id, groupKey, groupDepth + 1);
            addGroups(group.id, groupDepth + 1, new Set([...visited, group.id]));
          }
        }
      };
      addGroups(null, depth + 1);
      addLedgers(null, section, depth + 1);
    }
  };
  addSection('liabilities');
  rows.push({ key: 'total-liabilities', label: 'Total Liabilities', kind: 'total', totalKey: 'liabilities', depth: 0 });
  if (expanded.has('liabilities')) addSection('equity', 1);
  rows.push({ key: 'total-le', label: 'Total Liabilities & Equity', kind: 'total', totalKey: 'liabilitiesAndEquity', depth: 0 });
  rows.push({ key: 'assets-gap', kind: 'gap' });
  addSection('assets');
  rows.push({ key: 'total-assets', label: 'Total Assets', kind: 'total', totalKey: 'assets', depth: 0 });
  const totalBase = index => {
    const totals = index < 0 ? model?.current : models[index]?.previous;
    return Math.max(Math.abs(totals?.assets || 0), Math.abs(totals?.liabilitiesAndEquity || 0));
  };
  const detailRange = detailIndex < 0 ? currentRange : compareRanges[detailIndex];
  const detail = useMemo(() => selectedLedger?.source === 'ledger' ? buildLedgerStatement(db, currentCompany.id, selectedLedger.id) : null, [db, currentCompany.id, selectedLedger]);
  const detailRows = (detail?.rows || []).filter(row => String(row.date || '').slice(0, 10) <= detailRange.end).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const handlePrint = () => {
    document.body.classList.add('balance-sheet-printing');
    const cleanup = () => document.body.classList.remove('balance-sheet-printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    try { window.print(); } catch (error) { cleanup(); throw error; }
  };
  const exportCsv = () => {
    const requested = window.prompt('Export as: excel or pdf', 'excel')?.trim().toLowerCase();
    if (requested === 'pdf') { handlePrint(); return; }
    if (requested && requested !== 'excel' && requested !== 'csv') return;
    const heading = ['Particulars', `Amount as at ${asAtDate(currentRange)}`, ...(effectivePercent ? ['% of Total'] : []), ...compareRanges.flatMap(range => [`Amount as at ${asAtDate(range)}`, ...(effectivePercent ? ['% of Total'] : [])]), ...(effectiveVariance ? ['Variance', 'Variance %'] : [])];
    const lines = [heading, ...rows.filter(row => row.kind !== 'gap').map(row => {
      const current = valueFor(row);
      const first = valueFor(row, 0);
      return [row.label, current, ...(effectivePercent ? [pct(current, totalBase(-1))] : []), ...compareRanges.flatMap((_, index) => { const amount = valueFor(row, index); return [amount, ...(effectivePercent ? [pct(amount, totalBase(index))] : [])]; }), ...(effectiveVariance ? [current - first, variancePct(current, first)] : [])];
    })];
    const url = URL.createObjectURL(new Blob(['\uFEFF', lines.map(line => line.map(csvValue).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `Balance Sheet ${currentRange.end}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const numberCell = (value, total) => <><td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{formatReportAmount(value)}</td>{effectivePercent && <td className="px-1 py-1.5 text-right tabular-nums ui-muted">{pct(value, total)}</td>}</>;
  const emptyNumberCell = () => <><td aria-hidden="true"/>{effectivePercent && <td aria-hidden="true"/>}</>;
  const labelCell = row => <td className={`sticky left-0 z-[1] ${row.kind === 'section' && row.depth === 0 ? 'bg-[rgb(var(--heading-bg))]' : 'bg-[rgb(var(--surface))]'} px-3 py-1.5`} style={{ paddingLeft: `${12 + row.depth * 16}px` }}>{['section', 'group'].includes(row.kind) ? <button type="button" className="flex items-center gap-1 text-left" onClick={() => toggle(row.key)}>{expanded.has(row.key) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>} {row.label}</button> : row.kind === 'ledger' && row.source === 'ledger' ? <button type="button" className="text-left text-[rgb(var(--link))] hover:underline" onClick={() => { setSelectedLedger(row); setDetailIndex(-1); }}>{showCodes && row.code ? `${row.code} · ` : ''}{row.label}</button> : row.label}</td>;
  const periodHeader = range => <span className="pnl-period-label"><span>As at</span><span>{asAtDate(range)}</span></span>;
  const printHeading = <div className="financial-print-heading"><strong>{currentCompany.name}</strong><div>{addressOf(currentCompany)}</div><strong>Balance Sheet</strong><div>As at {asAtDate(currentRange)}{compareRanges.length ? ` · Compare with ${compareRanges.map(asAtDate).join(' · ')}` : ''}</div></div>;

  if (!model) return <div className="p-4"><button className="ui-btn ui-btn-ghost" onClick={onBack}><ArrowLeft size={15}/> Reports</button><p className="mt-3">Choose a valid period.</p></div>;
  if (selectedLedger) return <div className="space-y-3 p-3 lg:p-5"><div className="flex items-center justify-between rounded-lg bg-[rgb(var(--app-bg))] px-3 py-2"><div className="flex items-center gap-2"><button className="ui-icon-btn" aria-label="Back to Balance Sheet" onClick={() => setSelectedLedger(null)}><ArrowLeft size={16}/></button><h1 className="ui-t-page">{selectedLedger.label}</h1></div><select aria-label="Ledger period" className="ui-select" value={detailIndex} onChange={event => setDetailIndex(Number(event.target.value))}><option value={-1}>As at {compactReportPeriod(currentRange)}</option>{compareRanges.map((range, index) => <option key={range.end} value={index}>As at {compactReportPeriod(range)}</option>)}</select></div><div className="overflow-x-auto rounded-lg border ui-border-c"><table className="w-full text-xs"><thead className="bg-[rgb(var(--heading-bg))]"><tr>{['Date','Voucher Type','Voucher No.','Particulars','Narration','Debit','Credit','Balance'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{detailRows.map((row, index) => <tr key={index} className="border-t ui-border-c"><td className="px-3 py-2">{String(row.date).slice(0, 10)}</td><td className="px-3 py-2">{row.voucherType}</td><td className="px-3 py-2">{row.voucherNo}</td><td className="px-3 py-2">{row.particulars}</td><td className="px-3 py-2">{row.narration}</td><td className="px-3 py-2 text-right">{row.debit ? formatReportAmount(row.debit) : '-'}</td><td className="px-3 py-2 text-right">{row.credit ? formatReportAmount(row.credit) : '-'}</td><td className="px-3 py-2 text-right">{formatReportAmount(row.runningBalance)}</td></tr>)}</tbody></table>{!detailRows.length && <p className="p-6 text-sm ui-muted">No entries for this ledger.</p>}</div></div>;

  const horizontalTable = () => {
    const widths = multiComparison ? [Math.max(28, 100 - 14 * (compareRanges.length + 1)), ...Array(compareRanges.length + 1).fill(14)] : [35, 14, ...(effectivePercent ? [9] : []), ...(compareRanges.length ? [14, ...(effectivePercent ? [9] : []), ...(effectiveVariance ? [12, 7] : [])] : [])];
    const totalWidth = widths.reduce((total, width) => total + width, 0);
    const blankWidth = Math.max(0, 100 - totalWidth);
    return <div className={`profit-loss-table-wrapper ${multiComparison ? 'pnl-multi-comparison' : ''} min-h-[calc(100dvh-11rem)] rounded-lg border ui-border-c`}><table className="profit-loss-statement pnl-report-table text-xs" style={totalWidth > 100 ? { width: `${totalWidth}%`, maxWidth: 'none' } : undefined}><colgroup>{widths.map((width, index) => <col key={index} style={{ width: `${multiComparison ? width / Math.max(100, totalWidth) * 100 : width}%` }}/>) }{blankWidth > 0 && <col style={{ width: `${blankWidth}%` }}/>}</colgroup><thead className="bg-[rgb(var(--heading-bg))]"><tr><th className="pnl-particulars-heading sticky left-0 z-20 bg-[rgb(var(--heading-bg))] px-2 py-2 text-center">Particulars</th><th colSpan={effectivePercent ? 2 : 1} className="pnl-period-heading px-1 py-1 text-center" aria-label={`As at ${displayReportPeriod(currentRange)}`}>{periodHeader(currentRange)}</th>{compareRanges.map(range => <th key={range.end} colSpan={effectivePercent ? 2 : 1} className="pnl-period-heading px-1 py-1 text-center" aria-label={`As at ${displayReportPeriod(range)}`}>{periodHeader(range)}</th>)}{effectiveVariance && <th colSpan={2} className="px-2 py-1 text-center">Variance</th>}{blankWidth > 0 && <th rowSpan={2} aria-hidden="true" className="profit-loss-blank-cell"/>}</tr><tr><th className="pnl-particulars-heading sticky left-0 z-20 bg-[rgb(var(--heading-bg))]"/><th className="px-2 py-1 text-right">Amount (₹)</th>{effectivePercent && <th className="px-1 py-1 text-right">% of Total</th>}{compareRanges.map(range => <React.Fragment key={range.end}><th className="px-2 py-1 text-right">Amount (₹)</th>{effectivePercent && <th className="px-1 py-1 text-right">% of Total</th>}</React.Fragment>)}{effectiveVariance && <><th className="px-2 py-1 text-right">Amount (₹)</th><th className="px-1 py-1 text-right">%</th></>}</tr></thead><tbody>{rows.map(row => { if (row.kind === 'gap') return <tr key={row.key} className="balance-sheet-gap"><td colSpan={widths.length + (blankWidth > 0 ? 1 : 0)}/></tr>; const current = valueFor(row); const first = valueFor(row, 0); const heading = row.kind === 'section' && row.depth === 0; return <tr key={row.key} className={heading ? 'balance-sheet-section report-section-heading' : row.kind === 'section' ? 'report-section-heading' : row.kind === 'total' ? 'font-bold' : row.kind === 'group' ? 'font-semibold' : ''}>{labelCell(row)}{heading ? emptyNumberCell() : numberCell(current, totalBase(-1))}{compareRanges.map((range, index) => <React.Fragment key={range.end}>{heading ? emptyNumberCell() : numberCell(valueFor(row, index), totalBase(index))}</React.Fragment>)}{effectiveVariance && (heading ? <><td aria-hidden="true"/><td aria-hidden="true"/></> : <><td className="px-2 py-1.5 text-right tabular-nums">{formatReportAmount(current - first)}</td><td className="px-1 py-1.5 text-right">{variancePct(current, first)}</td></>)}{blankWidth > 0 && <td aria-hidden="true" className="profit-loss-blank-cell"/>}</tr>; })}</tbody></table></div>;
  };
  const verticalTable = side => {
    const keys = side === 'left' ? ['liabilities', 'total-liabilities', 'equity', 'total-le'] : ['assets', 'total-assets'];
    const visible = rows.filter(row => keys.some(key => row.key === key || row.key.startsWith(`${key}:`)));
    return <div className={`profit-loss-table-wrapper ${side === 'left' ? 'border-r ui-border-c' : ''}`}><table className="profit-loss-statement pnl-report-table w-full text-xs"><colgroup><col style={{ width: '56%' }}/><col style={{ width: '22%' }}/><col style={{ width: '22%' }}/></colgroup><thead className="bg-[rgb(var(--heading-bg))]"><tr><th className="px-2 py-2 text-center">{side === 'left' ? 'Liabilities' : 'Assets'}</th><th className="px-1 py-1 text-center">{periodHeader(currentRange)}</th><th className="px-1 py-1 text-center">{periodHeader(compareRanges[0])}</th></tr></thead><tbody>{visible.map(row => <tr key={row.key} className={row.kind === 'section' && row.depth === 0 ? 'balance-sheet-section report-section-heading' : row.kind === 'section' ? 'report-section-heading' : row.kind === 'total' ? 'font-bold' : ''}>{labelCell(row)}<td className="px-2 py-1.5 text-right">{row.kind === 'section' && row.depth === 0 ? '' : formatReportAmount(valueFor(row))}</td><td className="px-2 py-1.5 text-right">{row.kind === 'section' && row.depth === 0 ? '' : formatReportAmount(valueFor(row, 0))}</td></tr>)}</tbody></table></div>;
  };
  const openConfig = () => { setConfigDraft({ layout, showVariance, showPercent, showZero, showCodes }); setConfigOpen(true); };
  const saveConfig = () => { setLayout(configDraft.layout); setShowVariance(configDraft.showVariance); setShowPercent(configDraft.showPercent); setShowZero(configDraft.showZero); setShowCodes(configDraft.showCodes); setConfigOpen(false); };
  return <div className="space-y-2 p-2 lg:p-3 print:p-0">
    <header className="flex items-center gap-2 rounded-lg border ui-border-c bg-[rgb(var(--app-bg))] px-3 py-1.5"><h1 className="ui-t-page shrink-0 whitespace-nowrap">Balance Sheet</h1><ReportPeriodFilters currentRange={currentRange} periodMode={periodMode} onPeriodMode={setPeriodMode} customStart={customStart} customEnd={customEnd} onCustomRange={(start, end) => { setCustomStart(start); setCustomEnd(end); setPeriodMode('custom'); }} comparisonRanges={compareRanges} comparisonType={comparison} comparisonCount={comparisonCount} onComparison={(type, count, custom) => { setComparison(type); setComparisonCount(count); if (type === 'custom') setBaseCustom(custom); }}/><div className="ml-auto flex shrink-0 items-center gap-1.5 print:hidden"><button className="ui-btn ui-btn-secondary ui-btn-sm h-8" onClick={openConfig}><Settings2 size={14}/> View</button><button className="ui-btn ui-btn-secondary ui-btn-sm h-8" onClick={exportCsv}><Download size={14}/> Export</button><button className="ui-btn ui-btn-secondary ui-btn-sm h-8" onClick={handlePrint}><Printer size={14}/> Print</button></div></header>
    {configOpen && configDraft && <><button className="settings-drawer-backdrop print:hidden" aria-label="Close report options" onClick={() => setConfigOpen(false)}/><aside className="settings-side-drawer branch-detail-card space-y-3 print:hidden"><div className="settings-drawer-heading flex items-center justify-between"><div><div className="ui-t-sec">Balance Sheet view</div><div className="ui-caption">Choose columns and display style</div></div><button className="ui-btn ui-btn-ghost ui-btn-sm" aria-label="Close" onClick={() => setConfigOpen(false)}><X size={16}/></button></div><label className="ui-label block">Layout<select className="ui-select mt-1 w-full" value={configDraft.layout} onChange={event => setConfigDraft({ ...configDraft, layout: event.target.value })}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>{compareRanges.length === 1 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configDraft.showVariance} onChange={event => setConfigDraft({ ...configDraft, showVariance: event.target.checked })}/> Show variance</label>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configDraft.showPercent} onChange={event => setConfigDraft({ ...configDraft, showPercent: event.target.checked })}/> Show % of total</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configDraft.showZero} onChange={event => setConfigDraft({ ...configDraft, showZero: event.target.checked })}/> Show zero balances</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configDraft.showCodes} onChange={event => setConfigDraft({ ...configDraft, showCodes: event.target.checked })}/> Show ledger codes</label><div className="mt-auto flex justify-end gap-2 border-t ui-border-c pt-3"><button className="ui-btn ui-btn-secondary" onClick={() => setConfigOpen(false)}>Cancel</button><button className="ui-btn ui-btn-primary" onClick={saveConfig}>Save</button></div></aside></>}
    <div className="balance-sheet-print-area">{printHeading}{layout === 'vertical' && compareRanges.length === 1 ? <div className="grid grid-cols-2 gap-0 overflow-hidden rounded-lg border ui-border-c">{verticalTable('left')}{verticalTable('right')}</div> : horizontalTable()}</div>
  </div>;
}
