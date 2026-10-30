import React from 'react';

/** The on/off switch of People's settings screens. */
export default function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-[rgb(var(--brand))]' : 'bg-[rgb(var(--border-strong))]'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-[rgb(var(--surface))] shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}
