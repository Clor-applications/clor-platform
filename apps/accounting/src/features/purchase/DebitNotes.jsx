import { useFeatures } from '@ui/permissions/useFeatures';
import React, { useMemo, useState } from 'react';
import KnockOffForm from '@ui/components/KnockOffForm';
import { hasApiSession, saveSettlementApi } from '@ui/api/purchaseDocs';
import { notify } from '@ui/components/ui/notify';
import { formatMoney } from '@ui/utils/money';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { usePeriodFilter } from '@ui/components/ListControls';
import { useListSearch } from '@ui/components/ListToolbar';
import { isOnAccount, noteBalance } from '@ui/utils/onAccount';
import { DebitNoteForm } from './purchaseShared';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Ban, ClipboardList, CreditCard, FileText, NotebookPen, Plus, Printer, Upload } from 'lucide-react';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import { DocDate, DocumentNumber, MoneyValue } from '@ui/components/docs';
import Modal from '@ui/components/ui/Modal';
import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import DocumentPrintView from '@ui/components/DocumentPrintView';

export const DebitNotesList = ({ db, setDb, openModal, currentCompany, onNewDebitNote, warehouses = [], defaultWarehouseId = '', onNavigate = null }) => {
  const { isEnabled: featureIsEnabled } = useFeatures();
  const importsOn = featureIsEnabled('imports');
  const warehouseById = React.useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return new Map(list.map((w) => [String(w?.id), w]));
  }, [warehouses]);

  const [previewNote, setPreviewNote] = useState(null);

  /** Settle an on-account note against the vendor's open bills. */
  const openKnockOff = (note) => {
    if (typeof openModal !== 'function') return;
    openModal(
      <KnockOffForm
        note={note}
        documents={db.bills || []}
        notes={db.debitNotes || []}
        currentCompany={currentCompany}
        partyKey="vendorId"
        docLabel="bill"
        onCancel={() => openModal(null)}
        onConfirm={async (allocations) => {
          const today = new Date().toISOString().slice(0, 10);
          const stamped = allocations.map((a) => ({ ...a, date: today }));
          const next = [...(note.allocations || []), ...stamped];

          // The books already carry this note; what travels here is which
          // documents its value answers, so a second browser agrees.
          if (note.backendDocId && hasApiSession()) {
            try {
              await saveSettlementApi('debitNote', note.backendDocId, {
                settlementMode: 'ON_ACCOUNT',
                billIds: (note.billIds || []).map(String),
                allocations: next,
              });
            } catch (err) {
              notify.error(String(err?.message || 'Settlement not saved to the server.'));
              return;
            }
          }

          setDb((prev) => ({
            ...prev,
            debitNotes: (prev.debitNotes || []).map((x) =>
              String(x.id) === String(note.id) ? { ...x, allocations: next } : x
            ),
          }));
          openModal(null);
          const total = allocations.reduce((t, a) => t + Number(a.amount || 0), 0);
          notify.success(`${formatMoney(total, currentCompany)} knocked off against ${allocations.length} bill(s).`);
        }}
      />,
      { title: `Knock off ${note?.number || ''}`.trim(), maxWidthClass: 'max-w-3xl' }
    );
  };

  const dnFilters = useColumnFilters();
  const dnPeriod = usePeriodFilter();
  const dnSearch = useListSearch(
    db.debitNotes.filter((dn) => dn.companyId === currentCompany.id),
    ['number', 'vendorName', 'originalBillNumber', 'date'],
    'debitNotes'
  );

  // What is hiding rows right now. An empty list should not say "none yet" to
  // somebody who has simply filtered them all away.
  const dnFilterChips = React.useMemo(() => {
    const chips = [];
    if (String(dnSearch.query || '').trim()) {
      chips.push({ label: 'Search', value: String(dnSearch.query).trim(), onRemove: () => dnSearch.setQuery('') });
    }
    for (const [key, f] of Object.entries(dnFilters.filters || {})) {
      const shown = Array.isArray(f?.values) ? f.values.filter(Boolean).join(', ') : String(f?.value || '');
      chips.push({ label: key, value: shown || 'set', onRemove: () => dnFilters.clearColumn(key) });
    }
    return chips;
  }, [dnSearch, dnFilters]);
  const debitNotes = dnFilters.applyFilters(
    dnSearch.filtered
      .filter((r) => dnPeriod.inRange(r?.date))
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b?.id || 0) - Number(a?.id || 0);
      }),
    {
      number: (r) => r.number,
      original: (r) => r.originalBillNumber,
      vendor: (r) => r.vendorName,
      warehouse: (r) => warehouseById.get(String(r?.warehouseId || ''))?.name || r?.warehouseId || '',
      date: (r) => r.date,
      amount: (r) => r.total,
      status: (r) => r.status,
    }
  );

  /*
   * A debit note is money the vendor owes back. Like the sales side, the one
   * that matters is on account and unsettled: raised against no particular
   * bill and not yet knocked off anything.
   */
  const [dnStatus, setDnStatus] = useState('');
  const dnStatusOf = (dn) => {
    const st = String(dn?.status || 'Draft');
    if (st === 'Draft' || st === 'Cancelled') return st;
    if (isOnAccount(dn)) return noteBalance(dn).unsettled > 0.0001 ? 'On account' : 'Settled';
    return 'Open';
  };
  const DN_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Draft', label: 'Draft', tone: 'draft' },
    { value: 'Open', label: 'Issued', tone: 'sent' },
    { value: 'On account', label: 'On account', tone: 'outstanding' },
    { value: 'Settled', label: 'Settled', tone: 'paid' },
  ];
  const dnShown = dnStatus ? debitNotes.filter((dn) => dnStatusOf(dn) === dnStatus) : debitNotes;

  const dnStatusCounts = useMemo(() => {
    const counts = { '': debitNotes.length };
    for (const dn of debitNotes) {
      const st = dnStatusOf(dn);
      counts[st] = (counts[st] || 0) + 1;
    }
    return counts;
  }, [debitNotes]);

  const dnHeadline = useMemo(() => {
    let value = 0;
    let onAccount = 0;
    let drafted = 0;
    let againstBill = 0;
    for (const dn of debitNotes) {
      const amt = Number(dn.total || 0);
      value += amt;
      if (dnStatusOf(dn) === 'Draft') drafted += amt;
      else if (isOnAccount(dn)) onAccount += noteBalance(dn).unsettled;
      else againstBill += amt;
    }
    return { count: debitNotes.length, value, onAccount, drafted, againstBill };
  }, [debitNotes]);

  const dnExportColumns = [
    { key: 'number', label: 'Debit note #' },
    { key: 'originalBillNumber', label: 'Original bill' },
    { key: 'vendorName', label: 'Vendor' },
    { key: 'date', label: 'Date' },
    { key: 'total', label: 'Amount', value: (r) => Number(r.total || 0) },
    { key: 'status', label: 'Status', value: (r) => dnStatusOf(r) },
  ];

  const openNewDebitNote = () => {
    if (typeof onNewDebitNote === 'function') {
      onNewDebitNote();
      return;
    }
    openModal(
      <DebitNoteForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        warehouses={warehouses}
        defaultWarehouseId={defaultWarehouseId}
        onClose={() => openModal(null)}
      />
    );
  };

  return (
    <DocumentListShell
      entity="purchaseReturn"
      title="Purchase Returns"
      compact
      tight
      denseCards
      company={currentCompany}
      search={{
        value: dnSearch.query,
        onChange: dnSearch.setQuery,
        placeholder: 'Search debit notes…',
        label: 'Search debit notes',
      }}
      moreItems={[
        exportMenuItem('Export debit notes'),
        ...(onNavigate && importsOn ? [{ key: 'dataImport', label: 'Import purchase returns', Icon: Upload }] : []),
      ]}
      onMoreSelect={(k) => {
        if (k === 'dataImport') {
          onNavigate?.('dataImport', 'DEBIT_NOTE');
          return;
        }
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Purchase returns',
          fileName: `DebitNotes_${currentCompany?.name || 'company'}`,
          label: 'debit note(s)',
          columns: dnExportColumns,
          rows: dnShown,
        });
      }}
      primary={
        <button type="button" onClick={openNewDebitNote} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Debit Note
        </button>
      }
      cards={[
        { label: 'Debit notes', value: dnHeadline.count, count: true, tone: 'draft', Icon: NotebookPen },
        { label: 'Returned', value: dnHeadline.value, tone: 'refund', Icon: FileText },
        { label: 'Against bills', value: dnHeadline.againstBill, tone: 'paid', Icon: CreditCard },
        { label: 'On account, unused', value: dnHeadline.onAccount, tone: 'outstanding', Icon: ClipboardList },
        { label: 'Still in draft', value: dnHeadline.drafted, tone: 'cancelled', Icon: Ban },
      ]}
      tabs={DN_STATUS_TABS}
      tabsLabel="Debit note status"
      statusValue={dnStatus}
      statusCounts={dnStatusCounts}
      onStatusChange={setDnStatus}
      tip={{
        storageKey: 'clor.tip.debitNotes',
        Icon: NotebookPen,
        text: 'A debit note on account is money the vendor owes you until it is knocked off a bill — the row says how much is left.',
      }}
    >
      <div className="overflow-x-auto ui-table-scroll purchase-return-table-scroll" data-fill-viewport>
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead className="ui-sunken border-b">
            <tr>
              <ColumnHeader label="Debit note #" col="number" state={dnFilters} />
              <ColumnHeader label="Original bill" col="original" state={dnFilters} />
              <ColumnHeader label="Vendor" col="vendor" state={dnFilters} />
              <ColumnHeader label="Date" col="date" state={dnFilters} align="center" />
              <ColumnHeader label="Amount" col="amount" state={dnFilters} className="ui-num" align="right" />
              <ColumnHeader label="Status" col="status" state={dnFilters} align="center" />
              <ColumnHeader label="Warehouse" col="warehouse" state={dnFilters} />
              <th scope="col" className="ui-num"><span className="sr-only">On account</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {dnShown.length === 0 ? (
              <tr>
                <td colSpan="8">
                  {dnFilterChips.length === 0 && !dnStatus ? (
                    <EmptyState
                      icon={NotebookPen}
                      kind="new"
      title="No purchase returns yet"
                      description="A debit note is what the vendor owes you back — goods returned, an overcharge, a discount agreed after the bill."
                      routes={[
                        {
                          label: 'Return against a bill',
                          description: 'Pick the bill, choose the lines going back.',
                          onSelect: () => openNewDebitNote(),
                        },
                        {
                          label: 'Debit on account',
                          description: 'Record what they owe now, knock it off later.',
                          onSelect: () => openNewDebitNote(),
                        },
                      ]}
                    />
                  ) : (
                    <EmptyState
                      icon={NotebookPen}
                      kind="filtered"
                      totalCount={(db.debitNotes || []).filter((d) => d.companyId === currentCompany.id).length}
                      filters={dnFilterChips}
                      onClearFilters={() => {
                        dnSearch.setQuery('');
                        dnFilters.clearAll();
                      }}
                    />
                  )}
                </td>
              </tr>
            ) : (
              dnShown.map((dn) => {
                const whId = String(dn?.warehouseId || '').trim();
                const wh = whId ? warehouseById.get(whId) : null;
                const whLabel = wh ? String(wh?.name || `Warehouse ${wh?.id}`) : whId ? `Warehouse ${whId}` : '-';
                return (
                  <tr key={dn.id} className="ui-hover-sunken">
                    <td className="ui-col-id"><DocumentNumber value={dn.number} label="debit note" /></td>
                    <td className="ui-col-meta">
                      {dn.originalBillNumber || (
                        <span className="ui-muted">
                          {(dn.billIds || []).length ? `${(dn.billIds || []).length} bills · on account` : '—'}
                        </span>
                      )}
                    </td>
                    <td className="ui-col-entity">{dn.vendorName}</td>
                    <td className="ui-col-date"><DocDate value={dn.date} /></td>
                    <td className="ui-col-amount"><MoneyValue value={dn.total || 0} company={currentCompany} kind="refund" /></td>
                    <td>
                      <StatusPill status={dnStatusOf(dn)} />
                    </td>
                    <td className="ui-col-meta">{whLabel}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => setPreviewNote(dn)}
                        aria-label={`Print debit note ${dn.number}`}
                        className="ui-btn ui-btn-secondary ui-btn-sm text-xs mr-2"
                      >
                        <Printer size={14} aria-hidden="true" /> Print
                      </button>
                      {isOnAccount(dn) ? (
                        noteBalance(dn).unsettled > 0.0001 ? (
                          <button
                            type="button"
                            onClick={() => openKnockOff(dn)}
                            className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
      title="Knock this off against the vendor's open bills"
                          >
                            Knock off {formatMoney(noteBalance(dn).unsettled, currentCompany)}
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
        <TableTotals
          count={dnShown.length}
          totalCount={(db.debitNotes || []).filter((d) => d.companyId === currentCompany.id).length}
          noun="debit notes"
          figures={[
            { label: 'Value', value: formatMoney(dnShown.reduce((t, d) => t + Number(d.total || 0), 0), currentCompany) },
          ]}
        />
      </div>

      {previewNote ? (
        <Modal
          title={`Debit Note ${previewNote.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
          onClose={() => setPreviewNote(null)}
        >
          <PrintDownloadFrame
      title={`Debit Note ${previewNote.number || ''}`.trim()}
            fileBase={previewNote.number || 'debit-note'}
          >
            <DocumentPrintView
              db={db}
              currentCompany={currentCompany}
              docTitle="DEBIT NOTE"
              doc={previewNote}
              party={(db.vendors || []).find((v) => String(v.id) === String(previewNote.vendorId)) || null}
              partyLabel="Vendor"
              metaRows={[{ label: 'Against bill', value: previewNote.originalBillNumber }]}
              sideRows={[
                { label: 'GSTIN', value: previewNote.vendorGstin },
                { label: 'Place of supply', value: previewNote.placeOfSupplyState },
              ]}
              footNote="Debit note under section 34 of the CGST Act. The input tax credit claimed on the original bill is reduced by the tax shown above."
            />
          </PrintDownloadFrame>
        </Modal>
      ) : null}
    </DocumentListShell>
  );
};
