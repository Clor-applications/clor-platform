import { useFeatures } from '@ui/permissions/useFeatures';
import { useMemo, useState } from 'react';
import KnockOffForm from '@ui/components/KnockOffForm';
import { hasApiSession as hasDocsApiSession, saveSettlementApi } from '@ui/api/purchaseDocs';
import { notify } from '@ui/components/ui/notify';
import { formatMoney } from '@ui/utils/money';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { usePeriodFilter } from '@ui/components/ListControls';
import { useListSearch } from '@ui/components/ListToolbar';
import { isOnAccount, noteBalance } from '@ui/utils/onAccount';
import { CreditNoteForm } from './salesShared';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Ban, ClipboardList, CreditCard, FileText, Plus, Printer, Receipt, Upload } from 'lucide-react';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import { DateCell, InvoiceIdentifier } from '@ui/components/table/cells';
import { MoneyValue } from '@ui/components/docs';
import Modal from '@ui/components/ui/Modal';
import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import DocumentPrintView from '@ui/components/DocumentPrintView';

export const CreditNotesList = ({
  db,
  setDb,
  openModal,
  currentCompany,
  onNewCreditNote,
  warehouses = [],
  /* Handed on to a credit note opened from this list, so it can ask which
     branch the note belongs to. */
  branches = [],
  defaultWarehouseId = '',
  onNavigate = null,
}) => {
  const { isEnabled: featureIsEnabled } = useFeatures();
  const importsOn = featureIsEnabled('imports');
  const warehouseById = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return new Map(list.map((w) => [String(w?.id), w]));
  }, [warehouses]);

  const [previewCreditNote, setPreviewCreditNote] = useState(null);

  /** Settle an on-account credit note against the customer's open invoices. */
  const openKnockOff = (note) => {
    if (typeof openModal !== 'function') return;
    openModal(
      <KnockOffForm
        note={note}
        documents={db.invoices || []}
        notes={db.creditNotes || []}
        currentCompany={currentCompany}
        partyKey="customerId"
        docLabel="invoice"
        onCancel={() => openModal(null)}
        onConfirm={async (allocations) => {
          const today = new Date().toISOString().slice(0, 10);
          const stamped = allocations.map((a) => ({ ...a, date: today }));
          const next = [...(note.allocations || []), ...stamped];

          if (note.backendDocId && hasDocsApiSession()) {
            try {
              await saveSettlementApi('creditNote', note.backendDocId, {
                settlementMode: 'ON_ACCOUNT',
                invoiceIds: (note.invoiceIds || []).map(String),
                allocations: next,
              });
            } catch (err) {
              notify.error(String(err?.message || 'Settlement not saved to the server.'));
              return;
            }
          }

          setDb((prev) => ({
            ...prev,
            creditNotes: (prev.creditNotes || []).map((x) =>
              String(x.id) === String(note.id) ? { ...x, allocations: next } : x
            ),
          }));
          openModal(null);
          const total = allocations.reduce((t, a) => t + Number(a.amount || 0), 0);
          notify.success(`${formatMoney(total, currentCompany)} knocked off against ${allocations.length} invoice(s).`);
        }}
      />,
      { title: `Knock off ${note?.number || ''}`.trim(), maxWidthClass: 'max-w-3xl' }
    );
  };

  const cnFilters = useColumnFilters();
  const cnPeriod = usePeriodFilter();
  const cnSearch = useListSearch(
    db.creditNotes.filter((c) => c.companyId === currentCompany.id),
    ['number', 'customerName', 'originalInvoiceNumber', 'date'],
    'creditNotes'
  );

  // What is hiding rows right now, in the user's words. Without this an empty
  // list says "none yet" to someone who has simply filtered them all away.
  const cnFilterChips = useMemo(() => {
    const chips = [];
    if (String(cnSearch.query || '').trim()) {
      chips.push({ label: 'Search', value: String(cnSearch.query).trim(), onRemove: () => cnSearch.setQuery('') });
    }
    for (const [key, f] of Object.entries(cnFilters.filters || {})) {
      const shown = Array.isArray(f?.values) ? f.values.filter(Boolean).join(', ') : String(f?.value || '');
      chips.push({ label: key, value: shown || 'set', onRemove: () => cnFilters.clearColumn(key) });
    }
    return chips;
  }, [cnSearch, cnFilters]);
  const creditNotesAll = cnFilters.applyFilters(
    cnSearch.filtered
      .filter((r) => cnPeriod.inRange(r?.date))
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b?.id || 0) - Number(a?.id || 0);
      }),
    {
      number: (r) => r.number,
      original: (r) => r.originalInvoiceNumber,
      customer: (r) => r.customerName,
      warehouse: (r) => warehouseById.get(String(r?.warehouseId || ''))?.name || r?.warehouseId || '',
      date: (r) => r.date,
      total: (r) => r.total,
    }
  );

  /*
   * A credit note is money owed back. The list is read for two things: how much
   * has been credited, and how much of it is sitting on account — issued
   * against no particular invoice and not yet knocked off anything, which is a
   * customer balance nobody has finished dealing with.
   */
  const [cnStatus, setCnStatus] = useState('');
  const cnStatusOf = (cn) => {
    const st = String(cn?.status || 'Open');
    if (st === 'Draft' || st === 'Cancelled') return st;
    if (isOnAccount(cn)) return noteBalance(cn).unsettled > 0.0001 ? 'On account' : 'Settled';
    return st;
  };
  const CN_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Draft', label: 'Draft', tone: 'draft' },
    { value: 'Open', label: 'Issued', tone: 'sent' },
    { value: 'On account', label: 'On account', tone: 'outstanding' },
    { value: 'Settled', label: 'Settled', tone: 'paid' },
  ];
  const creditNotes = cnStatus ? creditNotesAll.filter((c) => cnStatusOf(c) === cnStatus) : creditNotesAll;

  const cnHeadline = useMemo(() => {
    let value = 0;
    let onAccount = 0;
    let drafted = 0;
    let againstInvoice = 0;
    for (const c of creditNotesAll) {
      const amt = Number(c.total || 0);
      value += amt;
      if (cnStatusOf(c) === 'Draft') drafted += amt;
      else if (isOnAccount(c)) onAccount += noteBalance(c).unsettled;
      else againstInvoice += amt;
    }
    return { count: creditNotesAll.length, value, onAccount, drafted, againstInvoice };
  }, [creditNotesAll]);

  const cnExportColumns = [
    { key: 'number', label: 'Credit #' },
    { key: 'originalInvoiceNumber', label: 'Original invoice' },
    { key: 'customerName', label: 'Customer' },
    { key: 'date', label: 'Date' },
    { key: 'total', label: 'Total', value: (r) => Number(r.total || 0) },
    { key: 'status', label: 'Status', value: (r) => cnStatusOf(r) },
  ];

  const openNewCreditNote = () => {
    if (typeof onNewCreditNote === 'function') {
      onNewCreditNote();
      return;
    }
    openModal(
      <CreditNoteForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        warehouses={warehouses}
        branches={branches}
        defaultWarehouseId={defaultWarehouseId}
        onClose={() => openModal(null)}
      />,
      { title: 'New Credit Note', maxWidthClass: 'max-w-5xl' }
    );
  };

  return (
    <DocumentListShell
      entity="salesReturn"
      className="sales-list-page"
      title="Sales Returns"
      company={currentCompany}
      search={{
        before: <select value={cnStatus} onChange={(event) => setCnStatus(event.target.value)} className="ui-select ui-ctl-compact w-40" aria-label="Credit note status">{CN_STATUS_TABS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select>,
        value: cnSearch.query,
        onChange: cnSearch.setQuery,
        placeholder: 'Search credit notes…',
        label: 'Search credit notes',
      }}
      moreItems={[
        exportMenuItem('Export credit notes'),
        ...(onNavigate && importsOn ? [{ key: 'dataImport', label: 'Import credit notes', Icon: Upload }] : []),
      ]}
      onMoreSelect={(k) => {
        if (k === 'dataImport') {
          onNavigate?.('dataImport', 'CREDIT_NOTE');
          return;
        }
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Credit notes',
          fileName: `CreditNotes_${currentCompany?.name || 'company'}`,
          label: 'credit note(s)',
          columns: cnExportColumns,
          rows: creditNotes,
        });
      }}
      primary={
        <PermissionButton
          permission="SALES::Credit Notes::CREATE"
          onClick={openNewCreditNote}
          className="ui-btn ui-btn-primary"
        >
          <Plus size={16} aria-hidden="true" /> New Credit Note
        </PermissionButton>
      }
      cards={[
        { label: 'Credit notes', value: cnHeadline.count, count: true, tone: 'draft', Icon: Receipt },
        { label: 'Credited', value: cnHeadline.value, tone: 'refund', Icon: FileText },
        { label: 'Against invoices', value: cnHeadline.againstInvoice, tone: 'paid', Icon: CreditCard },
        { label: 'On account, unused', value: cnHeadline.onAccount, tone: 'outstanding', Icon: ClipboardList },
        { label: 'Still in draft', value: cnHeadline.drafted, tone: 'cancelled', Icon: Ban },
      ]}
      denseCards
    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead>
            <tr>
              <ColumnHeader label="Credit #" col="number" state={cnFilters} />
              <ColumnHeader label="Original invoice" col="original" state={cnFilters} />
              <ColumnHeader label="Customer" col="customer" state={cnFilters} />
              <ColumnHeader label="Date" col="date" state={cnFilters} align="center" />
              <ColumnHeader label="Amount" col="total" state={cnFilters} className="ui-num" align="right" />
              <ColumnHeader label="Status" col="status" state={cnFilters} align="center" />
              <ColumnHeader label="Warehouse" col="warehouse" state={cnFilters} />
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {creditNotes.length === 0 ? (
              <tr>
                <td colSpan="8">
                  {cnFilterChips.length === 0 && !cnStatus ? (
                    <EmptyState
                      icon={Receipt}
                      kind="new"
      title="No sales returns yet"
                      description="A credit note is what you owe a customer back — goods returned, an overcharge, a discount agreed after the invoice."
                      routes={[
                        {
                          label: 'Credit an invoice',
                          description: 'Pick the invoice, choose the lines coming back.',
                          onSelect: () => openNewCreditNote(),
                        },
                        {
                          label: 'Credit on account',
                          description: 'Owe the customer a sum now, knock it off later.',
                          onSelect: () => openNewCreditNote(),
                        },
                      ]}
                    />
                  ) : (
                    <EmptyState
                      icon={Receipt}
                      kind="filtered"
                      totalCount={(db.creditNotes || []).filter((c) => c.companyId === currentCompany.id).length}
                      filters={cnFilterChips}
                      onClearFilters={() => {
                        cnSearch.setQuery('');
                        cnFilters.clearAll();
                      }}
                    />
                  )}
                </td>
              </tr>
            ) : (
              creditNotes.map((cn) => {
                const whId = String(cn?.warehouseId || '').trim();
                const wh = whId ? warehouseById.get(whId) : null;
                const whLabel = wh ? String(wh?.name || `Warehouse ${wh?.id}`) : whId ? `Warehouse ${whId}` : '-';
                return (
                  <tr key={cn.id}>
                    <td className="ui-col-id"><InvoiceIdentifier value={cn.number} label="credit note" /></td>
                    <td className="ui-col-meta">
                      {cn.originalInvoiceNumber || (
                        <span className="ui-muted">
                          {(cn.invoiceIds || []).length ? `${(cn.invoiceIds || []).length} invoices · on account` : '-'}
                        </span>
                      )}
                    </td>
                    <td className="ui-col-entity">{cn.customerName || '-'}</td>
                    <td className="ui-col-date"><DateCell value={cn.date} /></td>
                    {/* A credit note is money going back out, so it takes the
                        refund colour rather than reading as revenue. */}
                    <td className="ui-col-amount">
                      <MoneyValue value={cn.total} company={currentCompany} kind="refund" />
                    </td>
                    {/*
                      Whether this credit has actually reached the books. A
                      draft does not post, and without this column there was
                      nothing on screen to say so.
                    */}
                    <td className="whitespace-nowrap">
                      <StatusPill status={cnStatusOf(cn)} />
                    </td>
                    <td className="ui-col-meta">{whLabel}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => setPreviewCreditNote(cn)}
                        aria-label={`Print credit note ${cn.number}`}
                        className="ui-btn ui-btn-secondary ui-btn-sm text-xs mr-2"
                      >
                        <Printer size={14} aria-hidden="true" /> Print
                      </button>
                      {isOnAccount(cn) ? (
                        noteBalance(cn).unsettled > 0.0001 ? (
                          <button
                            type="button"
                            onClick={() => openKnockOff(cn)}
                            className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
      title="Knock this off against the customer's open invoices"
                          >
                            Knock off {formatMoney(noteBalance(cn).unsettled, currentCompany)}
                          </button>
                        ) : (
                          <span className="ui-caption">Settled</span>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <TableTotals
        count={creditNotes.length}
        totalCount={(db.creditNotes || []).filter((c) => c.companyId === currentCompany.id).length}
        noun="credit notes"
        figures={[
          { label: 'Value', value: formatMoney(creditNotes.reduce((t, c) => t + Number(c.total || 0), 0), currentCompany) },
        ]}
      />

      {previewCreditNote ? (
        <Modal
          title={`Credit Note ${previewCreditNote.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
          onClose={() => setPreviewCreditNote(null)}
        >
          <PrintDownloadFrame
      title={`Credit Note ${previewCreditNote.number || ''}`.trim()}
            fileBase={previewCreditNote.number || 'credit-note'}
          >
            <DocumentPrintView
              db={db}
              currentCompany={currentCompany}
              docTitle="CREDIT NOTE"
              doc={previewCreditNote}
              party={(db.customers || []).find((c) => String(c.id) === String(previewCreditNote.customerId)) || null}
              partyLabel="Customer"
              metaRows={[
                { label: 'Against invoice', value: previewCreditNote.originalInvoiceNumber },
                { label: 'Invoice date', value: previewCreditNote.originalInvoiceDate },
              ]}
              sideRows={[
                { label: 'GSTIN', value: previewCreditNote.customerGstin },
                { label: 'Reason', value: previewCreditNote.reasonLabel },
              ]}
              footNote="Credit note under section 34 of the CGST Act. The tax charged on the original invoice is reduced by the amount shown above."
            />
          </PrintDownloadFrame>
        </Modal>
      ) : null}
    </DocumentListShell>
  );
};
