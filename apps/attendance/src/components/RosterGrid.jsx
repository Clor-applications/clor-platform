import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SCHEDULE_SOURCE } from '../api/attendance';
import { cellLabel } from './rosterCells';

/**
 * The roster as a grid: a row a person, a column a day, each cell the day's
 * shift, weekly off, holiday or leave. Days are chosen as a block (drag,
 * Shift+click, Shift+arrows, or a row or column heading) and set in one go;
 * the screen that owns the grid sends that as one request.
 *
 * Keys, on a cell: arrows move, Shift+arrows stretch the block, Enter opens
 * the choices, a shift's code typed sets it, W is a weekly off, Delete puts
 * the days back on the person's schedule, Escape lets go of the block.
 */

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wd = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const dayWords = (d) => `${WEEKDAY[wd(d)]} ${Number(d.slice(8))} ${MONTH[Number(d.slice(5, 7)) - 1]}`;
const codeOf = (s) => s.code || (s.name || '').slice(0, 2);

/* A shift's colour is its place among the company's shifts, drawn from the chart series tokens (--dept-1..8), so it follows the theme. */
const toneIndex = (shifts) => new Map(shifts.map((s, i) => [s.id, (i % 8) + 1]));
const wash = (n) => ({ backgroundColor: `rgb(var(--dept-${n}) / 0.18)` });

const cellTitle = (c) => {
  if (c.kind === 'OUT') return 'Not employed';
  const what = c.kind === 'OFF' ? 'Weekly off' : c.kind === 'HOLIDAY' ? 'Holiday' : c.kind === 'LEAVE' ? 'On leave' : c.name;
  const under = c.kind !== 'WORK' && c.name ? ` (${c.name})` : '';
  const from = c.draft ? 'draft, not published' : SCHEDULE_SOURCE[c.source] || '';
  return `${what}${under}${from ? `, ${from}` : ''}`;
};

/** How long a typed code waits for its next letter when a longer code could still follow ("N" before "N1"). */
const TYPE_PAUSE_MS = 700;

export default function RosterGrid({ days, rows, shifts, coverage = [], closedMonths = [], filtered = false, canEdit = false, busy = false, onAssign }) {
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState({ r: 0, c: 0 });
  const [menu, setMenu] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuAt, setMenuAt] = useState({ left: 0, top: 0 });
  const menuBox = useRef(null);
  const [typed, setTyped] = useState('');
  const table = useRef(null);
  const dragging = useRef(false);
  const typing = useRef({ text: '', timer: null });
  const tones = useMemo(() => toneIndex(shifts), [shifts]);

  /* A new page or period: the block cannot point past the rows now shown. */
  const maxR = Math.max(0, rows.length - 1);
  const maxC = Math.max(0, days.length - 1);
  const a = { r: Math.min(active.r, maxR), c: Math.min(active.c, maxC) };
  const b = { r: Math.min(anchor.r, maxR), c: Math.min(anchor.c, maxC) };
  const sel = { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
  const selected = (r, c) => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
  const peopleN = sel.r1 - sel.r0 + 1;
  const daysN = sel.c1 - sel.c0 + 1;

  const choices = useMemo(
    () => [
      ...shifts.map((s) => ({ key: s.id, kind: 'SHIFT', shiftId: s.id, code: codeOf(s), label: `${s.name} ${s.startTime}–${s.endTime}` })),
      { key: 'OFF', kind: 'OFF', shiftId: null, code: 'W', label: 'Weekly off' },
      { key: 'CLEAR', kind: 'CLEAR', shiftId: null, code: '', label: 'Back to their schedule' },
    ],
    [shifts]
  );

  const focusCell = useCallback((cell) => {
    /* After the render that moves the roving tab stop. */
    window.requestAnimationFrame(() => table.current?.querySelector(`[data-cell="${cell.r}:${cell.c}"]`)?.focus());
  }, []);

  /* The block as it is when a choice lands (a typed code lands after a pause). */
  const block = useRef(sel);
  useEffect(() => { block.current = sel; });
  const apply = useCallback(
    (choice) => {
      setMenu(false);
      if (!canEdit || busy || !rows.length || !choice) return;
      const s = block.current;
      onAssign?.({ employeeIds: rows.slice(s.r0, s.r1 + 1).map((r) => r.employeeId), dates: days.slice(s.c0, s.c1 + 1), kind: choice.kind, shiftId: choice.shiftId });
    },
    [canEdit, busy, rows, days, onAssign]
  );

  /* The choices open beside the cell, fixed to the window so the table's own scroll box cannot clip them; above the cell when there is no room below. */
  const openMenu = () => {
    if (!canEdit || !rows.length) return;
    const box = table.current?.querySelector(`[data-cell="${a.r}:${a.c}"]`)?.getBoundingClientRect();
    const height = choices.length * 36 + 10;
    const above = box && box.bottom + height > window.innerHeight && box.top > height;
    setMenuAt(box ? { left: Math.max(8, Math.min(box.left, window.innerWidth - 248)), top: above ? box.top - height : box.bottom } : { left: 0, top: 0 });
    setMenuIndex(0);
    setMenu(true);
  };
  /* It belongs to where the cell was: scrolling, resizing or pressing elsewhere closes it. */
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(false);
    const away = (e) => { if (!menuBox.current?.contains(e.target)) setMenu(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', away);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', away);
    };
  }, [menu]);

  const clearTyping = () => {
    window.clearTimeout(typing.current.timer);
    typing.current = { text: '', timer: null };
    setTyped('');
  };
  useEffect(() => () => window.clearTimeout(typing.current.timer), []);
  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  /* A code typed on a cell: set at once when no longer code could follow, else after a short pause. */
  const type = (ch) => {
    window.clearTimeout(typing.current.timer);
    const coded = choices.filter((x) => x.code);
    let text = `${typing.current.text}${ch}`.toLowerCase();
    let matches = coded.filter((x) => x.code.toLowerCase().startsWith(text));
    if (!matches.length) {
      text = ch.toLowerCase();
      matches = coded.filter((x) => x.code.toLowerCase().startsWith(text));
    }
    if (!matches.length) return clearTyping();
    const exact = matches.find((x) => x.code.toLowerCase() === text);
    if (exact && matches.length === 1) {
      clearTyping();
      return apply(exact);
    }
    setTyped(text.toUpperCase());
    typing.current = { text, timer: window.setTimeout(() => { clearTyping(); if (exact) apply(exact); }, TYPE_PAUSE_MS) };
  };

  const onKeyDown = (e) => {
    if (!rows.length) return;
    if (menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        apply(choices[menuIndex]);
        focusCell(a);
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault();
        setMenu(false);
        focusCell(a);
      }
      return;
    }
    const move = (dr, dc, to) => {
      e.preventDefault();
      clearTyping();
      const next = to || { r: Math.min(Math.max(a.r + dr, 0), maxR), c: Math.min(Math.max(a.c + dc, 0), maxC) };
      setActive(next);
      if (!e.shiftKey) setAnchor(next);
      focusCell(next);
    };
    switch (e.key) {
      case 'ArrowUp': return move(-1, 0);
      case 'ArrowDown': return move(1, 0);
      case 'ArrowLeft': return move(0, -1);
      case 'ArrowRight': return move(0, 1);
      case 'Home': return move(0, 0, { r: a.r, c: 0 });
      case 'End': return move(0, 0, { r: a.r, c: maxC });
      case 'Enter':
      case 'F2':
        if (!canEdit) return undefined;
        e.preventDefault();
        clearTyping();
        return openMenu();
      case 'Escape':
        clearTyping();
        return setAnchor(a);
      case 'Delete':
      case 'Backspace':
        if (!canEdit) return undefined;
        e.preventDefault();
        return apply(choices[choices.length - 1]);
      default:
        if (canEdit && e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          type(e.key);
        }
        return undefined;
    }
  };

  const press = (r, c, e) => {
    if (e.button !== 0) return;
    setMenu(false);
    clearTyping();
    setActive({ r, c });
    if (!e.shiftKey) setAnchor({ r, c });
    dragging.current = true;
  };
  const selectRow = (r) => { setMenu(false); setAnchor({ r, c: 0 }); setActive({ r, c: maxC }); focusCell({ r, c: maxC }); };
  const selectColumn = (c) => { setMenu(false); setAnchor({ r: 0, c }); setActive({ r: maxR, c }); focusCell({ r: maxR, c }); };

  const closed = (d) => closedMonths.includes(d.slice(0, 7));
  const standard = coverage.some((v) => v.counts?.['']);
  const footRows = [...shifts.map((s) => ({ id: s.id, name: s.name, min: s.minStaff || 0, tone: tones.get(s.id) })), ...(standard ? [{ id: '', name: 'Standard day', min: 0, tone: 0 }] : [])];

  return (
    <div>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          <span className="text-sm tabular-nums" aria-live="polite">
            {peopleN === 1 && daysN === 1 ? '1 day chosen' : `${peopleN} ${peopleN === 1 ? 'person' : 'people'} × ${daysN} ${daysN === 1 ? 'day' : 'days'} chosen`}
            {typed ? ` · typing ${typed}` : ''}
          </span>
          <select
            className="ui-select ui-ctl-compact !w-auto"
            aria-label="Set the chosen days to"
            value=""
            disabled={busy || !rows.length}
            onChange={(e) => apply(choices.find((x) => x.key === e.target.value))}
          >
            <option value="">Set to…</option>
            {choices.map((x) => <option key={x.key} value={x.key}>{x.code ? `${x.code} · ` : ''}{x.label}</option>)}
          </select>
          <span className="ui-caption">Drag or Shift+click for a block, a name or a date for a whole row or column. Enter for the choices, or type a shift’s code; W weekly off; Delete back to their schedule.</span>
        </div>
      ) : null}
      <div className="ui-table-scroll">
        <table ref={table} role="grid" aria-label="Roster" aria-multiselectable="true" aria-readonly={canEdit ? undefined : 'true'} className="ui-table ui-table-sticky w-full select-none text-xs" onKeyDown={onKeyDown}>
          <thead>
            <tr>
              <th scope="col" className="ui-th sticky left-0 bg-[rgb(var(--surface))] px-3 text-left" style={{ zIndex: 'var(--z-base)' }}>Employee</th>
              {days.map((d, c) => (
                <th key={d} scope="col" className={`ui-th px-0 text-center ${wd(d) === 0 || closed(d) ? 'ui-muted' : ''}`} aria-label={`${dayWords(d)}${closed(d) ? ', month closed' : ''}`}>
                  <button type="button" className="w-full rounded-lg px-1 py-0.5 tabular-nums" tabIndex={-1} title={`Choose everyone shown on ${dayWords(d)}${closed(d) ? ' (month closed)' : ''}`} onClick={() => selectColumn(c)}>
                    <div>{Number(d.slice(8))}</div>
                    <div className="font-normal">{WD[wd(d)]}</div>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="ui-rows">
            {rows.map((row, r) => (
              <tr key={row.employeeId}>
                <th scope="row" className="sticky left-0 whitespace-nowrap bg-[rgb(var(--surface))] px-1 text-left font-medium" style={{ zIndex: 'var(--z-base)' }}>
                  <button type="button" className="rounded-lg px-2 py-1 text-left" tabIndex={-1} title={`Choose all of ${row.name}’s days`} onClick={() => selectRow(r)}>
                    {row.name}
                    {row.code ? <span className="ui-caption tabular-nums"> {row.code}</span> : null}
                  </button>
                </th>
                {row.cells.map((cell, c) => {
                  const on = selected(r, c);
                  const here = a.r === r && a.c === c;
                  const tone = cell.kind === 'WORK' && cell.shiftId ? tones.get(cell.shiftId) : 0;
                  return (
                    <td
                      key={cell.date}
                      role="gridcell"
                      data-cell={`${r}:${c}`}
                      tabIndex={here ? 0 : -1}
                      aria-selected={on}
                      aria-label={`${row.name}, ${dayWords(cell.date)}: ${cellTitle(cell)}`}
                      title={cellTitle(cell)}
                      className="relative px-0.5 text-center"
                      style={{ ...(on ? { backgroundColor: 'rgb(var(--brand) / 0.12)' } : {}), ...(here ? { outline: '2px solid rgb(var(--ring))', outlineOffset: '-2px' } : {}) }}
                      onMouseDown={(e) => press(r, c, e)}
                      onMouseEnter={() => { if (dragging.current) setActive({ r, c }); }}
                      onDoubleClick={openMenu}
                    >
                      <span
                        className={`inline-block min-w-[1.6rem] rounded-full px-1 py-0.5 ${tone ? 'font-semibold' : cell.kind === 'WORK' ? '' : 'ui-muted'}`}
                        style={{ ...(tone ? wash(tone) : {}), ...(cell.draft ? { outline: '1px dashed rgb(var(--fg-muted))' } : {}) }}
                        data-draft={cell.draft ? 'true' : undefined}
                      >
                        {cellLabel(cell)}
                      </span>
                      {menu && here ? (
                        <div
                          ref={menuBox}
                          role="listbox"
                          aria-label="Set the chosen days to"
                          className="ui-popover ui-menu w-60 text-left"
                          style={menuAt}
                          onMouseDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          {choices.map((x, i) => (
                            <button
                              key={x.key}
                              type="button"
                              role="option"
                              aria-selected={i === menuIndex}
                              tabIndex={-1}
                              className="ui-menu-item w-full rounded-lg"
                              style={i === menuIndex ? { backgroundColor: 'rgb(var(--surface-sunken))' } : undefined}
                              onMouseEnter={() => setMenuIndex(i)}
                              onClick={() => { apply(x); focusCell(a); }}
                            >
                              {x.code ? <span className="mr-2 inline-block min-w-[1.6rem] text-center font-semibold tabular-nums">{x.code}</span> : null}
                              {x.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {footRows.length ? (
            <tfoot>
              {footRows.map((f, i) => (
                <tr key={f.id || 'standard'} style={i === 0 ? { borderTop: '2px solid rgb(var(--border))' } : undefined}>
                  <th scope="row" className="sticky left-0 whitespace-nowrap bg-[rgb(var(--surface))] px-3 py-1 text-left font-medium" style={{ zIndex: 'var(--z-base)' }}>
                    {f.tone ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: `rgb(var(--dept-${f.tone}))` }} aria-hidden="true" /> : null}
                    {f.name}
                    {f.min ? <span className="ui-caption tabular-nums"> · at least {f.min}</span> : null}
                  </th>
                  {coverage.map((v) => {
                    const n = v.counts?.[f.id] || 0;
                    const short = v.short?.[f.id] || 0;
                    const all = v.company?.[f.id] || 0;
                    const says = short ? `${dayWords(v.date)}: ${all} on ${f.name} in the company, ${short} short of ${f.min}` : `${dayWords(v.date)}: ${n} on ${f.name}`;
                    return (
                      <td key={v.date} className="px-0.5 py-1 text-center tabular-nums" title={says} aria-label={says} data-short={short ? 'true' : undefined}>
                        <div className={n ? '' : 'ui-muted'}>{n}</div>
                        {short ? <div className="font-semibold" style={{ color: 'rgb(var(--neg))' }}>−{short}</div> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
      {footRows.some((f) => f.min) ? (
        <p className="ui-caption px-3 py-2">
          Each shift’s row counts the people working it that day{filtered ? ', among the people listed' : ''}. A red figure is how many more the shift needs to reach its minimum{filtered ? ' across the whole company' : ''}.
        </p>
      ) : null}
    </div>
  );
}
