import { useCallback, useRef, useState } from 'react';

/**
 * Validation that lands on the field, not in the corner.
 *
 * Three quarters of everything this app says to a user is an error, and almost
 * all of those errors are about a field — "Cost must be greater than zero",
 * "Purchase date is required". Announcing that in the far corner of the screen
 * puts the message as far as possible from the box it is about, and turns the
 * corner into a firehose that people learn to ignore, including for the
 * messages that actually matter.
 *
 * It also fixes a smaller thing that is worse than it looks. The old shape was
 *
 *     if (!a) { notify.error('a is required'); return; }
 *     if (!b) { notify.error('b is required'); return; }
 *
 * so a form with three empty fields reported one, and you found the next only
 * after fixing that one and submitting again. This collects every failure in a
 * pass and shows them all at once.
 *
 * Errors that are not about a field — a locked period, a missing company
 * setting, a server that refused — still belong in a toast. There is no field
 * to point at, so pointing at one would be a lie.
 *
 * Usage:
 *
 *     const v = useFieldErrors();
 *     const submit = () => {
 *       v.reset();
 *       v.require('customerId', formData.customerId, 'Customer is required');
 *       v.check('number', !clash, 'That invoice number is already used');
 *       if (v.failed()) return;   // focuses the first bad field
 *       ...
 *     };
 *
 *     <input {...v.props('customerId')} />
 *     <FieldError error={v.error('customerId')} id={v.errorId('customerId')} />
 */
export function useFieldErrors(formId = 'f') {
  const [errors, setErrors] = useState({});
  // Collected during a synchronous validation pass, before state catches up.
  const pending = useRef({});
  const nodes = useRef({});

  const reset = useCallback(() => {
    pending.current = {};
    setErrors({});
  }, []);

  /** Record a failure. The first message for a field wins — it is the most specific. */
  const fail = useCallback((field, message) => {
    if (!field || pending.current[field]) return;
    pending.current[field] = String(message || 'Check this field');
  }, []);

  /** `condition` true means valid. */
  const check = useCallback(
    (field, condition, message) => {
      if (!condition) fail(field, message);
      return !!condition;
    },
    [fail]
  );

  /** Present and non-blank. */
  const require = useCallback(
    (field, value, message) => check(field, String(value ?? '').trim() !== '', message),
    [check]
  );

  /**
   * End of the pass. Publishes what was collected, puts the cursor in the first
   * field that failed, and reports whether to stop.
   */
  const failed = useCallback(() => {
    const found = pending.current;
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      const node = nodes.current[first];
      // A picker is a component, not an input, so what gets registered is often
      // the wrapper around it. Focus the first thing inside that can take focus.
      const target =
        node && typeof node.matches === 'function' && node.matches('input, select, textarea, button')
          ? node
          : node?.querySelector?.('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
      if (target && typeof target.focus === 'function') {
        target.focus();
        target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }
    }
    return Object.keys(found).length > 0;
  }, []);

  /** Point a field at the element that should take focus when it fails. */
  const register = useCallback((field, el) => {
    nodes.current[field] = el;
  }, []);

  const error = useCallback((field) => errors[field] || '', [errors]);
  const errorId = useCallback((field) => `${formId}-${field}-error`, [formId]);

  /** Clear one field's error as soon as the user touches it. */
  const clearField = useCallback((field) => {
    delete pending.current[field];
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  /**
   * Everything a control needs to announce itself as invalid, including to a
   * screen reader — a red border alone says nothing to someone not looking at it.
   */
  const props = useCallback(
    (field) => ({
      ref: (el) => {
        nodes.current[field] = el;
      },
      'aria-invalid': errors[field] ? true : undefined,
      'aria-describedby': errors[field] ? `${formId}-${field}-error` : undefined,
      'data-invalid': errors[field] ? 'true' : undefined,
      onBlurCapture: () => clearField(field),
    }),
    [errors, formId, clearField]
  );

  return { reset, check, require, fail, failed, error, errorId, clearField, props, register, errors };
}

export default useFieldErrors;
