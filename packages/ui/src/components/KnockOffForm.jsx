import React, { useMemo, useState } from 'react';

import { notify } from './ui/notify';
import { formatMoney } from '../utils/money';
import { noteBalance, openDocumentsForParty, suggestAllocation } from '../utils/onAccount';

/**
 * Knock a note raised on account off against the documents it should reduce.
 *
 * The oldest open documents are proposed first, because that is what most
 * businesses do and it saves the typing. Every figure stays editable, nothing
 * may exceed what a document still owes, and the total may not exceed what the
 * note still has on account — the two ends of the arithmetic that make this
 * safe to leave to whoever is holding the paperwork.
 */
const KnockOffForm = ({
  note,
  documents,
  notes,
  currentCompany,
  partyKey,
  docLabel = 'bill',
  onCancel,
  onConfirm,
}) => {
  const balance = useMemo(() => noteBalance(note), [note]);

  const openRows = useMemo(
    () =>
      openDocumentsForParty(documents, notes, {
        companyId: currentCompany?.id,
        partyKey,
        partyId: note?.[partyKey],
      }),
    [documents, notes, currentCompany?.id, partyKey, note]
  );

  const [amounts, setAmounts] = useState(() => {
    const seeded = {};
    for (const a of suggestAllocation(balance.unsettled, openRows)) seeded[a.docId] = String(a.amount);
    return seeded;
  });

  const entered = useMemo(
    () =>
      Math.round(
        Object.values(amounts).reduce((t, v) => t + (Number(v) || 0), 0) * 100
      ) / 100,
    [amounts]
  );

  const remaining = Math.round((balance.unsettled - entered) * 100) / 100;

  const submit = () => {
    const allocations = Object.entries(amounts)
      .map(([docId, v]) => ({ docId, amount: Math.round((Number(v) || 0) * 100) / 100 }))
      .filter((a) => a.amount > 0);

    if (!allocations.length) {
      notify.error(`Enter what to knock off against at least one ${docLabel}.`);
      return;
    }
    if (entered > balance.unsettled + 0.0001) {
      notify.error(
        `That is ${formatMoney(entered - balance.unsettled, currentCompany)} more than this note has left on account.`
      );
      return;
    }
    for (const a of allocations) {
      const row = openRows.find((r) => String(r.doc.id) === String(a.docId));
      if (!row) continue;
      if (a.amount > row.outstanding + 0.0001) {
        notify.error(
          `${row.doc.number} only has ${formatMoney(row.outstanding, currentCompany)} outstanding.`
        );
        return;
      }
    }

    onConfirm?.(allocations);
  };

  return (
    <div className="space-y-6">
      <div className="ui-sunken rounded-xl p-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
        <span>
          <span className="ui-muted">Note</span> <span>{note?.number}</span>
        </span>
        <span>
          <span className="ui-muted">Value</span>{' '}
          <span className="ui-money">{formatMoney(balance.total, currentCompany)}</span>
        </span>
        <span>
          <span className="ui-muted">On account</span>{' '}
          <span className="ui-money text-[rgb(var(--brand))]">
            {formatMoney(balance.unsettled, currentCompany)}
          </span>
        </span>
      </div>

      {openRows.length === 0 ? (
        <div className="ui-card p-6 text-center text-sm ui-muted">
          This party has no open {docLabel}s to knock against. The value stays on account until one exists.
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <table className="ui-table w-full">
            <thead className="ui-sunken border-b">
              <tr>
                <th className="ui-th">Document</th>
                <th className="ui-th ui-col-h-center">Date</th>
                <th className="ui-th ui-num">Outstanding</th>
                <th className="ui-th ui-num w-40">Knock off</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {openRows.map((row) => (
                <tr key={row.doc.id} className="ui-hover-sunken">
                  <td className="px-3 py-2">{row.doc.number}</td>
                  <td className="px-3 py-2 ui-muted">{row.doc.date}</td>
                  <td className="ui-money px-3 py-2 text-right">{formatMoney(row.outstanding, currentCompany)}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      max={row.outstanding}
                      value={amounts[String(row.doc.id)] ?? ''}
                      onChange={(e) =>
                        setAmounts((prev) => ({ ...prev, [String(row.doc.id)]: e.target.value }))
                      }
                      className="ui-input w-full px-2 py-1 text-right"
                      placeholder="0.00"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <div className="ui-muted">
          Allocating <span className="ui-money ui-fg">{formatMoney(entered, currentCompany)}</span>
          {remaining > 0.0001 ? (
            <>
              {' '}
              · <span className="ui-money ui-fg">{formatMoney(remaining, currentCompany)}</span> stays on account
            </>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="ui-btn ui-btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={submit} className="ui-btn ui-btn-primary" disabled={openRows.length === 0}>
            Knock off
          </button>
        </div>
      </div>
    </div>
  );
};

export default KnockOffForm;
