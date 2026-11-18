import React, { useEffect } from 'react';

/* Round 24 picks (DESIGN.md, Round 24). */

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * A shift in two parts (hotel staff: 7–11, then 5–9) is kept as one shift with a long
 * unpaid break that has its own times. Two hours or more counts as a split, and the
 * shift then reads with both parts: "Split · 07:00–11:00, 17:00–21:00".
 * Returns null for an ordinary shift.
 */
export function splitShiftLabel(shift) {
  const s = toMin(shift?.startTime);
  const e = toMin(shift?.endTime);
  if (s == null || e == null || e <= s) return null;
  const gap = (Array.isArray(shift.breaks) ? shift.breaks : [])
    .filter((b) => !b.paid && toMin(b.startTime) != null && toMin(b.endTime) != null)
    .find((b) => {
      const bs = toMin(b.startTime);
      const be = toMin(b.endTime);
      return be - bs >= 120 && bs > s && be < e;
    });
  if (!gap) return null;
  return `Split · ${shift.startTime}–${gap.startTime}, ${gap.endTime}–${shift.endTime}`;
}

/**
 * Today's numbers for a screen at the office or factory gate: in, late, away, in big
 * type that reads from across a room. Esc or the button closes it.
 */
export function TodayScreen({ data, dateLabel, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const inn = (data.present || 0) + (data.halfDay || 0);
  const away = (data.onLeave || 0) + (data.absent || 0);
  const figures = [
    ['In', inn],
    ['Late', (data.late || []).length],
    ['Away', away],
  ];
  return (
    <div className="ui-tv" role="dialog" aria-modal="true" aria-label="Today on a screen">
      <p className="ui-tv-date">{dateLabel}</p>
      <ul className="ui-tv-figures">
        {figures.map(([label, n]) => (
          <li key={label}>
            <b className="tabular-nums">{n}</b>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {data.headcount ? <p className="ui-tv-note tabular-nums">{inn} of {data.headcount} in</p> : null}
      <button type="button" className="ui-btn ui-btn-secondary ui-tv-close" onClick={onClose}>Close</button>
    </div>
  );
}
