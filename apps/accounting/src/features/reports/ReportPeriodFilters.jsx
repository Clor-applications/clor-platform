import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { compactReportPeriod, displayReportPeriod } from './reportComparison';

export default function ReportPeriodFilters({
  currentRange, periodMode, onPeriodMode, customStart, customEnd, onCustomRange,
  comparisonRanges, comparisonType, comparisonCount, onComparison,
}) {
  const [open, setOpen] = useState(null);
  const [draftType, setDraftType] = useState(comparisonType);
  const [draftCount, setDraftCount] = useState(comparisonCount);
  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);
  const [baseStart, setBaseStart] = useState(comparisonRanges[0]?.start || '');
  const [baseEnd, setBaseEnd] = useState(comparisonRanges[0]?.end || '');
  const currentValid = draftStart && draftEnd && draftStart <= draftEnd;
  const baseValid = baseStart && baseEnd && baseStart <= baseEnd;
  const openMenu = kind => {
    if (open === kind) { setOpen(null); return; }
    setDraftType(comparisonType);
    setDraftCount(comparisonCount);
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    setBaseStart(comparisonRanges[0]?.start || '');
    setBaseEnd(comparisonRanges[0]?.end || '');
    setOpen(kind);
  };
  return <div className="flex min-w-0 items-center gap-1.5 print:hidden">
    <div className="relative w-[220px] shrink-0">
      <button type="button" className="ui-btn ui-btn-secondary h-8 w-full justify-between gap-1 px-2 text-xs" aria-label="Current Period" aria-expanded={open === 'current'} onClick={() => openMenu('current')}><span className="font-semibold">Current</span><span className="whitespace-nowrap font-normal" title={displayReportPeriod(currentRange)}>{compactReportPeriod(currentRange)}</span><ChevronDown size={13}/></button>
      {open === 'current' && <div className="absolute left-0 top-[calc(100%+0.25rem)] z-40 w-72 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-3 shadow-xl">
        <label className="ui-label block">Current Period<select aria-label="Current Period selection" className="ui-select mt-1 w-full text-xs" value={periodMode} onChange={event => { onPeriodMode(event.target.value); if (event.target.value !== 'custom') setOpen(null); }}><option value="month">This month</option><option value="year">This year</option><option value="30days">Last 30 days</option><option value="custom">Custom</option></select></label>
        {periodMode === 'custom' && <><div className="mt-2 grid grid-cols-2 gap-2"><label className="ui-label">From<input aria-label="Current Period from" className="ui-input mt-1 w-full text-xs" type="date" value={draftStart} onChange={event => setDraftStart(event.target.value)}/></label><label className="ui-label">To<input aria-label="Current Period to" className="ui-input mt-1 w-full text-xs" type="date" min={draftStart} value={draftEnd} onChange={event => setDraftEnd(event.target.value)}/></label></div><div className="mt-3 flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setOpen(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={!currentValid} onClick={() => { onCustomRange(draftStart, draftEnd); setOpen(null); }}>Apply</button></div></>}
      </div>}
    </div>
    <div className="relative w-[250px] shrink-0">
      <button type="button" className="ui-btn ui-btn-secondary h-8 w-full justify-between gap-1 px-2 text-xs" aria-label="Compare with" aria-expanded={open === 'comparison'} onClick={() => openMenu('comparison')}><span className="font-semibold">Compare</span><span className="whitespace-nowrap font-normal" title={comparisonRanges.map(displayReportPeriod).join(', ')}>{comparisonRanges.length > 1 ? `${comparisonRanges.length} ${comparisonType === 'previousYear' ? 'years' : 'periods'}` : comparisonRanges.length ? compactReportPeriod(comparisonRanges[0]) : 'None'}</span><ChevronDown size={13}/></button>
      {open === 'comparison' && <div className="absolute left-0 top-[calc(100%+0.25rem)] z-40 w-72 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-3 shadow-xl">
        <label className="ui-label block">Comparison type<select aria-label="Comparison type" className="ui-select mt-1 w-full text-xs" value={draftType} onChange={event => setDraftType(event.target.value)}><option value="none">No comparison</option><option value="previousMonth">Previous period(s)</option><option value="previousYear">Previous year(s)</option><option value="custom">Custom range</option></select></label>
        {draftType !== 'none' && draftType !== 'custom' && <label className="ui-label mt-3 block">Number of {draftType === 'previousYear' ? 'years' : 'periods'}<select aria-label="Number of comparison periods" className="ui-select mt-1 w-full text-xs" value={draftCount} onChange={event => setDraftCount(Number(event.target.value))}>{Array.from({ length: 32 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>}
        {draftType === 'custom' && <div className="mt-2 grid grid-cols-2 gap-2"><label className="ui-label">From<input aria-label="Compare with from" className="ui-input mt-1 w-full text-xs" type="date" value={baseStart} onChange={event => setBaseStart(event.target.value)}/></label><label className="ui-label">To<input aria-label="Compare with to" className="ui-input mt-1 w-full text-xs" type="date" min={baseStart} value={baseEnd} onChange={event => setBaseEnd(event.target.value)}/></label></div>}
        <div className="mt-3 flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setOpen(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={draftType === 'custom' && !baseValid} onClick={() => { onComparison(draftType, draftCount, { start: baseStart, end: baseEnd }); setOpen(null); }}>Apply</button></div>
      </div>}
    </div>
  </div>;
}
