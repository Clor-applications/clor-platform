import { Calendar } from 'lucide-react';

import { formatDateIn } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import { StatusPill } from '../ui/Primitives';

/**
 * What a column *means*, rather than what it should look like.
 *
 * A list used to decide its own colours cell by cell, so the balance column in
 * Invoices and the balance column in Bills could disagree about what an unpaid
 * figure looks like, and the next list to be built would guess again. A column
 * declares its semantic type here and the appearance follows from that — which
 * is the only way the answer stays the same across invoices, quotations, sales
 * orders, purchases and receipts.
 *
 * Two rules hold throughout:
 *
 *   - Colour is never the only signal. A due date that is overdue is also
 *     heavier and carries a red glyph; a settled balance says "Settled" in
 *     words. Anyone who cannot separate the hues still gets the meaning.
 *   - Restraint. Cells are text on white. The tinted chip is spent on status,
 *     where the value *is* a category, and nowhere else.
 */

/** A due date is only urgent relative to a day and to whether anything is owed. */
export const dueUrgency = (dueIso, { balance = 0, todayIso } = {}) => {
  const due = String(dueIso || '').slice(0, 10);
  if (!due) return 'none';
  if (Number(balance) <= 0) return 'none'; // paid in full: the date stops mattering
  const today = todayIso || new Date().toISOString().slice(0, 10);
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'future';
};

/**
 * The document's own number: the one piece of text in a row meant to be
 * clicked, so it is styled as the link it is rather than as body text.
 */
export const InvoiceIdentifier = ({ value, onOpen = null, label = 'document' }) => {
  const text = String(value || '').trim() || '—';
  if (!onOpen) return <span className="ui-cell-ref">{text}</span>;
  return (
    <button
      type="button"
      className="ui-cell-ref"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`Open ${label} ${text}`}
    >
      {text}
    </button>
  );
};

/** An issue date. Neutral, because nothing is at stake in it. */
export const DateCell = ({ value, withIcon = true }) => {
  const iso = String(value || '').slice(0, 10);
  if (!iso) return <span className="ui-cell-date">—</span>;
  return (
    /* Read as dd/mm/yyyy, stored as ISO — `dateTime` keeps the machine-readable
       value on the element for anything that copies or scrapes it. */
    <time className="ui-cell-date" dateTime={iso}>
      {withIcon ? <Calendar size={14} aria-hidden="true" /> : null}
      {formatDateIn(iso)}
    </time>
  );
};

/**
 * A due date, which earns colour only when it is owed and late — or owed and
 * due today. The word in `title` carries the same meaning without the hue.
 */
export const DueDateCell = ({ value, balance = 0, todayIso = null, withIcon = true }) => {
  const text = String(value || '').slice(0, 10);
  if (!text) return <span className="ui-cell-date">—</span>;
  const urgency = dueUrgency(text, { balance, todayIso });
  const note = urgency === 'overdue' ? 'Overdue' : urgency === 'today' ? 'Due today' : '';
  return (
    <time className="ui-cell-date" dateTime={text} data-urgency={urgency} title={note || undefined}>
      {withIcon ? <Calendar size={14} aria-hidden="true" /> : null}
      {formatDateIn(text)}
      {note ? <span className="sr-only"> — {note}</span> : null}
    </time>
  );
};

const Figure = ({ role, value, company, zeroAs = null }) => {
  const n = Number(value || 0);
  if (zeroAs && n === 0) return <span className="ui-cell-settled">{zeroAs}</span>;
  return (
    <span className="ui-cell-money" data-role={role}>
      {formatMoney(n, company)}
    </span>
  );
};

/** The document total: the figure the row is about. */
export const Money = (p) => <Figure role="amount" {...p} />;
/** Money that has arrived. */
export const PaidMoney = (p) => <Figure role="paid" {...p} />;
/** Money still owed, in time. */
export const OutstandingMoney = (p) => <Figure role="outstanding" {...p} />;
/** Money still owed, past its date. */
export const OverdueMoney = (p) => <Figure role="overdue" {...p} />;
/** Money going the other way — a credit note, a refund. */
export const CreditMoney = (p) => <Figure role="credit" {...p} />;

/** The status of the document, in the colours the filter tabs use. */
export const StatusBadge = ({ status, reason = '' }) => <StatusPill status={status} reason={reason} />;

/**
 * What is left to collect. Nothing owed is stated in words rather than as a
 * zero — "Settled" is the answer to the question the column asks, and a row of
 * ₹0.00 reads as missing data.
 */
export const Balance = ({ value, company, dueIso = null, todayIso = null }) => {
  const n = Number(value || 0);
  if (n <= 0) return <span className="ui-cell-settled">Settled</span>;
  const late = dueUrgency(dueIso, { balance: n, todayIso }) === 'overdue';
  return <Figure role={late ? 'overdue' : 'outstanding'} value={n} company={company} />;
};

/**
 * The registry a column config points at, so a new column picks a meaning
 * rather than a colour. Adding a column without choosing one of these is the
 * thing this module exists to prevent.
 */
export const CELL_TYPES = {
  invoiceIdentifier: InvoiceIdentifier,
  date: DateCell,
  dueDate: DueDateCell,
  money: Money,
  paidMoney: PaidMoney,
  outstandingMoney: OutstandingMoney,
  overdueMoney: OverdueMoney,
  creditMoney: CreditMoney,
  statusBadge: StatusBadge,
  balance: Balance,
};

export default CELL_TYPES;
