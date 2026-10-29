import React, { useState } from 'react';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { listInterviews } from '../api/talent';
import CandidateDrawer from './CandidateDrawer';
import { MODES, Tabs, usePerm, when, word } from './shared';

/**
 * Interviews (TALENT-DECISIONS.md): the interviews on my name, coming up first, and whether I
 * still owe feedback. Anyone can be an interviewer, so this needs no Recruitment right; HR sees
 * everyone's. Opening one shows the candidate's brief and the feedback form.
 */
export default function Interviews({ params = {} }) {
  const allowed = usePerm();
  const [when_, setWhen] = useState('upcoming');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState(null);
  const req = useRequest(() => listInterviews({ when: when_ === 'past' ? 'past' : '', mine: mine ? '1' : '' }), [when_, mine]);
  const rows = req.data?.interviews || [];
  const hr = Boolean(req.data?.hr);
  /* A notice about one interview opens its candidate, once the list has it. */
  const [seen, setSeen] = useState(null);
  if (params?.id && req.data && seen !== params.id) {
    setSeen(params.id);
    const row = rows.find((r) => r.id === params.id);
    if (row) setOpen(row.candidate.id);
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
      <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Interviews' }]} title="Interviews" />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          tabs={<Tabs label="Interviews" tabs={[['upcoming', 'Coming up'], ['past', 'Past']]} value={when_} onChange={setWhen} />}
          label="Interviews" columns={columns} rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun="interviews"
          onRowClick={(r) => setOpen(r.candidate.id)}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.candidate.name}</span>{r.owesFeedback ? <span className="ui-pill ui-pill-warn">Feedback owed</span> : null}</span>
              <span className="block truncate ui-caption tabular-nums">{[when(r.at), word(MODES, r.mode), r.openingTitle].filter(Boolean).join(' · ')}</span>
            </span>
          )}
          empty={<EmptyState title={when_ === 'past' ? 'No past interviews' : 'No interviews coming up'} description={hr ? 'Interviews are set from a candidate.' : 'Interviews you are asked to sit on show here.'} />}
          toolbar={hr && allowed('PEOPLE::Recruitment::VIEW') ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only mine</label> : null} />
      )}
      {open ? <CandidateDrawer id={open} hr={hr} canEdit={hr && allowed('PEOPLE::Recruitment::EDIT')} canHire={false} canOffer={false} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
    </div>
  );
}
