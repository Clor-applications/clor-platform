import React, { useState } from 'react';

import { Info } from '@ui/components/ui/lineIcons';
import { requestOpenHelp } from '@platform/context';

/*
 * Round 64 picks (18 Nov 2026), settings: the pieces more than one settings screen uses.
 *
 *  settinghelp C  — a small ⓘ beside a setting that opens its how-to in the Help centre.
 *  settingsfind A — Settings search finds a setting by a word inside it ("grace") and says where it lives.
 *  shiftsetup A   — a 24-hour bar that draws a shift, its breaks, and says "ends next day".
 *  leavetypesetup A — a new leave type asked as plain questions, one after another.
 */

/* ------------------------------------------------------------------ settinghelp C */

/** ⓘ beside a setting: opens the Help centre on `topic` (a key in packages/shell/helpGuides.js). */
export function SettingHelp({ topic, label }) {
  return (
    <button
      type="button"
      className="ui-setting-help"
      aria-label={`How ${label} works`}
      title={`How ${label} works`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestOpenHelp(topic); }}
    >
      <Info size={14} aria-hidden="true" />
    </button>
  );
}

/* ------------------------------------------------------------------ settingsfind A */

/**
 * Settings that hold a word the search typed, where the word is not already in the setting's own name or line:
 * [{ key, word, label, group }]. `words` is { navKey: [word, ...] }; `byKey` the nav items this person may open.
 */
export function settingHits(q, words, groups, byKey) {
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 2 || !words) return [];
  const out = [];
  for (const g of groups || []) {
    for (const [key, note] of g.items || []) {
      const item = byKey.get(key);
      if (!item) continue;
      const own = `${item.label} ${note}`.toLowerCase();
      if (own.includes(term)) continue;
      const pool = [...(words[key] || []), ...(item.keywords || [])];
      const word = pool.find((w) => String(w).toLowerCase().includes(term));
      if (word && !out.some((h) => h.key === key)) out.push({ key, word, label: item.label, group: g.title });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ shiftsetup A */

const toMin = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
};

/** A shift's pieces on a 24-hour day, as [from, to] minute pairs; a night shift is split at midnight. */
export function shiftPieces(start, end) {
  const a = toMin(start);
  const b = toMin(end);
  if (a == null || b == null || a === b) return { pieces: [], night: false, minutes: 0 };
  if (b > a) return { pieces: [[a, b]], night: false, minutes: b - a };
  return { pieces: [[a, 1440], [0, b]].filter(([x, y]) => y > x), night: true, minutes: 1440 - a + b };
}

const hoursOf = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/** The shift drawn on a 24-hour bar, breaks lighter, with "ends next day" for a night shift. */
export function ShiftBar({ start, end, breaks = [] }) {
  const { pieces, night, minutes } = shiftPieces(start, end);
  if (!pieces.length) return null;
  const pct = (m) => `${(m / 1440) * 100}%`;
  const gaps = (breaks || []).flatMap((b) => shiftPieces(b.startTime, b.endTime).pieces);
  const words = `${start} to ${end}${night ? ' · ends next day' : ''} · ${hoursOf(minutes)}`;
  return (
    <div className="ui-shift-bar sm:col-span-2">
      <div className="ui-shift-bar-track" role="img" aria-label={`Shift ${words}`}>
        {pieces.map(([x, y]) => <span key={`s${x}`} className="ui-shift-bar-on" style={{ left: pct(x), width: pct(y - x) }} />)}
        {gaps.map(([x, y]) => <span key={`b${x}`} className="ui-shift-bar-break" style={{ left: pct(x), width: pct(y - x) }} />)}
      </div>
      <div className="ui-shift-bar-ticks" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      <p className="ui-caption tabular-nums">{words}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ leavetypesetup A */

/** The questions, in order; a question may only apply to paid leave. */
export const LEAVE_QUESTIONS = [
  { key: 'name', ask: 'What is it called?' },
  { key: 'paid', ask: 'Is it paid?' },
  { key: 'days', ask: 'How many days a year?', paidOnly: true },
  { key: 'who', ask: 'Who gets it?' },
  { key: 'carry', ask: 'Can unused days carry into next year?', paidOnly: true },
  { key: 'proof', ask: 'Does it need proof, such as a certificate?' },
];

export const questionsFor = (form) => LEAVE_QUESTIONS.filter((q) => !q.paidOnly || form.isPaid);

function Chips({ value, onChange, options, label }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={String(v)} type="button" className="ui-choice-chip" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

/**
 * A new leave type as plain questions, one at a time (round 64 "leavetypesetup" A). Each answer goes straight into
 * the form; the full form opens after the last question, or at once from "Show every setting".
 */
export function LeaveQuestions({ form, set, onDone }) {
  const [i, setI] = useState(0);
  const list = questionsFor(form);
  const q = list[Math.min(i, list.length - 1)];
  const last = i >= list.length - 1;
  const carry = form.carryForwardMax !== '' && form.carryForwardMax != null;
  const proof = form.attachmentAfterDays !== '' && form.attachmentAfterDays != null;
  const canNext = q.key !== 'name' || Boolean(String(form.name || '').trim());
  const next = () => (last ? onDone() : setI((n) => n + 1));
  return (
    <section className="ui-leave-questions sm:col-span-2" aria-label="Set up in a few questions">
      <p className="ui-caption tabular-nums">Question {i + 1} of {list.length}</p>
      <h3 className="ui-t-sec" id="leave-q">{q.ask}</h3>
      <div className="space-y-2" aria-labelledby="leave-q">
        {q.key === 'name' ? (
          <input className="ui-input w-full" aria-label="Name" maxLength={60} value={form.name} placeholder="e.g. Marriage leave" onChange={(e) => set('name')(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (canNext) next(); } }} autoFocus />
        ) : null}
        {q.key === 'paid' ? <Chips label="Paid" value={Boolean(form.isPaid)} onChange={(v) => set('isPaid')(v)} options={[[true, 'Yes, paid'], [false, 'No, unpaid']]} /> : null}
        {q.key === 'days' ? (
          <label className="block max-w-[10rem]"><span className="sr-only">Days a year</span><input type="number" min={0} max={366} step={0.5} className="ui-input w-full tabular-nums" value={form.annualDays} onChange={(e) => set('annualDays')(e.target.value === '' ? '' : Number(e.target.value))} /></label>
        ) : null}
        {q.key === 'who' ? <Chips label="Who gets it" value={form.gender || ''} onChange={(v) => set('gender')(v)} options={[['', 'Everyone'], ['FEMALE', 'Women only'], ['MALE', 'Men only']]} /> : null}
        {q.key === 'carry' ? (
          <>
            <Chips label="Carry forward" value={carry} onChange={(v) => set('carryForwardMax')(v ? (Number(form.carryForwardMax) || 5) : '')} options={[[false, 'No, they lapse'], [true, 'Yes, some carry']]} />
            {carry ? <label className="block max-w-[14rem]"><span className="ui-label">Up to, days</span><input type="number" min={0} max={366} step={0.5} className="ui-input w-full tabular-nums" value={form.carryForwardMax} onChange={(e) => set('carryForwardMax')(e.target.value)} /></label> : null}
          </>
        ) : null}
        {q.key === 'proof' ? (
          <>
            <Chips label="Proof" value={proof} onChange={(v) => set('attachmentAfterDays')(v ? (form.attachmentAfterDays === '' ? 2 : form.attachmentAfterDays) : '')} options={[[false, 'No proof'], [true, 'Yes, for longer leave']]} />
            {proof ? <label className="block max-w-[14rem]"><span className="ui-label">When longer than, days</span><input type="number" min={0} max={366} step={0.5} className="ui-input w-full tabular-nums" value={form.attachmentAfterDays} onChange={(e) => set('attachmentAfterDays')(e.target.value)} /></label> : null}
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {i > 0 ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setI((n) => n - 1)}>Back</button> : null}
        <button type="button" className="ui-btn ui-btn-secondary" disabled={!canNext} onClick={next}>{last ? 'See the full form' : 'Next'}</button>
        <button type="button" className="ui-link ml-auto" onClick={onDone}>Show every setting</button>
      </div>
    </section>
  );
}
