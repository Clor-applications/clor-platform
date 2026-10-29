import React, { useState } from 'react';
import { Eye, EyeOff } from '@ui/components/ui/lineIcons';

/**
 * A password field with a show / hide button.
 *
 * Typed on a phone at the gate or on a laptop in a hurry, a password nobody
 * can see is a password typed twice. The button keeps focus in the field
 * (mousedown is not allowed to take it), says what it will do, and reports
 * its state with aria-pressed. Everything else goes to the input as given.
 */
export default function PasswordInput({ className = '', wrapperClassName = '', ...props }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={`relative block ${wrapperClassName}`}>
      <input {...props} type={shown ? 'text' : 'password'} className={`ui-input w-full pe-11 ${className}`} />
      <button
        type="button"
        className="ui-icon-btn absolute end-1 top-1/2 -translate-y-1/2"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown((v) => !v)}
        disabled={props.disabled}
      >
        {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </span>
  );
}
