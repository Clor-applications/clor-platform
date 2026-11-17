import React, { useState } from 'react';
import { Eye, EyeOff } from '@ui/components/ui/lineIcons';

/** 0–4: length, mixed case, a digit, a symbol. Only a hint, never a rule. */
export function passwordScore(value = '') {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.max(1, Math.min(4, score));
}

const STRENGTH_WORDS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

/**
 * A password field with a show / hide button.
 *
 * Typed on a phone at the gate or on a laptop in a hurry, a password nobody
 * can see is a password typed twice. The button keeps focus in the field
 * (mousedown is not allowed to take it), says what it will do, and reports
 * its state with aria-pressed. Outside Books the button also carries the word
 * "Show" / "Hide" (owner's pick), and a new password (`strength`) gets a bar.
 */
export default function PasswordInput({ className = '', wrapperClassName = '', strength = false, ...props }) {
  const [shown, setShown] = useState(false);
  const score = strength ? passwordScore(String(props.value ?? '')) : 0;
  return (
    <span className={`block ${wrapperClassName}`}>
      <span className="ui-pw relative block">
        <input {...props} type={shown ? 'text' : 'password'} className={`ui-input w-full pe-11 ${className}`} />
        <button
          type="button"
          className="ui-icon-btn ui-pw-toggle absolute end-1 top-1/2 -translate-y-1/2"
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          title={shown ? 'Hide password' : 'Show password'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShown((v) => !v)}
          disabled={props.disabled}
        >
          {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          <span className="ui-pw-word" aria-hidden="true">{shown ? 'Hide' : 'Show'}</span>
        </button>
      </span>
      {strength && score > 0 ? (
        <span className="ui-pw-strength" data-score={score}>
          <span className="ui-pw-bar" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => <span key={i} className={i <= score ? 'is-on' : ''} />)}
          </span>
          <span className="ui-pw-strength-word">{STRENGTH_WORDS[score]}</span>
        </span>
      ) : null}
    </span>
  );
}
