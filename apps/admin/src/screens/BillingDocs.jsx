import React, { useCallback, useEffect, useRef, useState } from 'react';

import { confirmDialog, notify } from '@ui/components/ui/notify';
import { apiFetch } from '@platform/http';
import { printElement } from '@ui/utils/printElement';
import { WsDrawer } from './wsKit';
import { InvoiceDocument, inr } from './InvoiceDocument';
import { invoiceDay } from './InvoiceDrawer';
import { errorWords } from '@ui/utils/errorWords';

/**
 * Round 67 (selling to companies and CAs), Workspace → Plan → Invoices, below
 * the invoices: what a company's accounts and purchase teams ask a new vendor
 * for. Purchase orders (the number prints on every invoice whose period the
 * PO covers), proformas (the plan with GST, valid 15 days, to pay against;
 * CLOR turns it into the tax invoice) and CLOR's vendor documents (GST
 * certificate, PAN and the like). Server: routes/billing.ts. Documents only:
 * nothing here charges or moves money.
 */

const msg = (e, what) => errorWords(e, what);
const dayOf = (iso) => (iso ? invoiceDay(`${iso}T00:00:00+05:30`) : '—');

function useList(path, key) {
  const [state, setState] = useState({ rows: null, failed: false, extra: {} });
  const reload = useCallback(() => {
    apiFetch(path)
      .then((r) => setState({ rows: r?.[key] || [], failed: false, extra: r || {} }))
      .catch(() => setState({ rows: null, failed: true, extra: {} }));
  }, [path, key]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

export default function BillingDocs() {
  return (
    <>
      <PurchaseOrders />
      <ProformaList />
      <VendorDocs />
    </>
  );
}

/* ---------------------------------------------------------- purchase orders */
function PurchaseOrders() {
  const { rows, failed, extra, reload } = useList('/billing/purchase-orders', 'purchaseOrders');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ number: '', poDate: '', fromDate: '', toDate: '' });
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  if (failed) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setProblems([]);
    try {
      await apiFetch('/billing/purchase-orders', { method: 'POST', body: { number: f.number, poDate: f.poDate || null, fromDate: f.fromDate, toDate: f.toDate } });
      notify.success('Saved. Invoices for those dates will carry this PO number.');
      setF({ number: '', poDate: '', fromDate: '', toDate: '' });
      setAdding(false);
      reload();
    } catch (e) {
      setProblems(e?.data?.problems?.length ? e.data.problems : [msg(e, 'save the PO')]);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (po) => {
    if (!(await confirmDialog({ title: `Remove PO ${po.number}?`, message: 'Invoices already issued keep it. New ones will not carry it.', confirmLabel: 'Remove PO' }))) return;
    try {
      await apiFetch(`/billing/purchase-orders/${encodeURIComponent(po.id)}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      notify.error(msg(e, 'remove the PO'));
    }
  };
  return (
    <section className="ws-section r67-docs-section" aria-labelledby="r67-po-title">
      <div className="r67-head">
        <div>
          <h2 id="r67-po-title" className="ws-h2">Purchase orders</h2>
          <p className="ws-card-blurb">If your company raises a PO for CLOR, add it here. Its number prints on every invoice for a period it covers.</p>
        </div>
        {extra.mayChange && !adding ? (
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAdding(true)}>
            Add a PO
          </button>
        ) : null}
      </div>
      {adding ? (
        <div className="r67-po-form">
          <label className="grid gap-1">
            <span className="text-sm font-medium">PO number</span>
            <input className="ui-input ui-mono" maxLength={60} value={f.number} onChange={set('number')} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">PO date</span>
            <input className="ui-input" type="date" value={f.poDate} onChange={set('poDate')} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Covers from</span>
            <input className="ui-input" type="date" value={f.fromDate} onChange={set('fromDate')} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Covers to</span>
            <input className="ui-input" type="date" value={f.toDate} onChange={set('toDate')} />
          </label>
          <div className="r67-po-actions">
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => (setAdding(false), setProblems([]))}>
              Cancel
            </button>
            <button type="button" className="ws-btn ws-btn--primary ws-btn--small" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save PO'}
            </button>
          </div>
          {problems.length ? (
            <ul role="alert" className="text-sm r67-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {rows === null ? null : !rows.length ? (
        <p className="ws-item-sub">No purchase orders yet. Add one if your accounts team needs its number on CLOR’s invoices.</p>
      ) : (
        <ul className="r67-rows">
          {rows.map((po) => (
            <li key={po.id} className="r67-row">
              <span className="ui-mono">{po.number}</span>
              <span className="ws-item-sub">
                {dayOf(po.fromDate)} to {dayOf(po.toDate)}
                {po.poDate ? ` · dated ${dayOf(po.poDate)}` : ''}
              </span>
              {extra.mayChange ? (
                <button type="button" className="ws-link" aria-label={`Remove ${po.number}`} onClick={() => remove(po)}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- proformas */
const asPaper = (p) => ({ ...p, issueDate: p.createdAt, dueDate: p.validUntil, status: 'PROFORMA', payTo: null });

function ProformaList() {
  const { rows, failed, reload } = useList('/billing/proformas', 'proformas');
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState(null);
  const paper = useRef(null);
  if (failed) return null;
  const make = async () => {
    setMaking(true);
    try {
      const p = await apiFetch('/billing/proformas', { method: 'POST', body: {} });
      reload();
      setOpen(p);
    } catch (e) {
      notify.error(msg(e, 'make the proforma'));
    } finally {
      setMaking(false);
    }
  };
  return (
    <section className="ws-section r67-docs-section" aria-labelledby="r67-pf-title">
      <div className="r67-head">
        <div>
          <h2 id="r67-pf-title" className="ws-h2">Proformas</h2>
          <p className="ws-card-blurb">A proforma shows your plan with GST, for your accounts team to pay against. It is valid for 15 days. The tax invoice follows once the payment arrives.</p>
        </div>
        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={making} onClick={make}>
          {making ? 'Making…' : 'Get a proforma'}
        </button>
      </div>
      {rows === null ? null : !rows.length ? (
        <p className="ws-item-sub">No proformas yet.</p>
      ) : (
        <ul className="r67-rows">
          {rows.map((p) => (
            <li key={p.id} className="r67-row">
              <button type="button" className="ws-name-link ui-mono" onClick={() => setOpen(p)}>
                {p.number}
              </button>
              <span className="ws-item-sub">
                {p.invoiced ? 'Invoiced' : p.expired ? `Ended ${invoiceDay(p.validUntil)}` : `Valid until ${invoiceDay(p.validUntil)}`}
              </span>
              <span className="ui-num r67-amt">{inr(p.total)}</span>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <WsDrawer
          open
          onClose={() => setOpen(null)}
          widthClass="w-[min(56rem,96vw)]"
          title={`Proforma ${open.number}`}
          actions={
            <>
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setOpen(null)}>
                Close
              </button>
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => paper.current?.firstElementChild && printElement({ element: paper.current.firstElementChild, title: `CLOR proforma ${open.number}` })}>
                Print or save as PDF
              </button>
            </>
          }
        >
          <div ref={paper}>
            <InvoiceDocument invoice={asPaper(open)} proforma />
          </div>
        </WsDrawer>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------- vendor documents */
const KIND_WORD = { GST: 'GST registration certificate', PAN: 'PAN card', INCORPORATION: 'Certificate of incorporation', MSME: 'MSME (Udyam) certificate', CHEQUE: 'Cancelled cheque', OTHER: 'Other document' };

function VendorDocs() {
  const { rows, failed } = useList('/billing/vendor-documents', 'documents');
  if (failed || !rows?.length) return null;
  const save = async (d) => {
    try {
      const f = await apiFetch(`/billing/vendor-documents/${encodeURIComponent(d.id)}/file`);
      const a = document.createElement('a');
      a.href = f.dataUrl;
      a.download = f.fileName || 'document';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      notify.error(msg(e, 'download the document'));
    }
  };
  return (
    <section className="ws-section r67-docs-section" aria-labelledby="r67-vd-title">
      <div className="r67-head">
        <div>
          <h2 id="r67-vd-title" className="ws-h2">Vendor documents</h2>
          <p className="ws-card-blurb">CLOR’s own papers, for your purchase team’s vendor registration.</p>
        </div>
      </div>
      <ul className="r67-rows">
        {rows.map((d) => (
          <li key={d.id} className="r67-row">
            <span className="font-medium">{d.title}</span>
            <span className="ws-item-sub">
              {KIND_WORD[d.kind] || d.kind}
              {d.validUntil ? ` · valid until ${dayOf(d.validUntil)}` : ''}
            </span>
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" aria-label={`Download ${d.title}`} onClick={() => save(d)}>
              Download
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
