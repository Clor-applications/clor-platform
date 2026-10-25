import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * DatePicker (People design spec v1 §5): type a date or pick one. Value in
 * and out is ISO `YYYY-MM-DD` (what the API stores); shown as `12 Feb 2026`.
 * Typing accepts 2026-02-12, 12/02/2026, 12-02-2026 and 12 Feb 2026 (day
 * first, as India writes it, never guessed as US order). min/max are enforced
 * in the calendar and on typed entry. The calendar is a grid: arrows move a
 * day or a week, PageUp/PageDown a month, Enter picks, Escape closes and
 * returns focus to the field without closing any drawer around it.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const valid = (y, m, d) => { const t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d; };

export function formatDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return '';
  const [y, m, d] = v.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function parseDate(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  let y; let m; let d;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) { y = +r[1]; m = +r[2] - 1; d = +r[3]; }
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { d = +r[1]; m = +r[2] - 1; y = +r[3]; }
  else if ((r = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/))) {
    d = +r[1]; y = +r[3];
    m = MONTHS.findIndex((x) => r[2].slice(0, 3).toLowerCase() === x.toLowerCase());
  } else return null;
  if (m < 0 || !valid(y, m, d)) return null;
  return iso(y, m, d);
}

const addDays = (v, n) => { const t = new Date(`${v}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMonths = (v, n) => {
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last));
};
const todayIso = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export default function DatePicker({ id, value = '', onChange, min = '', max = '', disabled = false, required = false, invalid = false, describedBy, placeholder = 'DD/MM/YYYY', label }) {
  const auto = useId();
  const inputId = id || auto;
  const gridId = `${inputId}-grid`;
  const [text, setText] = useState(formatDate(value));
  const [seen, setSeen] = useState(value);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(value || todayIso());
  const [typedError, setTypedError] = useState('');
  const wrap = useRef(null);
  const input = useRef(null);
  const grid = useRef(null);
  if (value !== seen) {
    setSeen(value);
    setText(formatDate(value));
    setTypedError('');
  }
  const allowed = (v) => (!min || v >= min) && (!max || v <= max);
  const commit = (v) => {
    setText(formatDate(v));
    setTypedError('');
    onChange?.(v);
  };
  /* Close on a click outside the picker only; a click inside a drawer elsewhere is the drawer's business. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => {
    if (open) grid.current?.querySelector('[data-focus="true"]')?.focus();
  }, [open, focus]);

  const [fy, fm] = focus.split('-').map(Number);
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(fy, fm - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7; /* weeks start Monday */
    const days = new Date(Date.UTC(fy, fm, 0)).getUTCDate();
    const out = [];
    for (let i = 0; i < lead; i += 1) out.push(null);
    for (let d = 1; d <= days; d += 1) out.push(iso(fy, fm - 1, d));
    return out;
  }, [fy, fm]);

  const onGridKey = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) { e.preventDefault(); setFocus(addDays(focus, step)); return; }
    if (e.key === 'PageUp') { e.preventDefault(); setFocus(addMonths(focus, -1)); return; }
    if (e.key === 'PageDown') { e.preventDefault(); setFocus(addMonths(focus, 1)); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (allowed(focus)) { commit(focus); setOpen(false); input.current?.focus(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); input.current?.focus(); }
  };

  return (
    <div ref={wrap} className="ui-datepicker relative">
      <div className="relative flex items-center">
        <input
          ref={input}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={`ui-input w-full pr-9 ${invalid || typedError ? 'is-invalid' : ''}`}
          aria-invalid={invalid || Boolean(typedError) || undefined}
          aria-describedby={[describedBy, typedError ? `${inputId}-typed` : ''].filter(Boolean).join(' ') || undefined}
          aria-label={label}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = parseDate(text);
            if (v === '') { setTypedError(''); if (value) onChange?.(''); return; }
            if (v === null) { setTypedError('Enter a date like 12/02/2026.'); return; }
            if (!allowed(v)) { setTypedError(min && v < min ? `On or after ${formatDate(min)}.` : `On or before ${formatDate(max)}.`); return; }
            commit(v);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent?.isComposing) return;
            if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); setFocus(value || todayIso()); setOpen(true); }
            /* Enter in a date field confirms the date; it never submits the form around it. */
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); e.currentTarget.focus(); }
          }}
        />
        <button type="button" className="ui-icon-btn absolute right-1" aria-label="Choose a date" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
          onClick={() => { setFocus(value && allowed(value) ? value : (min && todayIso() < min ? min : todayIso())); setOpen((o) => !o); }}>
          <Calendar size={16} aria-hidden="true" />
        </button>
      </div>
      {typedError ? <p id={`${inputId}-typed`} className="ui-field-error">{typedError}</p> : null}
      {open ? (
        <div role="dialog" aria-modal="false" aria-label="Choose a date" className="ui-datepicker-pop">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setFocus(addMonths(focus, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
            <p className="text-sm font-medium" aria-live="polite">{MONTHS_LONG[fm - 1]} {fy}</p>
            <button type="button" className="ui-icon-btn" aria-label="Next month" onClick={() => setFocus(addMonths(focus, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          <div ref={grid} id={gridId} role="grid" aria-label={`${MONTHS_LONG[fm - 1]} ${fy}`} className="ui-datepicker-grid" onKeyDown={onGridKey}>
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} role="columnheader" className="ui-caption text-center">{d}</span>)}
            {cells.map((c, i) => (c ? (
              <button
                key={c}
                type="button"
                role="gridcell"
                tabIndex={c === focus ? 0 : -1}
                data-focus={c === focus ? 'true' : undefined}
                aria-selected={c === value}
                aria-current={c === todayIso() ? 'date' : undefined}
                aria-label={formatDate(c)}
                disabled={!allowed(c)}
                className={`ui-datepicker-day ${c === value ? 'is-selected' : ''} ${c === todayIso() ? 'is-today' : ''}`}
                onClick={() => { commit(c); setOpen(false); input.current?.focus(); }}
              >
                {Number(c.slice(8))}
              </button>
            ) : <span key={`x${i}`} />))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
