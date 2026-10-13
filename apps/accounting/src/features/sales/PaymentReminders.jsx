import React, { useMemo, useState } from 'react';
import { partyEmail, partyMobile } from '@ui/utils/contacts';
import { Ban, Bell, Copy, Download, FileText, Mail, MessageCircle, Receipt } from 'lucide-react';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { formatMoney } from '@ui/utils/money';
import { notify } from '@ui/components/ui/notify';
import { DocumentNumber, SalesDate, DueDate, MoneyValue, SalesBalance } from '@ui/components/docs';
import { createInvoiceShareLink } from '../../api/share';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import {
  collectiblesList,
  buildReminderMessage,
  waLink,
  mailtoLink,
  lastReminder,
  needsReminder,
} from '@ui/utils/reminders';

/**
 * Payment reminders — the collections desk.
 *
 * Every open invoice with a balance, most overdue first. The schedule is
 * due-date → +7 → +15; an invoice that reached a stage without a reminder
 * shows "Send now". Buttons open WhatsApp (wa.me deep link, prefilled
 * message, the customer's mobile) or the mail client; each send is stamped
 * on the invoice so the stage tracking knows what went out.
 */
export default function PaymentReminders({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => collectiblesList(db, companyId, today), [db, companyId, today]);
  const customersById = useMemo(
    () => new Map((db.customers || []).filter((c) => c.companyId === companyId).map((c) => [String(c.id), c])),
    [db.customers, companyId]
  );

  const [filter, setFilter] = useState('ALL'); // ALL | DUE | S2 | S3 | SENDNOW

  const stageLabel = (s) => (s === 3 ? '15+ days' : s === 2 ? '7+ days' : s === 1 ? 'Due' : 'Not due');

  const prSearch = useListSearch(
    rows.filter((r) => {
      if (filter === 'DUE') return r.stage === 1;
      if (filter === 'S2') return r.stage === 2;
      if (filter === 'S3') return r.stage === 3;
      if (filter === 'SENDNOW') return needsReminder(r.invoice, today);
      return true;
    }),
    [(r) => r.invoice?.number, (r) => r.invoice?.customerName, (r) => r.invoice?.dueDate]
  );
  const shown = prSearch.filtered;

  const markSent = (invoice, channel) => {
    const entry = { date: today, channel, stage: reminderStageSafe(invoice) };
    setDb((prev) => ({
      ...prev,
      invoices: (prev.invoices || []).map((i) =>
        i.id === invoice.id ? { ...i, remindersSent: [...(i.remindersSent || []), entry] } : i
      ),
    }));
  };
  const reminderStageSafe = (inv) => {
    const r = rows.find((x) => x.invoice.id === inv.id);
    return r ? r.stage : 1;
  };

  /**
   * The link the customer follows.
   *
   * It used to be `?invoiceId=123`, which only ever worked for somebody already
   * signed in with this company open — the business itself, never the customer
   * being chased. They landed on a login page, which reads as a broken link
   * sent by their supplier.
   *
   * Now a token, minted on the server and good for one invoice. The same
   * invoice always gives the same address, so a reminder sent three times is
   * three messages pointing at one page rather than two dead links and a live
   * one.
   *
   * A link that cannot be minted is left out of the message entirely. Sending
   * the customer a URL that will not open is worse than sending them none.
   */
  const messageFor = async (invoice) => {
    const customer = customersById.get(String(invoice.customerId)) || null;
    let shareUrl = '';
    const backendId = String(invoice.backendInvoiceId || '').trim();
    if (backendId) {
      try {
        const res = await createInvoiceShareLink(backendId);
        if (res?.token) shareUrl = `${window.location.origin}/?share=${encodeURIComponent(res.token)}`;
      } catch {
        shareUrl = '';
      }
    }
    return { customer, message: buildReminderMessage({ invoice, customer, company: currentCompany, shareUrl }) };
  };

  const sendWhatsApp = async (invoice) => {
    const { customer, message } = await messageFor(invoice);
    const phone = partyMobile(customer);
    window.open(waLink(phone, message), '_blank', 'noopener');
    markSent(invoice, 'whatsapp');
    notify.success(`WhatsApp reminder opened for ${invoice.number}${phone ? '' : ' (no mobile on the customer — pick the contact in WhatsApp)'}`);
  };

  const sendEmail = async (invoice) => {
    const { customer, message } = await messageFor(invoice);
    const email = partyEmail(customer);
    window.open(mailtoLink(email, `Payment reminder — Invoice ${invoice.number}`, message), '_self');
    markSent(invoice, 'email');
    notify.success(`Email reminder opened for ${invoice.number}`);
  };

  const copyMessage = async (invoice) => {
    const { message } = await messageFor(invoice);
    try {
      await navigator.clipboard.writeText(message);
      markSent(invoice, 'copy');
      notify.success('Reminder message copied.');
    } catch {
      notify.error('Clipboard unavailable — use WhatsApp/Email buttons instead.');
    }
  };

  /*
   * The stages of chasing, as tabs rather than a row of loose buttons. Send
   * now is not a stage — it is "the schedule says today", which cuts across
   * all three — so it keeps its own tab and its own count.
   */
  const PR_STATUS_TABS = [
    { value: 'ALL', label: 'All open', tone: 'all' },
    { value: 'SENDNOW', label: 'Send now', tone: 'overdue' },
    { value: 'DUE', label: 'Due', tone: 'sent' },
    { value: 'S2', label: '7+ days', tone: 'partial' },
    { value: 'S3', label: '15+ days', tone: 'outstanding' },
  ];
  /*
   * What is owed and how old it is. The oldest bucket is the one that decides
   * whether this is a collections problem or a timing one, so it gets a figure
   * of its own rather than being folded into the total.
   */
  const prHeadline = useMemo(() => {
    let outstanding = 0;
    let due = 0;
    let old = 0;
    let sendNow = 0;
    for (const r of rows) {
      const bal = Number(r.balance || 0);
      outstanding += bal;
      if (r.stage === 3) old += bal;
      else if (r.stage >= 1) due += bal;
      if (needsReminder(r.invoice, today)) sendNow += bal;
    }
    return { count: rows.length, outstanding, due, old, sendNow };
  }, [rows, today]);

  const prExportColumns = [
    { key: 'invoice', label: 'Invoice', value: (r) => r.invoice?.number || '' },
    { key: 'customer', label: 'Customer', value: (r) => r.invoice?.customerName || '' },
    { key: 'dueDate', label: 'Due date', value: (r) => r.invoice?.dueDate || '' },
    { key: 'overdueDays', label: 'Overdue days', value: (r) => r.overdueDays ?? '' },
    { key: 'balance', label: 'Balance', value: (r) => Number(r.balance || 0) },
    { key: 'stage', label: 'Stage', value: (r) => r.stage ?? '' },
  ];

  return (
    <DocumentListShell
      entity="customer"
      className="sales-list-page"
      title="Payment Reminders"
      company={currentCompany}
      search={{
        before: <select value={filter} onChange={(event) => setFilter(event.target.value)} className="ui-select ui-ctl-compact w-40" aria-label="Reminder stage">{PR_STATUS_TABS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select>,
        value: prSearch.query,
        onChange: prSearch.setQuery,
        placeholder: 'Search collectibles…',
        label: 'Search collectibles',
      }}
      moreItems={[exportMenuItem('Export collectibles')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Collectibles',
          fileName: `PaymentReminders_${currentCompany?.name || 'company'}`,
          label: 'collectible(s)',
          columns: prExportColumns,
          rows: shown,
        });
      }}
      cards={[
        { label: 'Open invoices', value: prHeadline.count, count: true, tone: 'draft', Icon: FileText },
        { label: 'Outstanding', value: prHeadline.outstanding, tone: 'sent', Icon: Receipt },
        { label: 'Due now', value: prHeadline.due, tone: 'outstanding', Icon: Bell },
        { label: '15+ days old', value: prHeadline.old, tone: 'overdue', Icon: Ban },
        { label: 'To chase today', value: prHeadline.sendNow, tone: 'partial', Icon: MessageCircle },
      ]}
      denseCards
    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Customer</th>
                <th scope="col">Due date</th>
                <th scope="col" className="ui-num">Overdue</th>
                <th scope="col" className="ui-num">Balance</th>
                <th scope="col">Stage</th>
                <th scope="col">Last reminder</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {shown.length === 0 ? (
                <tr>
                  <td colSpan="8">
                    <EmptyState
                      icon={Bell}
                      kind="new"
      title={rows.length ? 'Nothing to chase here' : 'Nothing to chase'}
                      description={
                        rows.length
                          ? 'No open invoice with a balance is at this stage.'
                          : 'Every invoice with a balance appears here on its own, oldest first — there is nothing to set up.'
                      }
                    />
                  </td>
                </tr>
              ) : (
              shown.map(({ invoice: inv, overdue, stage, balance }) => {
                const last = lastReminder(inv);
                return (
                  <tr key={inv.id}>
                    <td className="ui-col-id"><DocumentNumber value={inv.number} label="invoice" /></td>
                    <td className="ui-col-entity">{inv.customerName}</td>
                    <td className="ui-col-date"><DueDate value={inv.dueDate} balance={balance} /></td>
                    <td className="ui-col-amount ui-mono">{overdue > 0 ? `${overdue}d` : '—'}</td>
                    <td className="ui-col-amount"><SalesBalance value={balance} company={currentCompany} dueIso={inv.dueDate} /></td>
                    <td className="whitespace-nowrap"><StatusPill status={stageLabel(stage)} /></td>
                    <td className="ui-col-meta text-xs">{last ? `${last.date} · ${last.channel}` : 'Never'}</td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button type="button" onClick={() => sendWhatsApp(inv)} className="ui-btn ui-btn-secondary ui-btn-sm text-xs" title="WhatsApp">
                          <MessageCircle size={14} aria-hidden="true" /> WhatsApp
                        </button>
                        <button type="button" onClick={() => sendEmail(inv)} className="ui-icon-btn ui-btn-sm !w-8" aria-label="Email reminder" title="Email">
                          <Mail size={14} />
                        </button>
                        <button type="button" onClick={() => copyMessage(inv)} className="ui-icon-btn !h-8 !w-8" aria-label="Copy message" title="Copy message">
                          <Copy size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
              )}
            </tbody>
          </table>
      </div>
      <TableTotals
        count={shown.length}
        totalCount={rows.length}
        noun="invoices"
        figures={[{ label: 'To collect', value: formatMoney(prHeadline.outstanding, currentCompany) }]}
      />
    </DocumentListShell>
  );
}
