import React from 'react';

/**
 * The fields a company invented, rendered onto a document form.
 *
 * These were built for invoices and lived inside the invoice form, which is why
 * a business that added "Customer PO ref" could put it on an invoice and on
 * nothing else — not the sales order the PO actually arrives with, not the
 * challan that quotes it back. The markup is unchanged from where it grew; only
 * its address is new, so every sales document can render the same set.
 *
 * `where` is the placement the field was given in settings. A form asks for one
 * placement at a time and puts each group where it belongs, so a field marked
 * "beside the reference fields" does not surface under the notes.
 */
export const DocumentCustomFields = ({ fields, values, onChange, where }) => {
  const list = (Array.isArray(fields) ? fields : []).filter((f) => f.formPlacement === where);
  if (!list.length) return null;
  return (
    <>
      {list.map((f) => {
        const value = (values || {})[f.key] ?? '';
        const id = `cf-${f.key}`;
        return (
          <div key={f.key}>
            <label htmlFor={id} className="ui-label">
              {f.label}
              {f.required ? <span className="ml-1 text-[rgb(var(--neg-ink))]">*</span> : null}
            </label>
            {f.type === 'Yes/No' ? (
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer h-[38px]">
                <input
                  id={id}
                  type="checkbox"
                  className="ui-checkbox"
                  checked={value === true || value === 'true'}
                  onChange={(e) => onChange(f.key, e.target.checked)}
                />
                {value === true || value === 'true' ? 'Yes' : 'No'}
              </label>
            ) : f.type === 'List' && f.options.length ? (
              <select id={id} value={value} onChange={(e) => onChange(f.key, e.target.value)} className="ui-select">
                <option value="">— none —</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={f.type === 'Number' ? 'number' : f.type === 'Date' ? 'date' : 'text'}
                value={value}
                required={f.required}
                onChange={(e) => onChange(f.key, e.target.value)}
                className="ui-input"
              />
            )}
          </div>
        );
      })}
    </>
  );
};

/** Whether any field asked to be rendered in one of these placements. */
export const hasCustomFieldsAt = (fields, ...placements) =>
  (Array.isArray(fields) ? fields : []).some((f) => placements.includes(f.formPlacement));

export default DocumentCustomFields;
