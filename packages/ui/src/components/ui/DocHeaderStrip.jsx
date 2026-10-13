import React, { useEffect, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import DocNumberingPopover from '../DocNumberingPopover';

/**
 * Compact document header: number and dates on one tight line at the top of an
 * entry form.
 *
 * Operators coming from Tally expect the voucher number and date to be small,
 * always in the same place, and out of the way — the body of the document is
 * what they are actually typing. Focus lands on the first field that accepts
 * input so a new entry can be typed without touching the mouse.
 */
export const DocHeaderStrip = ({
  numberLabel = 'No.',
  number,
  onNumberChange,
  numberLocked = false,
  numberHint = '',
  numberError = '',
  dateError = '',
  date,
  onDateChange,
  dueDate,
  onDueDateChange,
  dueDateLabel = 'Due',
  extra = null,
  /*
   * The series behind the number, when the caller has one.
   *
   * Same gear as the invoice and the bill carry, on the same field, so a
   * prefix can be corrected without leaving a half-typed voucher. Absent, the
   * strip is exactly what it was.
   */
  numbering = null,
  autoFocusTarget = 'auto',
}) => {
  const numberRef = useRef(null);
  const numberingBtnRef = useRef(null);
  const [numberingOpen, setNumberingOpen] = React.useState(false);
  const dateRef = useRef(null);

  useEffect(() => {
    if (autoFocusTarget === 'none') return;
    // A locked number cannot be typed into, so focus moves to the date.
    const target = numberLocked ? dateRef.current : numberRef.current;
    target?.focus();
    // Only on mount: re-focusing on every keystroke would fight the operator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="ui-panel px-3 py-2 flex flex-wrap items-end gap-x-4 gap-y-2"
      style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}
    >
      <div className="min-w-[9rem]">
        <label className="ui-label !mb-0.5 !text-xs" htmlFor="doc-number">
          {numberLabel}
        </label>
        <div className="relative w-36">
          <input
            id="doc-number"
            ref={numberRef}
            type="text"
            value={number ?? ''}
            onChange={(e) => onNumberChange?.(e.target.value)}
            disabled={numberLocked}
            required
            aria-invalid={numberError ? true : undefined}
            aria-describedby={numberError ? 'doc-number-error' : undefined}
            data-invalid={numberError ? 'true' : undefined}
            className={`ui-input ui-mono !min-h-0 !py-1 !text-sm w-full${numbering ? ' pe-8' : ''}`}
          />
          {numbering ? (
            <button
              type="button"
              ref={numberingBtnRef}
              onClick={() => setNumberingOpen((v) => !v)}
              className="absolute end-1 top-1/2 -translate-y-1/2 ui-icon-btn"
              aria-label={`${numbering.title || 'Document'} settings`}
              aria-haspopup="dialog"
              aria-expanded={numberingOpen}
      title="Numbering"
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
            </button>
          ) : null}
          {numbering && numberingOpen ? (
            <DocNumberingPopover
              anchorRef={numberingBtnRef}
              db={numbering.db}
              setDb={numbering.setDb}
              currentCompany={numbering.currentCompany}
              voucherKey={numbering.voucherKey}
      title={numbering.title}
              sampleLabel={numbering.sampleLabel}
              manualLabel={numbering.manualLabel}
              branchId={numbering.branchId ?? null}
              settings={numbering.settings}
              onClose={() => setNumberingOpen(false)}
              onOpenFullSettings={() => {
                setNumberingOpen(false);
                numbering.onOpenFullSettings?.();
              }}
            />
          ) : null}
        </div>
        {numberError ? (
          <p id="doc-number-error" role="alert" className="ui-field-error">
            {numberError}
          </p>
        ) : null}
      </div>

      <div>
        <label className="ui-label !mb-0.5 !text-xs" htmlFor="doc-date">
          Date
        </label>
        <input
          id="doc-date"
          ref={dateRef}
          type="date"
          value={date ?? ''}
          onChange={(e) => onDateChange?.(e.target.value)}
          required
          aria-invalid={dateError ? true : undefined}
          data-invalid={dateError ? 'true' : undefined}
          className="ui-input !min-h-0 !py-1 !text-sm !w-40"
        />
        {dateError ? <p role="alert" className="ui-field-error">{dateError}</p> : null}
      </div>

      {onDueDateChange ? (
        <div>
          <label className="ui-label !mb-0.5 !text-xs" htmlFor="doc-due">
            {dueDateLabel}
          </label>
          <input
            id="doc-due"
            type="date"
            value={dueDate ?? ''}
            onChange={(e) => onDueDateChange(e.target.value)}
            className="ui-input !min-h-0 !py-1 !text-sm !w-40"
          />
        </div>
      ) : null}

      {extra}

      {numberHint ? <div className="ui-subtle text-xs pb-1 ml-auto">{numberHint}</div> : null}
    </div>
  );
};

export default DocHeaderStrip;
