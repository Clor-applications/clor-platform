import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Download, Printer, Settings2, X } from 'lucide-react';
import { buildLedgerStatement } from '../../data/db';
import { monthBounds } from './profitLossModel';
import { buildTrialBalance } from './trialBalanceModel';
import { formatDateIn } from '@ui/utils/dates';
import { formatMoney } from '@ui/utils/money';
import { useDismissable } from '@ui/components/ui/useDismissable';

const money = value => formatMoney(value);
const balance = value => Math.abs(value) < 0.005 ? '–' : `${money(Math.abs(value))} ${value > 0 ? 'Dr' : 'Cr'}`;
const dateText = value => formatDateIn(value);
const addressOf = company => {
  const profile = company?.profile?.companySettings || {};
  const address = company?.registeredAddress || company?.address;
  if (typeof address === 'string') return [address, company?.city || profile.regCity, company?.state || profile.regStateName, company?.pincode || profile.regPincode].filter(Boolean).join(', ');
  if (address && typeof address === 'object') return [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  return [profile.regAddress1, profile.regAddress2, profile.regCity, profile.regStateName, profile.regPincode].filter(Boolean).join(', ');
};

export default function TrialBalanceReport({ db, currentCompany }) {
  const today = new Date();
  const [periodMode, setPeriodMode] = useState('month');
  const [customStart, setCustomStart] = useState(() => monthBounds(today.toISOString().slice(0, 7)).start);
  const [customEnd, setCustomEnd] = useState(() => monthBounds(today.toISOString().slice(0, 7)).end);
  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const periodRef = useDismissable(periodOpen, () => setPeriodOpen(false));
  const exportRef = useDismissable(exportOpen, () => setExportOpen(false));
  const [showBalances, setShowBalances] = useState(true);
  const [view, setView] = useState('group');
  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedLedger, setSelectedLedger] = useState(null);
  const range = useMemo(() => {
    const now = new Date();
    const iso = date => date.toISOString().slice(0, 10);
    if (periodMode === 'year') return { start: `${now.getFullYear()}-01-01`, end: iso(now) };
    if (periodMode === '30days') { const start = new Date(now); start.setDate(start.getDate() - 29); return { start: iso(start), end: iso(now) }; }
    if (periodMode === 'custom') return { start: customStart, end: customEnd };
    return monthBounds(now.toISOString().slice(0, 7));
  }, [periodMode, customStart, customEnd]);
  const validRange = Boolean(range.start && range.end && range.start <= range.end);
  const model = useMemo(() => validRange ? buildTrialBalance(db, currentCompany.id, range) : { roots: [], ledgers: [], totals: { opening: 0, debit: 0, credit: 0, closing: 0 } }, [db, currentCompany.id, range, validRange]);
  const flatten = (nodes, depth = 0) => nodes.flatMap(node => [ { ...node, depth }, ...(node.kind === 'group' && expanded.has(node.id) ? flatten(node.children, depth + 1) : []) ]);
  const rows = view === 'ledger' ? model.ledgers.map(row => ({ ...row, depth: 0 })) : flatten(model.roots);
  const toggle = id => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const periodLabel = `${dateText(range.start)} – ${dateText(range.end)}`;
  const printReport = () => {
    document.body.classList.add('trial-balance-printing');
    const cleanup = () => { document.body.classList.remove('trial-balance-printing'); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 120000);
  };
  const exportExcel = async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const headers = ['Particulars', ...(showBalances ? ['Opening Balance'] : []), 'Debit', 'Credit', ...(showBalances ? ['Closing Balance'] : [])];
    const values = [headers, ...rows.map(row => [`${'  '.repeat(row.depth)}${row.name}`, ...(showBalances ? [balance(row.opening)] : []), row.debit, row.credit, ...(showBalances ? [balance(row.closing)] : [])]), ['Total', ...(showBalances ? [balance(model.totals.opening)] : []), model.totals.debit, model.totals.credit, ...(showBalances ? [balance(model.totals.closing)] : [])]];
    const data = values.map((row, rowIndex) => row.map((value, columnIndex) => ({ value, type: typeof value === 'number' ? Number : String, fontWeight: rowIndex === 0 || rowIndex === values.length - 1 ? 'bold' : undefined, align: columnIndex ? 'right' : 'left' })));
    await writeXlsxFile(data, { sheet: 'Trial Balance', columns: headers.map((_, index) => ({ width: index ? 20 : 44 })) }).toFile(`Trial Balance ${range.start} to ${range.end}.xlsx`);
    setExportOpen(false);
  };
  const statement = useMemo(() => selectedLedger ? buildLedgerStatement(db, currentCompany.id, selectedLedger.id) : null, [db, currentCompany.id, selectedLedger]);
  const statementRows = (statement?.rows || []).filter(row => String(row.date || '').slice(0, 10) >= range.start && String(row.date || '').slice(0, 10) <= range.end);
  if (selectedLedger) return <div className="p-3 lg:p-5 space-y-3"><div className="flex items-center gap-2 rounded-lg bg-[rgb(var(--heading-bg))] px-3 py-2"><button className="ui-icon-btn" aria-label="Back to Trial Balance" onClick={() => setSelectedLedger(null)}><ArrowLeft size={16}/></button><div><h1 className="ui-t-page">{selectedLedger.name}</h1><p className="text-xs ui-muted">Ledger Statement · {periodLabel}</p></div></div><div className="overflow-x-auto rounded-lg border ui-border-c"><table className="w-full text-xs"><thead className="bg-[rgb(var(--heading-bg))]"><tr>{['Date','Voucher Type','Voucher No.','Particulars','Narration','Debit','Credit','Balance'].map(label => <th key={label} className={`px-3 py-2 ${['Debit','Credit','Balance'].includes(label) ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead><tbody>{statementRows.map((row, index) => <tr key={`${row.date}-${index}`} className="border-t ui-border-c"><td className="px-3 py-2">{dateText(String(row.date).slice(0, 10))}</td><td className="px-3 py-2">{row.voucherType}</td><td className="px-3 py-2">{row.voucherNo}</td><td className="px-3 py-2">{row.particulars}</td><td className="px-3 py-2">{row.narration}</td><td className="px-3 py-2 text-right">{row.debit ? money(row.debit) : '–'}</td><td className="px-3 py-2 text-right">{row.credit ? money(row.credit) : '–'}</td><td className="px-3 py-2 text-right">{money(row.runningBalance)}</td></tr>)}</tbody></table>{!statementRows.length && <p className="p-6 text-sm ui-muted">No entries in this period.</p>}</div></div>;
  return <div className="trial-balance-report p-3 lg:p-4 space-y-2">
    <header className="trial-balance-toolbar flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[rgb(var(--heading-bg))] px-3 py-2"><h1 className="ui-t-page">Trial Balance</h1><div className="flex items-center gap-2">
      <div className="relative" ref={periodRef}><button className="ui-btn ui-btn-secondary h-8 min-w-36 justify-between text-xs" onClick={() => setPeriodOpen(!periodOpen)}>{periodMode === 'month' ? 'This month' : periodMode === 'year' ? 'This year' : periodMode === '30days' ? 'Last 30 days' : 'Custom'} <ChevronDown size={14}/></button>{periodOpen && <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-2 shadow-lg">{[['month','This month'],['year','This year'],['30days','Last 30 days'],['custom','Custom']].map(([key,label]) => <button key={key} className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[rgb(var(--heading-bg))]" onClick={() => { if (key === 'custom') { setDraftStart(customStart); setDraftEnd(customEnd); setPeriodMode('custom'); } else { setPeriodMode(key); setPeriodOpen(false); } }}>{label}</button>)}{periodMode === 'custom' && <div className="mt-2 space-y-2 border-t ui-border-c pt-2"><label className="block text-xs">From<input className="ui-input mt-1 w-full" type="date" value={draftStart} onChange={event => setDraftStart(event.target.value)}/></label><label className="block text-xs">To<input className="ui-input mt-1 w-full" type="date" value={draftEnd} onChange={event => setDraftEnd(event.target.value)}/></label><button className="ui-btn ui-btn-primary w-full" disabled={!draftStart || !draftEnd || draftStart > draftEnd} onClick={() => { setCustomStart(draftStart); setCustomEnd(draftEnd); setPeriodOpen(false); }}>Apply</button></div>}</div>}</div>
      <button className="ui-btn ui-btn-secondary h-8 text-xs" onClick={() => setViewOpen(true)}><Settings2 size={14}/> View</button>
      <div className="relative" ref={exportRef}><button className="ui-btn ui-btn-secondary h-8 text-xs" onClick={() => setExportOpen(!exportOpen)}><Download size={14}/> Export <ChevronDown size={12}/></button>{exportOpen && <div className="absolute right-0 top-full z-30 mt-1 w-28 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-1 shadow-lg"><button className="w-full px-2 py-1 text-left text-sm hover:bg-[rgb(var(--heading-bg))]" onClick={exportExcel}>Excel</button><button className="w-full px-2 py-1 text-left text-sm hover:bg-[rgb(var(--heading-bg))]" onClick={() => { setExportOpen(false); printReport(); }}>PDF</button></div>}</div>
      <button className="ui-btn ui-btn-secondary h-8 text-xs" onClick={printReport}><Printer size={14}/> Print</button>
    </div></header>
    <div className="trial-balance-print-area rounded-lg border ui-border-c"><div className="trial-balance-print-heading text-center"><strong>{currentCompany.name}</strong><div>{addressOf(currentCompany)}</div><strong>Trial Balance</strong><div>{periodLabel}</div></div><div className="trial-balance-period px-3 py-1.5 text-xs ui-muted">Period: {periodLabel}</div><table className="trial-balance-table w-full table-fixed border-collapse text-xs"><colgroup><col style={{width:showBalances?'40%':'56%'}}/>{showBalances && <col style={{width:'15%'}}/>}<col style={{width:'15%'}}/><col style={{width:'15%'}}/>{showBalances && <col style={{width:'15%'}}/>}</colgroup><thead className="bg-[rgb(var(--heading-bg))]"><tr><th className="px-3 py-2 text-left">Particulars</th>{showBalances && <th className="px-2 py-2 text-right">Opening Balance</th>}<th className="px-2 py-2 text-right">Debit</th><th className="px-2 py-2 text-right">Credit</th>{showBalances && <th className="px-2 py-2 text-right">Closing Balance</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className={row.kind === 'group' ? 'font-semibold' : ''}><td className="px-3 py-1.5" style={{paddingLeft:`${12 + row.depth * 16}px`}}>{row.kind === 'group' ? <button className="inline-flex items-center gap-1 text-left" onClick={() => toggle(row.id)}>{expanded.has(row.id) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>} {row.name}</button> : <button className="text-left text-[rgb(var(--link))] hover:underline" onClick={() => setSelectedLedger(row)}>{row.name}</button>}</td>{showBalances && <td className="px-2 py-1.5 text-right tabular-nums">{balance(row.opening)}</td>}<td className="px-2 py-1.5 text-right tabular-nums">{row.debit ? money(row.debit) : '–'}</td><td className="px-2 py-1.5 text-right tabular-nums">{row.credit ? money(row.credit) : '–'}</td>{showBalances && <td className="px-2 py-1.5 text-right tabular-nums">{balance(row.closing)}</td>}</tr>)}<tr className="border-t ui-border-c font-bold"><td className="px-3 py-2">Total</td>{showBalances && <td className="px-2 py-2 text-right">{balance(model.totals.opening)}</td>}<td className="px-2 py-2 text-right">{money(model.totals.debit)}</td><td className="px-2 py-2 text-right">{money(model.totals.credit)}</td>{showBalances && <td className="px-2 py-2 text-right">{balance(model.totals.closing)}</td>}</tr></tbody></table>{!rows.length && <p className="p-6 text-center text-sm ui-muted">No ledgers for this period.</p>}</div>
    {viewOpen && <div className="fixed inset-0 z-50 flex justify-end ui-scrim" onClick={() => setViewOpen(false)}><aside className="h-full w-full max-w-sm bg-[rgb(var(--surface))] shadow-xl" onClick={event => event.stopPropagation()}><div className="flex items-center justify-between border-b ui-border-c p-4"><h2 className="font-semibold">View</h2><button className="ui-icon-btn" aria-label="Close view" onClick={() => setViewOpen(false)}><X size={18}/></button></div><div className="space-y-4 p-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={showBalances} onChange={event => setShowBalances(event.target.checked)}/> Show opening & closing balances</label><fieldset className="space-y-2"><legend className="mb-2 font-medium">Particulars</legend><label className="flex items-center gap-2"><input type="radio" name="trial-view" checked={view === 'group'} onChange={() => setView('group')}/> Group view</label><label className="flex items-center gap-2"><input type="radio" name="trial-view" checked={view === 'ledger'} onChange={() => setView('ledger')}/> Ledger view</label></fieldset></div><div className="border-t ui-border-c p-4 text-right"><button className="ui-btn ui-btn-primary" onClick={() => setViewOpen(false)}>Done</button></div></aside></div>}
  </div>;
}
