import React, { useState } from 'react';
import { ListTree, Plus, ReceiptText, Trash2 } from 'lucide-react';

import LedgerField from '../../components/pickers/LedgerField';
import { allocationSummary, emptyAllocationRow } from './allocationLines';

/**
 * Where the money goes, line by line.
 *
 * The same table on a payment and on a receipt — only the heading and the
 * direction of the sentence underneath it change — because they are the same
 * accounting act seen from either side: one line against the bank, several
 * against everything else.
 *
 * What it deliberately does not do is hide the arithmetic. The figure still to
 * be placed is printed at the foot in the colour of a problem while it is not
 * zero, because the alternative is a save button that refuses with a toast and
 * a person hunting for the fifty rupees.
 */
export const AllocationTable = ({
  rows,
  onChange,
  ledgerOptions,
  amount,
  documentTotal = 0,
  documentLabel = '',
  heading = 'Payment allocation',
  noun = 'payment',
  money,
  disabled = false,
  /* Only needed to create a ledger from the row; without them the field is a
     type-ahead over `ledgerOptions` and nothing more. */
  db = null,
  setDb = null,
  currentCompany = null,
  /*
   * What a given row is, asked per row.
   *
   * A row whose ledger is a customer's control account can say which of that
   * customer's invoices the money settled, so it carries the link that opens
   * the dialog and a word for where the money went. Every other row is
   * already the whole answer. Returning `{}` is the ordinary case.
   */
  rowMeta = null,
}) => {
  const meta = (i) => (typeof rowMeta === 'function' ? rowMeta(i) || {} : {});
  const summary = allocationSummary({ rows, documentTotal, amount });
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /*
   * A row arriving or leaving, with a bridge.
   *
   * Both used to happen in a single frame, so the rows below a deleted one
   * jumped up under the cursor — the jarring change motion exists to prevent.
   * `leaving` holds the row on screen while its cells collapse; `entering`
   * fades the new one in. Both are indices, because the rows have no id of
   * their own and the caller owns the array.
   */
  const [leaving, setLeaving] = useState(null);
  const [entering, setEntering] = useState(null);

  const add = () => {
    setEntering(rows.length);
    onChange([...rows, emptyAllocationRow()]);
    setTimeout(() => setEntering(null), 200);
  };

  const remove = (i) => {
    if (leaving !== null) return;
    setLeaving(i);
    setTimeout(() => {
      setLeaving(null);
      onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyAllocationRow()]);
    }, 140);
  };

  return (
    <section>
      <div className="mb-3">
        <div className="ui-sec-head" style={{ marginBottom: '0.125rem' }}>
          <span className="ui-sec-mark" aria-hidden="true"><ListTree size={16} /></span>
          <h3>{heading}</h3>
        </div>
        <p className="ui-caption">
          Pick a ledger and enter the amount. Against a customer, the
          outstanding invoices open so the {noun} can be placed on them.
        </p>
      </div>

      <div className="border ui-border-c rounded-xl overflow-hidden">
        <table className="ui-table w-full">
          <thead className="ui-sunken">
            <tr>
              <th className="ui-th w-8 px-2">#</th>
              {/*
                The ledger used to take 42% and the amount was pushed to the
                far right of whatever was left, so a figure sat half a screen
                from the row it belonged to. Fixed widths, and the bills get a
                column of their own rather than sharing the amount's cell.
              */}
              <th className="ui-th" style={{ width: '34%' }}>
                Ledger <span className="text-[rgb(var(--neg))]">*</span>
              </th>
              <th className="ui-th ui-num" style={{ width: '20%' }}>
                Amount <span className="text-[rgb(var(--neg))]">*</span>
              </th>
              <th className="ui-th" style={{ width: '24%' }}>Outstanding Bills</th>
              <th className="ui-th w-16 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, i) => (
              <tr
                key={i}
                data-leaving={leaving === i ? 'true' : undefined}
                data-entering={entering === i ? 'true' : undefined}
              >
                <td className="px-2 py-2 ui-muted text-sm">
                  <div className="ui-row-slot"><div>{i + 1}</div></div>
                </td>
                <td className="px-3 py-2">
                  <div className="ui-row-slot"><div>
                  {/* Typed, not hunted for. A select holding every ledger in
                      the book is a scroll through a hundred names to reach one
                      you already knew, and it cannot offer the ledger that
                      does not exist yet. */}
                  <LedgerField
                    db={db}
                    setDb={setDb}
                    currentCompany={currentCompany}
                    options={ledgerOptions}
                    value={row.ledgerId || ''}
                    onChange={(id) => set(i, { ledgerId: id })}
                    ariaLabel={`Account, allocation row ${i + 1}`}
                    disabled={disabled}
                    canCreate={Boolean(setDb && currentCompany)}
                  />
                  </div></div>
                </td>
                <td className="px-3 py-2">
                  <div className="ui-row-slot"><div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount ?? ''}
                    onChange={(e) => set(i, { amount: e.target.value })}
                    onBlur={() => meta(i).onAmountSettled?.()}
                    className="ui-input ui-input-plain ui-mono w-full text-right"
                    placeholder="0.00"
                    aria-label={`Amount, allocation row ${i + 1}`}
                    disabled={disabled}
                  />
                  </div></div>
                </td>

                {/* A customer's row can say which of their invoices the money
                    settled. Every other ledger is the whole answer already, so
                    its cell stays empty rather than offering a dialog with
                    nothing to put in it. */}
                <td className="px-3 py-2">
                  <div className="ui-row-slot"><div>
                  {meta(i).isParty ? (
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {/* A button rather than a link: it opens a dialog that
                          changes the row, which is an action, and the drawing
                          gives it a mark so the one row that has this is
                          findable without reading every row. */}
                      <button
                        type="button"
                        onClick={meta(i).onViewBills}
                        className="ui-btn ui-btn-secondary ui-btn-sm w-fit"
                        disabled={disabled}
                      >
                        <ReceiptText size={14} aria-hidden="true" />
                        View Bills
                        {meta(i).available > 0 ? (
                          <span
                            /* 12px is the floor of the scale; this count sat
                               at 11. Tracking keeps the digits from crowding
                               now that they are a step larger. */
                            className="ms-0.5 inline-flex items-center justify-center rounded-full px-1.5 text-xs tracking-wide ui-mono"
                            style={{
                              backgroundColor: 'rgb(var(--brand))',
                              color: 'rgb(var(--on-brand))',
                              minWidth: '1.125rem',
                            }}
                          >
                            {meta(i).available}
                          </span>
                        ) : null}
                      </button>
                      {meta(i).status ? (
                        <span className="ui-caption truncate">{meta(i).status}</span>
                      ) : null}
                    </div>
                  ) : null}
                  </div></div>
                </td>
                <td className="px-2 py-2 text-center">
                  {!disabled ? (
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="ui-icon-btn"
                      aria-label={`Remove allocation row ${i + 1}`}
                    >
                      <Trash2 size={16} className="text-[rgb(var(--neg))]" aria-hidden="true" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ui-sunken border-t px-3 py-2 text-sm flex flex-wrap items-center justify-end gap-x-6 gap-y-1">
          {/* The document side, named, so it is obvious the bills are inside
              this total and not a second one competing with it. */}
          {summary.documentTotal > 0 ? (
            <span className="ui-muted">
              {documentLabel || 'Documents'} <span className="ui-money ms-1">{money(summary.documentTotal)}</span>
            </span>
          ) : null}
          <span className="ui-muted">
            Total allocated <span className="ui-money ms-1">{money(summary.allocated)}</span>
          </span>
          {/* The one figure on this form the user is steering toward, so the
              arrival at zero is worth seeing rather than blinking into place. */}
          {summary.allocated > 0 || summary.unallocated > 0 ? (
            <span
              style={{
                color: summary.balanced ? 'rgb(var(--pos))' : 'rgb(var(--neg))',
                transition: 'color var(--dur-surface) var(--ease-out)',
              }}
            >
              {summary.balanced ? 'Fully allocated' : 'Unallocated'}
              {summary.balanced ? null : <span className="ui-money ms-1">{money(summary.unallocated)}</span>}
            </span>
          ) : null}
        </div>
      </div>

      {/* Under the rows it adds to, where the next row will appear — it was
          up in the heading, as far from the thing it does as the section is
          tall. */}
      {!disabled ? (
        <button type="button" onClick={add} className="ui-btn ui-btn-soft ui-btn-sm mt-3">
          <Plus size={16} aria-hidden="true" /> Add Row
        </button>
      ) : null}


    </section>
  );
};

export default AllocationTable;
