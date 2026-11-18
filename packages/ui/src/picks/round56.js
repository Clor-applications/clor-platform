/**
 * Round 56 picks (owner, 18 Nov 2026): forms that are easy to fill. The rules
 * here hold on every form outside Books, so they live once, installed by the
 * shell and the employee app.
 *
 * indianDigits / rawDigits — a big amount takes its commas as it is typed,
 *               12,50,000 (amounttyping A), the Indian grouping; the value a
 *               screen stores stays plain digits.
 * properName  — "RAVI KUMAR" → "Ravi Kumar", offered under a name field, never
 *               forced (namecase A).
 * isIdentifierField / installFormRules — PAN, IFSC, GSTIN and TAN turn to
 *               capitals as they are typed (autoupper A); Enter moves to the
 *               next field and only Save sends (enterkey A).
 * rememberChoices / lastChoices — the branch, department and type of the last
 *               person added start the next one (lastchoice A).
 */

const inBooks = () => typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo';

/** "1250000.5" → "12,50,000.5"; anything that is not a number is returned as typed. */
export function indianDigits(value) {
  const s = String(value ?? '');
  if (!s) return '';
  const m = s.match(/^(-?)(\d*)(\.\d*)?$/);
  if (!m) return s;
  const [, sign, whole, frac = ''] = m;
  if (!whole) return `${sign}${frac}`;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${rest ? `${rest},` : ''}${last3}${frac}`;
}

/** "12,50,000" → "1250000": what the screen keeps. */
export const rawDigits = (value) => String(value ?? '').replace(/,/g, '');

/** A caret after the n-th digit of the formatted text. */
export function caretAfterDigits(text, n) {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (/[\d.-]/.test(text[i])) seen += 1;
    if (seen === n) return i + 1;
  }
  return text.length;
}

/** "RAVI KUMAR" → "Ravi Kumar" when the name is all capitals; otherwise null (nothing to offer). */
export function properName(value) {
  const s = String(value ?? '');
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3 || letters !== letters.toUpperCase()) return null;
  return s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

const ID_WORDS = /\b(pan|ifsc|gstin|gst number|gst no|tan)\b/i;

function labelOf(el) {
  const parts = [el.getAttribute('name'), el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder')];
  if (el.labels) for (const l of el.labels) parts.push(l.textContent);
  return parts.filter(Boolean).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** A field that holds a PAN, IFSC, GSTIN or TAN: named so, or marked `data-caps`. */
export function isIdentifierField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  if (el.dataset?.caps === 'off') return false;
  if (el.dataset?.caps === 'on') return true;
  if (!/^(text|search|)$/.test(el.type || '')) return false;
  return ID_WORDS.test(labelOf(el));
}

const nativeValue = typeof HTMLInputElement !== 'undefined' ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set : null;

/* Capitals before the screen hears the keystroke, so what it stores is already right and the caret stays put. */
function onInput(e) {
  const el = e.target;
  if (inBooks() || !isIdentifierField(el)) return;
  const up = el.value.toUpperCase();
  if (up === el.value) return;
  const at = el.selectionStart;
  nativeValue?.call(el, up);
  try { if (at != null) el.setSelectionRange(at, at); } catch { /* a type without a caret */ }
}

/* A test page draws no boxes, so every field there counts as shown. */
const NO_LAYOUT = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');

const TYPING = /^(text|email|tel|number|password|url|date|time|datetime-local|month|week|)$/;

function fieldsOf(form) {
  return Array.from(form.querySelectorAll('input, select, textarea, [role="combobox"]')).filter((el) => {
    if (el.disabled || el.closest('[hidden], [aria-hidden="true"]')) return false;
    if (el.tagName === 'INPUT' && (el.type === 'hidden' || el.type === 'file' || el.classList.contains('sr-only'))) return false;
    return el.getClientRects().length > 0 || NO_LAYOUT;
  });
}

/** The field after `el` in its form, or null at the last one. */
export function nextFieldAfter(form, el) {
  const fields = fieldsOf(form);
  return fields.slice(fields.indexOf(el) + 1)[0] || null;
}

/*
 * Enter moves on, it never sends a half-filled form. A short form (sign-in, one
 * reason, a search) still sends from its last field, as people expect there. A
 * field that answers Enter itself (an open list, a suggestion) has already
 * claimed it and is left alone.
 */
function onKeyDown(e) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target;
  if (inBooks() || !el || el.tagName !== 'INPUT' || !TYPING.test(el.type || '') || el.type === 'search') return;
  if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-expanded') === 'true' || el.dataset?.enter === 'send') return;
  const form = el.form || el.closest('form');
  if (!form || form.dataset?.enter === 'send') return;
  const fields = fieldsOf(form);
  const at = fields.indexOf(el);
  if (fields.length <= 2 && at === fields.length - 1) return;
  e.preventDefault();
  fields[at + 1]?.focus();
}

let installed = 0;
/** Installs the two rules once on the document; returns the undo. */
export function installFormRules(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return () => {};
  installed += 1;
  if (installed === 1) {
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('keydown', onKeyDown);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    installed -= 1;
    if (installed === 0) {
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('keydown', onKeyDown);
    }
  };
}

const LAST_KEY = 'clor.addPerson.last';
const KEPT = ['branchId', 'departmentId', 'employeeTypeId', 'workTypeId', 'hours'];

/** The choices of the last person added, to start the next one; ids only, nothing personal. */
export function lastChoices() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
    return Object.fromEntries(KEPT.filter((k) => typeof v[k] === 'string' && v[k]).map((k) => [k, v[k]]));
  } catch {
    return {};
  }
}

export function rememberChoices(form) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(Object.fromEntries(KEPT.map((k) => [k, form?.[k] || ''])))); } catch { /* private window */ }
}

export function forgetChoices() {
  try { localStorage.removeItem(LAST_KEY); } catch { /* private window */ }
}
