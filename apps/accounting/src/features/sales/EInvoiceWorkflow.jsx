import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { notify } from '@ui/components/ui/notify';
import { buildEInvoicePayload } from '@ui/utils/einvoice';
import { registerEInvoiceApi, getEInvoiceDetailsApi, cancelEInvoiceApi } from '../../api/einvoice';

/**
 * The native e-invoice workflow for one invoice:
 *   Validate → Generate IRN → QR → Download, plus cancellation while the
 *   24-hour window is open. Everything the IRP returned (IRN, ack, signed
 *   invoice JWT, signed QR, the registered payload) is stored server-side and
 *   downloadable from here.
 */

/** Pre-flight checks — catch what the IRP would reject, before calling it. */
export function validateForEInvoice({ invoice, company, customer }) {
  const issues = [];
  const gstin = String(company?.gstin || '').trim();
  if (!/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(gstin)) issues.push('Company GSTIN missing or malformed (Settings → Tax & Compliance).');
  if (!String(company?.state || '').trim()) issues.push('Company state not set.');
  if (!String(invoice?.number || '').trim()) issues.push('Invoice has no number.');
  if (!String(invoice?.date || '').trim()) issues.push('Invoice has no date.');
  const buyerGstin = String(invoice?.customerGstin || customer?.gstin || '').trim();
  if (!buyerGstin) issues.push('Buyer GSTIN missing — e-invoices are for B2B; B2C invoices are not registered on the IRP.');
  else if (!/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(buyerGstin)) issues.push(`Buyer GSTIN "${buyerGstin}" is malformed.`);
  const lines = Array.isArray(invoice?.items) ? invoice.items : [];
  if (!lines.length) issues.push('Invoice has no line items.');
  lines.forEach((l, i) => {
    if (!String(l.hsnSac || '').trim()) issues.push(`Line ${i + 1} (${l.description || 'item'}) has no HSN/SAC code.`);
  });
  if (!(Number(invoice?.total) > 0)) issues.push('Invoice total must be greater than zero.');
  return issues;
}

const download = (filename, data) => {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const Step = ({ done, active, label }) => (
  <div className={`flex items-center gap-1.5 text-xs ${done ? '' : active ? 'font-semibold' : 'ui-muted'}`}>
    {done ? <CheckCircle2 size={14} className="text-[rgb(var(--pos))]" aria-hidden="true" /> : <span className={`inline-block h-3 w-3 rounded-full border ${active ? 'border-[rgb(var(--brand))]' : ''}`} />}
    <span>{label}</span>
  </div>
);

export default function EInvoiceWorkflow({ invoice, company, customer, onRegistered, onCancelled, onClose }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('2');
  const [cancelRemarks, setCancelRemarks] = useState('');

  const issues = useMemo(() => validateForEInvoice({ invoice, company, customer }), [invoice, company, customer]);
  const payload = useMemo(() => {
    try {
      return buildEInvoicePayload({ invoice, company, customer: customer || {} });
    } catch {
      return null;
    }
  }, [invoice, company, customer]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!invoice?.backendInvoiceId) {
        setLoading(false);
        return;
      }
      try {
        const d = await getEInvoiceDetailsApi(invoice.backendInvoiceId);
        if (!cancelled) setDetails(d);
      } catch {
        /* not registered yet */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice?.backendInvoiceId]);

  const registered = details?.status === 'REGISTERED';
  const cancelledIrn = details?.status === 'CANCELLED';

  useEffect(() => {
    const qrSource = details?.signedQr;
    if (!qrSource) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(String(qrSource), { margin: 1, width: 220 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [details?.signedQr]);

  const withinCancelWindow =
    registered && details?.registeredAt && Date.now() - new Date(details.registeredAt).getTime() < 24 * 60 * 60 * 1000;

  const generate = async () => {
    if (issues.length || !payload) return;
    setBusy(true);
    try {
      await registerEInvoiceApi(invoice.backendInvoiceId, payload);
      const d = await getEInvoiceDetailsApi(invoice.backendInvoiceId);
      setDetails(d);
      onRegistered?.(d);
      notify.success(`IRN generated: ${d.irn}`);
    } catch (err) {
      notify.error(String(err?.message || 'IRP registration failed.'));
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setBusy(true);
    try {
      await cancelEInvoiceApi(invoice.backendInvoiceId, { reason: cancelReason, remarks: cancelRemarks });
      const d = await getEInvoiceDetailsApi(invoice.backendInvoiceId);
      setDetails(d);
      setCancelOpen(false);
      onCancelled?.(d);
      notify.success('IRN cancelled on the GST network.');
    } catch (err) {
      notify.error(String(err?.message || 'Cancellation failed.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="ui-muted p-6 text-center text-sm">Loading e-invoice record…</div>;

  if (!invoice?.backendInvoiceId) {
    return <div className="ui-muted p-6 text-center text-sm">Only server-backed invoices can be registered on the IRP.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Step done label="Create" />
        <Step done={issues.length === 0} active={issues.length > 0} label="Validate" />
        <Step done={registered || cancelledIrn} active={issues.length === 0 && !registered && !cancelledIrn} label="Generate IRN" />
        <Step done={Boolean(qrDataUrl)} label="QR" />
        <Step done={registered || cancelledIrn} label="Download" />
      </div>

      {cancelledIrn ? (
        <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <XCircle size={16} className="mt-0.5 text-[rgb(var(--neg))]" aria-hidden="true" />
          <div>
            <div className="font-semibold">IRN cancelled</div>
            <div className="ui-muted text-xs">
              {details.irn} · cancelled {details.cancelledAt ? new Date(details.cancelledAt).toLocaleString() : ''}
              {details.cancelReason ? ` · ${details.cancelReason}` : ''}
            </div>
          </div>
        </div>
      ) : null}

      {!registered && !cancelledIrn ? (
        <div className="space-y-3">
          {issues.length ? (
            <div className="rounded-lg border p-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangle size={14} className="text-[rgb(var(--warn-ink))]" aria-hidden="true" /> Fix before registering
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {issues.map((i, idx) => (
                  <li key={idx}>{i}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="ui-muted text-sm">Validation passed — the INV-01 payload is ready.</div>
          )}
          <div className="flex justify-end gap-2">
            {payload ? (
              <button type="button" onClick={() => download(`EINV_${invoice.number}.json`, payload)} className="ui-btn ui-btn-secondary">
                Download INV-01 JSON
              </button>
            ) : null}
            <button type="button" onClick={generate} disabled={busy || issues.length > 0} className="ui-btn ui-btn-primary">
              {busy ? 'Registering…' : 'Generate IRN'}
            </button>
          </div>
        </div>
      ) : null}

      {registered || cancelledIrn ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 text-sm">
            <div>
              <span className="ui-muted text-xs">IRN</span>
              <div className="break-all font-mono text-xs">{details.irn}</div>
            </div>
            <div className="flex gap-6">
              <div>
                <span className="ui-muted text-xs">Ack no</span>
                <div>{details.ackNo || '—'}</div>
              </div>
              <div>
                <span className="ui-muted text-xs">Ack date</span>
                <div>{details.ackDate || '—'}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {details.payload ? (
                <button type="button" onClick={() => download(`EINV_${invoice.number}.json`, details.payload)} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                  e-Invoice JSON
                </button>
              ) : null}
              {details.signedInvoice ? (
                <button type="button" onClick={() => download(`EINV_${invoice.number}_signed.jwt.json`, { irn: details.irn, signedInvoice: details.signedInvoice })} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                  Signed invoice
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  download(`EINV_${invoice.number}_record.json`, {
                    irn: details.irn,
                    status: details.status,
                    ackNo: details.ackNo,
                    ackDate: details.ackDate,
                    signedQr: details.signedQr,
                    registeredAt: details.registeredAt,
                    cancelledAt: details.cancelledAt,
                    cancelReason: details.cancelReason,
                  })
                }
                className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
              >
                Full record
              </button>
            </div>
            {registered ? (
              withinCancelWindow ? (
                <button type="button" onClick={() => setCancelOpen((v) => !v)} className="ui-btn ui-btn-secondary ui-btn-sm mt-2 text-xs text-[rgb(var(--neg))]">
                  Cancel IRN…
                </button>
              ) : (
                <p className="ui-muted pt-2 text-xs">
                  The 24-hour cancellation window has closed — issue a credit note to reverse this invoice.
                </p>
              )
            ) : null}
          </div>
          <div className="flex items-start justify-center">
            {qrDataUrl ? (
              <div className="text-center">
                <img src={qrDataUrl} alt={`Signed QR for ${details.irn}`} className="mx-auto h-44 w-44" />
                <div className="ui-caption mt-1">Signed QR — prints on the invoice</div>
              </div>
            ) : (
              <div className="ui-muted text-xs">No signed QR stored.</div>
            )}
          </div>
        </div>
      ) : null}

      {cancelOpen && registered ? (
        <div className="rounded-lg border p-3">
          <div className="mb-2 text-sm font-semibold">Cancel IRN {details.irn?.slice(0, 12)}…</div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="ui-label" htmlFor="einvoiceworkflow-reason">Reason</label>
              <select id="einvoiceworkflow-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="ui-select px-2 text-sm">
                <option value="1">Duplicate</option>
                <option value="2">Data entry mistake</option>
                <option value="3">Order cancelled</option>
                <option value="4">Others</option>
              </select>
            </div>
            <div className="min-w-48 flex-1 min-w-0">
              <label className="ui-label" htmlFor="einvoiceworkflow-remarks">Remarks</label>
              <input id="einvoiceworkflow-remarks" type="text" value={cancelRemarks} onChange={(e) => setCancelRemarks(e.target.value)} maxLength={100} className="ui-input w-full px-2 text-sm" placeholder="Optional" />
            </div>
            <button type="button" onClick={doCancel} disabled={busy} className="ui-btn ui-btn-primary text-sm">
              {busy ? 'Cancelling…' : 'Confirm cancel'}
            </button>
          </div>
          <p className="ui-muted mt-2 text-xs">Cancelling voids the IRN on the GST network. The local invoice stays — cancel or credit-note it separately.</p>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="ui-btn ui-btn-secondary">Close</button>
      </div>
    </div>
  );
}
