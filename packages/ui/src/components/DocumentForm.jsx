import React, { useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

import Popover from './ui/Popover';

/**
 * The chrome every document form shares.
 *
 * Invoices, bills, purchase orders, estimates, credit notes and the rest are
 * the same shape of screen: a few header fields, a grid of lines, a totals
 * block, and one place to save. They had drifted into different shapes —
 * actions at the bottom on one, the top on another, a ⋮ on one and nothing on
 * the next — so learning one taught you nothing about the others.
 *
 * These are the pieces, not a template. A bill is not an invoice and should
 * not be forced through one component; what it should share is where the
 * primary action sits, how a field row breathes, and what the foot of a
 * document looks like.
 */

/**
 * The action row: secondary, primary, then the ⋮.
 *
 * Top right, per the design system — and only ever one primary. `menu` is a
 * list of `{ key, label, icon, onSelect, danger, group }`; entries sharing a
 * `group` are kept together under its heading, because "preview this document"
 * and "change every document of this type" are different kinds of act and
 * mixing them is how somebody edits a template mid-invoice.
 *
 * Pass `title` (and optionally `onBack`) to make this the document's header
 * rather than a bare row of buttons: the name on the left, every way out of
 * the screen on the right. `sticky` then pins it to the top of the scroll
 * container, so Save is reachable from the twentieth line of a long invoice
 * without scrolling back up for it.
 */
export const DocFormActions = ({
  primaryLabel,
  onPrimary = null,
  primaryType = 'submit',
  secondaryLabel = '',
  onSecondary = null,
  menu = [],
  disabled = false,
  children = null,
  title = '',
  subtitle = '',
  onBack = null,
  backLabel = 'Back',
  sticky = false,
  /*
   * The bar is a card in its own right rather than the lid of one.
   *
   * The default assumes it sits inside a padded card and reaches out to that
   * card's edges with negative margins. A form built as stacked cards — header,
   * then the fields, then the tabs — wants the bar to be the whole of the first
   * card instead, and those margins would then pull it outside its own border.
   */
  ownCard = false,
}) => {
  const menuBtnRef = useRef(null);
  const [open, setOpen] = useState(false);

  const groups = [];
  menu.filter(Boolean).forEach((item) => {
    const name = item.group || '';
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(item);
    else groups.push({ name, items: [item] });
  });

  /*
   * As a plain row this sits flush right and tucks up under whatever preceded
   * it. As a header it spans the card it lives in — hence the negative
   * margins, which cancel the card's own padding — and carries a rule and a
   * solid background so lines scrolling under it stay legible.
   *
   * `top-0` is measured against #main-content, which owns the only scroll in
   * the shell; there is no app header to offset against inside it.
   */
  const shellClass = title
    ? ownCard
      ? `ui-card ui-page-heading flex items-center justify-between gap-3 flex-wrap px-5 py-4 ${sticky ? 'sticky top-0 z-30' : ''}`
      : // `rounded-t-xl` because the negative margins take this bar out to the
        // card's border box, where a square fill was overprinting the card's own
        // rounded top corners.
        `ui-page-heading flex items-center justify-between gap-3 flex-wrap -mx-4 -mt-4 mb-1 px-4 py-3 rounded-t-xl ${
          sticky ? 'sticky top-0 z-30' : ''
        }`
    : 'flex items-center justify-end gap-2 -mb-2';

  const shellStyle =
    title && !ownCard
      ? { backgroundColor: 'rgb(var(--surface))', borderBottom: '1px solid rgb(var(--border))' }
      : undefined;

  return (
    <div className={shellClass} style={shellStyle}>
      {title ? (
        <div className="min-w-0">
          <h3 className="ui-t-doc truncate">{title}</h3>
          {subtitle ? <div className="text-sm ui-muted truncate">{subtitle}</div> : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap justify-end">
      {children}
      {onBack ? (
        <button type="button" onClick={onBack} className="ui-btn ui-btn-secondary">
          {backLabel}
        </button>
      ) : null}
      {secondaryLabel ? (
        <button type="button" onClick={onSecondary} className="ui-btn ui-btn-secondary" disabled={disabled}>
          {secondaryLabel}
        </button>
      ) : null}
      <button type={primaryType} onClick={onPrimary} className="ui-btn ui-btn-primary" disabled={disabled}>
        {primaryLabel}
      </button>

      {menu.length ? (
        <>
          <button
            type="button"
            ref={menuBtnRef}
            onClick={() => setOpen((v) => !v)}
            className="ui-btn ui-btn-ghost !px-1.5"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <MoreVertical size={18} aria-hidden="true" />
          </button>
          {open ? (
            <Popover anchorRef={menuBtnRef} onClose={() => setOpen(false)} minWidth={230}>
              <div className="py-1" role="menu">
                {groups.map((group, gi) => (
                  <React.Fragment key={group.name || `g${gi}`}>
                    {gi ? <div className="my-1" style={{ borderTop: '1px solid rgb(var(--border))' }} /> : null}
                    {group.name ? <div className="ui-caption px-3 pt-1 pb-1.5">{group.name}</div> : null}
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.key}
                          type={item.submit ? 'submit' : 'button'}
                          role="menuitem"
                          onClick={() => {
                            setOpen(false);
                            item.onSelect?.();
                          }}
                          className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))] ${
                            item.danger ? 'text-[rgb(var(--neg-ink))]' : ''
                          }`}
                        >
                          {Icon ? <Icon size={16} aria-hidden="true" /> : null}
                          {item.label}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </Popover>
          ) : null}
        </>
      ) : null}
      </div>
    </div>
  );
};

/** A row of header fields. Four across on a desktop, one on a phone. */
export const FormRow = ({ children, className = '', divided = false }) => (
  <div
    className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 ${divided ? 'pt-4' : ''} ${className}`}
    style={divided ? { borderTop: '1px solid rgb(var(--border))' } : undefined}
  >
    {children}
  </div>
);

/** One labelled field. `required` prints the marker the footer explains. */
export const Field = ({ label, htmlFor, required = false, hint = '', children, className = '', span = 1 }) => (
  <div className={`${span > 1 ? `lg:col-span-${span}` : ''} ${className}`}>
    <label htmlFor={htmlFor} className="ui-label">
      {label}
      {required ? <span className="ml-1 text-[rgb(var(--neg-ink))]">*</span> : null}
    </label>
    {children}
    {hint ? <p className="mt-1 text-xs ui-muted">{hint}</p> : null}
  </div>
);

/**
 * The foot of a document: the amount, written out.
 *
 * A GST invoice carries the sum in words and this prints on the document, so
 * the words earn their place. The numeral beside them did not: it sat directly
 * under the Total in the column above and again above the running total at the
 * foot, which put the same figure on screen three times and made a reader
 * check whether the three agreed. Words on their own say the thing the
 * numerals cannot.
 */
export const AmountInWordsBand = ({ words }) => (
  <div className="rounded-xl px-4 py-3" style={{ background: 'rgb(var(--accent-soft))' }}>
    <div className="ui-caption">Amount in words</div>
    <div className="text-sm">{words}</div>
  </div>
);

/**
 * The line under a document: what the asterisks meant, and the declaration.
 *
 * Both belong at the foot rather than the head — a required-field note read
 * before any field has been seen tells nobody anything.
 */
export const DocFormFootnote = ({ declaration = '' }) => (
  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
    <p className="text-xs" style={{ color: 'rgb(var(--neg-ink))' }}>
      * Indicates mandatory fields
    </p>
    {declaration ? (
      <p className="text-xs ui-muted flex-1 min-w-0 min-w-[16rem]">
        <span className="font-medium">Declaration:</span> {declaration}
      </p>
    ) : null}
  </div>
);

export default DocFormActions;
