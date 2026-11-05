import { useEffect, useRef } from 'react';

import { hasApiSession, listDocsApi } from '../api/purchaseDocs';
import { listInvoicesApi } from '../api/invoices';
import {
  COLLECTION_FOR_KIND,
  listCustomers,
  listDeliveryChallans,
  listFixedAssets,
  listItems,
  listOrgMasters,
  listSalesmen,
  listVendors,
} from '../api/masters';
import { listPayments } from '../api/payments';
import { listBankBook } from '../api/bankBook';
import { listPosDayCloses } from '../api/posDayClose';
import { listSchedules } from '../api/recurring';
import { getFiscalYears, getJournalEntries, getLedgerAccounts } from '../api/ledger';

/**
 * Pull-hydration: documents saved to the server come BACK on a fresh browser.
 *
 * Write-through alone closed only half the localStorage risk — a new browser
 * profile still opened onto empty lists while the server held the books. On
 * sign-in this fetches every server-backed document kind and merges the ones
 * the local db does not know yet.
 *
 * Merge rules, deliberately additive:
 * - match by backend id first, then by document number — a doc the browser
 *   already has (it wrote it) is never duplicated;
 * - nothing local is ever deleted here. Legacy local-only documents stay
 *   until their owner deals with them; hydration must never eat data.
 */

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const mapCommon = (d, companyId, idKey) => ({
  companyId,
  [idKey]: d.id,
  number: d.number,
  date: d.date,
  dueDate: d.dueDate || '',
  refNo: d.refNo || '',
  refDate: d.refDate || '',
  status: d.status || 'Unpaid',
  subtotal: num(d.subtotal),
  cgstTotal: num(d.cgstTotal),
  sgstTotal: num(d.sgstTotal),
  igstTotal: num(d.igstTotal),
  gstTotal: num(d.gstTotal),
  total: num(d.total),
  /* Invoices call it `paidAmount`, bills and notes call it `settledAmount`.
     Reading only the second meant every hydrated invoice arrived showing
     nothing paid, however much had been received against it. */
  paidAmount: num(d.paidAmount ?? d.settledAmount),
  items: Array.isArray(d.items) ? d.items : [],
  partyId: d.partyId || '',
  description: d.description || '',
  tdsAmount: num(d.tdsAmount),
  tdsLedgerId: d.tdsLedgerId || '',
  tdsLedgerName: d.tdsLedgerName || '',
  placeOfSupplyState: d.placeOfSupplyState || '',
  taxType: d.taxType || '',
  /* Stock is counted per warehouse; a document arriving without one moved
     stock nowhere on this device's inventory screen. */
  warehouseId: d.warehouseId || '',
  createdAt: d.createdAt,
  hydratedFromServer: true,
});

const GST_REGISTRATION = {
  REGULAR: 'Registered',
  COMPOSITION: 'Composition',
  UNREGISTERED: 'Unregistered',
  SEZ: 'SEZ',
  OVERSEAS: 'Overseas',
};

/** A server party as the browser's books store one. */
const mapParty = (p, companyId) => ({
  companyId,
  backendPartyId: p.id,
  name: p.name || '',
  displayName: p.legalName || p.name || '',
  gstin: p.gstin || '',
  gstRegistration: GST_REGISTRATION[String(p.gstRegistrationType || '').toUpperCase()] || 'Unregistered',
  email: p.email || '',
  phone: p.phone || '',
  contactPerson: p.contactPerson || '',
  billingAddress: {
    line1: p.billingLine1 || '',
    line2: p.billingLine2 || '',
    city: p.billingCity || '',
    state: p.billingState || p.placeOfSupplyState || '',
    pincode: p.billingPincode || '',
    country: p.billingCountry || 'India',
  },
  openingBalance: num(p.openingBalance),
  openingBalanceType: p.openingBalanceType === 'CR' ? 'Cr' : 'Dr',
  balance: 0,
  hydratedFromServer: true,
});

const mapItem = (it, companyId) => ({
  companyId,
  backendItemId: it.id,
  code: it.code || '',
  name: it.name || '',
  description: it.description || '',
  type: String(it.itemType || '').toUpperCase() === 'SERVICE' ? 'Service' : 'Goods',
  unit: it.unit || 'Pcs',
  hsnSac: it.hsnSac || '',
  gstRate: num(it.gstRate),
  salePrice: num(it.salePrice),
  purchasePrice: num(it.purchasePrice),
  openingQty: num(it.openingQty),
  openingWarehouseId: it.openingWarehouseId || '',
  stock: num(it.openingQty),
  reorderLevel: num(it.reorderLevel),
  trackingType: String(it.trackBy || 'NONE').toUpperCase(),
  hydratedFromServer: true,
});

/**
 * Masters, fetched the same way documents are.
 *
 * Without these a browser that had never seen this company — a new machine, a
 * cleared site, a different URL for the same server — opened onto documents
 * with no customers, no vendors and no items behind them: the invoice list
 * showed a customer name because the invoice carries one, while the customer
 * list was empty and no new invoice could be raised against them.
 *
 * The chart of accounts is hydrated too, now that the browser no longer keeps
 * a copy of the books between visits. It used to accumulate in localStorage,
 * so by the time anybody opened a receipt the ledgers were already there; with
 * the working copy in memory the list started empty every load and the ledger
 * picker on a receipt had nothing in it. The server holds the real chart —
 * including the accounts payroll posts into — so that is where it comes from.
 */

/** ASSET → Asset, and which half of the statements it belongs to. */
const ACCOUNT_CLASS = {
  ASSET: ['Asset', 'Balance Sheet'],
  LIABILITY: ['Liability', 'Balance Sheet'],
  EQUITY: ['Equity', 'Balance Sheet'],
  INCOME: ['Income', 'P&L'],
  REVENUE: ['Income', 'P&L'],
  EXPENSE: ['Expense', 'P&L'],
};

const mapLedgerAccount = (a, companyId) => {
  const [type, main] = ACCOUNT_CLASS[String(a?.accountType || '').toUpperCase()] || ['Asset', 'Balance Sheet'];
  return {
    companyId,
    backendLedgerId: String(a.id),
    code: String(a.code || ''),
    name: String(a.name || ''),
    type,
    main,
    ledgerCategory: 'General',
    /* Left for normalizeDB, which puts an account in the right group and knows
       the local group ids this browser happens to have. */
    groupId: null,
    controlKind: a.controlKind || null,
    openingBalance: 0,
    balance: 0,
    isSystem: Boolean(a.controlKind),
    hiddenFromChart: false,
  };
};
const MASTER_KINDS = [
  ['customers', 'backendPartyId', listCustomers, (r) => r?.customers, mapParty],
  ['vendors', 'backendPartyId', listVendors, (r) => r?.vendors, mapParty],
  ['items', 'backendItemId', listItems, (r) => r?.items, mapItem],
  ['chartOfAccounts', 'backendLedgerId', getLedgerAccounts, (r) => r?.accounts || r?.ledgers, mapLedgerAccount],
];

/**
 * The six reference lists, hydrated by name the same way a customer is.
 *
 * They arrive from one endpoint keyed by kind, so unlike the masters above
 * there is nothing to fetch per collection — the rows are split on the way in.
 */
const REFERENCE_COLLECTIONS = Object.values(COLLECTION_FOR_KIND).map((collection) => [collection, 'backendMasterId']);

/**
 * Written through and never read back.
 *
 * A challan, a salesman and a fixed asset were each given a table so they would
 * stop living in one browser — and then nothing fetched them, which fixes only
 * half of the problem it was meant to fix: the server holds the record and a
 * fresh browser still opens onto an empty list.
 *
 * Payments are the worst of the four. They are created through the API and
 * never read back, so a new machine showed no receipts, no payments, and — now
 * that reconciliation exists — an empty book side against a full statement,
 * which would report every line as money nobody had recorded.
 */
const mapChallan = (d, companyId) => ({
  companyId,
  backendDocId: d.id,
  number: d.number,
  date: d.date,
  customerId: d.partyId || '',
  customerName: d.partyName || '',
  purpose: String(d.purpose || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase()),
  vehicleNo: d.vehicleNo || '',
  notes: d.notes || '',
  items: Array.isArray(d.items) ? d.items : [],
  value: num(d.total ?? d.subtotal),
  status: d.status || 'Open',
  warehouseId: d.warehouseId || '',
  createdAt: d.createdAt,
  hydratedFromServer: true,
});

const mapSalesman = (r, companyId) => ({
  companyId,
  backendSalesmanId: r.id,
  name: r.name,
  phone: r.phone || '',
  email: r.email || '',
  commissionPct: num(r.commissionRate),
  active: r.isActive !== false,
  createdAt: r.createdAt,
  hydratedFromServer: true,
});

const mapFixedAsset = (r, companyId) => ({
  companyId,
  backendAssetId: r.id,
  name: r.name,
  category: r.category || '',
  purchaseDate: r.purchaseDate || '',
  cost: num(r.cost),
  salvageValue: num(r.salvageValue),
  method: r.depreciationMethod || '',
  rate: num(r.depreciationRate),
  usefulLifeYears: r.usefulLifeYears ?? null,
  accumulatedDepreciation: num(r.accumulatedDepreciation),
  status: r.status || 'Active',
  createdAt: r.createdAt,
  hydratedFromServer: true,
});

/**
 * A manual journal entry as the Journal screen stores one.
 *
 * Only the ones somebody keyed by hand. Every other entry in the ledger was
 * posted by the document that caused it — an invoice, a receipt — and those
 * documents are hydrated in their own right; bringing their postings across as
 * well would show the same transaction twice on the Journal screen.
 */
const mapJournalEntry = (e, companyId) => ({
  companyId,
  backendEntryId: e.id,
  number: e.entryNo || '',
  date: String(e.date || '').slice(0, 10),
  narration: e.narration || '',
  lines: (Array.isArray(e.lines) ? e.lines : []).map((l) => ({
    accountName: l.ledgerAccount?.name || '',
    accountCode: l.ledgerAccount?.code || '',
    serverLedgerAccountId: l.ledgerAccountId || null,
    debit: num(l.debit),
    credit: num(l.credit),
    narration: l.description || '',
  })),
  totalDebit: num((e.lines || []).reduce((t, l) => t + num(l.debit), 0)),
  totalCredit: num((e.lines || []).reduce((t, l) => t + num(l.credit), 0)),
  status: e.status || 'POSTED',
  // A contra's reconciliation lives on the server now; without it a
  // reconciled contra read unreconciled after every reload.
  reconciled: e.reconciled === true,
  bankDate: e.bankDate ? String(e.bankDate).slice(0, 10) : null,
  statementRef: e.statementRef || '',
  createdAt: e.createdAt,
  hydratedFromServer: true,
});

/**
 * A recurring schedule as the browser's screen stores one.
 *
 * The server owns the schedule and raises its invoices; the local row exists so
 * the screen keeps working. `active` rather than `isActive` because that is
 * what the screen has always called it.
 */
const mapSchedule = (r, companyId) => ({
  companyId,
  backendScheduleId: r.id,
  name: r.name || '',
  customerId: r.partyId || '',
  customerName: r.partyName || '',
  branchId: r.branchId || '',
  warehouseId: r.warehouseId || '',
  frequency: r.frequency || 'MONTHLY',
  interval: Number(r.interval) || 1,
  nextRunDate: r.nextRunDate || '',
  endDate: r.endDate || null,
  maxOccurrences: r.maxOccurrences ?? null,
  generatedCount: Number(r.generatedCount) || 0,
  dueDays: Number.isFinite(Number(r.dueDays)) ? Number(r.dueDays) : 30,
  active: r.isActive !== false,
  notes: r.notes || '',
  items: Array.isArray(r.template?.items) ? r.template.items : [],
  subtotal: num(r.template?.subtotal),
  cgstTotal: num(r.template?.cgstTotal),
  sgstTotal: num(r.template?.sgstTotal),
  igstTotal: num(r.template?.igstTotal),
  gstTotal: num(r.template?.gstTotal),
  total: num(r.template?.total),
  lastRunAt: r.lastRunAt || null,
  createdAt: r.createdAt,
  hydratedFromServer: true,
});

/**
 * A cash or bank book line as the browser stores one.
 *
 * `cashBankAccountId` and `ledgerId` are the browser's own numeric chart ids
 * and mean nothing on the server, so what comes back carries the server ledger
 * ids and the cash-book screen resolves them against its chart. A line whose
 * account cannot be resolved locally is still hydrated — losing it would be
 * worse than showing it under an account the browser has not caught up with.
 */
const mapBankEntry = (r, companyId) => ({
  companyId,
  backendBankEntryId: r.id,
  serverLedgerAccountId: r.ledgerAccountId,
  serverContraLedgerAccountId: r.contraLedgerAccountId || null,
  date: String(r.date || '').slice(0, 10),
  direction: String(r.direction || 'IN').toUpperCase(),
  amount: num(r.amount),
  narration: r.narration || '',
  description: r.narration || '',
  reference: r.reference || '',
  source: r.source || 'MANUAL',
  reconciled: r.reconciled === true,
  bankDate: r.bankDate || null,
  statementRef: r.statementRef || '',
  createdAt: r.createdAt,
  hydratedFromServer: true,
});

/**
 * A payment as the browser's books store one.
 *
 * `reconciled` comes across because the reconciliation screen reads it: a
 * payment already tied off against a statement must not be offered again on
 * the next machine that opens the book.
 */
const mapPayment = (p, companyId) => ({
  companyId,
  backendPaymentId: p.id,
  id: p.id,
  number: p.number || '',
  date: String(p.date || '').slice(0, 10),
  voucherType: String(p.direction || '').toUpperCase() === 'RECEIPT' ? 'receipt' : 'payment',
  amount: num(p.amount),
  partyName: p.partyName || '',
  customerName: String(p.partyType || '') === 'CUSTOMER' ? p.partyName || '' : '',
  vendorName: String(p.partyType || '') === 'VENDOR' ? p.partyName || '' : '',
  ledgerAccountId: p.ledgerAccountId || '',
  notes: p.notes || '',
  reconciled: p.reconciled === true,
  bankDate: p.bankDate || null,
  statementRef: p.statementRef || '',
  createdAt: p.createdAt,
  hydratedFromServer: true,
});

/**
 * [db collection, backend id field, fetcher, pick, mapper]
 *
 * Split by what makes a row the same row. A challan carries a number, so a
 * challan the browser wrote is recognised by it; a salesman has only a name.
 * Getting that wrong duplicates: the same person under two ids, and a
 * commission report that counts their invoices once each.
 */
const WRITE_THROUGH_BY_NUMBER = [
  ['deliveryChallans', 'backendDocId', listDeliveryChallans, (r) => r?.documents, mapChallan],
];

const WRITE_THROUGH_BY_NAME = [
  ['recurringTemplates', 'backendScheduleId', listSchedules, (r) => r?.schedules, mapSchedule],
  ['salesmen', 'backendSalesmanId', listSalesmen, (r) => r?.salesmen, mapSalesman],
  ['fixedAssets', 'backendAssetId', listFixedAssets, (r) => r?.assets, mapFixedAsset],
];

const WRITE_THROUGH_KINDS = [...WRITE_THROUGH_BY_NUMBER, ...WRITE_THROUGH_BY_NAME];

/** kind → [db collection, backend id field, party field, extra mapper] */
const KINDS = [
  ['bill', 'bills', 'backendDocId', 'vendorName', null],
  ['expense', 'expenses', 'backendDocId', 'vendorName', (d) => ({ category: d.category || '', description: d.description || '', taxableTotal: num(d.subtotal) })],
  ['estimate', 'estimates', 'backendDocId', 'customerName', (d) => ({ validUntil: d.validUntil || '' })],
  ['purchaseOrder', 'purchaseOrders', 'backendDocId', 'vendorName', (d) => ({ expectedDate: d.expectedDate || '', warehouseId: d.warehouseId || '' })],
  ['salesOrder', 'salesOrders', 'backendDocId', 'customerName', (d) => ({ expectedDate: d.expectedDate || '', warehouseId: d.warehouseId || '' })],
  ['creditNote', 'creditNotes', 'backendDocId', 'customerName', (d) => ({ originalInvoiceNumber: d.refNo || '', customerGstin: d.partyGstin || '' })],
  ['debitNote', 'debitNotes', 'backendDocId', 'vendorName', (d) => ({ originalBillNumber: d.refNo || '', vendorGstin: d.partyGstin || '' })],
];

export function useServerDocSync({ enabled, currentCompanyId, setDb }) {
  // One sync per session per company: hydration is a boot concern, not a poll.
  const syncedFor = useRef('');

  useEffect(() => {
    const key = String(currentCompanyId || '');
    if (!enabled || !key || !hasApiSession()) return;
    if (syncedFor.current === key) return;
    syncedFor.current = key;

    /**
     * The claim above is released again if this run does not finish.
     *
     * It used to be permanent, and the run that made it almost never got to
     * use it: the effect is set up, torn down and set up again during boot
     * (React's development remount, and again when the company id arrives),
     * so the run holding the claim was cancelled while its fetches were still
     * in the air and dropped every document it had just downloaded. Each
     * later run then found the key already claimed and returned immediately.
     * The result was hydration that never once merged anything — an invoice,
     * a customer and a payment sat on the server, and the browser showed
     * empty lists with no way to ever see them.
     */
    let cancelled = false;
    let merged = false;

    (async () => {
      const collected = {};

      /*
       * Every request starts now, together; the results are still applied one
       * by one in the order below.
       *
       * They used to be awaited one after another — about twenty round trips
       * in a row, so opening the app took four seconds of waiting on requests
       * the server answers in milliseconds. The order of *applying* them still
       * matters (org masters add to collections the master lists create), so
       * only the waiting is parallel. `start` attaches a no-op catch so a
       * failure is not reported as unhandled before its turn comes; the await
       * below still throws into that section's own try/catch.
       */
      const start = (fn) => {
        const p = Promise.resolve().then(fn);
        p.catch(() => {});
        return p;
      };
      const docsPending = KINDS.map(([kind]) => start(() => listDocsApi(kind)));
      const mastersPending = [...MASTER_KINDS, ...WRITE_THROUGH_KINDS].map(([, , fetcher]) => start(fetcher));
      const closesPending = start(listPosDayCloses);
      const yearsPending = start(getFiscalYears);
      const journalPending = start(() => getJournalEntries(500));
      const bankPending = start(listBankBook);
      const receiptsPending = start(() => listPayments({ direction: 'RECEIPT' }));
      const paidPending = start(() => listPayments({ direction: 'PAYMENT' }));
      const orgMastersPending = start(listOrgMasters);
      const invoicesPending = start(listInvoicesApi);

      for (const [i, [, collection, idKey, partyField, extra]] of KINDS.entries()) {
        try {
          const docs = await docsPending[i];
          collected[collection] = docs.map((d) => ({
            ...mapCommon(d, currentCompanyId, idKey),
            [partyField]: d.partyName || '',
            partyGstin: d.partyGstin || '',
            ...(extra ? extra(d) : {}),
          }));
        } catch {
          // A kind that fails (permissions, feature off) hydrates nothing;
          // the rest still land.
        }
      }

      for (const [i, [collection, , , pick, mapper]] of [...MASTER_KINDS, ...WRITE_THROUGH_KINDS].entries()) {
        try {
          const rows = pick(await mastersPending[i]) || [];
          collected[collection] = rows.map((r) => mapper(r, currentCompanyId));
        } catch {
          // Same rule as the documents: what does not arrive hydrates nothing.
        }
      }

      try {
        /*
         * The till counts, so the owner can review them anywhere.
         *
         * A day closed at the counter looked never closed on the back-office
         * machine, and the over/short figure — the point of the exercise — was
         * only ever on the till that produced it.
         */
        const closes = (await closesPending)?.dayCloses || [];
        collected.posDayCloses = closes.map((d) => ({
          companyId: currentCompanyId,
          backendDayCloseId: String(d.id),
          date: String(d.date || '').slice(0, 10),
          invoices: num(d.invoices),
          cash: num(d.cash),
          upi: num(d.upi),
          card: num(d.card),
          total: num(d.total),
          countedCash: num(d.countedCash),
          overShort: num(d.overShort),
          denomCounts: d.denomCounts && typeof d.denomCounts === 'object' ? d.denomCounts : {},
          closedAt: d.closedAt,
          hydratedFromServer: true,
        }));
      } catch {
        /* same rule: what does not arrive hydrates nothing */
      }

      try {
        /*
         * How far the books are closed, as the server holds it.
         *
         * The server is what refuses a posting into a closed period, so its
         * answer is the real one. Without this, a year closed on one machine
         * looked open on every other — the screen would offer to close it
         * again and the postings would be refused with no explanation.
         */
        const years = (await yearsPending)?.fiscalYears || [];
        const lockedThrough = years
          .map((y) => String(y?.lockedThrough || '').slice(0, 10))
          .filter(Boolean)
          .sort()
          .pop();
        if (lockedThrough) collected.fyLocks = [{ companyId: currentCompanyId, upTo: lockedThrough }];
      } catch {
        /* same rule: what does not arrive hydrates nothing */
      }

      try {
        /*
         * Manual journals only. Everything else in the ledger was posted by a
         * document that is hydrated in its own right, so pulling those across
         * would list the same transaction twice.
         *
         * An entry posted by another application — payroll's salary journal —
         * is deliberately not copied here either. It belongs to the books, not
         * to this browser's working copy, and the reports that must show it
         * read the ledger from the server rather than recomputing it locally.
         * Copying it in would also put an entry this app did not write behind
         * this app's edit and delete buttons.
         */
        const journal = (await journalPending)?.entries || [];
        collected.journalEntries = journal
          .filter((e) => String(e.sourceDocType || '') === 'MANUAL')
          .map((e) => mapJournalEntry(e, currentCompanyId));
      } catch {
        /* same rule: what does not arrive hydrates nothing */
      }

      try {
        const entries = (await bankPending)?.entries || [];
        collected.bankTransactions = entries.map((r) => mapBankEntry(r, currentCompanyId));
      } catch {
        /* same rule: what does not arrive hydrates nothing */
      }

      try {
        /*
         * Both directions. `listPayments` defaults to receipts, so asking once
         * would have hydrated the money coming in and quietly left out the
         * money going out.
         */
        const [receipts, paid] = await Promise.all([
          receiptsPending.catch(() => []),
          paidPending.catch(() => []),
        ]);
        collected.payments = [...receipts, ...paid].map((p) => mapPayment(p, currentCompanyId));
      } catch {
        /* same rule: what does not arrive hydrates nothing */
      }

      try {
        const rows = (await orgMastersPending)?.masters || [];
        for (const r of rows) {
          const collection = COLLECTION_FOR_KIND[r.kind];
          if (!collection) continue;
          if (!collected[collection]) collected[collection] = [];
          collected[collection].push({
            // `data` first so a stored payload can never overwrite the identity
            // the server keeps in its own columns.
            ...(r.data && typeof r.data === 'object' ? r.data : {}),
            companyId: currentCompanyId,
            backendMasterId: r.id,
            name: r.name,
            active: r.isActive !== false,
            hydratedFromServer: true,
          });
        }
      } catch {
        /* same rule: what does not arrive hydrates nothing */
      }

      try {
        const invoices = await invoicesPending;
        collected.invoices = invoices.map((d) => ({
          ...mapCommon(d, currentCompanyId, 'backendInvoiceId'),
          customerName: d.partyName || d.customerName || '',
          customerId: d.partyId || d.customerId || '',
          // The returns read these; without them every hydrated sale looked like B2C.
          customerGstin: d.customerGstin || '',
          supplyType: d.supplyType || '',
          reverseCharge: Boolean(d.reverseCharge),
        }));
      } catch {
        /* same: partial hydration beats none */
      }

      if (cancelled) return;

      setDb((prev) => {
        const next = { ...prev };

        /*
         * Settlement converges into documents the browser already holds.
         *
         * Everything else here is insert-only, deliberately: a document this
         * browser knows is not replaced wholesale, because its local copy may
         * carry edits that have not been submitted and this is not the place
         * to decide whose version of a whole document wins.
         *
         * How much has been paid is different. The server decides that now,
         * from the allocations it holds, so a receipt recorded on another
         * device leaves this browser showing a stale balance until it is told.
         * Only those two fields move, and only on rows that carry a server id
         * — a document that has never reached the server has no counterpart to
         * converge with and is left completely alone.
         */
        const SETTLEMENT_STATUSES = new Set(['unpaid', 'partially paid', 'partial', 'paid', 'overdue']);
        const reconcileSettlement = (collection, idKey) => {
          const incoming = collected[collection];
          if (!incoming || !incoming.length) return;
          const existing = Array.isArray(prev[collection]) ? prev[collection] : [];
          if (!existing.length) return;

          const fromServer = new Map();
          for (const d of incoming) {
            const id = String(d?.[idKey] || '').trim();
            if (id) fromServer.set(id, d);
          }

          let touched = false;
          const merged = existing.map((row) => {
            const id = String(row?.[idKey] || '').trim();
            if (!id) return row; // never sent to the server: not ours to change
            const server = fromServer.get(id);
            if (!server) return row;

            const serverPaid = num(server.paidAmount);
            const localPaid = num(row.paidAmount);
            const localStatus = String(row.status || '').trim();
            const serverStatus = String(server.status || '').trim();

            /* A status that describes where the document is in its life, not
               how much of it is paid, is left as it stands on both sides —
               a locally cancelled document must not be reopened by a sync,
               and a settlement status must not overwrite one. */
            const statusIsSettlement =
              SETTLEMENT_STATUSES.has(localStatus.toLowerCase()) &&
              SETTLEMENT_STATUSES.has(serverStatus.toLowerCase());

            const nextStatus = statusIsSettlement && serverStatus !== localStatus ? serverStatus : localStatus;
            /* Decreases matter as much as increases: a reversed receipt has to
               reopen the document, so this is a straight assignment and never
               a max(). */
            const paidChanged = serverPaid !== localPaid;
            if (!paidChanged && nextStatus === localStatus) return row;

            touched = true;
            return { ...row, paidAmount: serverPaid, status: nextStatus };
          });

          if (touched) next[collection] = merged;
        };

        reconcileSettlement('invoices', 'backendInvoiceId');
        for (const [, collection, idKey] of KINDS) reconcileSettlement(collection, idKey);

        for (const [collection, idKey] of [...MASTER_KINDS, ...REFERENCE_COLLECTIONS, ...WRITE_THROUGH_BY_NAME]) {
          const incoming = collected[collection];
          if (!incoming || !incoming.length) continue;
          const existing = Array.isArray(prev[collection]) ? prev[collection] : [];
          const knownIds = new Set(existing.map((x) => String(x?.[idKey] || '')).filter(Boolean));
          // Masters have no document number, so the second test is the name —
          // a customer the browser already knows must not arrive twice under
          // two ids and split their ledger in half.
          const knownNames = new Set(
            existing
              .filter((x) => x.companyId === currentCompanyId)
              .map((x) => String(x?.name || '').trim().toLowerCase())
              .filter(Boolean)
          );
          let nextId = existing.reduce((m, x) => Math.max(m, Number(x?.id) || 0), 0);
          const fresh = incoming
            .filter(
              (d) =>
                !knownIds.has(String(d[idKey])) && !knownNames.has(String(d.name || '').trim().toLowerCase())
            )
            // An item is known by its server id (utils/itemIdentity.js): a
            // load-order number shifted whenever an earlier-sorting item was
            // added, and every stored line with it.
            .map((d) => ({ ...d, id: collection === 'items' && d[idKey] ? String(d[idKey]) : ++nextId }));
          if (fresh.length) next[collection] = [...existing, ...fresh];
        }

        /*
         * A day close is identified by the day it closes.
         *
         * It has no number of its own, and the server allows one per day, so
         * matching on the date is what keeps a close made at the counter from
         * arriving again as a second close of the same day.
         */
        if (collected.posDayCloses?.length) {
          const existing = Array.isArray(prev.posDayCloses) ? prev.posDayCloses : [];
          const mine = new Set(
            existing
              .filter((r) => r.companyId === currentCompanyId)
              .map((r) => String(r.date || '').slice(0, 10))
          );
          let nextId = existing.reduce((m, r) => Math.max(m, Number(r?.id || 0)), 0);
          const fresh = collected.posDayCloses
            .filter((r) => !mine.has(r.date))
            .map((r) => ({ ...r, id: ++nextId }));
          if (fresh.length) next.posDayCloses = [...existing, ...fresh];
        }

        /*
         * The lock is one row per company and the server's answer wins: it is
         * the book that actually refuses the posting. Appending it the way
         * documents are appended would leave a stale local lock beside it and
         * two different answers to "how far are the books closed".
         */
        if (collected.fyLocks) {
          const others = (Array.isArray(prev.fyLocks) ? prev.fyLocks : []).filter(
            (l) => l.companyId !== currentCompanyId
          );
          const mine = (Array.isArray(prev.fyLocks) ? prev.fyLocks : []).find(
            (l) => l.companyId === currentCompanyId
          );
          next.fyLocks = [...others, { ...(mine || {}), ...collected.fyLocks[0] }];
        }

        for (const [, collection, idKey] of [
          ...KINDS,
          ['invoice', 'invoices', 'backendInvoiceId'],
          ['deliveryChallan', 'deliveryChallans', 'backendDocId'],
          // A payment's number is its voucher number, which is exactly what
          // makes two rows the same payment.
          ['payment', 'payments', 'backendPaymentId'],
          // A bank book line has no number of its own, so the server id is the
          // only test — which is right: two identical charges on one day are
          // two charges, not one recorded twice.
          ['bankBookEntry', 'bankTransactions', 'backendBankEntryId'],
          // A journal carries its own number, so that is the second test after
          // the server id.
          ['journalEntry', 'journalEntries', 'backendEntryId'],
        ]) {
          const incoming = collected[collection];
          if (!incoming || !incoming.length) continue;
          const existing = Array.isArray(prev[collection]) ? prev[collection] : [];
          const knownIds = new Set(existing.map((x) => String(x?.[idKey] || '')).filter(Boolean));
          const knownNumbers = new Set(
            existing
              .filter((x) => x.companyId === currentCompanyId)
              .map((x) => String(x?.number || '').trim())
              .filter(Boolean)
          );
          let nextId = existing.reduce((m, x) => Math.max(m, Number(x?.id) || 0), 0);
          const fresh = incoming
            .filter((d) => !knownIds.has(String(d[idKey])) && !knownNumbers.has(String(d.number).trim()))
            .map((d) => ({ ...d, id: ++nextId }));
          if (fresh.length) next[collection] = [...existing, ...fresh];
        }
        return next;
      });
      merged = true;
    })();

    return () => {
      cancelled = true;
      // Cancelled before it merged: give the claim back so the next run redoes
      // the work, rather than leaving the session permanently un-hydrated.
      if (!merged) syncedFor.current = '';
    };
  }, [enabled, currentCompanyId, setDb]);
}
