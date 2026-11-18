/*
 * Round 57 picks (18 Nov 2026), lists and finding things. Plain helpers, no server:
 * - filtermemory A: a list keeps its scroll place when you come back to it.
 * - newrowmark A: the row just added sits on top with a soft highlight.
 * - todayrow A: today's row in a dated list is marked "Today".
 * - waitingfirst A: waiting first, oldest waiting on top; then the rest, newest first.
 * - bulkresult A: "12 approved · 2 could not be", with the reason for each.
 * - newtab A: a record's address, so Ctrl-click or long-press opens it in a new tab.
 */
import { useEffect, useRef, useState } from 'react';

/** Today in India as YYYY-MM-DD. */
export function todayInIndia(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** True when a date (YYYY-MM-DD, or an ISO timestamp) is today in India. */
export function isTodayDate(date, today = todayInIndia()) {
  return Boolean(date) && String(date).slice(0, 10) === today;
}

/** The row just added first, everything else in its own order. */
export function freshFirst(rows, freshId, key = (r) => r.id) {
  if (!freshId || !Array.isArray(rows)) return rows;
  const i = rows.findIndex((r) => key(r) === freshId);
  if (i <= 0) return rows;
  return [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)];
}

/** The id of the row just added, cleared after a few seconds so the highlight fades by itself. */
export function useFreshRow(ms = 6000) {
  const [fresh, setFresh] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mark = (id) => {
    clearTimeout(timer.current);
    setFresh(id || null);
    if (id) timer.current = setTimeout(() => setFresh(null), ms);
  };
  return [fresh, mark];
}

/** Waiting rows first, the oldest waiting on top; then the rest, newest first. */
export function waitingFirst(rows, isWaiting, at = (r) => r.createdAt) {
  const t = (r) => { const v = at(r); const n = v ? Date.parse(v) : NaN; return Number.isNaN(n) ? 0 : n; };
  const waiting = rows.filter(isWaiting).sort((a, b) => t(a) - t(b));
  const rest = rows.filter((r) => !isWaiting(r)).sort((a, b) => t(b) - t(a));
  return [...waiting, ...rest];
}

/**
 * What a bulk action did, from each route's `{ done, results: [{ id, ok, error }] }`
 * and the rows chosen: how many went through and, for each one that did not, whose and why.
 */
export function bulkOutcome({ done = 0, results = [], nameOf = () => '' }) {
  const failed = results.filter((r) => r && r.ok === false).map((r) => ({ id: r.id, name: nameOf(r.id) || 'One request', reason: r.error || 'Not done.' }));
  return { done: Number(done) || 0, failed };
}

/** "12 approved · 2 could not be". */
export function bulkOutcomeLine({ done, failed }, verb = 'approved') {
  const parts = [`${done} ${verb}`];
  if (failed.length) parts.push(`${failed.length} could not be`);
  return parts.join(' · ');
}

/**
 * The address of a screen with its own state, as the shell writes it
 * (`?open=<screen>&s.<key>=<value>`), keeping the app and company in the
 * current address. A row links here so Ctrl-click opens it in a new tab.
 */
export function screenHref(open, params = {}, loc = typeof window !== 'undefined' ? window.location : null) {
  if (!loc) return '#';
  const q = new URLSearchParams(loc.search || '');
  for (const k of [...q.keys()]) if (k.startsWith('s.')) q.delete(k);
  q.set('open', open);
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '' || typeof v === 'object') continue;
    q.set(`s.${k}`, String(v));
  }
  return `${loc.pathname}?${q.toString()}`;
}

/** A click the browser should handle itself: a new tab or window (Ctrl, Cmd, Shift, the middle button). */
export function opensElsewhere(e) {
  return Boolean(e && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || (typeof e.button === 'number' && e.button !== 0)));
}
