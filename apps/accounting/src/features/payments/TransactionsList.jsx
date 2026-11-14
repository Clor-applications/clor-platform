import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { notify } from '@ui/components/ui/notify';

import RecordDisbursementForm from './RecordDisbursementForm';
import RecordReceiptForm from './RecordReceiptForm';
import { confirmDialog } from '@ui/components/ui/notify';
import { reversePayment } from '@ui/api/payments';
import { hasApiSession } from '@ui/api/purchaseDocs';
import { applyPaymentReversal } from './paymentService';
import { formatMoney, round2 } from '@ui/utils/money';
import { TableTotals } from '@ui/components/ui/Primitives';
import { ListToolbar, useListSearch } from '@ui/components/ListToolbar';
import { usePeriodFilter } from '@ui/components/ListControls';
import { StatCards, ListSearch, FiltersButton, MoreButton, ExportButton, Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { PageHeader } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { CreditCard, FileText, MoreVertical, Receipt, Undo2 } from 'lucide-react';
import Popover from '@ui/components/ui/Popover';
import { useColumnFilters, ColumnHeader } from '@ui/components/ColumnFilters';
import { Download } from 'lucide-react';
import { DocumentNumber, SalesDate, MoneyValue } from '@ui/components/docs';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { getDocSettings } from '@ui/utils/docSettings';
import ReceiptVoucher from './ReceiptVoucher';
import { RECEIPT_TEMPLATE_GROUPS } from './receiptTemplateConfig';

const safeArray = (v) => (Array.isArray(v) ? v : []);
const unallocatedReceiptAmount = (receipt) => {
  const allocations = safeArray(receipt?.allocations);
  const advance = Math.max(0, Number(receipt?.advanceAmount) || 0);
  if (advance > 0) return round2(advance);
  const amount = Math.max(0, Number(receipt?.amount) || 0);
  if (!allocations.length) return round2(amount);
  return round2(Math.max(0, amount - allocations.reduce((sum, line) => sum + (Number(line?.amount) || 0), 0)));
};

const getVoucherLabel = (voucherType) => {
  if (voucherType === 'invoice') return 'Invoice';
  if (voucherType === 'bill') return 'Bill';
  if (voucherType === 'expense') return 'Expense';
  if (voucherType === 'receipt') return 'Receipt';
  if (voucherType === 'payment') return 'Payment';
  return String(voucherType || 'Document');
};

const resolveVoucher = ({ db, companyId, voucherType, voucherId }) => {
  const id = Number(voucherId);
  if (!Number.isFinite(id)) return null;

  if (voucherType === 'invoice') return safeArray(db.invoices).find((d) => d.companyId === companyId && Number(d.id) === id) || null;
  if (voucherType === 'bill') return safeArray(db.bills).find((d) => d.companyId === companyId && Number(d.id) === id) || null;
  if (voucherType === 'expense') return safeArray(db.expenses).find((d) => d.companyId === companyId && Number(d.id) === id) || null;
  return null;
};

const ReceiptHeaderActions = ({ actionsRef, savedTemplateId }) => {
  const [templateId, setTemplateId] = useState(savedTemplateId === 'compact' ? 'compact' : 'modernReceipt');
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const syncTemplate = (event) => setTemplateId(event.detail === 'compact' ? 'compact' : 'modernReceipt');
    window.addEventListener('receipt-template-saved', syncTemplate);
    return () => window.removeEventListener('receipt-template-saved', syncTemplate);
  }, []);
  return <div className="receipt-view-header-actions">
    <div className="receipt-view-template"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>Template: {templateId === 'compact' ? 'Compact' : 'Modern'} ▾</button>{menuOpen ? <div className="receipt-view-template-menu" role="menu"><button type="button" role="menuitemradio" aria-checked={templateId === 'modernReceipt'} onClick={() => { setTemplateId('modernReceipt'); actionsRef.current?.setTemplate('modernReceipt'); setMenuOpen(false); }}>Modern Receipt</button><button type="button" role="menuitemradio" aria-checked={templateId === 'compact'} onClick={() => { setTemplateId('compact'); actionsRef.current?.setTemplate('compact'); setMenuOpen(false); }}>Compact Receipt</button><div className="receipt-view-template-separator" /><button type="button" role="menuitem" onClick={() => { actionsRef.current?.customize(); setMenuOpen(false); }}>Customize template…</button></div> : null}</div>
    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => actionsRef.current?.print()}>Print</button>
    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => actionsRef.current?.exportPdf()}>Export PDF</button>
  </div>;
};

const ReceiptTemplateSidebar = ({ template, onChange, onSave, onClose }) => {
  const drawerRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    drawerRef.current?.querySelector('input, select, button')?.focus();
    return () => { if (previousFocus && document.contains(previousFocus)) previousFocus.focus(); };
  }, []);
  const onDrawerKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(drawerRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') || []);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); event.stopPropagation(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); event.stopPropagation(); first.focus(); }
  };
  const options = template.printOptions || {};
  const updateOption = (key, value) => onChange({ ...template, printOptions: { ...options, [key]: value } });
  return createPortal(<div className="receipt-template-drawer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={onDrawerKeyDown}><aside ref={drawerRef} className="receipt-template-drawer" role="dialog" aria-modal="true" aria-label="Customize receipt template"><header><div><small>Document Templates</small><h2>Receipt Voucher Settings</h2></div><button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close template settings">×</button></header><div className="receipt-template-drawer-scroll"><label className="invoice-template-field"><span>Document title</span><input className="ui-input ui-ctl-compact" value={template.printTitle ?? 'RECEIPT'} onChange={(event) => onChange({ ...template, printTitle: event.target.value })} /></label><label className="invoice-template-field"><span>Template</span><select className="ui-select ui-ctl-compact" value={template.templateId === 'compact' ? 'compact' : 'modernReceipt'} onChange={(event) => onChange({ ...template, templateId: event.target.value })}><option value="modernReceipt">Modern Receipt</option><option value="compact">Compact Receipt</option></select></label><label className="invoice-template-field"><span>Accent</span><select className="ui-select ui-ctl-compact" value={template.accentId || 'blue'} onChange={(event) => onChange({ ...template, accentId: event.target.value })}><option value="blue">Blue</option><option value="indigo">Indigo</option><option value="green">Green</option><option value="orange">Orange</option><option value="violet">Violet</option><option value="slate">Slate</option></select></label>{RECEIPT_TEMPLATE_GROUPS.map((section) => <details key={section.key} className="invoice-template-setting-group" open={section.key === 'receiptHeader'}><summary>{section.label}</summary><div>{section.options.map(([key, label]) => <label key={key} className="invoice-template-option"><span>{label}</span><input type="checkbox" checked={options[key] !== false} onChange={(event) => updateOption(key, event.target.checked)} /></label>)}</div></details>)}<label className="invoice-template-field"><span>Footer note</span><input className="ui-input ui-ctl-compact" value={template.footerText || ''} onChange={(event) => onChange({ ...template, footerText: event.target.value })} /></label></div><footer><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={onSave}>Save template</button></footer></aside></div>, document.body);
};

export const TransactionView = ({ title, payload, actionsRef, setDb }) => {
  const initialReceiptTemplate = payload?.receiptView ? getDocSettings(payload?.db, payload?.currentCompany)?.templates?.receipt || {} : {};
  const [receiptTemplate, setReceiptTemplate] = useState(initialReceiptTemplate);
  const [templateId, setTemplateId] = useState(initialReceiptTemplate.templateId === 'compact' ? 'compact' : 'modernReceipt');
  const [customizing, setCustomizing] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState(initialReceiptTemplate);
  const selectedReceiptTemplate = customizing ? draftTemplate : { ...receiptTemplate, templateId };
  const receiptPaperRef = useRef(null);
  const company = payload?.currentCompany || {};
  const profile = company?.profile?.companySettings || {};
  const rawAddress = company.registeredAddress || company.address;
  const companyAddress = typeof rawAddress === 'string'
    ? [rawAddress, company.city || profile.regCity, company.state || profile.regStateName, company.pincode || profile.regPincode].filter(Boolean).join(', ')
    : [rawAddress?.line1 || profile.regAddress1, rawAddress?.line2 || profile.regAddress2, rawAddress?.city || company.city || profile.regCity, rawAddress?.state || company.state || profile.regStateName, rawAddress?.pincode || company.pincode || profile.regPincode].filter(Boolean).join(', ');
  const shareText = useMemo(() => {
    const lines = [
      title,
      payload?.documentNumber ? `Document: ${payload.documentNumber}` : null,
      payload?.partyName ? `Party: ${payload.partyName}` : null,
      payload?.date ? `Date: ${payload.date}` : null,
      payload?.mode ? `Mode: ${payload.mode}` : null,
      payload?.reference ? `Reference: ${payload.reference}` : null,
      payload?.amount !== undefined && payload?.amount !== null ? `Amount: ${String(payload.amount)}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }, [payload, title]);

  const doPrint = () => {
    try {
      const prevTitle = document.title;
      if (payload?.documentNumber) document.title = String(payload.documentNumber);

      document.body.classList.add('receipt-printing');
      let fallback;
      const cleanup = () => {
        window.clearTimeout(fallback);
        document.body.classList.remove('receipt-printing');
        document.title = prevTitle;
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      fallback = window.setTimeout(cleanup, 60000);
      window.print();
    } catch {
      // ignore
    }
  };
  const exportReceiptPdf = async () => {
    if (!receiptPaperRef.current) return;
    try {
      const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
      const canvas = await html2canvas(receiptPaperRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      const width = doc.internal.pageSize.getWidth() - margin * 2;
      const height = canvas.height * width / canvas.width;
      const pageHeight = doc.internal.pageSize.getHeight() - margin * 2;
      if (height <= pageHeight) {
        doc.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, width, height);
      } else {
        const sliceHeight = Math.max(1, Math.floor(pageHeight * canvas.width / width));
        for (let offset = 0; offset < canvas.height; offset += sliceHeight) {
          if (offset) doc.addPage();
          const slice = document.createElement('canvas');
          slice.width = canvas.width;
          slice.height = Math.min(sliceHeight, canvas.height - offset);
          slice.getContext('2d').drawImage(canvas, 0, offset, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
          doc.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, width, slice.height * width / canvas.width);
        }
      }
      doc.save(`${String(payload?.documentNumber || 'receipt').replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
    } catch {
      notify.error('Unable to export receipt PDF. Please try again.');
    }
  };
  const saveReceiptTemplate = () => {
    if (typeof setDb !== 'function') return;
    setDb((old) => ({ ...old, companies: safeArray(old.companies).map((item) => {
      if (String(item.id) !== String(company.id)) return item;
      const settings = getDocSettings(old, item);
      return { ...item, docSettings: { ...settings, templates: { ...settings.templates, receipt: draftTemplate } } };
    }) }));
    setReceiptTemplate(draftTemplate);
    setTemplateId(draftTemplate.templateId === 'compact' ? 'compact' : 'modernReceipt');
    window.dispatchEvent(new CustomEvent('receipt-template-saved', { detail: draftTemplate.templateId }));
    setCustomizing(false);
    notify.success('Receipt template saved.');
  };
  useEffect(() => {
    if (!actionsRef || !payload?.receiptView) return undefined;
    actionsRef.current = { print: doPrint, exportPdf: exportReceiptPdf, setTemplate: setTemplateId, customize: () => { setDraftTemplate(selectedReceiptTemplate); setCustomizing(true); } };
    return () => { actionsRef.current = null; };
  });

  const doShare = async () => {
    try {
      if (navigator?.share) {
        await navigator.share({ title, text: shareText });
        return;
      }
    } catch {
      // fallthrough to copy
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        notify.success('Copied to clipboard');
        return;
      }
    } catch {
      // ignore
    }

    notify.error(shareText);
  };

  return (
    <div className="space-y-6">
      {!payload?.receiptView ? <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm ui-muted">{title}</div>
          <div className="font-medium">{payload?.documentNumber || '-'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={doPrint}
            className="px-3 py-2 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            Print
          </button>
          <button
            type="button"
            onClick={doShare}
            className="px-3 py-2 rounded-lg ui-btn ui-btn-primary"
          >
            Share
          </button>
        </div>
      </div> : null}

      {payload?.receiptView ? <div ref={receiptPaperRef}><ReceiptVoucher company={company} receipt={payload} db={payload.db} template={selectedReceiptTemplate} /></div> : <div className="printable ui-surface border rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="ui-muted">Party</div>
            <div>{payload?.partyName || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Date</div>
            <div>{payload?.date || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Mode</div>
            <div>{payload?.mode || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Reference</div>
            <div>{payload?.reference || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Type</div>
            <div>{payload?.typeLabel || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Amount</div>
            <div className="ui-money">{formatMoney(payload?.amount || 0, payload?.currentCompany)}</div>
          </div>
        </div>

        {payload?.notes ? (
          <div className="text-sm">
            <div className="ui-muted">Notes</div>
            <div className="whitespace-pre-wrap">{payload.notes}</div>
          </div>
        ) : null}

        {Array.isArray(payload?.allocations) && payload.allocations.length ? (
          <div className="text-sm">
            <div className="ui-muted mb-2">Allocations</div>
            <div className="border rounded-lg overflow-hidden">
              <table className="ui-table w-full">
                <thead className="ui-sunken border-b">
                  <tr>
                    <th className="ui-th">Document #</th>
                    <th className="ui-th ui-num">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payload.allocations.map((a, idx) => (
                    <tr key={idx}>
                      <td className="ui-col-id px-3 py-2">
                        {a?.voucherType ? `${getVoucherLabel(a.voucherType)}: ` : ''}
                        {a?.documentNumber || a?.voucherId || '-'}
                      </td>
                      <td className="ui-col-amount px-3 py-2 text-right">
                        {formatMoney(Number(a?.amount ?? 0), payload?.currentCompany)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {Number(payload?.advanceAmount ?? 0) > 0 ? (
              <div className="mt-3 flex items-center justify-between">
                <div className="ui-muted">Advance</div>
                <div className="ui-money">{formatMoney(Number(payload.advanceAmount ?? 0), payload?.currentCompany)}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>}
      {createPortal(payload?.receiptView ? <div className="receipt-print-host" aria-hidden="true"><ReceiptVoucher company={company} receipt={payload} db={payload.db} template={selectedReceiptTemplate} /></div> : <div className="receipt-print-host" aria-hidden="true">
        <header className="receipt-print-heading">
          <div className="receipt-print-company">{company.legalName || company.name || company.companyName || 'Company'}</div>
          {companyAddress ? <div className="receipt-print-address">{companyAddress}</div> : null}
          {company.gstin || profile.gstin || company.email || company.phone ? <div className="receipt-print-address">{[
            company.gstin || profile.gstin ? `GSTIN: ${company.gstin || profile.gstin}` : '',
            company.email || profile.email || '', company.phone || profile.phone || '',
          ].filter(Boolean).join(' · ')}</div> : null}
          <div className="receipt-print-title">{payload?.typeLabel === 'Payment' ? 'Payment' : 'Receipt'}</div>
        </header>
        <div className="receipt-print-meta"><span><strong>Receipt no.</strong> {payload?.documentNumber || '—'}</span><span><strong>Date</strong> {payload?.date || '—'}</span></div>
        <div className="receipt-print-details">
          <div><span>Received from</span><strong>{payload?.partyName || '—'}</strong></div>
          <div><span>Received into</span><strong>{payload?.mode || '—'}</strong></div>
          {payload?.reference ? <div><span>Reference</span><strong>{payload.reference}</strong></div> : null}
      </div>
        <div className="receipt-print-amount"><span>Amount received</span><strong>{formatMoney(payload?.amount || 0, company)}</strong></div>
        {Array.isArray(payload?.allocations) && payload.allocations.length ? <section className="receipt-print-allocations">
          <h2>Applied to</h2>
          {payload.allocations.map((allocation, index) => <div key={index}><span>{allocation.documentNumber || allocation.voucherId || 'Document'}</span><strong>{formatMoney(allocation.amount, company)}</strong></div>)}
        </section> : null}
        {payload?.notes ? <p className="receipt-print-notes"><strong>Notes</strong><br />{payload.notes}</p> : null}
      </div>, document.body)}
      {customizing ? <ReceiptTemplateSidebar template={draftTemplate} onChange={setDraftTemplate} onSave={saveReceiptTemplate} onClose={() => setCustomizing(false)} /> : null}
    </div>
  );
};

const TransactionsTable = ({ title, rows, currentCompany, rightActions, onView, onReverse = null, onEdit = null, onDelete = null }) => {
  const isReceiptList = title === 'Receipts';
  const isCashList = isReceiptList || title === 'Payments';
  const receiptColumns = ['date', 'documentNumber', 'partyName', 'accountName', 'againstInvoice', 'amount', 'actions'];
  const [receiptWidths, setReceiptWidths] = useState(null);
  const onReceiptResize = (event, key) => {
    event.preventDefault();
    event.stopPropagation();
    const headerCells = Array.from(event.currentTarget.closest('tr')?.children || []);
    const startingWidths = receiptWidths || Object.fromEntries(receiptColumns.map((column, index) => [column, Math.ceil(headerCells[index]?.getBoundingClientRect().width || 80)]));
    const startX = event.clientX;
    const startWidth = startingWidths[key];
    const onMove = (moveEvent) => setReceiptWidths({ ...startingWidths, [key]: Math.max(key === 'actions' ? 32 : 64, Math.round(startWidth + moveEvent.clientX - startX)) });
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };
  const tableScrollRef = useRef(null);
  const bottomScrollRef = useRef(null);
  const [tableWidth, setTableWidth] = useState(0);
  useEffect(() => {
    if (!isCashList || !tableScrollRef.current) return;
    const update = () => setTableWidth(tableScrollRef.current?.scrollWidth || 0);
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (observer) { observer.observe(tableScrollRef.current); const table = tableScrollRef.current.querySelector('table'); if (table) observer.observe(table); }
    return () => observer?.disconnect();
  }, [isCashList, rows]);
  const [actionRow, setActionRow] = useState(null);
  const actionAnchorRef = useRef(null);
  const period = usePeriodFilter();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const search = useListSearch(rows, ['documentNumber', 'partyName', 'accountName', 'againstInvoice', 'againstBill', 'mode', 'reference', 'typeLabel', 'date']);
  const colFilters = useColumnFilters();
  const shownAll = colFilters.applyFilters(search.filtered.filter((r) => period.inRange(r?.date)), {
    date: (r) => r.date,
    typeLabel: (r) => r.typeLabel,
    documentNumber: (r) => r.documentNumber,
    partyName: (r) => r.partyName,
    accountName: (r) => r.accountName,
    againstInvoice: (r) => r.againstInvoice,
    againstBill: (r) => r.againstBill,
    mode: (r) => r.mode,
    reference: (r) => r.reference,
    amount: (r) => r.amount,
  });

  const exportTransactions = (format) => {
    if (!shown.length) {
      notify.error('Nothing to export.');
      return;
    }
    runListExport({
      format,
      title,
      label: title.toLowerCase(),
      fileName: `${title}_${currentCompany?.name || 'company'}`,
      columns: isCashList ? [
        { key: 'date', label: 'Date' },
        { key: 'documentNumber', label: 'Document #' },
        { key: 'partyName', label: 'Party' },
        { key: 'accountName', label: 'Account' },
        { key: isReceiptList ? 'againstInvoice' : 'againstBill', label: isReceiptList ? 'Against invoice' : 'Against bill' },
        { key: 'amount', label: 'Amount', value: (r) => round2(Number(r.amount || 0)) },
      ] : [
        { key: 'date', label: 'Date' },
        { key: 'typeLabel', label: 'Type' },
        { key: 'documentNumber', label: 'Document #' },
        { key: 'partyName', label: 'Party' },
        { key: 'mode', label: 'Mode' },
        { key: 'reference', label: 'Reference' },
        { key: 'amount', label: 'Amount', value: (r) => round2(Number(r.amount || 0)) },
      ],
      rows: shown,
    });
  };

  /*
   * A receipt or payment either settles documents or it does not. The second
   * group is what somebody comes here to find: money taken or sent that is
   * still sitting on account against nothing in particular.
   */
  const [txStatus, setTxStatus] = useState('');
  const TX_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Allocated', label: 'Against documents', tone: 'paid' },
    { value: 'OnAccount', label: 'On account', tone: 'outstanding' },
  ];
  const txMatches = (r, tab) => {
    if (tab === 'Allocated') return (r.allocations || []).length > 0;
    if (tab === 'OnAccount') return unallocatedReceiptAmount(r) > 0;
    return true;
  };
  const shown = txStatus ? shownAll.filter((r) => txMatches(r, txStatus)) : shownAll;

  const txStatusCounts = useMemo(() => {
    const counts = { '': shownAll.length };
    for (const t of TX_STATUS_TABS) {
      if (!t.value) continue;
      counts[t.value] = shownAll.filter((r) => txMatches(r, t.value)).length;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownAll]);

  const { pageCount, safePage, pageRows } = usePaged(shown, perPage, page);

  /**
   * Five figures, and every one of them countable from the rows themselves.
   *
   * The reference proposed "Employee payments" and "Refunds"; neither is
   * modelled — a payment has a party and a mode, not an employee flag — and a
   * card that can only ever read zero teaches people the row above it is
   * guesswork too. These are the splits the data actually supports.
   */
  /*
   * Over `shown`, the rows actually on screen — not `rows`, the whole book.
   *
   * Reading the unfiltered set meant searching for one party left five figures
   * describing every receipt ever taken, sitting directly above a table showing
   * three. Two different sets of data on one screen with nothing saying so.
   */
  const headline = useMemo(() => {
    const sum = (rs) => rs.reduce((t, r) => t + Number(r.amount || 0), 0);
    const month = new Date().toISOString().slice(0, 7);
    return {
      count: shown.length,
      total: sum(shown),
      thisMonth: sum(shown.filter((r) => String(r.date || '').slice(0, 7) === month)),
      onAccount: isCashList ? round2(shown.reduce((sum, payment) => sum + unallocatedReceiptAmount(payment), 0)) : 0,
    };
  }, [shown, isReceiptList]);

  return (
    <DocumentListShell
      entity="transfer"
      title={title}
      tight
      denseCards
      company={currentCompany}
      search={{
        value: search.query,
        onChange: (v) => {
          search.setQuery(v);
          setPage(1);
        },
        placeholder: `Search ${title.toLowerCase()}…`,
        label: `Search ${title.toLowerCase()}`,
      }}
      headerExtras={rightActions ? <>{rightActions}</> : null}
      moreItems={[exportMenuItem(`Export ${title.toLowerCase()}`)]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) exportTransactions(format);
      }}
      cards={[
        { label: `Total ${title.toLowerCase()}`, value: headline.count, count: true, tone: 'draft', Icon: FileText },
        { label: 'Value', value: headline.total, tone: 'sent', Icon: Receipt },
        { label: 'This month', value: headline.thisMonth, tone: 'paid', Icon: CreditCard },
        ...(isCashList ? [{ label: 'On account', value: headline.onAccount, tone: 'outstanding', Icon: CreditCard }] : []),
      ]}
      tabs={TX_STATUS_TABS}
      tabsLabel={`${title} filter`}
      statusInHeader
      statusValue={txStatus}
      className={isCashList ? `receipts-list-page ${isReceiptList ? '' : 'payments-list-page'}` : ''}
      statusCounts={txStatusCounts}
      onStatusChange={(v) => {
        setTxStatus(v);
        setPage(1);
      }}
    >
        {/* Eight columns in a card that stops at the page's edge, so the
            table needs somewhere to scroll. Without this wrapper the card's
            own `overflow: hidden` clipped it: at 1093px — a 1366 laptop at
            125% — the table came to 960px inside an 803px card, and the last
            157px, which is the Amount column, was not merely off-screen but
            unreachable, with no scrollbar to say it existed. Every other wide
            list in the product is wrapped this way; this one was missed. */}
        <div className={`overflow-x-auto ui-table-scroll transactions-table-scroll ${shown.length ? '' : 'transactions-table-empty'}`} ref={tableScrollRef} onScroll={(event) => { if (bottomScrollRef.current) bottomScrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }}>
        <table className={`ui-table ui-table-wide ui-table-sticky ${isCashList ? 'receipts-data-table' : ''} ${receiptWidths ? 'receipts-data-table-manual' : ''}`} style={receiptWidths ? { width: Object.values(receiptWidths).reduce((total, width) => total + width, 0), minWidth: 0, tableLayout: 'fixed' } : undefined}>
          {isCashList && receiptWidths ? <colgroup>{receiptColumns.map((column) => <col key={column} style={{ width: receiptWidths[column] }} />)}</colgroup> : null}
          <thead>
            <tr>
              <ColumnHeader align="center" label="Date" col="date" state={colFilters} onResizeStart={isCashList ? onReceiptResize : undefined} />
              {onReverse && !isCashList ? <th scope="col" className="w-10"></th> : null}
              {!isCashList ? <ColumnHeader label="Type" col="typeLabel" state={colFilters} /> : null}
              <ColumnHeader label="Document #" col="documentNumber" state={colFilters} onResizeStart={isCashList ? onReceiptResize : undefined} />
              <ColumnHeader label="Party" col="partyName" state={colFilters} onResizeStart={isCashList ? onReceiptResize : undefined} />
              {isCashList ? <>
                <ColumnHeader label="Account" col="accountName" state={colFilters} onResizeStart={onReceiptResize} />
                <ColumnHeader label={isReceiptList ? 'Against invoice' : 'Against bill'} col={isReceiptList ? 'againstInvoice' : 'againstBill'} state={colFilters} onResizeStart={onReceiptResize} />
              </> : <>
              <ColumnHeader label="Mode" col="mode" state={colFilters} />
              <ColumnHeader label="Reference" col="reference" state={colFilters} />
              </>}
              <ColumnHeader label="Amount" col="amount" state={colFilters} className="ui-num" align="right" onResizeStart={isCashList ? onReceiptResize : undefined} />
              {onEdit || onDelete || (onReverse && isCashList) ? <th scope="col" className="ui-action-col"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody className="ui-rows">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={(isCashList ? 6 : 7) + Number(Boolean(onReverse && !isCashList)) + Number(Boolean(onEdit || onDelete || (onReverse && isCashList)))} className="px-6 py-12 text-center ui-muted">
                  No transactions found
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <tr
                  key={r.id}
                  className={onView ? 'ui-hover-sunken cursor-pointer' : 'ui-hover-sunken'}
                  onClick={() => {
                    if (typeof onView === 'function') onView(r);
                  }}
                >
                  <td className="ui-col-date"><SalesDate value={r.date} withIcon={!isCashList} /></td>
                  {onReverse && !isCashList ? (
                    <td className="w-10" onClick={(e) => e.stopPropagation()}>
                      {r.status === 'Reversed' ? (
                        <span className="ui-caption">Reversed</span>
                      ) : (
                        <button
                          type="button"
                          className="ui-icon-btn !h-7 !w-7"
                          aria-label={`Reverse ${r.documentNumber || r.typeLabel}`}
      title="Reverse — the voucher stays on record, the settlement is given back"
                          onClick={() => onReverse(r)}
                        >
                          <Undo2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  ) : null}
                  {!isCashList ? <td className="ui-col-meta">{r.typeLabel}</td> : null}
                  <td className="ui-col-id" title={r.documentNumber || ''}><DocumentNumber value={r.documentNumber} label={isReceiptList ? 'receipt' : 'payment'} /></td>
                  <td className="ui-col-entity">{r.partyName || '-'}</td>
                  {isCashList ? <>
                    <td className="ui-col-meta" title={r.accountName || ''}>{r.accountName || '-'}</td>
                    <td className="ui-col-meta" title={isReceiptList ? (r.againstInvoiceFull || r.againstInvoice || '') : (r.againstBillFull || r.againstBill || '')}>{(isReceiptList ? r.againstInvoice : r.againstBill) || 'On account'}</td>
                  </> : <>
                  <td className="ui-col-meta">{r.mode || '-'}</td>
                  <td className="ui-col-meta">{r.reference || '-'}</td>
                  </>}
                  {/* Money that has arrived. */}
                  <td className="ui-col-amount"><MoneyValue value={r.amount} company={currentCompany} kind="paid" /></td>
                  {onEdit || onDelete || (onReverse && isCashList) ? <td className="ui-action-col" onClick={(e) => e.stopPropagation()}>
                    <button
                      ref={actionRow?.id === r.id ? actionAnchorRef : null}
                      type="button"
                      className="ui-icon-btn"
                      aria-label={`Actions for ${r.documentNumber || 'receipt'}`}
                      aria-haspopup="menu"
                      aria-expanded={actionRow?.id === r.id}
                      onClick={(e) => { actionAnchorRef.current = e.currentTarget; setActionRow(actionRow?.id === r.id ? null : r); }}
                    ><MoreVertical size={16} /></button>
                  </td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        {actionRow ? <Popover anchorRef={actionAnchorRef} onClose={() => setActionRow(null)} minWidth={150} maxWidth={190} autoFocus={false}>
          <div role="menu" aria-label={`Actions for ${actionRow.documentNumber || 'receipt'}`} className="p-1">
            {onEdit ? <button type="button" role="menuitem" className="report-menu-item w-full text-left" onClick={() => { const row = actionRow; setActionRow(null); onEdit(row); }}>Edit</button> : null}
            {onDelete ? <button type="button" role="menuitem" className="report-menu-item w-full text-left" onClick={() => { const row = actionRow; setActionRow(null); onDelete(row); }}>Delete</button> : null}
            {onReverse && isCashList ? <button type="button" role="menuitem" className="report-menu-item w-full text-left" onClick={() => { const row = actionRow; setActionRow(null); onReverse(row); }}>Reverse</button> : null}
          </div>
        </Popover> : null}
        <TableTotals
          count={shown.length}
          totalCount={(rows || []).length}
          noun="transactions"
          figures={[{ label: 'Value', value: formatMoney(shown.reduce((t, r) => t + Number(r.amount || 0), 0), currentCompany) }]}
        />

        <Pagination
          className={isCashList ? 'receipts-pagination' : ''}
          total={shown.length}
          page={safePage}
          perPage={perPage}
          pageCount={pageCount}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n);
            setPage(1);
          }}
          noun={title.toLowerCase()}
        />
        {isCashList ? <div ref={bottomScrollRef} className="receipts-bottom-scroll" onScroll={(event) => { if (tableScrollRef.current) tableScrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }}><div style={{ width: tableWidth, height: 1 }} /></div> : null}
    </DocumentListShell>
  );
};


/** Reverse a voucher: server first where it is known, then the local book
 *  through the payment service — voucher kept, settlement given back, TDS
 *  answered by its lineage pair. */
const makeReverse = ({ setDb, currentCompany, noun }) => async (row) => {
  const ok = await confirmDialog({
    title: `Reverse ${row.documentNumber || `this ${noun}`}?`,
    message: `The ${noun} stays on record as reversed; every document it settled becomes outstanding again.`,
    confirmLabel: 'Yes, reverse it',
  });
  if (!ok) return;
  if (row.backendPaymentId && hasApiSession()) {
    try {
      await reversePayment(String(row.backendPaymentId));
    } catch (err) {
      notify.error(String(err?.message || `The server refused to reverse the ${noun}.`));
      return;
    }
  }
  const by = (() => {
    try {
      return String(localStorage.getItem('userEmail') || '').trim() || 'User';
    } catch {
      return 'User';
    }
  })();
  setDb((prev) => applyPaymentReversal(prev, currentCompany.id, row.id, { by }));
  notify.success(`${row.documentNumber || noun} reversed.`);
};

export const ReceiptsTransactionsList = ({ db, setDb, currentCompany, openModal, onRecordReceipt, onEditReceipt }) => {
  const receiptActionsRef = useRef(null);
  const deleteReceipt = async (row) => {
    const ok = await confirmDialog({
      title: `Delete ${row.documentNumber || 'this receipt'}?`,
      message: 'This removes the receipt from the list and restores the outstanding amount on its invoices.',
      confirmLabel: 'Delete receipt',
    });
    if (!ok) return;
    if (row.backendPaymentId && hasApiSession()) {
      try { await reversePayment(String(row.backendPaymentId)); }
      catch (error) { notify.error(String(error?.message || 'Unable to delete the receipt.')); return; }
    }
    setDb((prev) => {
      const undone = applyPaymentReversal(prev, currentCompany.id, row.id);
      return { ...undone, payments: safeArray(undone.payments).filter((p) => !(p.companyId === currentCompany.id && String(p.id) === String(row.id))) };
    });
    notify.success('Receipt deleted.');
  };
  const rows = useMemo(() => {
    const companyId = currentCompany.id;
    const payments = safeArray(db.payments).filter((p) => p.companyId === companyId);

    return payments
      .filter((p) => String(p.direction || '').toUpperCase() === 'IN')
      .map((p) => {
        const isReceipt = String(p.voucherType || '') === 'receipt';
        const voucher = isReceipt ? null : resolveVoucher({ db, companyId, voucherType: p.voucherType, voucherId: p.voucherId });
        const partyName = isReceipt ? p.customerName || '' : voucher?.customerName || voucher?.partyName || '';
        const accountId = String(p.ledgerAccountId || p.cashBankAccountId || '');
        const accounts = [...safeArray(db.chartOfAccounts), ...safeArray(db.cashBankAccounts)];
        const account = accounts.find((item) => String(item.companyId) === String(companyId) && (
          String(item.id) === accountId || String(item.serverLedgerAccountId || '') === accountId ||
          (p.cashBankAccountId && String(item.id) === String(p.cashBankAccountId))
        ));
        const invoiceNumbers = safeArray(p.allocations)
          .filter((allocation) => allocation.voucherType === 'invoice' || allocation.docType === 'INVOICE')
          .map((allocation) => allocation.documentNumber || safeArray(db.invoices).find((invoice) => String(invoice.id) === String(allocation.voucherId))?.number || '')
          .filter(Boolean);

        return {
          id: p.id,
          status: p.status,
          backendPaymentId: p.backendPaymentId,
          date: p.date,
          amount: Number(p.amount ?? 0),
          mode: p.mode,
          reference: p.reference,
          notes: p.notes,
          typeLabel: getVoucherLabel(p.voucherType),
          documentNumber: isReceipt ? p.receiptNo || '' : voucher?.number || '',
          partyName,
          accountName: account?.name || p.ledgerAccountName || (String(p.mode || '').toLowerCase().includes('cash') ? 'Cash account' : 'Bank account'),
          againstInvoice: invoiceNumbers.length ? `${invoiceNumbers[0]}${invoiceNumbers.length > 1 ? ` +${invoiceNumbers.length - 1}` : ''}` : 'On account',
          againstInvoiceFull: invoiceNumbers.join(', '),
          allocations: isReceipt ? safeArray(p.allocations) : null,
          advanceAmount: isReceipt ? Number(p.advanceAmount ?? 0) : 0,
          ledgerAllocations: isReceipt ? safeArray(p.ledgerAllocations) : null,
          customerId: p.customerId,
          ledgerAccountId: p.ledgerAccountId,
          cashBankAccountId: p.cashBankAccountId,
          netCashAmount: p.netCashAmount,
          tdsAmount: p.tdsAmount,
          currency: p.currency,
        };
      })
      .sort((a, b) => {
        const da = String(a.date || '');
        const dbb = String(b.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b.id) - Number(a.id);
      });
  }, [db, currentCompany.id]);

  return (
    <TransactionsTable
      title="Receipts"
      rows={rows}
      currentCompany={currentCompany}
      onEdit={onEditReceipt ? (row) => {
        const payment = safeArray(db.payments).find((p) => p.companyId === currentCompany.id && String(p.id) === String(row.id));
        if (payment) onEditReceipt(payment);
      } : null}
      onDelete={setDb ? deleteReceipt : null}
      onView={(row) => {
        if (typeof openModal !== 'function') return;
        receiptActionsRef.current = null;
        const title = row?.documentNumber ? `Receipt ${row.documentNumber}` : 'Receipt';
        const savedTemplateId = getDocSettings(db, currentCompany)?.templates?.receipt?.templateId;
        openModal(<TransactionView title={title} payload={{ ...row, currentCompany, db, receiptView: true }} actionsRef={receiptActionsRef} setDb={setDb} />, {
          title,
          maxWidthClass: 'max-w-4xl',
          headerActions: <ReceiptHeaderActions actionsRef={receiptActionsRef} savedTemplateId={savedTemplateId} />,
        });
      }}
      rightActions={
        <button
          type="button"
          onClick={() => {
            if (typeof onRecordReceipt === 'function') {
              onRecordReceipt();
              return;
            }

            if (typeof openModal !== 'function' || typeof setDb !== 'function') return;
            /* The full receipt, not a document picker.
               Money can arrive with no invoice behind it — interest, a
               refund, a director's contribution — and asking which invoice
               this is before showing the form refused all of them. The
               invoices are still there to tick once a customer is chosen. */
            openModal(
              <RecordReceiptForm
                db={db}
                setDb={setDb}
                currentCompany={currentCompany}
                onClose={() => openModal(null)}
              />,
              { title: 'Record Receipt', maxWidthClass: 'max-w-4xl' }
            );
          }}
          className="px-4 py-2 rounded-lg ui-btn ui-btn-primary"
        >
          Record Receipt
        </button>
      }
    />
  );
};

export const PaymentsTransactionsList = ({ db, setDb, currentCompany, openModal, onRecordPayment }) => {
  const rows = useMemo(() => {
    const companyId = currentCompany.id;
    const payments = safeArray(db.payments).filter((p) => p.companyId === companyId);

    return payments
      .filter((p) => String(p.direction || '').toUpperCase() === 'OUT' && p.voucherType !== 'invoice')
      .map((p) => {
        const isGroupedPayment = String(p.voucherType || '') === 'payment';
        const voucher = isGroupedPayment ? null : resolveVoucher({ db, companyId, voucherType: p.voucherType, voucherId: p.voucherId });
        const partyName = isGroupedPayment ? p.vendorName || '' : voucher?.vendorName || voucher?.partyName || '';
        const accountId = String(p.ledgerAccountId || p.cashBankAccountId || '');
        const accounts = [...safeArray(db.chartOfAccounts), ...safeArray(db.cashBankAccounts)];
        const account = accounts.find((item) => String(item.companyId) === String(companyId) && (
          String(item.id) === accountId || String(item.serverLedgerAccountId || '') === accountId ||
          (p.cashBankAccountId && String(item.id) === String(p.cashBankAccountId))
        ));
        const billNumbers = safeArray(p.allocations)
          .filter((allocation) => ['bill', 'purchaseBill', 'purchaseInvoice'].includes(String(allocation.voucherType || '')) || ['BILL', 'PURCHASE_BILL'].includes(String(allocation.docType || '')))
          .map((allocation) => allocation.documentNumber || safeArray(db.bills).find((bill) => String(bill.id) === String(allocation.voucherId))?.number || '')
          .filter(Boolean);
        return {
          id: p.id,
          status: p.status,
          backendPaymentId: p.backendPaymentId,
          date: p.date,
          amount: Number(p.amount ?? 0),
          mode: p.mode,
          reference: p.reference,
          notes: p.notes,
          typeLabel: getVoucherLabel(p.voucherType),
          documentNumber: isGroupedPayment ? p.paymentNo || '' : voucher?.number || '',
          partyName,
          accountName: account?.name || p.ledgerAccountName || (String(p.mode || '').toLowerCase().includes('cash') ? 'Cash account' : 'Bank account'),
          againstBill: billNumbers.length ? `${billNumbers[0]}${billNumbers.length > 1 ? ` +${billNumbers.length - 1}` : ''}` : 'On account',
          againstBillFull: billNumbers.join(', '),
          allocations: isGroupedPayment ? safeArray(p.allocations) : null,
          advanceAmount: isGroupedPayment ? Number(p.advanceAmount ?? 0) : 0,
        };
      })
      .sort((a, b) => {
        const da = String(a.date || '');
        const dbb = String(b.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b.id) - Number(a.id);
      });
  }, [db, currentCompany.id]);

  return (
    <TransactionsTable
      title="Payments"
      rows={rows}
      currentCompany={currentCompany}
      onReverse={setDb ? makeReverse({ setDb, currentCompany, noun: 'payment' }) : null}
      onView={(row) => {
        if (typeof openModal !== 'function') return;
        const title = row?.documentNumber ? `Payment ${row.documentNumber}` : 'Payment';
        openModal(<TransactionView title={title} payload={{ ...row, currentCompany }} />, {
          title,
          maxWidthClass: 'max-w-3xl',
        });
      }}
      rightActions={
        <button
          type="button"
          onClick={() => {
            if (typeof onRecordPayment === 'function') {
              onRecordPayment();
              return;
            }

            if (typeof openModal !== 'function' || typeof setDb !== 'function') return;
            /* Likewise: a GST challan, a bank charge and a salary advance
               are payments with no bill to pick, and this button used to
               insist on one before it would show the form. */
            openModal(
              <RecordDisbursementForm
                db={db}
                setDb={setDb}
                currentCompany={currentCompany}
                onClose={() => openModal(null)}
              />,
              { title: 'Record Payment', maxWidthClass: 'max-w-5xl' }
            );
          }}
          className="px-4 py-2 rounded-lg ui-btn ui-btn-primary"
        >
          Record Payment
        </button>
      }
    />
  );
};
