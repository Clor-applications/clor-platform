import { formatMoney } from '../../utils/money';
import { StatusPill } from '../ui/Primitives';
import {
  Balance,
  CreditMoney,
  DateCell,
  DueDateCell,
  InvoiceIdentifier,
  Money,
  OutstandingMoney,
  OverdueMoney,
  PaidMoney,
  dueUrgency,
} from '../table/cells';

/**
 * The document design system, in one place.
 *
 * Every screen that lists or edits a document — Sales, Purchases, CRM, Cash &
 * Bank, Expenses, Inventory, Journals — reaches for these rather than choosing
 * a colour. The point is not tidiness: it is that "overdue" has to look the
 * same on an invoice, a bill, a party statement and a stock transfer, and the
 * only way that holds is if none of those screens is allowed to decide.
 *
 * It began in Sales and the `Sales*` names are kept as aliases at the foot of
 * this file, because a bill is not a sale and importing `SalesStatusBadge`
 * into Purchases would teach the wrong thing.
 *
 * The palette is semantic, never decorative:
 *
 *   orange       the active module — navigation, selection, the primary action — navigation, the primary action, selection
 *   slate        draft — not yet real
 *   blue         sent, open, in progress
 *   purple       partially paid, pending, and money going back out
 *   green        paid, received, completed
 *   amber        outstanding, due soon
 *   red          overdue, rejected, failed
 *   dark grey    cancelled, closed, expired
 *
 * Two rules hold everywhere. Colour is never the only signal — a state that
 * matters carries a word or a glyph as well. And surfaces stay white: colour
 * arrives as text, a tinted chip, an icon or a hover, never as a filled row
 * or a coloured column.
 */

/* ---------------------------------------------------------------- status - */

/**
 * The status of any Sales document. The colour comes from the status registry,
 * so a status added there is styled everywhere at once and no screen has an
 * opinion of its own.
 */
export const StatusBadge = ({ status, reason = '' }) => <StatusPill status={status} reason={reason} />;

/* ----------------------------------------------------------------- money - */

const MONEY_ROLE = {
  amount: Money,
  total: Money,
  paid: PaidMoney,
  outstanding: OutstandingMoney,
  overdue: OverdueMoney,
  refund: CreditMoney,
  credit: CreditMoney,
};

/**
 * A figure, coloured by what the figure *is*.
 *
 * `kind` is the whole interface: a caller says the money is outstanding and
 * the amber follows. A caller that passes nothing gets the neutral total,
 * which is the right default — most figures on a screen are just totals.
 */
export const MoneyValue = ({ value, company, kind = 'amount', zeroAs = null }) => {
  const Component = MONEY_ROLE[kind] || Money;
  return <Component value={value} company={company} zeroAs={zeroAs} />;
};

/** What is left to collect, stated as "Settled" when there is nothing. */
export const BalanceValue = Balance;

/* ------------------------------------------------------------------ date - */

/** An issue date: a fact, so it takes no colour. */
export const DocDate = DateCell;

/**
 * A due date: slate while it is comfortable, amber on the day, red past it —
 * and never coloured at all once the document is settled, because a paid
 * invoice with an old date is not late.
 */
export const DueDate = DueDateCell;

export { dueUrgency };

/* -------------------------------------------------------------- document - */

/** A document's own number, as the link it is. */
export const DocumentNumber = InvoiceIdentifier;

/* ---------------------------------------------------------------- metric - */

/**
 * One figure at the top of a Sales screen.
 *
 * `tone` is a status tone, not a colour, so the Paid card is the same green as
 * the Paid pill and the Paid tab. The icon sits on a wash of its own tone and
 * the figure takes the ink; a card is never a filled block of colour.
 */
export const MetricCard = ({ label, value, company, tone = 'sent', Icon = null, count = false, hint = '' }) => {
  const text = count ? String(value ?? 0) : formatMoney(Number(value || 0), company);
  return (
    <div className="ui-card px-3 py-2.5 flex items-center gap-2.5" data-tone={tone}>
      {Icon ? (
        <span
          className="h-8 w-8 rounded-lg grid place-items-center flex-shrink-0"
          style={{
            backgroundColor: `rgb(var(--st-${tone}-strong))`,
            color: `rgb(var(--st-${tone}-ink))`,
          }}
          aria-hidden="true"
        >
          <Icon size={16} />
        </span>
      ) : null}
      <span className="block min-w-0">
        <span className="ui-t-label block truncate" title={label}>
          {label}
        </span>
        <span
          /* A figure on a card is already the largest thing in it and sits in
             its own colour; a weight on top made every number on every list
             read as emphasis, so none of them were. */
          className={`block font-normal leading-6 truncate ${count ? 'text-base' : 'ui-mono text-base'}`}
          title={text}
          style={{ color: `rgb(var(--st-${tone}-ink))` }}
        >
          {text}
        </span>
        {hint ? <span className="ui-caption block truncate">{hint}</span> : null}
      </span>
    </div>
  );
};

/* ------------------------------------------------------------------ form - */

/**
 * A labelled control on a Sales form.
 *
 * It exists so a field cannot quietly acquire its own sizing: the label, the
 * spacing and the error line come from here, and the control inside carries no
 * padding of its own. `hint` is for standing help; `error` replaces it, because
 * a field that is wrong has nothing more useful to say than why.
 */
export const FormField = ({ label, htmlFor = undefined, required = false, hint = '', error = '', children }) => (
  <div>
    {label ? (
      <label className="ui-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-[rgb(var(--neg-ink))]" aria-hidden="true"> *</span> : null}
      </label>
    ) : null}
    {children}
    {error ? (
      <p className="ui-caption mt-1" style={{ color: 'rgb(var(--neg))' }} role="alert">
        {error}
      </p>
    ) : hint ? (
      <p className="ui-caption mt-1">{hint}</p>
    ) : null}
  </div>
);

/* ----------------------------------------------------------------- table - */

/**
 * A Sales table whose columns declare a meaning.
 *
 * Each column names a `type` from the semantic set; the cell is rendered by
 * that type and gets its colour from it. A column may still pass `render` for
 * something bespoke, but it then owns its own appearance — which is the thing
 * this exists to make visible rather than easy.
 */
const COLUMN_RENDERERS = {
  documentNumber: ({ row, col, ctx }) => (
    <DocumentNumber value={col.value(row)} label={ctx.label} onOpen={col.onOpen ? () => col.onOpen(row) : null} />
  ),
  date: ({ row, col }) => <DocDate value={col.value(row)} />,
  dueDate: ({ row, col, ctx }) => (
    <DueDate value={col.value(row)} balance={col.balance ? col.balance(row) : 0} todayIso={ctx.todayIso} />
  ),
  money: ({ row, col, ctx }) => <MoneyValue value={col.value(row)} company={ctx.company} kind={col.kind || 'amount'} />,
  balance: ({ row, col, ctx }) => (
    <BalanceValue value={col.value(row)} company={ctx.company} dueIso={col.dueIso ? col.dueIso(row) : null} todayIso={ctx.todayIso} />
  ),
  status: ({ row, col }) => <StatusBadge status={col.value(row)} reason={col.reason ? col.reason(row) : ''} />,
  text: ({ row, col }) => <>{col.value(row) ?? '—'}</>,
};

export const DocTable = ({ columns, rows, company, todayIso = null, label = 'document', rowKey, onRowClick = null, empty = null }) => {
  const ctx = { company, todayIso, label };
  if (!rows?.length && empty) return empty;
  return (
    <table className="ui-table w-full">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={`ui-th${c.align === 'right' ? ' ui-num' : ''}`} style={c.width ? { width: c.width } : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className={onRowClick ? 'cursor-pointer' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
            {columns.map((c) => {
              const render = c.render || COLUMN_RENDERERS[c.type] || COLUMN_RENDERERS.text;
              return (
                <td key={c.key} className={c.cellClass || (c.align === 'right' ? 'ui-col-amount' : undefined)}>
                  {render({ row, col: c, ctx })}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** The set a Sales column is allowed to be. */
export const DOC_COLUMN_TYPES = Object.keys(COLUMN_RENDERERS);

/* The names Sales was built against. Kept so the module that grew this system
   does not have to be rewritten to prove the system is general. */
export const SalesStatusBadge = StatusBadge;
export const SalesDate = DocDate;
export const SalesBalance = BalanceValue;
export const SalesMetricCard = MetricCard;
export const SalesFormField = FormField;
export const SalesTable = DocTable;
export const SALES_COLUMN_TYPES = DOC_COLUMN_TYPES;

export default {
  StatusBadge,
  MoneyValue,
  DueDate,
  DocumentNumber,
  MetricCard,
  DocTable,
  FormField,
};
