import React from 'react';

import { ChartFrame, INK, fmtNumber } from './core';

/**
 * Steps that narrow: each a bar as wide as its count, with the share that
 * went on to the next step written between them. Bklit's "Funnel" shape,
 * flat (no halo rings, no stagger).
 *
 * steps: [{ name, value }]
 * focus: index of the step the page is about (the one losing the most, say)
 *
 * Use for: hiring (applied, screened, interviewed, offered, joined), trial to
 * paid on clor.in, invoices sent to paid, onboarding started to done.
 */
export default function Funnel({ title, figure, note, steps = [], focus, format = fmtNumber, label }) {
  const top = Math.max(1, ...steps.map((s) => Number(s.value) || 0));
  const said = label || title || 'Funnel';
  const table = {
    caption: said,
    columns: ['Step', 'Count', 'Of the step before'],
    rows: steps.map((s, i) => [s.name, format(s.value), i ? `${Math.round(((s.value || 0) / (steps[i - 1].value || 1)) * 100)}%` : '']),
  };
  return (
    <ChartFrame title={title} figure={figure} note={note} table={table} label={said}>
      <ol className="ck-funnel" aria-hidden="true">
        {steps.map((s, i) => {
          const conv = i ? Math.round(((s.value || 0) / (steps[i - 1].value || 1)) * 100) : null;
          return (
            <li key={s.name}>
              {conv != null ? <span className="ck-funnel-conv">{conv}% went on</span> : null}
              <div className="ck-funnel-row">
                <span className="ck-funnel-name">{s.name}</span>
                <span className="ck-funnel-bar">
                  <span style={{ width: `${((s.value || 0) / top) * 100}%`, background: focus === i ? INK.act : INK.fg }} />
                </span>
                <span className="ck-funnel-value">{format(s.value)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}
