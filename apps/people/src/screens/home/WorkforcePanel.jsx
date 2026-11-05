import React, { useState } from 'react';
import { Briefcase, CaretRight, UsersFour } from '@phosphor-icons/react';

import { PanelHead } from './bits';

const MONTH = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
const VIEWS = [
  { key: 'byDepartment', label: 'Department' },
  { key: 'byEntity', label: 'Entity' },
  { key: 'byLocation', label: 'Location' },
  { key: 'byKind', label: 'Full time or contract' },
];
const STAGE_WORD = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer' };
const SHOWN = 6;

/* Joiners against leavers, month by month: green for joining, clay for leaving, each month's numbers under it. */
function JoinersLeavers({ months }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.joiners, m.leavers || 0]));
  const leaversShown = months.some((m) => m.leavers !== null);
  const total = (k) => months.reduce((n, m) => n + (m[k] || 0), 0);
  return (
    <figure className="home-jl" aria-label={`Joiners${leaversShown ? ' and leavers' : ''} by month: ${months.map((m) => `${MONTH(m.month)} ${m.joiners} joined${m.leavers !== null ? `, ${m.leavers} left` : ''}`).join('; ')}`}>
      <figcaption className="home-jl-key">
        <span data-tint="mint"><span className="home-jl-swatch" aria-hidden="true" />Joined <b className="tabular-nums">{total('joiners')}</b></span>
        {leaversShown ? <span data-tint="peach"><span className="home-jl-swatch" aria-hidden="true" />Left <b className="tabular-nums">{total('leavers')}</b></span> : null}
        <span className="ui-caption">Last 12 months</span>
      </figcaption>
      <ol className="home-jl-months" aria-hidden="true">
        {months.map((m) => (
          <li key={m.month}>
            <span className="home-jl-bars">
              <span data-tint="mint" style={{ height: `${(m.joiners / max) * 100}%` }} title={`${m.joiners} joined`} />
              {m.leavers !== null ? <span data-tint="peach" style={{ height: `${(m.leavers / max) * 100}%` }} title={`${m.leavers} left`} /> : null}
            </span>
            <span className="home-jl-month">{MONTH(m.month)}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/**
 * The workforce in numbers (owner's suite spec, 5–6 Nov 2026): headcount by department, entity, location and
 * full time against contract; joiners against leavers month by month; open requisitions and the candidate pipeline.
 */
export default function WorkforcePanel({ workforce, hiring, openScreen }) {
  const views = VIEWS.filter((v) => workforce?.[v.key]?.length);
  const [view, setView] = useState('byDepartment');
  if (!workforce) return null;
  const current = views.find((v) => v.key === view) || views[0];
  const rows = current ? workforce[current.key] : [];
  const max = Math.max(1, ...rows.map((r) => r.count));
  const inPipeline = (hiring?.pipeline || []).reduce((n, s) => n + s.count, 0);
  return (
    <section aria-labelledby="workforce-h">
      <PanelHead id="workforce-h" icon={UsersFour} tint="sky" title="Workforce" action={<button type="button" className="people-more" onClick={() => openScreen?.('reports')}>Reports <CaretRight size={14} aria-hidden="true" /></button>} />
      <div className="home-workforce">
        <div className="home-wf-part">
          <div className="home-wf-switch" role="tablist" aria-label="Headcount by">
            {views.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={current?.key === v.key} className="home-wf-tab" onClick={() => setView(v.key)}>{v.label}</button>
            ))}
          </div>
          <ul className="soft-bars" data-tint="sky" aria-label={`Headcount by ${current?.label.toLowerCase()}`}>
            {rows.slice(0, SHOWN).map((r) => (
              <li key={r.key || r.name}><span className="truncate" title={r.name}>{r.name}</span><span className="soft-bar"><span style={{ width: `${(r.count / max) * 100}%` }} /></span><b className="tabular-nums">{r.count}</b></li>
            ))}
            {rows.length > SHOWN ? <li className="ui-caption">and {rows.length - SHOWN} more</li> : null}
          </ul>
        </div>
        {workforce.months?.length ? <div className="home-wf-part"><JoinersLeavers months={workforce.months} /></div> : null}
        {hiring ? (
          <div className="home-wf-part">
            <button type="button" className="home-hiring" onClick={() => openScreen?.('recruitment')}>
              <span className="home-mark" data-tint="lilac"><Briefcase size={16} weight="duotone" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Open requisitions <b className="tabular-nums" data-zero={hiring.open === 0 || undefined}>{hiring.open}</b></span>
                <span className="ui-caption block"><span className="tabular-nums">{hiring.places}</span> {hiring.places === 1 ? 'place' : 'places'} to fill{hiring.requested ? <> · <span className="tabular-nums">{hiring.requested}</span> asked for</> : null}{hiring.onHold ? <> · <span className="tabular-nums">{hiring.onHold}</span> on hold</> : null}</span>
              </span>
              <CaretRight size={16} className="ui-subtle shrink-0" aria-hidden="true" />
            </button>
            <ol className="home-pipeline" aria-label={`Candidate pipeline: ${(hiring.pipeline || []).map((s) => `${STAGE_WORD[s.stage] || s.stage} ${s.count}`).join(', ')}`}>
              {(hiring.pipeline || []).map((s) => (
                <li key={s.stage}>
                  <button type="button" onClick={() => openScreen?.('candidates')}>
                    <b className="tabular-nums" data-zero={s.count === 0 || undefined}>{s.count}</b>
                    <span>{STAGE_WORD[s.stage] || s.stage}</span>
                  </button>
                </li>
              ))}
            </ol>
            {!inPipeline ? <p className="ui-caption">No candidates in the pipeline.</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
