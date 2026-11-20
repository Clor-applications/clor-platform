import React, { useEffect, useState } from 'react';

import { confirmDialog, notify } from '@ui/components/ui/notify';
import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { opsAddVendorDocument, opsProformaToInvoice, opsProformas, opsRemoveVendorDocument, opsTdsCertificate, opsTdsDue, opsVendorDocumentFile, opsVendorDocuments } from './api';
import { Empty, Err, Loading, day, may, errorWords } from './kit';
import { inr } from './money';

/**
 * Round 67 (selling to companies and CAs), on ops.clor.in under Billing:
 * TDS certificates a customer still owes after paying CLOR's invoice less
 * TDS, proformas customers made in Workspace (each turned into a draft
 * invoice once), and CLOR's own papers (GST certificate, PAN and the like)
 * that customers download for their vendor registration. Records only:
 * nothing here charges or moves money.
 */

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const msg = (e, what) => errorWords(e, what);

export function TdsCertificates({ role, openInvoice }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [again, setAgain] = useState(0);
  useEffect(() => {
    opsTdsDue()
      .then((r) => (setRows(r.invoices || []), setError('')))
      .catch((e) => setError(msg(e, 'load the TDS certificates')));
  }, [again]);
  const mayChange = may(role, 'BILLING');
  const received = async (r) => {
    setBusy(r.id);
    try {
      await opsTdsCertificate(r.id, today());
      notify.success(`Certificate for ${r.number} noted as received.`);
      setAgain((n) => n + 1);
    } catch (e) {
      notify.error(msg(e, 'note the certificate'));
    } finally {
      setBusy('');
    }
  };
  const owed = (rows || []).reduce((s, r) => s + (r.tdsDeducted || 0), 0);
  return (
    <>
      <PageHead crumbs={['Billing and setup']} title="TDS certificates" counts={!rows ? null : rows.length ? `${rows.length} still to come · ${inr(owed)} of TDS` : 'None outstanding'} />
      <p className="ws-card-blurb r67-lede">A customer that paid an invoice less TDS owes CLOR the Form 16A for it. Each one stays here until it comes in. TDS is entered when an invoice is marked paid.</p>
      <Err onRetry={() => setAgain((n) => n + 1)}>{error}</Err>
      {!rows ? (
        error ? null : <Loading />
      ) : !rows.length ? (
        <Empty>No certificates outstanding.</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">TDS certificates still to come</caption>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Paid</th>
                <th className="ui-num" style={{ textAlign: 'right' }}>
                  TDS
                </th>
                {mayChange ? (
                  <th>
                    <span className="sr-only">Received</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="ws-name-link ui-mono" onClick={() => openInvoice(r.id)}>
                      {r.number}
                    </button>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{r.accountName || '—'}</td>
                  <td>{day(r.paidAt)}</td>
                  <td className="ui-num" style={{ textAlign: 'right' }}>
                    {inr(r.tdsDeducted)}
                  </td>
                  {mayChange ? (
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy === r.id} aria-label={`Certificate received for ${r.number}`} onClick={() => received(r)}>
                        Certificate received
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function Proformas({ role, openInvoice }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [again, setAgain] = useState(0);
  useEffect(() => {
    opsProformas()
      .then((r) => (setRows(r.proformas || []), setError('')))
      .catch((e) => setError(msg(e, 'load the proformas')));
  }, [again]);
  const mayChange = may(role, 'BILLING');
  const toInvoice = async (p) => {
    setBusy(p.id);
    try {
      const draft = await opsProformaToInvoice(p.id);
      notify.success(`Draft invoice made from ${p.number}. Check it and issue it.`);
      openInvoice(draft.id);
    } catch (e) {
      notify.error(msg(e, 'make the invoice'));
      setBusy('');
    }
  };
  return (
    <>
      <PageHead crumbs={['Billing and setup']} title="Proformas" counts={rows ? (rows.length ? `${rows.length} ${rows.length === 1 ? 'proforma' : 'proformas'}` : null) : null} />
      <p className="ws-card-blurb r67-lede">Customers make a proforma in the Admin center, Billing: the plan with GST, valid 15 days, for their accounts team to pay against. When the money comes, make the tax invoice from it here.</p>
      <Err onRetry={() => setAgain((n) => n + 1)}>{error}</Err>
      {!rows ? (
        error ? null : <Loading />
      ) : !rows.length ? (
        <Empty>No proformas yet. One shows here when a customer makes a proforma in the Admin center, Billing.</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Proformas</caption>
            <thead>
              <tr>
                <th>Number</th>
                <th>Customer</th>
                <th>Made</th>
                <th>Valid until</th>
                <th className="ui-num" style={{ textAlign: 'right' }}>
                  Total
                </th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="ui-mono">{p.number}</td>
                  <td style={{ whiteSpace: 'normal' }}>{p.buyer?.name || p.accountName || '—'}</td>
                  <td>{day(p.createdAt)}</td>
                  <td>{p.expired ? <span className="ws-item-sub">Ended {day(p.validUntil)}</span> : day(p.validUntil)}</td>
                  <td className="ui-num" style={{ textAlign: 'right' }}>
                    {inr(p.total)}
                  </td>
                  <td>
                    {p.invoiceId ? (
                      <button type="button" className="ws-name-link" onClick={() => openInvoice(p.invoiceId)}>
                        Open invoice
                      </button>
                    ) : mayChange ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy === p.id} onClick={() => toInvoice(p)}>
                        Make invoice
                      </button>
                    ) : (
                      <span className="ws-item-sub">Not yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------- vendor documents */
export const VENDOR_KIND_WORD = {
  GST: 'GST registration certificate',
  PAN: 'PAN card',
  INCORPORATION: 'Certificate of incorporation',
  MSME: 'MSME (Udyam) certificate',
  CHEQUE: 'Cancelled cheque',
  OTHER: 'Other document',
};
const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Saves a vendor document the API answers as a data URL. Shared with Workspace, Billing. */
export async function saveFile(fetchIt) {
  try {
    const f = await fetchIt();
    const a = document.createElement('a');
    a.href = f.dataUrl;
    a.download = f.fileName || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    notify.error(msg(e, 'download the document'));
  }
}

export function VendorDocuments({ role }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    opsVendorDocuments()
      .then((r) => (setRows(r.documents || []), setError('')))
      .catch((e) => setError(msg(e, 'load the vendor documents')));
  }, [again]);
  const mayChange = may(role, 'BILLING');
  const remove = async (d) => {
    if (!(await confirmDialog({ title: `Remove ${d.title}?`, message: 'Customers stop seeing it in Billing at once.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await opsRemoveVendorDocument(d.id);
      notify.success('Removed.');
      setAgain((n) => n + 1);
    } catch (e) {
      notify.error(msg(e, 'remove the document'));
    }
  };
  return (
    <>
      <PageHead
        crumbs={['Billing and setup']}
        title="Vendor documents"
        counts={rows ? (rows.length ? `${rows.length} shared with customers` : 'None shared yet') : null}
        actions={
          mayChange ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setAdding(true)}>
              Add a document
            </button>
          ) : null
        }
      />
      <p className="ws-card-blurb r67-lede">CLOR’s own papers that a customer’s purchase team asks for before they can pay a new vendor. Every customer’s billing people can download these from the Admin center, Billing.</p>
      <Err onRetry={() => setAgain((n) => n + 1)}>{error}</Err>
      {!rows ? (
        error ? null : <Loading />
      ) : !rows.length ? (
        <Empty>No documents yet. Add the GST certificate and PAN first: they are asked for most.</Empty>
      ) : (
        <ul className="r67-docs">
          {rows.map((d) => (
            <li key={d.id} className="r67-doc">
              <div className="min-w-0">
                <div>{d.title}</div>
                <div className="ws-item-sub">
                  {VENDOR_KIND_WORD[d.kind] || d.kind} · {d.fileName} · {sizeText(d.size)}
                  {d.validUntil ? ` · valid until ${day(d.validUntil)}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => saveFile(() => opsVendorDocumentFile(d.id))}>
                  Download
                </button>
                {mayChange ? (
                  <button type="button" className="ws-link" onClick={() => remove(d)}>
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? <AddDocument onClose={() => setAdding(false)} onSaved={() => (setAdding(false), setAgain((n) => n + 1))} /> : null}
    </>
  );
}

function AddDocument({ onClose, onSaved }) {
  const [kind, setKind] = useState('GST');
  const [title, setTitle] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = (e) => {
    setError('');
    const f = e.target.files?.[0];
    if (!f) return setFile(null);
    if (f.size > 2 * 1024 * 1024) return (setFile(null), setError('The file is larger than 2 MB.'));
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, dataUrl: String(reader.result) });
    reader.onerror = () => setError('That file could not be read. Choose it again.');
    reader.readAsDataURL(f);
  };
  const dirty = Boolean(file) || Boolean(title.trim()) || Boolean(validUntil) || kind !== 'GST';
  const close = () => { if (!busy) onClose(); };
  const save = async () => {
    if (busy) return;
    if (!file) return setError('Choose the PDF or picture.');
    setBusy(true);
    setError('');
    try {
      await opsAddVendorDocument({ kind, title: title.trim() || null, validUntil: validUntil || null, dataUrl: file.dataUrl, fileName: file.name });
      notify.success('Added. Customers can download it now.');
      onSaved();
    } catch (e) {
      setError(msg(e, 'add the document'));
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={close}
      dirty={dirty || busy}
      title="Add a vendor document"
      description="A PDF, PNG or JPEG up to 2 MB. Every customer’s billing people can download it."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy} onClick={save}>
            {busy ? 'Adding…' : 'Add document'}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-1">
          <label htmlFor="vd-kind" className="text-sm font-semibold">
            What it is
          </label>
          <select id="vd-kind" className="ui-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(VENDOR_KIND_WORD).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="vd-title" className="text-sm font-semibold">
            Name customers see
          </label>
          <input id="vd-title" className="ui-input" maxLength={120} placeholder={VENDOR_KIND_WORD[kind]} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="vd-valid" className="text-sm font-semibold">
            Valid until
          </label>
          <input id="vd-valid" type="date" className="ui-input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          <span className="ws-card-blurb">Leave empty if it does not run out, as a PAN does not.</span>
        </div>
        <div className="grid gap-1">
          <label htmlFor="vd-file" className="text-sm font-semibold">
            File
          </label>
          <input id="vd-file" type="file" accept="application/pdf,image/png,image/jpeg" onChange={pick} aria-invalid={error && !file ? true : undefined} aria-describedby={error && !file ? 'vd-file-err' : undefined} />
        </div>
        <div id="vd-file-err">
          <Err>{error}</Err>
        </div>
      </div>
    </WsDrawer>
  );
}
