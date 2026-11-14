import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Download, Printer } from 'lucide-react';
import { buildCatalogReport } from './reportCatalogModel';
import ReportLayoutPicker from './ReportLayoutPicker';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { formatDateIn } from '@ui/utils/dates';
import { getDecimalPlaces, getNumberLocale } from '@ui/utils/money';

const COLUMNS = [
  { key: 'date', label: 'Date', weight: 9 },
  { key: 'number', label: 'Voucher No.', weight: 14 },
  { key: 'type', label: 'Movement Type', weight: 13 },
  { key: 'branch', label: 'Branch', weight: 10 },
  { key: 'warehouse', label: 'Warehouse', weight: 10 },
  { key: 'code', label: 'Item Code', weight: 10 },
  { key: 'name', label: 'Item Name', weight: 18 },
  { key: 'quantity', label: 'Quantity', weight: 7, numeric: true },
  { key: 'amount', label: 'Amount', weight: 9, numeric: true },
  { key: 'in', label: 'Qty In', weight: 8, numeric: true, optional: true },
  { key: 'out', label: 'Qty Out', weight: 8, numeric: true, optional: true },
  { key: 'balance', label: 'Running Qty', weight: 9, numeric: true, optional: true },
];
const DEFAULT_KEYS = COLUMNS.filter(column => !column.optional).map(column => column.key);
const formatNumber = value => new Intl.NumberFormat(getNumberLocale(), { maximumFractionDigits: getDecimalPlaces() }).format(Number(value) || 0);
const formatDate = value => formatDateIn(value);
const companyAddress = company => {
  const address = company?.registeredAddress || company?.address;
  const profile = company?.profile?.companySettings || {};
  if (typeof address === 'string') return [address, company?.city || profile.regCity, company?.state || profile.regStateName, company?.pincode || profile.regPincode].filter(Boolean).join(', ');
  if (address && typeof address === 'object') return [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  return [profile.regAddress1, profile.regAddress2, profile.regCity, profile.regStateName, profile.regPincode].filter(Boolean).join(', ');
};
const loadLayout = key => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    const valid = Array.isArray(saved) ? saved.filter(column => COLUMNS.some(option => option.key === column)) : [];
    return valid.length ? [...new Set(valid)] : DEFAULT_KEYS;
  } catch { return DEFAULT_KEYS; }
};

export default function InventoryRegisterReport({ db, currentCompany, onBack }) {
  const storageKey = `inventory-register-columns:${currentCompany?.id}`;
  const [columnKeys, setColumnKeys] = useState(() => loadLayout(storageKey));

  const [exportOpen, setExportOpen] = useState(false);
  const [period, setPeriod] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const columnFilters = useColumnFilters();

  const range = useMemo(() => {
    const now = new Date();
    const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (period === 'all') return { start: '', end: '' };
    if (period === 'year') return { start: `${now.getFullYear()}-01-01`, end: iso(now) };
    if (period === 'custom') return { start: customStart, end: customEnd };
    return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }, [period, customStart, customEnd]);
  const periodLabel = range.start || range.end ? `${range.start ? formatDate(range.start) : 'Beginning'} – ${range.end ? formatDate(range.end) : 'Today'}` : 'All periods';
  const allRows = useMemo(() => buildCatalogReport(db, currentCompany.id, 'Inventory Register', range).rows, [db, currentCompany.id, range]);
  const columns = columnKeys.map(key => COLUMNS.find(column => column.key === key)).filter(Boolean);
  const totalWeight = columns.reduce((total, column) => total + column.weight, 0);
  const rows = columnFilters.apply(allRows, Object.fromEntries(COLUMNS.map(column => [column.key, row => row[column.key]])));
  const saveColumns = next => { setColumnKeys(next); localStorage.setItem(storageKey, JSON.stringify(next)); };
  const printReport = () => {
    document.body.classList.add('catalog-report-printing');
    const cleanup = () => { document.body.classList.remove('catalog-report-printing'); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 120000);
  };
  const exportExcel = async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const heading = value => ({ value, type: String, fontWeight: 'bold' });
    const data = [
      [{ ...heading(currentCompany.name), columnSpan: columns.length }],
      [{ ...heading('Inventory Register'), columnSpan: columns.length }],
      [{ value: periodLabel, type: String, columnSpan: columns.length }],
      columns.map(column => heading(column.label)),
      ...rows.map(row => columns.map(column => ({ value: column.numeric ? Number(row[column.key] || 0) : String(row[column.key] ?? ''), type: column.numeric ? Number : String, format: column.numeric ? '#,##,##0.00' : undefined }))),
    ];
    await writeXlsxFile(data, { sheet: 'Inventory Register', columns: columns.map(column => ({ width: column.numeric ? 16 : 22 })) }).toFile('inventory-register.xlsx');
    setExportOpen(false);
  };
  const exportCsv = () => {
    const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [columns.map(column => column.label), ...rows.map(row => columns.map(column => row[column.key]))].map(line => line.map(escape).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'inventory-register.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    setExportOpen(false);
  };

  return <div className="inventory-register-report catalog-report space-y-2 p-3 lg:p-4">
    <header className="inventory-register-toolbar ui-page-heading flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 shrink-0 items-center gap-2"><button type="button" className="ui-icon-btn" aria-label="Back to Inventory" onClick={onBack}><ArrowLeft size={16}/></button><h1 className="ui-t-page whitespace-nowrap">Inventory Register</h1></div>
      <div className="inventory-register-actions relative flex flex-wrap items-center gap-2">
        <div className="relative"><select aria-label="Report period" className="ui-select h-8 w-32 text-xs" value={period} onChange={event => { setPeriod(event.target.value); setCustomOpen(event.target.value === 'custom'); }}><option value="all">All periods</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom period</option></select>{customOpen && <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-3 shadow-lg"><div className="mb-2 text-sm font-semibold">Custom period</div><label className="block text-xs">From<input type="date" className="ui-input mt-1 w-full" value={customStart} onChange={event => setCustomStart(event.target.value)}/></label><label className="mt-2 block text-xs">To<input type="date" className="ui-input mt-1 w-full" value={customEnd} onChange={event => setCustomEnd(event.target.value)}/></label><button type="button" className="ui-btn ui-btn-primary mt-3 w-full" disabled={Boolean(customStart && customEnd && customStart > customEnd)} onClick={() => setCustomOpen(false)}>Apply</button></div>}</div>
        <ReportLayoutPicker title="Inventory Register" columns={COLUMNS} defaultKeys={DEFAULT_KEYS} selectedKeys={columnKeys} onSelect={saveColumns} storageKey={`inventory-register-saved-layouts:${currentCompany?.id}`} onOpen={() => setExportOpen(false)}/>
        <div className="relative"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { setExportOpen(open => !open); }}><Download size={14}/> Export <ChevronDown size={13}/></button>{exportOpen && <div className="absolute right-0 top-full z-40 mt-1 w-32 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-1 shadow-lg"><button type="button" className="report-menu-item" onClick={exportExcel}>Excel</button><button type="button" className="report-menu-item" onClick={exportCsv}>CSV</button><button type="button" className="report-menu-item" onClick={() => { setExportOpen(false); printReport(); }}>PDF</button></div>}</div>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={printReport}><Printer size={14}/> Print</button>
      </div>
    </header>
    <div className="catalog-report-print-area"><div className="catalog-report-print-heading text-center"><strong>{currentCompany.name}</strong><div>{companyAddress(currentCompany)}</div><strong>Inventory Register</strong><div>{periodLabel}</div></div>
      <div className="inventory-register-table-wrap"><table className="inventory-register-grid catalog-report-table w-full border-collapse text-xs"><colgroup>{columns.map(column => <col key={column.key} style={{ width: `${column.weight / totalWeight * 100}%` }}/>)}</colgroup><thead className="bg-[rgb(var(--heading-bg))]"><tr>{columns.map(column => <ColumnHeader key={column.key} label={column.label} col={column.key} state={columnFilters} type={column.key === 'date' ? 'date' : column.numeric ? 'number' : 'text'} align={column.numeric ? 'right' : 'left'} className={`whitespace-nowrap ${columnFilters.filters[column.key] ? 'sales-report-filter-active' : ''}`}/>) }</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.date}-${row.number}-${row.code}-${index}`} className="hover:bg-[rgb(var(--heading-bg))]"><>{columns.map(column => <td key={column.key} className={`px-2 py-1.5 align-top ${column.numeric ? 'text-right tabular-nums' : ''}`}>{column.numeric ? formatNumber(row[column.key]) : String(row[column.key] ?? '—') || '—'}</td>)}</></tr>)}{!rows.length && <tr><td colSpan={columns.length} className="px-4 py-10 text-center ui-muted">No inventory movements match this period or filter.</td></tr>}</tbody></table></div>
    </div>
  </div>;
}


