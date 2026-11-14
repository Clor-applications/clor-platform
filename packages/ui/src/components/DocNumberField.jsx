import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from '@ui/components/ui/lineIcons';

import DocNumberingPopover from './DocNumberingPopover';
import VoucherSeriesSelect from './VoucherSeriesSelect';
import { formatVoucherNumberPreview } from '../utils/docSettings';

/**
 * A document's number, with the series it came from on the field itself.
 *
 * The invoice and the bill each grew this separately — a relative wrapper, an
 * icon button, a popover and the state to open it — and every other document
 * had none, so changing a purchase order's prefix meant leaving a half-typed
 * order for Settings. Written once here, it is four lines at each call site,
 * which is the difference between "every form has it" and "the two forms
 * somebody got round to".
 *
 * The gear sits on the field it governs. A series is nearly always realised to
 * be wrong WHILE a document is being typed — the year turned over, or the
 * prefix is last company's — and sending somebody to Settings at that moment
 * costs them the document.
 */
const DocNumberField = ({
  id,
  label,
  value,
  onChange,
  disabled = false,
  required = false,
  /* Which series: the key under `docSettings.numbering`. */
  voucherKey,
  /* What the panel calls itself, and what it calls the next number. */
  title,
  sampleLabel,
  manualLabel,
  branchId = null,
  settings,
  db,
  setDb,
  currentCompany,
  onOpenFullSettings = null,
  className = '',
  children = null,
  seriesInHeader = true,
}) => {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [headerSlot, setHeaderSlot] = useState(null);
  const containerRef = useCallback((node) => {
    if (node) setHeaderSlot(node.closest('form')?.querySelector('[data-doc-series-slot]') || null);
  }, []);
  const seriesPicker = seriesInHeader ? <VoucherSeriesSelect db={db} setDb={setDb} currentCompany={currentCompany} voucherKey={voucherKey} branchId={branchId} onNumberChange={(number) => onChange?.({ target: { value: number } })} onSelect={() => setOpen(false)} /> : null;

  return (
    <div className={className} ref={containerRef}>
      <label className="ui-label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value ?? ''}
          onChange={onChange}
          disabled={disabled}
          required={required}
          className={`ui-input ui-mono w-full pe-9 ${disabled ? 'ui-sunken' : ''}`}
        />
        <button
          type="button"
          ref={btnRef}
          onClick={() => setOpen(true)}
          className="absolute end-1 top-1/2 -translate-y-1/2 ui-icon-btn !h-7 !w-7"
          aria-label={`${title || 'Document'} settings`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Numbering"
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
        </button>
      </div>
      {seriesPicker ? (headerSlot ? createPortal(seriesPicker, headerSlot) : <div className="mt-1.5">{seriesPicker}</div>) : null}
      {children}
      {open ? (
        <DocNumberingPopover
          key={`${voucherKey}-${settings?.seriesId || 'default'}`}
          anchorRef={btnRef}
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          voucherKey={voucherKey}
          title={title}
          sampleLabel={sampleLabel}
          manualLabel={manualLabel}
          branchId={branchId}
          settings={settings}
          onSaved={(nextSettings) => {
            // The form owns the current number in local state. Keep that
            // field in sync when the series is edited from inside the form.
            // Every voucher form uses this shared field, so the fix applies
            // consistently to payments, receipts, invoices and all others.
            const nextNumber = nextSettings.mode === 'manual' || nextSettings.enabled === false ? '' : formatVoucherNumberPreview(nextSettings);
            onChange?.({ target: { value: nextNumber } });
          }}
          onClose={() => setOpen(false)}
          onOpenFullSettings={() => {
            setOpen(false);
            onOpenFullSettings?.();
          }}
        />
      ) : null}
    </div>
  );
};

export default DocNumberField;
