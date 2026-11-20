import React from 'react';

/**
 * One part of a form, named by a heading over a 2px ink rule (DESIGN.md "Forms"; design audit G3).
 *
 * The calm register's form section: no box, no tinted band, no icon tile. The heading is
 * the section size (17/24, 600) and the rule under it is ink, so the parts of a long form
 * read as chapters on one page. `action` is the one control that belongs to the part (Add
 * a line, Add an address); it sits at the right end of the heading.
 *
 * Books keeps its own `FormSection` card (DESIGN.legacy.md); every other app uses this.
 */
export function FormPart({ title, description = '', action = null, className = '', children, id }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`ui-form-part ${className}`.trim()} aria-labelledby={headingId}>
      <div className="ui-form-part-head">
        <div className="min-w-0">
          <h3 className="ui-t-sec" id={headingId}>{title}</h3>
          {description ? <p className="ui-form-part-help">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="ui-form-part-body">{children}</div>
    </section>
  );
}

export default FormPart;
