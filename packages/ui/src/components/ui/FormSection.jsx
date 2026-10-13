/**
 * One part of a document form, named and on its own card.
 *
 * A form of forty fields in one unbroken column is forty fields to read; the
 * same form in four named parts is four things to do. The icon is the part's
 * marker, not decoration — it is what the eye comes back to after looking away
 * at a bill or a delivery note.
 *
 * `action` is for the one control that belongs to the part rather than to the
 * document: Add Item on the lines, Add Address on a party's places. The
 * document's own actions stay in the bar at the top, where every way out of the
 * form is kept together.
 */
export default function FormSection({ icon: Icon, title, description = '', action = null, className = '', children }) {
  return (
    <section className={`ui-card p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: 'rgb(var(--brand) / 0.12)', color: 'rgb(var(--brand))' }}
              aria-hidden="true"
            >
              <Icon size={18} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="ui-t-sec">{title}</h3>
            {description ? <p className="ui-caption mt-0.5">{description}</p> : null}
          </div>
        </div>

        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}
