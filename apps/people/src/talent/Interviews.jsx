import React, { useState } from 'react';
import { CalendarClock } from '@ui/components/ui/lineIcons';
import { EmptyState } from '@ui/components/ui/Primitives';
import ListHeader from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { listCandidates, listInterviews } from '../api/talent';
import CandidateDrawer, { InterviewForm } from './CandidateDrawer';
import { MODES, STAGES, usePerm, when, word } from './shared';

/**
 * Interviews (TALENT-DECISIONS.md): the interviews on my name, coming up first, and whether I
 * still owe feedback. Anyone can be an interviewer, so this needs no Recruitment right; HR sees
 * everyone's. Opening one shows the candidate's brief and the feedback form. HR schedules one
 * from here too (People plan 8 Nov 2026, step 3): pick the candidate, then the interview form
 * the candidate's own page uses.
 */
export default function Interviews({ params = {} }) {
  const allowed = usePerm();
  const [when_, setWhen] = useState('upcoming');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  const req = useRequest(() => listInterviews({ when: when_ === 'past' ? 'past' : '', mine: mine ? '1' : '' }), [when_, mine]);
  const rows = req.data?.interviews || [];
  const hr = Boolean(req.data?.hr);
  const canSchedule = hr && allowed('PEOPLE::Recruitment::EDIT');
  /* A notice about one interview opens its candidate. It is looked up among all of mine, not only those
     coming up; one cancelled since (or no longer mine) says so instead of doing nothing. */
  const lookup = useRequest(() => (params?.id ? listInterviews({ when: 'all' }).catch(() => null) : Promise.resolve(null)), [params?.id]);
  const [seen, setSeen] = useState(null);
  const [gone, setGone] = useState(false);
  if (params?.id && lookup.data !== undefined && !lookup.loading && !lookup.refreshing && seen !== params.id) {
    setSeen(params.id);
    const row = (lookup.data?.interviews || []).find((r) => r.id === params.id);
    if (row) { setOpen(row.candidate.id); setGone(false); } else setGone(true);
  }

  const columns = [
    { key: 'at', label: 'When', always: true, render: (r) => <span className="tabular-nums whitespace-nowrap font-medium">{when(r.at)}</span> },
    { key: 'candidate', label: 'Candidate', render: (r) => <span className="min-w-0"><span className="block truncate">{r.candidate.name}</span><span className="block truncate ui-caption">{r.openingTitle}</span></span> },
    { key: 'mode', label: 'How', render: (r) => word(MODES, r.mode) },
    { key: 'interviewers', label: 'Interviewers', render: (r) => <span className="block max-w-[20rem] truncate" title={r.interviewers.join(', ')}>{r.interviewers.join(', ')}</span> },
    { key: 'feedback', label: 'My feedback', render: (r) => (!r.mine ? <span className="ui-muted">Not mine</span> : r.owesFeedback ? <span className="ui-pill ui-pill-warn">Owed</span> : r.status === 'DONE' || new Date(r.at) < new Date() ? <span className="ui-muted">Given</span> : <span className="ui-muted">After the interview</span>) },
  ];

  return (
    <div className="space-y-6">
      <ListHeader
        module="Talent"
        title="Interviews"
        description={hr ? 'Every interview set with a candidate, coming up first, and whose feedback is still owed.' : 'The interviews you are asked to sit on, coming up first, and the feedback you still owe.'}
        primary={canSchedule ? { label: 'Schedule interview', icon: CalendarClock, onClick: () => setScheduling(true) } : null}
        toolbar={hr ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only mine</label> : null}
        tabs={[{ key: 'upcoming', label: 'Coming up' }, { key: 'past', label: 'Past' }]}
        tab={when_}
        onTab={setWhen}
      />
      {gone ? <p className="ui-alert ui-alert-info text-sm" role="status">This interview was cancelled or has moved. The ones on your name are below.</p> : null}
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label="Interviews" columns={columns} rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun="interviews"
          onRowClick={(r) => setOpen(r.candidate.id)}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.candidate.name}</span>{r.owesFeedback ? <span className="ui-pill ui-pill-warn">Feedback owed</span> : null}</span>
              <span className="block truncate ui-caption tabular-nums">{[when(r.at), word(MODES, r.mode), r.openingTitle].filter(Boolean).join(' · ')}</span>
            </span>
          )}
          empty={<EmptyState title={when_ === 'past' ? 'No past interviews' : 'No interviews coming up'}
            description={hr ? 'An interview is set with a candidate in the running: when, how, and who sits on it.' : 'Interviews you are asked to sit on show here, with the feedback you owe after each.'}
            action={canSchedule && when_ !== 'past' ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setScheduling(true)}>Schedule interview</button> : null} />} />
      )}
      {open ? <CandidateDrawer id={open} hr={hr} canEdit={canSchedule} canHire={false} canOffer={false} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
      {scheduling ? <ScheduleInterview onClose={() => setScheduling(false)} onSaved={() => { setScheduling(false); req.reload(); }} /> : null}
    </div>
  );
}

/** Which candidate, then the interview form their page uses. */
function ScheduleInterview({ onClose, onSaved }) {
  const req = useRequest(() => listCandidates({ stage: 'open', limit: 500 }).then((r) => r?.rows || []).catch(() => []), []);
  const [picked, setPicked] = useState('');
  const rows = req.data || [];
  const candidate = rows.find((c) => c.id === picked);
  if (candidate) return <InterviewForm candidate={candidate} onClose={onClose} onSaved={onSaved} />;
  return (
    <Drawer open onClose={onClose} title="Schedule interview" description="Which candidate. Then when, how, and who sits on it." widthClass="w-[min(32rem,96vw)] ui-drawer-sheet"
      footer={<button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>}>
      {/* Choosing the candidate opens the form at once; there is nothing else to say before it. */}
      <div className="grid gap-4">
        {req.loading ? <p className="ui-muted text-sm" aria-busy="true">Loading candidates…</p>
          : !rows.length ? <p className="ui-muted text-sm" role="status">Nobody is in the running. Add a candidate under Talent › Candidates first.</p>
            : <PopupSelect label="Candidate" alwaysSearch value={picked} onChange={(v) => setPicked(v || '')} placeholder="Choose a candidate"
                options={rows.map((c) => ({ value: c.id, label: c.name, subtext: [c.openingTitle, word(STAGES, c.stage)].filter(Boolean).join(' · ') }))} />}
      </div>
    </Drawer>
  );
}
