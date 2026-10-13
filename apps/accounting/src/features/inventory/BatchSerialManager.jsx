import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Hash, Plus, ScanLine } from 'lucide-react';

import { listItems } from '@ui/api/masters';
import {
  issueBatch,
  issueSerials,
  listBatches,
  listSerials,
  receiveBatch,
  registerSerials,
} from '../../api/inventoryTracking';
import { EmptyState, PageHeader, Spinner } from '@ui/components/ui/Primitives';

/**
 * Batch and serial tracking — requirement 11.
 *
 * Two modes rather than one merged screen, because an item is tracked one way
 * or the other and mixing the controls would invite recording a lot number
 * against a serialised item.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** Days until expiry, or null when the lot has no expiry date. */
const daysToExpiry = (expiryDate) => {
  if (!expiryDate) return null;
  const then = new Date(`${expiryDate}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return null;
  const now = new Date(`${today()}T00:00:00Z`).getTime();
  return Math.round((then - now) / 86_400_000);
};

const ExpiryCell = ({ expiryDate }) => {
  const days = daysToExpiry(expiryDate);
  if (!expiryDate) return <span className="ui-muted">—</span>;

  // Expiry is the reason batches are tracked, so a lot that is gone or nearly
  // gone says so instead of leaving the reader to compare dates.
  const tone =
    days === null ? '' : days < 0 ? 'text-[rgb(var(--neg))] font-medium' : days <= 30 ? 'text-[rgb(var(--warn-ink))]' : '';
  const note = days === null ? '' : days < 0 ? ' (expired)' : days <= 30 ? ` (${days}d left)` : '';

  return (
    <span className={tone}>
      {expiryDate}
      {note}
    </span>
  );
};

export default function BatchSerialManager() {
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [batches, setBatches] = useState([]);
  const [serials, setSerials] = useState([]);

  const [lot, setLot] = useState({ batchNo: '', qty: '', mfgDate: '', expiryDate: '' });
  const [serialText, setSerialText] = useState('');
  const [issueText, setIssueText] = useState('');

  const selected = useMemo(() => items.find((i) => String(i.id) === String(itemId)) || null, [items, itemId]);
  const mode = selected?.trackBy || 'NONE';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listItems();
        if (cancelled) return;
        // Only tracked items are offered: picking an untracked one would only
        // ever produce a rejection from the server.
        setItems((rows?.items || []).filter((i) => i.trackBy && i.trackBy !== 'NONE'));
        setError('');
      } catch (e) {
        if (!cancelled) setError(String(e?.message || 'Could not load items.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!itemId) {
      setBatches([]);
      setSerials([]);
      return;
    }
    try {
      if (mode === 'BATCH') setBatches(await listBatches({ itemId }));
      if (mode === 'SERIAL') setSerials(await listSerials({ itemId }));
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load tracking records.'));
    }
  }, [itemId, mode]);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      setError('');
      done?.();
      await reload();
    } catch (e) {
      setError(String(e?.message || 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const onReceive = (e) => {
    e.preventDefault();
    run(
      () =>
        receiveBatch({
          itemId,
          batchNo: lot.batchNo.trim(),
          qty: Number(lot.qty),
          mfgDate: lot.mfgDate || null,
          expiryDate: lot.expiryDate || null,
        }),
      () => setLot({ batchNo: '', qty: '', mfgDate: '', expiryDate: '' })
    );
  };

  const onIssueLot = (batch) => {
    const raw = window.prompt(`Issue how many from ${batch.batchNo}? (${batch.qtyOnHand} on hand)`, '1');
    if (raw === null) return;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter a quantity greater than zero.');
      return;
    }
    run(() => issueBatch(batch.id, qty));
  };

  /** Scanners emit one code per line; commas are accepted for pasted lists. */
  const splitCodes = (text) =>
    String(text || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const onRegisterSerials = (e) => {
    e.preventDefault();
    const serialNos = splitCodes(serialText);
    if (!serialNos.length) {
      setError('Enter at least one serial number.');
      return;
    }
    run(() => registerSerials({ itemId, serialNos }), () => setSerialText(''));
  };

  const onIssueSerials = (e) => {
    e.preventDefault();
    const serialNos = splitCodes(issueText);
    if (!serialNos.length) {
      setError('Enter at least one serial number.');
      return;
    }
    run(() => issueSerials({ serialNos }), () => setIssueText(''));
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="items"
        title="Batches and serial numbers"
      />

      {error ? (
        <div className="rounded-lg border border-[rgb(var(--neg)/0.35)] bg-[rgb(var(--neg-soft))] px-4 py-3 text-sm text-[rgb(var(--neg))]">{error}</div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No tracked items yet"
          description="Set an item's tracking to Batch or Serial under Master Data → Items, and it will appear here."
        />
      ) : (
        <>
          <div className="ui-card p-4">
            <label className="ui-label" htmlFor="batchserialmanager-item">Item</label>
            <select id="batchserialmanager-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className="ui-select max-w-lg">
              <option value="">Select a tracked item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} — tracked by {String(i.trackBy).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          {mode === 'BATCH' ? (
            <>
              <form onSubmit={onReceive} className="ui-card p-4 space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Plus size={16} /> Receive into a lot
                </h3>
                <p className="text-xs ui-muted">
                  Receiving a lot number that already exists adds to it rather than creating a second one.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="ui-label" htmlFor="batchserialmanager-lot-number">Lot number *</label>
                    <input id="batchserialmanager-lot-number"
                      value={lot.batchNo}
                      onChange={(e) => setLot((p) => ({ ...p, batchNo: e.target.value }))}
                      className="ui-input"
                      required
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="batchserialmanager-quantity">Quantity *</label>
                    <input id="batchserialmanager-quantity"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={lot.qty}
                      onChange={(e) => setLot((p) => ({ ...p, qty: e.target.value }))}
                      className="ui-input"
                      required
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="batchserialmanager-manufactured">Manufactured</label>
                    <input id="batchserialmanager-manufactured"
                      type="date"
                      value={lot.mfgDate}
                      onChange={(e) => setLot((p) => ({ ...p, mfgDate: e.target.value }))}
                      className="ui-input"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="batchserialmanager-expires">Expires</label>
                    <input id="batchserialmanager-expires"
                      type="date"
                      value={lot.expiryDate}
                      onChange={(e) => setLot((p) => ({ ...p, expiryDate: e.target.value }))}
                      className="ui-input"
                    />
                  </div>
                </div>
                <button type="submit" disabled={busy || !itemId} className="ui-btn ui-btn-primary disabled:opacity-50">
                  {busy ? 'Saving…' : 'Receive'}
                </button>
              </form>

              <div className="ui-card overflow-x-auto">
                <div className="px-4 py-3 border-b flex items-center gap-2">
                  <AlertTriangle size={16} className="ui-muted" />
                  <span className="text-sm ui-muted">Soonest expiry first — the order stock should leave in.</span>
                </div>
                <table className="ui-table w-full text-sm">
                  <thead>
                    <tr className="text-left ui-muted">
                      <th className="px-4 py-2">Lot</th>
                      <th className="px-4 py-2">Expires</th>
                      <th className="px-4 py-2 text-right">On hand</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center ui-muted">
                          No lots for this item yet.
                        </td>
                      </tr>
                    ) : (
                      batches.map((b) => (
                        <tr key={b.id} className="border-t">
                          <td className="ui-col-id px-4 py-2">{b.batchNo}</td>
                          <td className="ui-col-date px-4 py-2">
                            <ExpiryCell expiryDate={b.expiryDate} />
                          </td>
                          <td className="ui-col-amount px-4 py-2 text-right tabular-nums">{b.qtyOnHand}</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              disabled={busy || Number(b.qtyOnHand) <= 0}
                              onClick={() => onIssueLot(b)}
                              className="ui-btn ui-btn-ghost disabled:opacity-40"
                            >
                              Issue
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {mode === 'SERIAL' ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <form onSubmit={onRegisterSerials} className="ui-card p-4 space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <ScanLine size={16} /> Register units into stock
                  </h3>
                  <p className="text-xs ui-muted">
                    One serial per line. The whole list is rejected if any of them is already registered, so a
                    part-accepted scan cannot leave you guessing which landed.
                  </p>
                  <textarea
                    rows={5}
                    value={serialText}
                    onChange={(e) => setSerialText(e.target.value)}
                    className="ui-input font-mono text-sm"
                    placeholder={'SN-0001\nSN-0002'}
                  />
                  <button type="submit" disabled={busy || !itemId} className="ui-btn ui-btn-primary disabled:opacity-50">
                    {busy ? 'Saving…' : 'Register'}
                  </button>
                </form>

                <form onSubmit={onIssueSerials} className="ui-card p-4 space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Hash size={16} /> Issue units out
                  </h3>
                  <p className="text-xs ui-muted">
                    A unit that is already out is refused rather than sold twice.
                  </p>
                  <textarea
                    rows={5}
                    value={issueText}
                    onChange={(e) => setIssueText(e.target.value)}
                    className="ui-input font-mono text-sm"
                    placeholder={'SN-0001'}
                  />
                  <button type="submit" disabled={busy} className="ui-btn ui-btn-secondary disabled:opacity-50">
                    {busy ? 'Saving…' : 'Issue'}
                  </button>
                </form>
              </div>

              <div className="ui-card overflow-x-auto">
                <table className="ui-table w-full text-sm">
                  <thead>
                    <tr className="text-left ui-muted">
                      <th className="px-4 py-2">Serial</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Issued against</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serials.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center ui-muted">
                          No units registered for this item yet.
                        </td>
                      </tr>
                    ) : (
                      serials.map((s) => (
                        <tr key={s.id} className="border-t">
                          <td className="ui-col-id px-4 py-2 font-mono">{s.serialNo}</td>
                          <td className="ui-col-meta px-4 py-2">{s.status}</td>
                          <td className="ui-col-meta px-4 py-2 ui-muted">
                            {s.issuedDocType ? `${s.issuedDocType} ${s.issuedDocId || ''}` : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
