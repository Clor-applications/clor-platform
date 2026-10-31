import React from 'react';

/**
 * The on/off switch of People's settings screens. The track is 24px tall; the button around it is 44px,
 * so a thumb on a phone finds it (QA on #81).
 */
export default function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg disabled:opacity-50"
    >
      <span aria-hidden="true" className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-[rgb(var(--brand))]' : 'bg-[rgb(var(--border-strong))]'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-[rgb(var(--surface))] shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}
