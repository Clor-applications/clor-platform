import React, { useMemo, useRef, useState } from 'react';
import { BarChart3, Clock3, List, RotateCcw, Settings, ShoppingCart, SlidersHorizontal, X } from 'lucide-react';
import { notify } from '@ui/components/ui/notify';
import { computeGstForLines } from '@ui/utils/gst';
import { formatMoney } from '@ui/utils/money';
import { checkoutErrorCode, newCheckoutId, posCheckoutApi } from '../../api/posCheckout';
import { createPosDayClose } from '@ui/api/posDayClose';
import { hasApiSession } from '@ui/api/purchaseDocs';
import { bumpCompanyNextNumber, getDocSettings } from '@ui/utils/docSettings';
import DocNumberingPopover from '@ui/components/DocNumberingPopover';

/**
 * Point of sale — the fast lane for counter sales. Search or tap items, take
 * cash/UPI/card, done.
 *
 * The server rings the sale up, as one transaction: invoice, sale posting,
 * receipt into the account this branch configured for the tender, allocation,
 * receipt posting, settlement. What this screen keeps locally afterwards is a
 * projection of that — the server's numbers and ids, not a second set of books.
 * It used to be the other way round: the invoice went to the server marked
 * Paid, the receipt lived only here, and the ledger carried the sale as still
 * owed.
 */

/** The three the counter takes, in the spelling the books use. */
const TENDERS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'UPI', label: 'UPI' },
  { key: 'CARD', label: 'Card' },
];
const tenderLabel = (key) => TENDERS.find((t) => t.key === String(key || '').toUpperCase())?.label || 'Cash';
function PosBillingScreen({ db, setDb, currentCompany }) {
  /* The POS series has no number field to hang its gear on — a sale takes its
     number the moment it is rung up — so the gear sits in the header and
     opens the same series panel every numbered form carries. */
  const numberingBtnRef = useRef(null);
  const [numberingOpen, setNumberingOpen] = useState(false);
  const posBranchId = String(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '').trim() || null;
  const posNumbering = getDocSettings(db, currentCompany, { branchId: posBranchId })?.numbering?.pos;

  const companyId = currentCompany.id;
  const items = useMemo(
    () => (db.items || []).filter((i) => i.companyId === companyId && Number(i.salePrice || 0) > 0),
    [db.items, companyId]
  );

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]); // {itemId, name, rate, gstRate, qty}
  const [tender, setTender] = useState('CASH');
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [heldBills, setHeldBills] = useState([]);
  const [busy, setBusy] = useState(false);
  /*
   * One id per checkout attempt, and the same one on the retry.
   *
   * Minted the first time Charge is pressed for this cart, kept through a
   * failed call, and let go only when the server confirms the sale or the
   * cart is deliberately emptied. A till whose network drops after the server
   * has committed sends the same id again and is handed the sale that exists,
   * rather than taking the customer's money twice. A ref, not persisted: the
   * cart itself does not survive a reload, so there is nothing to retry after
   * one, and an id that outlived its cart could claim another customer's sale.
   */
  const checkoutIdRef = useRef('');
  const [dayCloseOpen, setDayCloseOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState(0);
  const [differenceReason, setDifferenceReason] = useState('');
  const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];
  const [denomCounts, setDenomCounts] = useState({});

  const today = new Date().toISOString().slice(0, 10);
  const todaysSales = useMemo(
    () => (db.invoices || []).filter((i) => i.companyId === companyId && i.posSale && i.date === today && String(i.status).toLowerCase() !== 'cancelled'),
    [db.invoices, companyId, today]
  );
  const byTender = useMemo(() => {
    /* Keyed by the label the day close prints. Sales the old till wrote carry
       "Cash"; sales the server rings up carry "CASH"; a day can hold both, and
       the count must not split them. */
    const m = { Cash: 0, UPI: 0, Card: 0 };
    for (const s of todaysSales) {
      const label = tenderLabel(s.tender);
      m[label] = (m[label] || 0) + Number(s.total || 0);
    }
    return m;
  }, [todaysSales]);
  const recentCloses = useMemo(
    () =>
      (db.posDayCloses || [])
        .filter((r) => r.companyId === companyId)
        .slice()
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 14),
    [db.posDayCloses, companyId]
  );

  const countedCash = DENOMS.reduce((s, d) => s + d * (Number(denomCounts[d]) || 0), 0);
  const expectedCash = Number(openingCash || 0) + byTender.Cash;
  const overShort = Math.round((countedCash - expectedCash) * 100) / 100;

  const saveDayClose = async () => {
    const nextId = (db.posDayCloses || []).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    const record = {
      id: nextId,
      companyId,
      date: today,
      invoices: todaysSales.length,
      cash: byTender.Cash,
      upi: byTender.UPI,
      card: byTender.Card,
      total: byTender.Cash + byTender.UPI + byTender.Card,
      countedCash,
      openingCash: Number(openingCash || 0),
      differenceReason: differenceReason.trim(),
      overShort,
      denomCounts: { ...denomCounts },
      closedAt: new Date().toISOString(),
    };
    /*
     * Sent to the server, because the over/short figure is a cash control: the
     * owner reviews it, and the cashier cannot be the only person holding it.
     * A day already closed comes back as the close that stands rather than a
     * second one, so a double press does not count the till twice.
     */
    let serverPatch = {};
    if (hasApiSession()) {
      try {
        const saved = await createPosDayClose({
          date: today,
          invoices: record.invoices,
          cash: record.cash,
          upi: record.upi,
          card: record.card,
          total: record.total,
          countedCash: record.countedCash,
          overShort: record.overShort,
          denomCounts: Object.fromEntries(
            Object.entries(denomCounts).map(([d, n]) => [d, Number(n) || 0])
          ),
        });
        if (saved?.dayClose?.id) serverPatch = { backendDayCloseId: String(saved.dayClose.id) };
        if (saved?.alreadyClosed) notify.error(`${today} was already closed — showing the count that stands.`);
      } catch (e) {
        notify.error(`Closed on this till only — the server refused it: ${String(e?.message || e)}`);
      }
    }

    setDb((prev) => ({ ...prev, posDayCloses: [...(prev.posDayCloses || []), { ...record, ...serverPatch }] }));

    const w = window.open('', '_blank', 'width=380,height=640');
    if (w) {
      w.document.write(
        `<pre style="font-family:monospace;font-size:12px;padding:12px">` +
          `${currentCompany.name}\nZ REPORT · ${today}\n` +
          `--------------------------------\n` +
          `Invoices     ${record.invoices}\n` +
          `Cash         ${record.cash.toFixed(2)}\nUPI          ${record.upi.toFixed(2)}\nCard         ${record.card.toFixed(2)}\n` +
          `TOTAL        ${record.total.toFixed(2)}\n` +
          `--------------------------------\n` +
          `Counted cash ${countedCash.toFixed(2)}\nExpected     ${record.cash.toFixed(2)}\n` +
          `${overShort === 0 ? 'TALLIED' : overShort > 0 ? `OVER  +${overShort.toFixed(2)}` : `SHORT ${overShort.toFixed(2)}`}\n` +
          `</pre>`
      );
      w.document.close();
      w.print();
    }
    setDayCloseOpen(false);
    setDenomCounts({});
    setDifferenceReason('');
    notify.success(`Day closed — ${record.invoices} sale(s), ${overShort === 0 ? 'cash tallied' : overShort > 0 ? `over by ₹${overShort}` : `short by ₹${-overShort}`}.`);
  };

  const filtered = items.filter(
    (i) =>
      !search ||
      String(i.name || '').toLowerCase().includes(search.toLowerCase()) ||
      String(i.code || '').toLowerCase().includes(search.toLowerCase()) ||
      String(i.barcode || '').toLowerCase() === search.toLowerCase()
  );

  /**
   * Barcode scanners are keyboards that type fast and press Enter. Enter in
   * the search box with an exact barcode/code match adds the item and clears
   * the box, so back-to-back scans just work.
   */
  const onSearchKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = search.trim().toLowerCase();
    if (!term) return;
    const hit =
      items.find((i) => String(i.barcode || '').toLowerCase() === term) ||
      items.find((i) => String(i.code || '').toLowerCase() === term) ||
      (filtered.length === 1 ? filtered[0] : null);
    if (hit) {
      addToCart(hit);
      setSearch('');
    } else {
      notify.error(`No item matches "${search.trim()}"`);
    }
  };

  /*
   * Any change to the cart is a different sale, so the attempt id goes with
   * it. Keeping it would let a retry after an edit be answered with the sale
   * the server committed for the cart as it WAS — a receipt for the wrong
   * goods. If a response really was lost and the till edits the cart, the
   * committed sale is still in the server's books and hydrates from there;
   * what the till rings up next is a second, genuine sale.
   */
  const cartChanged = () => {
    checkoutIdRef.current = '';
  };

  const addToCart = (item) => {
    cartChanged();
    setCart((prev) => {
      const existing = prev.find((c) => c.itemId === item.id);
      if (existing) return prev.map((c) => (c.itemId === item.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { itemId: item.id, name: item.name, rate: Number(item.salePrice || 0), gstRate: Number(item.gstRate || 0), discount: 0, qty: 1 }];
    });
  };
  const drop = (itemId) => {
    cartChanged();
    setCart((prev) => prev.filter((c) => c.itemId !== itemId));
  };
  const editLine = (itemId, key, value) => {
    cartChanged();
    setCart((prev) => prev.map((c) => c.itemId === itemId ? { ...c, [key]: Math.max(0, Number(value) || 0) } : c));
  };
  const holdBill = () => {
    if (!cart.length) return notify.error('Add an item before holding the bill.');
    setHeldBills((prev) => [...prev, { id: newCheckoutId(), cart, customerName, customerMobile, heldAt: new Date().toISOString() }]);
    setCart([]);
    setCustomerName('');
    setCustomerMobile('');
    checkoutIdRef.current = '';
    notify.success('Bill held for recall.');
  };
  const recallBill = () => {
    const held = heldBills.at(-1);
    if (!held) return notify.error('There are no held bills.');
    setCart(held.cart);
    setCustomerName(held.customerName);
    setCustomerMobile(held.customerMobile);
    setHeldBills((prev) => prev.slice(0, -1));
    checkoutIdRef.current = '';
  };

  // Walk-in sales are intra-state by definition — the buyer is at the counter.
  const computed = computeGstForLines({
    lines: cart.map((c) => ({ itemId: String(c.itemId), description: c.name, quantity: c.qty, rate: c.rate, discount: c.discount, discountType: 'PERCENT', gstRate: c.gstRate })),
    isIntra: true,
  });

  const checkout = async () => {
    if (!cart.length) {
      notify.error('Cart is empty');
      return;
    }
    if (!hasApiSession()) {
      notify.error('Sign in to ring up a sale — the counter records money on the server, not in this browser.');
      return;
    }
    setBusy(true);
    try {
      const buyer = customerName.trim() || 'Walk-in Customer';
      const activeBranchId = String(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '').trim();
      const today = new Date().toISOString().slice(0, 10);

      if (!checkoutIdRef.current) checkoutIdRef.current = newCheckoutId();
      const checkoutId = checkoutIdRef.current;

      let sale;
      try {
        sale = await posCheckoutApi({
          checkoutId,
          tender,
          date: today,
          customerName: buyer,
          customerMobile: customerMobile.trim() || undefined,
          warehouseId: String(localStorage.getItem('activeWarehouseId') || '').trim() || undefined,
          taxType: 'CGST_SGST',
          subtotal: computed.subtotal,
          cgstTotal: computed.cgstTotal,
          sgstTotal: computed.sgstTotal,
          igstTotal: 0,
          gstTotal: computed.gstTotal,
          total: computed.total,
          items: computed.lines,
        });
      } catch (err) {
        /* The cart and its checkout id both stay: pressing Charge again sends
           the same id, and a sale the server had already committed comes back
           as itself rather than as a second one. */
        const code = checkoutErrorCode(err);
        if (code === 'POS_TENDER_UNCONFIGURED') {
          notify.error(
            `${tenderLabel(tender)} cannot be taken at this counter yet. An administrator needs to set its account under ` +
              'Settings → Finance → POS Payment Accounts.'
          );
        } else if (code === 'POS_CHECKOUT_CONFLICT') {
          notify.error(`${String(err?.message || 'This sale is in a state the counter cannot complete.')} Do not retry it.`);
        } else {
          notify.error(String(err?.message || 'The sale did not go through. Nothing was recorded — try again.'));
        }
        return;
      }

      // Confirmed by the server: this attempt is finished with its id.
      checkoutIdRef.current = '';

      const number = sale.invoice.number;
      const nextInvId = (db.invoices || []).reduce((m, i) => Math.max(m, Number(i.id) || 0), 0) + 1;
      const nextPayId = (db.payments || []).reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1;

      /*
       * What stays in this browser is a projection of the sale the server just
       * rang up — its number, its ids, what it settled to. The invoice feeds
       * the day close (posSale, tender, total) and the invoice list; the
       * receipt row feeds the cash book and the dashboard. Neither is a second
       * accounting write: the server's payment carries the money, and this
       * row points at it.
       */
      const invoice = {
        id: nextInvId,
        companyId,
        backendInvoiceId: sale.invoice.id,
        number,
        date: today,
        dueDate: today,
        customerId: '',
        customerName: buyer,
        taxType: 'CGST_SGST',
        items: computed.lines,
        subtotal: computed.subtotal,
        cgstTotal: computed.cgstTotal,
        sgstTotal: computed.sgstTotal,
        igstTotal: 0,
        gstTotal: computed.gstTotal,
        total: computed.total,
        paidAmount: Number(sale.invoice.paidAmount || 0),
        status: sale.invoice.status,
        posSale: true,
        tender,
        customerMobile: customerMobile.trim(),
        // The counter this was rung up at, from the header — a POS sale takes
        // stock off a real shelf, so it has to say which one.
        branchId: activeBranchId || '',
        warehouseId: String(localStorage.getItem('activeWarehouseId') || '').trim(),
        createdAt: new Date().toISOString(),
      };
      const receipt = {
        id: nextPayId,
        companyId,
        backendPaymentId: sale.payment.id,
        voucherType: 'receipt',
        direction: 'IN',
        receiptNo: sale.payment.number,
        date: today,
        customerId: null,
        customerName: buyer,
        amount: Number(sale.payment.amount || computed.total),
        allocatedAmount: Number(sale.allocation.amount || computed.total),
        advanceAmount: 0,
        allocations: [{ voucherType: 'invoice', voucherId: nextInvId, documentNumber: number, amount: Number(sale.allocation.amount || computed.total) }],
        mode: tenderLabel(tender),
        ledgerAccountId: sale.payment.ledgerAccountId,
        notes: `POS sale ${number}`,
        sourceSystem: 'POS',
        sourceKey: checkoutId,
        createdAt: new Date().toISOString(),
      };

      setDb((prev) => ({
        ...prev,
        invoices: [...(prev.invoices || []), invoice],
        payments: [...(prev.payments || []), receipt],
        companies: bumpCompanyNextNumber({
          db: prev,
          companyId,
          voucherKey: 'pos',
          usedNumber: number,
          branchId: activeBranchId || null,
        }),
      }));

      // Print-friendly receipt.
      const w = window.open('', '_blank', 'width=380,height=600');
      if (w) {
        w.document.write(
          `<pre style="font-family:monospace;font-size:12px;padding:12px">` +
            `${currentCompany.name}\n${number} · ${today}\nCustomer: ${buyer}\n` +
            `--------------------------------\n` +
            computed.lines.map((l) => `${l.description}\n  ${l.quantity} x ${l.rate.toFixed(2)} = ${l.lineTotal.toFixed(2)}`).join('\n') +
            `\n--------------------------------\n` +
            `Subtotal  ${computed.subtotal.toFixed(2)}\nGST       ${computed.gstTotal.toFixed(2)}\nTOTAL     ${computed.total.toFixed(2)}\nPaid by   ${tenderLabel(tender)}\n\nThank you!` +
            `</pre>`
        );
        w.document.close();
        w.print();
      }

      setCart([]);
      setCustomerName('');
      setCustomerMobile('');
      notify.success(
        `${number} — ${formatMoney(computed.total, currentCompany)} received by ${tenderLabel(tender)}${sale.replayed ? ' (already recorded)' : ''}.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="ui-t-sec">Counter billing</h2><p className="ui-helper">Scan an item or search by name and code.</p></div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            ref={numberingBtnRef}
            onClick={() => setNumberingOpen((v) => !v)}
            className="ui-icon-btn !h-7 !w-7"
            aria-label="POS numbering settings"
            aria-haspopup="dialog"
            aria-expanded={numberingOpen}
      title="Numbering"
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setDayCloseOpen(true)} className="ui-btn ui-btn-secondary">
            Day Close ({todaysSales.length})
          </button>
        </div>
      </div>

      {numberingOpen ? (
        <DocNumberingPopover
          anchorRef={numberingBtnRef}
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          voucherKey="pos"
          title="POS numbering"
          sampleLabel="Next sale will be"
          manualLabel="Typed on each sale"
          branchId={posBranchId}
          settings={posNumbering}
          onClose={() => setNumberingOpen(false)}
        />
      ) : null}

      {dayCloseOpen ? (
        <div className="ui-card space-y-4 p-5">
          <h3 className="ui-t-sec">Day close — {today}</h3>
          <div className="grid gap-3 sm:grid-cols-4 text-sm">
            <div className="ui-sunken rounded-lg p-3"><div className="ui-caption">Invoices</div><div className="ui-mono text-xl font-medium">{todaysSales.length}</div></div>
            <div className="ui-sunken rounded-lg p-3"><div className="ui-caption">Cash</div><div className="ui-money text-xl">{formatMoney(byTender.Cash, currentCompany)}</div></div>
            <div className="ui-sunken rounded-lg p-3"><div className="ui-caption">UPI</div><div className="ui-money text-xl">{formatMoney(byTender.UPI, currentCompany)}</div></div>
            <div className="ui-sunken rounded-lg p-3"><div className="ui-caption">Card</div><div className="ui-money text-xl">{formatMoney(byTender.Card, currentCompany)}</div></div>
          </div>

          <div>
            <label className="ui-label mb-3 block max-w-xs">Opening cash
              <input type="number" min="0" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} className="ui-input mt-1 w-full" />
            </label>
            <div className="ui-label mb-1">Cash denomination count</div>
            <div className="flex flex-wrap gap-2">
              {DENOMS.map((d) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <span className="ui-muted w-10 text-right">₹{d} ×</span>
                  <input
                    type="number"
                    min="0"
                    value={denomCounts[d] ?? ''}
                    onChange={(e) => setDenomCounts((p) => ({ ...p, [d]: e.target.value }))}
                    className="ui-input ui-btn-sm w-16 px-2 text-sm"
                    placeholder="0"
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 text-sm">
              Counted: <strong>{formatMoney(countedCash, currentCompany)}</strong> · Expected cash: <strong>{formatMoney(expectedCash, currentCompany)}</strong> ·{' '}
              {overShort === 0 ? (
                <span className="ui-amount-pos font-semibold">Tallied</span>
              ) : overShort > 0 ? (
                <span className="font-semibold">Over {formatMoney(overShort, currentCompany)}</span>
              ) : (
                <span className="ui-amount-neg font-semibold">Short {formatMoney(-overShort, currentCompany)}</span>
              )}
            </div>
          </div>

          {overShort !== 0 ? <label className="ui-label block">Reason for difference
            <textarea value={differenceReason} onChange={(e) => setDifferenceReason(e.target.value)} className="ui-input mt-1 min-h-16 w-full" required placeholder="Explain the cash short or excess" />
          </label> : null}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDayCloseOpen(false)} className="ui-btn ui-btn-secondary">Cancel</button>
            <button type="button" onClick={saveDayClose} disabled={overShort !== 0 && !differenceReason.trim()} className="ui-btn ui-btn-primary">Close day & print Z report</button>
          </div>
        </div>
      ) : null}

      {recentCloses.length ? (
        <div className="space-y-2">
          {/*
            * The counts, where somebody other than the till can read them. A
            * cash control nobody reviews is a number typed into a form: the
            * over/short is the whole point of counting the drawer.
            */}
          <h3 className="ui-t-sec">Recent day closes</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="ui-caption text-left">
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2 text-right">Invoices</th>
                <th className="px-3 py-2 text-right">Takings</th>
                <th className="px-3 py-2 text-right">Counted cash</th>
                <th className="px-3 py-2 text-right">Over / short</th>
              </tr>
            </thead>
            <tbody>
              {recentCloses.map((r) => (
                <tr key={r.id} className="ui-hover-sunken border-t ui-border-c">
                  <td className="px-3 py-2 ui-col-meta">{r.date}</td>
                  <td className="px-3 py-2 ui-mono text-right tabular-nums">{r.invoices || 0}</td>
                  <td className="px-3 py-2 ui-money text-right">{formatMoney(r.total || 0, currentCompany)}</td>
                  <td className="px-3 py-2 ui-money text-right">{formatMoney(r.countedCash || 0, currentCompany)}</td>
                  <td className="px-3 py-2 ui-money text-right">
                    {Number(r.overShort || 0) === 0 ? (
                      <span className="ui-amount-pos">Tallied</span>
                    ) : Number(r.overShort) > 0 ? (
                      <span>Over {formatMoney(Number(r.overShort), currentCompany)}</span>
                    ) : (
                      <span className="ui-amount-neg">Short {formatMoney(-Number(r.overShort), currentCompany)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="ui-input mb-3 w-full"
            placeholder="Search name / code — or scan a barcode"
            autoFocus
          />
          <div className="grid max-h-[30rem] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {filtered.slice(0, 60).map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => addToCart(i)}
                className="ui-card ui-lift p-3 text-left"
              >
                <div className="truncate text-sm">{i.name}</div>
                <div className="ui-money ui-caption">{formatMoney(Number(i.salePrice || 0), currentCompany)} · GST {Number(i.gstRate || 0)}%</div>
              </button>
            ))}
            {filtered.length === 0 ? <div className="ui-muted col-span-full p-6 text-center text-sm">No items match.</div> : null}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="ui-card p-4">
            <h3 className="ui-title mb-3 flex items-center gap-2 text-base">
              <ShoppingCart size={16} aria-hidden="true" /> Cart
            </h3>
            {cart.length === 0 ? (
              <p className="ui-muted py-6 text-center text-sm">Tap items to add them.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="grid min-w-[520px] grid-cols-[minmax(9rem,1fr)_4rem_5.5rem_4.5rem_4rem_6rem_2rem] gap-1 border-b px-1 pb-1 ui-caption"><span>Item</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Discount</span><span className="text-right">Tax</span><span className="text-right">Amount</span><span /></div>
                {cart.map((c) => (
                  <div key={c.itemId} className="grid min-w-[520px] grid-cols-[minmax(9rem,1fr)_4rem_5.5rem_4.5rem_4rem_6rem_2rem] items-center gap-1 border-b py-1 text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
                    <span className="truncate" title={c.name}>{c.name}</span>
                    <input aria-label={`${c.name} quantity`} type="number" min="1" value={c.qty} onChange={(e) => editLine(c.itemId, 'qty', Math.max(1, e.target.value))} className="ui-input !h-7 px-1 text-right" />
                    <input aria-label={`${c.name} rate`} type="number" min="0" value={c.rate} onChange={(e) => editLine(c.itemId, 'rate', e.target.value)} className="ui-input !h-7 px-1 text-right" />
                    <input aria-label={`${c.name} discount`} type="number" min="0" max="100" value={c.discount} onChange={(e) => editLine(c.itemId, 'discount', Math.min(100, Number(e.target.value) || 0))} className="ui-input !h-7 px-1 text-right" />
                    <span className="text-right">{c.gstRate}%</span>
                    <span className="ui-money text-right">{formatMoney(c.qty * c.rate * (1 - c.discount / 100), currentCompany)}</span>
                    <button type="button" onClick={() => drop(c.itemId)} className="ui-icon-btn !h-7 !w-7" aria-label="Remove"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span className="ui-money">{formatMoney(computed.subtotal, currentCompany)}</span></div>
              <div className="flex justify-between"><span>GST</span><span className="ui-money">{formatMoney(computed.gstTotal, currentCompany)}</span></div>
              <div className="flex justify-between ui-t-sec"><span>Total</span><span className="ui-money">{formatMoney(computed.total, currentCompany)}</span></div>
            </div>

            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="ui-input w-full text-sm"
                placeholder="Customer name (optional — Walk-in)"
              />
              <input
                type="tel"
                value={customerMobile}
                onChange={(e) => setCustomerMobile(e.target.value.replace(/[^\d+ -]/g, '').slice(0, 15))}
                className="ui-input w-full text-sm"
                placeholder="Customer mobile (optional)"
              />
              <div className="flex gap-2">
                {TENDERS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTender(t.key)}
                    className={`ui-btn flex-1 text-sm ${tender === t.key ? 'ui-btn-primary' : 'ui-btn-secondary'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={holdBill} className="ui-btn ui-btn-secondary">Hold</button>
                <button type="button" onClick={recallBill} className="ui-btn ui-btn-secondary">Recall {heldBills.length ? `(${heldBills.length})` : ''}</button>
                <button type="button" onClick={() => { setCart([]); setCustomerName(''); setCustomerMobile(''); checkoutIdRef.current = ''; }} className="ui-btn ui-btn-secondary">Cancel</button>
              </div>
              <button type="button" onClick={checkout} disabled={busy || !cart.length} className="ui-btn ui-btn-primary !h-11 w-full text-base">
                {busy ? 'Booking…' : `Charge ${formatMoney(computed.total, currentCompany)}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const POS_TABS = [
  { key: 'billing', label: 'Billing', icon: ShoppingCart },
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'transactions', label: 'Transactions', icon: List },
  { key: 'returns', label: 'Returns', icon: RotateCcw },
  { key: 'sessions', label: 'Sessions', icon: Clock3 },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const dateOf = (value) => String(value || '').slice(0, 10);
const timeOf = (value) => {
  const d = new Date(value || 0);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function PosMetric({ label, value, note }) {
  return (
    <div className="ui-card min-w-0 px-4 py-3">
      <div className="ui-caption">{label}</div>
      <div className="ui-money mt-1 truncate text-lg font-semibold">{value}</div>
      {note ? <div className="ui-helper mt-0.5">{note}</div> : null}
    </div>
  );
}

function PosDashboard({ db, currentCompany }) {
  const today = new Date().toISOString().slice(0, 10);
  const sales = (db.invoices || []).filter((x) => x.companyId === currentCompany.id && x.posSale && dateOf(x.date) === today && String(x.status).toLowerCase() !== 'cancelled');
  const returns = (db.creditNotes || []).filter((x) => x.companyId === currentCompany.id && (x.posReturn || x.sourceSystem === 'POS') && dateOf(x.date) === today);
  const total = sales.reduce((n, x) => n + Number(x.total || 0), 0);
  const cash = sales.filter((x) => String(x.tender).toUpperCase() === 'CASH').reduce((n, x) => n + Number(x.total || 0), 0);
  const byMode = ['CASH', 'UPI', 'CARD', 'CREDIT'].map((mode) => ({ mode, amount: sales.filter((x) => String(x.tender).toUpperCase() === mode).reduce((n, x) => n + Number(x.total || 0), 0) }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <PosMetric label="Today's sales" value={formatMoney(total, currentCompany)} />
        <PosMetric label="Transactions" value={sales.length} />
        <PosMetric label="Returns" value={formatMoney(returns.reduce((n, x) => n + Number(x.total || 0), 0), currentCompany)} />
        <PosMetric label="Average bill value" value={formatMoney(sales.length ? total / sales.length : 0, currentCompany)} />
        <PosMetric label="Cash collected" value={formatMoney(cash, currentCompany)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="ui-card p-4"><h2 className="ui-t-sec mb-3">Sales by payment mode</h2>{byMode.map((x) => <div key={x.mode} className="flex justify-between border-b py-2 last:border-0" style={{ borderColor: 'rgb(var(--border))' }}><span>{tenderLabel(x.mode)}</span><span className="ui-money">{formatMoney(x.amount, currentCompany)}</span></div>)}</section>
        <section className="ui-card p-4"><h2 className="ui-t-sec mb-3">POS-wise sales</h2><div className="flex justify-between py-2"><span>{currentCompany?.posSettings?.terminalName || 'Main POS'}</span><span className="ui-money">{formatMoney(total, currentCompany)}</span></div><p className="ui-helper mt-4">Figures come from normal sales invoices marked as POS transactions.</p></section>
      </div>
    </div>
  );
}

function PosTransactions({ db, currentCompany }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('');
  const [selected, setSelected] = useState(null);
  const rows = (db.invoices || []).filter((x) => x.companyId === currentCompany.id && x.posSale).filter((x) => !mode || String(x.tender).toUpperCase() === mode).filter((x) => !query || `${x.number} ${x.customerName}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2"><select aria-label="Payment mode" value={mode} onChange={(e) => setMode(e.target.value)} className="ui-input w-40"><option value="">All payments</option><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="CARD">Card</option><option value="CREDIT">Credit</option></select><input className="ui-input min-w-56 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoice or customer…" /></div>
    <div className="ui-table-shell overflow-auto" style={{ maxHeight: 'calc(100dvh - 15rem)' }}><table className="ui-table min-w-[950px]"><thead><tr><th>Date</th><th>Time</th><th>POS</th><th>Invoice No</th><th>Customer</th><th className="text-right">Amount</th><th>Payment Mode</th><th>Cashier</th><th>Status</th><th className="ui-action-col">Action</th></tr></thead><tbody>{rows.map((x) => <tr key={x.id} onClick={() => setSelected(x)} className="cursor-pointer"><td>{dateOf(x.date)}</td><td>{timeOf(x.createdAt)}</td><td>{x.posTerminalName || currentCompany?.posSettings?.terminalName || 'Main POS'}</td><td><button className="ui-link" onClick={(e) => { e.stopPropagation(); setSelected(x); }}>{x.number}</button></td><td>{x.customerName || 'Walk-in Customer'}</td><td className="ui-money text-right">{formatMoney(x.total, currentCompany)}</td><td>{tenderLabel(x.tender)}</td><td>{x.cashierName || 'Current user'}</td><td>{x.status}</td><td className="ui-action-col">⋮</td></tr>)}{!rows.length ? <tr><td colSpan="10" className="py-10 text-center ui-muted">No POS transactions match the filters.</td></tr> : null}</tbody></table></div>
    {selected ? <div className="ui-modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}><section role="dialog" aria-modal="true" aria-label="Accounting entry" className="ui-modal-panel max-w-5xl" onMouseDown={(e) => e.stopPropagation()}><div className="flex items-start justify-between"><div><h2 className="ui-t-major">Sales Invoice · {selected.number}</h2><p className="ui-muted">{dateOf(selected.date)} · {selected.customerName}</p></div><button className="ui-btn ui-btn-secondary" onClick={() => setSelected(null)}>Close</button></div><table className="ui-table mt-4 w-full"><thead><tr><th>Date</th><th>Voucher No</th><th>Ledger Name</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead><tbody><tr><td>{dateOf(selected.date)}</td><td>{selected.number}</td><td>{selected.customerName || 'Walk-in Customer'}</td><td className="ui-money text-right">{formatMoney(selected.total, currentCompany)}</td><td>—</td></tr><tr><td>{dateOf(selected.date)}</td><td>{selected.number}</td><td>Sales Account</td><td>—</td><td className="ui-money text-right">{formatMoney(selected.subtotal, currentCompany)}</td></tr>{Number(selected.gstTotal || 0) ? <tr><td>{dateOf(selected.date)}</td><td>{selected.number}</td><td>Output GST</td><td>—</td><td className="ui-money text-right">{formatMoney(selected.gstTotal, currentCompany)}</td></tr> : null}</tbody></table><p className="ui-narration mt-4">POS sale {selected.number}</p></section></div> : null}
  </div>;
}

function PosReturns({ db, currentCompany }) {
  const rows = (db.creditNotes || []).filter((x) => x.companyId === currentCompany.id && (x.posReturn || x.sourceSystem === 'POS'));
  return <div className="ui-table-shell overflow-auto" style={{ maxHeight: 'calc(100dvh - 13rem)' }}><table className="ui-table min-w-[900px]"><thead><tr><th>Date</th><th>Return No</th><th>Original Invoice</th><th>Customer</th><th>POS</th><th className="text-right">Amount</th><th>Refund Mode</th><th>Cashier</th><th>Status</th></tr></thead><tbody>{rows.map((x) => <tr key={x.id}><td>{dateOf(x.date)}</td><td>{x.number}</td><td>{x.refNo || x.againstInvoiceNumber || '—'}</td><td>{x.customerName}</td><td>{x.posTerminalName || 'Main POS'}</td><td className="ui-money text-right">{formatMoney(x.total, currentCompany)}</td><td>{x.refundMode || 'Original mode'}</td><td>{x.cashierName || 'Current user'}</td><td>{x.status}</td></tr>)}{!rows.length ? <tr><td colSpan="9" className="py-10 text-center ui-muted">No POS returns yet. Start a return from Billing using the original invoice.</td></tr> : null}</tbody></table></div>;
}

function PosSessions({ db, currentCompany }) {
  const rows = (db.posDayCloses || []).filter((x) => x.companyId === currentCompany.id).slice().sort((a, b) => String(b.closedAt || b.date).localeCompare(String(a.closedAt || a.date)));
  return <div className="ui-table-shell overflow-auto"><table className="ui-table min-w-[850px]"><thead><tr><th>Date</th><th>Terminal</th><th className="text-right">Transactions</th><th className="text-right">Cash sales</th><th className="text-right">Card</th><th className="text-right">UPI</th><th className="text-right">Expected cash</th><th className="text-right">Actual cash</th><th className="text-right">Short / Excess</th></tr></thead><tbody>{rows.map((x) => <tr key={x.id}><td>{x.date}</td><td>{x.terminalName || 'Main POS'}</td><td className="text-right">{x.invoices || 0}</td><td className="ui-money text-right">{formatMoney(x.cash, currentCompany)}</td><td className="ui-money text-right">{formatMoney(x.card, currentCompany)}</td><td className="ui-money text-right">{formatMoney(x.upi, currentCompany)}</td><td className="ui-money text-right">{formatMoney(x.cash, currentCompany)}</td><td className="ui-money text-right">{formatMoney(x.countedCash, currentCompany)}</td><td className="ui-money text-right">{formatMoney(x.overShort, currentCompany)}</td></tr>)}{!rows.length ? <tr><td colSpan="9" className="py-10 text-center ui-muted">No closed sessions yet.</td></tr> : null}</tbody></table></div>;
}

const SETTING_TABS = ['General', 'Terminals', 'Payments', 'Sales', 'Returns', 'Sessions', 'Field Customization', 'Printing', 'Permissions'];
function PosSettings({ setDb, currentCompany }) {
  const saved = currentCompany.posSettings || {};
  const [tab, setTab] = useState('General');
  const [form, setForm] = useState({ terminalName: 'Main POS', terminalCode: 'POS-01', walkInCustomer: 'Walk-in Customer', printSize: '80mm Thermal', priceList: 'Retail', allowWithoutInvoice: false, ...saved });
  const update = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  const save = () => { setDb((prev) => ({ ...prev, companies: (prev.companies || []).map((x) => x.id === currentCompany.id ? { ...x, posSettings: form } : x) })); notify.success('POS settings saved.'); };
  return <div className="space-y-4"><div className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'rgb(var(--border))' }}>{SETTING_TABS.map((x) => <button key={x} className={`ui-tab whitespace-nowrap ${tab === x ? 'ui-tab-active' : ''}`} onClick={() => setTab(x)}>{x}</button>)}</div><section className="ui-card p-4"><h2 className="ui-t-sec">{tab}</h2><p className="ui-helper mb-4">Configure {tab.toLowerCase()} behaviour for this POS workspace.</p>
    {tab === 'Terminals' || tab === 'General' ? <div className="grid gap-3 md:grid-cols-2"><label className="ui-label">POS name<input className="ui-input mt-1 w-full" value={form.terminalName} onChange={(e) => update('terminalName', e.target.value)} /></label><label className="ui-label">POS code<input className="ui-input mt-1 w-full" value={form.terminalCode} onChange={(e) => update('terminalCode', e.target.value)} /></label><label className="ui-label">Default walk-in customer<input className="ui-input mt-1 w-full" value={form.walkInCustomer} onChange={(e) => update('walkInCustomer', e.target.value)} /></label><label className="ui-label">Price list<input className="ui-input mt-1 w-full" value={form.priceList} onChange={(e) => update('priceList', e.target.value)} /></label></div> : null}
    {tab === 'Payments' ? <div className="space-y-2"><p>Cash, UPI and Card use the branch ledger mappings configured under POS Payment Accounts.</p><p className="ui-helper">Credit leaves the invoice outstanding. Split payments create and allocate one receipt per paid tender.</p></div> : null}
    {tab === 'Returns' ? <label className="flex items-center gap-2"><input type="checkbox" checked={form.allowWithoutInvoice} onChange={(e) => update('allowWithoutInvoice', e.target.checked)} />Allow return without invoice with manager approval</label> : null}
    {tab === 'Printing' ? <label className="ui-label block max-w-sm">Default format<select className="ui-input mt-1 w-full" value={form.printSize} onChange={(e) => update('printSize', e.target.value)}><option>58mm Thermal</option><option>80mm Thermal</option><option>A4</option></select></label> : null}
    {tab === 'Field Customization' ? <div className="grid gap-2 md:grid-cols-2">{['Item Code','Barcode','Qty','Rate','MRP','Discount','Tax','Batch','Expiry','Warehouse'].map((x) => <label key={x} className="flex items-center gap-2 rounded border p-2" style={{ borderColor: 'rgb(var(--border))' }}><input type="checkbox" defaultChecked={!['Batch','Expiry'].includes(x)} />{x}</label>)}</div> : null}
    {tab === 'Permissions' ? <div className="grid gap-2 md:grid-cols-2">{['Sale','Cancel Bill','Return','Return Without Invoice','Discount','Price Override','Credit Sale','Cash In / Out','Session Close / Reopen','Manager Approval'].map((x) => <label key={x} className="flex items-center gap-2 rounded border p-2" style={{ borderColor: 'rgb(var(--border))' }}><input type="checkbox" defaultChecked={['Sale','Return'].includes(x)} />{x}</label>)}</div> : null}
    {['Sales','Sessions'].includes(tab) ? <p className="ui-muted">These controls use the existing invoice numbering, warehouse, GST and session posting rules.</p> : null}
    <div className="mt-5 flex justify-end"><button className="ui-btn ui-btn-primary" onClick={save}>Save POS settings</button></div></section></div>;
}

export default function PosScreen(props) {
  const [active, setActive] = useState('billing');
  return <div className="space-y-4"><div className="flex items-center justify-between"><div><h1 className="ui-t-page">Point of Sale</h1><p className="ui-muted ui-t-body">Fast billing, payments, sessions and counter control</p></div></div><nav aria-label="POS workspace" className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'rgb(var(--border))' }}>{POS_TABS.map(({ key, label, icon: Icon }) => <button key={key} type="button" onClick={() => setActive(key)} className={`ui-tab flex items-center gap-1.5 whitespace-nowrap ${active === key ? 'ui-tab-active' : ''}`}><Icon size={15} />{label}</button>)}</nav>{active === 'billing' ? <PosBillingScreen {...props} /> : null}{active === 'dashboard' ? <PosDashboard {...props} /> : null}{active === 'transactions' ? <PosTransactions {...props} /> : null}{active === 'returns' ? <PosReturns {...props} /> : null}{active === 'sessions' ? <PosSessions {...props} /> : null}{active === 'settings' ? <PosSettings {...props} /> : null}</div>;
}
