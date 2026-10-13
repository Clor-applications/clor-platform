import React, { useMemo } from 'react';
import { Ban, BookOpen, ClipboardList, Download, Pencil, Plus, Receipt, Trash2, Undo2, Upload } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { usePeriodFilter } from '@ui/components/ListControls';
import { useListSearch } from '@ui/components/ListToolbar';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import { confirmDialog } from '@ui/components/ui/notify';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { formatMoney } from '@ui/utils/money';
import { reverseJournalOnLedger } from '@ui/utils/journalSync';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { useFeatures } from '@ui/permissions/useFeatures';
import { tdsReversalEventFrom } from '../tds/engine';

/**
 * The journal list.
 *
 * Lifted out of App.jsx when it moved onto the shared list layout — a screen
 * that cannot be rendered on its own cannot be tested on its own either.
 */
export default function JournalEntriesList({ db, setDb, currentCompany, onNewJournal, onEditJournal, onNavigate = null }) {
  const { isEnabled } = useFeatures();
  const importsOn = isEnabled('imports');
  const jvPeriod = usePeriodFilter();
  const jvSearch = useListSearch(
    db.journalEntries.filter((j) => j.companyId === currentCompany.id),
    ['number', 'narration', 'date', 'status']
  );
  const jvFilters = useColumnFilters();
  const journalEntries = jvFilters.applyFilters(jvSearch.filtered.filter((r) => jvPeriod.inRange(r?.date)), {
    number: (r) => r.number,
    date: (r) => r.date,
    narration: (r) => r.narration,
    status: (r) => r.status,
  });

  /*
   * What a journal is: balanced, out by something, or taken back.
   *
   * The last is the one somebody scans for — a reversed entry still sits in
   * the books and must, but it is not a live posting and reading the list
   * without being able to tell them apart is how a reversal gets counted
   * twice.
   */
  const jvStatusOf = (jv) => {
    if (String(jv?.status || '') === 'REVERSED') return 'Reversed';
    return Number(jv?.totalDebit || 0) === Number(jv?.totalCredit || 0) ? 'Balanced' : 'Unbalanced';
  };
  const jvShown = journalEntries;

  /*
   * Debit and credit are the same figure on a balanced book, so showing both
   * as headline money would be one fact twice. What differs — and what somebody
   * opens this screen to find — is how many entries there are, how many lines
   * they move, and whether anything is out.
   */
  const jvHeadline = useMemo(() => {
    let debit = 0;
    let lines = 0;
    let unbalanced = 0;
    let reversed = 0;
    for (const jv of journalEntries) {
      const st = jvStatusOf(jv);
      if (st === 'Reversed') {
        reversed += 1;
        continue;
      }
      debit += Number(jv.totalDebit || 0);
      lines += (jv.lines || []).length;
      if (st === 'Unbalanced') unbalanced += 1;
    }
    return { count: journalEntries.length, debit, lines, unbalanced, reversed };
  }, [journalEntries]);

  const jvExportColumns = [
    { key: 'number', label: 'JV #' },
    { key: 'date', label: 'Date' },
    { key: 'narration', label: 'Narration' },
    { key: 'debit', label: 'Debit', value: (r) => Number(r.totalDebit ?? r.debit ?? 0) },
    { key: 'credit', label: 'Credit', value: (r) => Number(r.totalCredit ?? r.credit ?? 0) },
    { key: 'status', label: 'Status', value: (r) => jvStatusOf(r) },
  ];

  const deleteEntry = async (jv) => {
    /*
     * An entry that reached the ledger is reversed, not deleted. Erasing the
     * row here while the server kept the posting is exactly the divergence
     * this screen was fixed to stop, and a posting is undone by an equal and
     * opposite entry so the trail shows both.
     */
    const posted = Boolean(String(jv?.backendEntryId || '').trim());
    const ok = await confirmDialog({
      title: 'Please confirm',
      message: posted
        ? `Entry "${String(jv?.number || '').trim() || 'this entry'}" is posted to the ledger. Reverse it with an opposite entry?`
        : `Delete journal entry "${String(jv?.number || '').trim() || 'this entry'}"?`,
      confirmLabel: posted ? 'Yes, reverse it' : 'Yes, continue',
    });
    if (!ok) return;

    const reverseTdsEvents = (state) => {
      const events = Array.isArray(state.tdsTransactions) ? state.tdsTransactions : [];
      const mine = events.filter(
        (event) =>
          Number(event?.companyId) === Number(currentCompany.id) &&
          String(event?.sourceType) === 'journal' &&
          String(event?.sourceId) === String(jv.id) &&
          String(event?.status).toLowerCase() === 'posted' &&
          !event?.reversalOfId
      );
      if (!mine.length) return events;
      let nextId = events.reduce((max, event) => Math.max(max, Number(event?.id) || 0), 0);
      const stamp = new Date().toISOString();
      const reversals = mine.map((event) => ({
        ...tdsReversalEventFrom(event, { reason: `Journal ${jv?.number || jv.id} reversed` }),
        id: ++nextId,
      }));
      return [
        ...events.map((event) =>
          mine.some((row) => row.id === event.id)
            ? { ...event, status: 'Reversed', modifiedBy: reversals[0]?.createdBy || 'User', modifiedAt: stamp }
            : event
        ),
        ...reversals,
      ];
    };

    if (posted) {
      const { reversed } = await reverseJournalOnLedger(jv);
      if (!reversed) return;
      setDb({
        ...db,
        tdsTransactions: reverseTdsEvents(db),
        journalEntries: (Array.isArray(db.journalEntries) ? db.journalEntries : []).map((x) =>
          x.companyId === currentCompany.id && String(x.id) === String(jv.id) ? { ...x, status: 'REVERSED' } : x
        ),
      });
      return;
    }

    setDb({
      ...db,
      tdsTransactions: reverseTdsEvents(db),
      journalEntries: (Array.isArray(db.journalEntries) ? db.journalEntries : []).filter(
        (x) => !(x.companyId === currentCompany.id && String(x.id) === String(jv.id))
      ),
    });
  };

  return (
    <DocumentListShell
      entity="journal"
      title="Journal Entries"
      compact
      tight
      denseCards
      className="journal-list-page"
      company={currentCompany}
      search={{
        value: jvSearch.query,
        onChange: jvSearch.setQuery,
        placeholder: 'Search journal entries…',
        label: 'Search journal entries',
      }}
      moreItems={[
        exportMenuItem('Export journal entries'),
        /* An opening trial balance arrives as a spreadsheet, not as
           four hundred vouchers somebody types. */
        ...(onNavigate && importsOn ? [{ key: 'dataImport', label: 'Import journal entries', Icon: Upload }] : []),
      ]}
      onMoreSelect={(k) => {
        if (k === 'dataImport') {
          onNavigate?.('dataImport', 'JOURNAL');
          return;
        }
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Journal entries',
          fileName: `JournalEntries_${currentCompany?.name || 'company'}`,
          label: 'entry/entries',
          columns: jvExportColumns,
          rows: jvShown,
        });
      }}
      primary={
        <button type="button" onClick={onNewJournal} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Entry
        </button>
      }
      cards={[
        { label: 'Entries', value: jvHeadline.count, count: true, tone: 'draft', Icon: BookOpen },
        { label: 'Posted value', value: jvHeadline.debit, tone: 'sent', Icon: Receipt },
        { label: 'Lines posted', value: jvHeadline.lines, count: true, tone: 'partial', Icon: ClipboardList },
        { label: 'Unbalanced', value: jvHeadline.unbalanced, count: true, tone: 'overdue', Icon: Ban },
        { label: 'Reversed', value: jvHeadline.reversed, count: true, tone: 'cancelled', Icon: Undo2 },
      ]}
      tip={{
        storageKey: 'clor.tip.journalEntries',
        Icon: BookOpen,
        text: 'An entry that reached the ledger is reversed rather than deleted — the original stays, and the opposite entry shows what was undone.',
      }}
    >
      <div
        className={`ui-table-scroll journal-table-scroll ${jvShown.length ? '' : 'journal-table-empty'}`}
        {...(jvShown.length ? { 'data-fill-viewport': '' } : {})}
      >
        <table className="ui-table ui-table-sticky journal-entry-table">
          <colgroup>
            <col className="journal-col-number" />
            <col className="journal-col-date" />
            <col className="journal-col-narration" />
            <col className="journal-col-money" />
            <col className="journal-col-money" />
            <col className="journal-col-status" />
            <col className="journal-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <ColumnHeader label="JV #" col="number" state={jvFilters} />
              <ColumnHeader label="Date" col="date" state={jvFilters} align="center" />
              <ColumnHeader label="Narration" col="narration" state={jvFilters} />
              <th scope="col" className="ui-num">Debit</th>
              <th scope="col" className="ui-num">Credit</th>
              <ColumnHeader label="Status" col="status" state={jvFilters} align="center" />
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {jvShown.length === 0 ? (
              <tr>
                <td colSpan="7">
                  <EmptyState
                    icon={BookOpen}
                    kind="new"
      title={journalEntries.length ? 'No entries match' : 'No journal entries yet'}
                    description={
                      journalEntries.length
                        ? 'Nothing in this status for the chosen period.'
                        : 'A journal entry posts a debit and a matching credit straight to the ledger — for the adjustments no document covers.'
                    }
                    routes={
                      journalEntries.length
                        ? undefined
                        : [
                            {
                              label: 'Post one now',
                              description: 'Pick the two ledgers, enter the amount, say why.',
                              onSelect: () => onNewJournal?.(),
                            },
                          ]
                    }
                  />
                </td>
              </tr>
            ) : (
              jvShown.map((jv) => (
                <tr key={jv.id}>
                  <td className="ui-col-id">{jv.number}</td>
                  <td className="ui-col-date">{jv.date}</td>
                  <td className="ui-col-entity">
                    <div className="ui-narration">{jv.narration || '-'}</div>
                    <div className="text-xs ui-muted">{(jv.lines || []).length} lines</div>
                  </td>
                  <td className="ui-col-amount">{formatMoney(jv.totalDebit || 0, currentCompany)}</td>
                  <td className="ui-col-amount">{formatMoney(jv.totalCredit || 0, currentCompany)}</td>
                  <td>
                    <StatusPill status={jvStatusOf(jv)} />
                  </td>
                  <td className="ui-col-meta">
                    <div className="flex justify-end gap-2">
                      {jv.status === 'REVERSED' ? (
                        <span className="text-sm ui-muted">Reversed</span>
                      ) : (
                      <>
                      <button
                        type="button"
                        onClick={() => onEditJournal?.(jv)}
                        className="px-3 py-1.5 rounded-lg border ui-surface ui-hover-sunken ui-border-c text-sm flex items-center gap-1"
                      >
                        <Pencil size={16} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteEntry(jv)}
                        className="px-3 py-1.5 rounded-lg border ui-surface ui-hover-sunken ui-border-c text-sm flex items-center gap-1 text-[rgb(var(--neg))]"
                      >
                        <Trash2 size={16} /> {jv.backendEntryId ? 'Reverse' : 'Delete'}
                      </button>
                      </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <TableTotals
        count={jvShown.length}
        totalCount={(db.journalEntries || []).filter((j) => j.companyId === currentCompany.id).length}
        noun="entries"
        figures={[{ label: 'Posted value', value: formatMoney(jvHeadline.debit, currentCompany) }]}
      />
    </DocumentListShell>
  );
}
