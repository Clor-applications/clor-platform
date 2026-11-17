import { useMemo } from 'react';

/**
 * A phone number with a country picker in front (owner's style pick, 17 Nov 2026).
 *
 * The value stays one string, as every screen already stores it: "+91 98400 12345". With no
 * country code typed, India (+91) is assumed and the number is kept as typed, so an old value
 * like "98400 12345" reads back unchanged until someone picks another country.
 */
export const COUNTRIES = [
  ['IN', '+91', 'India'],
  ['AE', '+971', 'UAE'],
  ['SA', '+966', 'Saudi Arabia'],
  ['QA', '+974', 'Qatar'],
  ['OM', '+968', 'Oman'],
  ['KW', '+965', 'Kuwait'],
  ['BH', '+973', 'Bahrain'],
  ['SG', '+65', 'Singapore'],
  ['MY', '+60', 'Malaysia'],
  ['LK', '+94', 'Sri Lanka'],
  ['NP', '+977', 'Nepal'],
  ['BD', '+880', 'Bangladesh'],
  ['GB', '+44', 'United Kingdom'],
  ['US', '+1', 'USA or Canada'],
  ['AU', '+61', 'Australia'],
];
const FLAG = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/* "+971 50 123 4567" → ['+971', '50 123 4567']; a value without a known code keeps India and the whole text. */
export function splitPhone(value = '') {
  const v = String(value || '').trim();
  if (v.startsWith('+')) {
    const hit = [...COUNTRIES].sort((a, b) => b[1].length - a[1].length).find(([, code]) => v.startsWith(code));
    if (hit) return [hit[1], v.slice(hit[1].length).trim()];
  }
  return ['+91', v];
}

export default function PhoneInput({ id, value = '', onChange, className = '', ...props }) {
  const [code, rest] = useMemo(() => splitPhone(value), [value]);
  /* India with no code typed keeps the number as it was entered; any other country is saved with its code. */
  const join = (c, n) => (c === '+91' && !String(value || '').trim().startsWith('+') ? n : n ? `${c} ${n}` : '');
  return (
    <span className="ui-phone-field">
      <select
        className="ui-select ui-phone-code"
        aria-label="Country code"
        value={code}
        onChange={(e) => onChange?.(e.target.value === '+91' ? rest : rest ? `${e.target.value} ${rest}` : '')}
      >
        {COUNTRIES.map(([cc, c, name]) => <option key={cc} value={c}>{FLAG(cc)} {c} {name}</option>)}
      </select>
      <input id={id} type="tel" inputMode="tel" autoComplete="tel-national" {...props} className={`${className} ui-phone-number`} value={rest} onChange={(e) => onChange?.(join(code, e.target.value))} />
    </span>
  );
}
