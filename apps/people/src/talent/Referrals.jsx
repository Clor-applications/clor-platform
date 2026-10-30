import React, { useState } from 'react';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { rupees } from '@ui/referrals/words';
import { bonusForfeit, bonusPaid, listOpenings, listReferrals, referralReport, sendBonus } from '../api/talent';
import CandidateDrawer from './CandidateDrawer';
import { Pill, ReasonDrawer, STAGES, Tabs, day, useParamState, usePerm } from './shared';

/**
 * Referrals (A20): every referral with who made it, where the candidate is and the bonus; and
 * the report by employee (referred, in process, joined, bonus waiting, due and paid). A bonus
 * becomes due on its own when the hire stays to the date; it goes to Payroll as a draft earning,
 * or, without Payroll in CLOR, HR pays it by hand and marks it paid. Amounts show only to
 * Recruitment edit and Payroll; Recruitment view sees that there is a bonus, not how much.
 */
const TABS = [['all', 'All'], ['open', 'In process'], ['joined', 'Joined'], ['bonusWaiting', 'Bonus waiting'], ['bonusDue', 'Bonus due'], ['bonusPaid', 'Bonus paid'], ['notTaken', 'Not taken forward'], ['report', 'By employee']];
const BONUS = {
  NONE: ['No bonus yet', 'ui-pill-neutral'],
  WAITING: ['Waiting', 'ui-pill-info'],
  DUE: ['Due', 'ui-pill-warn'],
  SENT: ['With Payroll', 'ui-pill-info'],
  PAID: ['Paid', 'ui-pill-pos'],
  FORFEITED: ['Not payable', 'ui-pill-neutral'],
};

export default function Referrals({ params = {}, openScreen }) {
  const allowed = usePerm();
  const canEdit = allowed('PEOPLE::Recruitment::EDIT');
  const canPayroll = allowed('PAYROLL::Payroll Adjustments::CREATE');
  const [status, setStatus] = useParamState(params?.status, 'all');
  const [opening, setOpening] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [forfeiting, setForfeiting] = useState(null);
  const report = status === 'report';
  const openings = useRequest(() => listOpenings({ status: 'all' }).catch(() => []), []);
  const req = useRequest(() => (report ? referralReport() : listReferrals({ status, openingId: opening, q })), [status, opening, q, report]);
  const rows = report ? [] : req.data?.rows || [];
  const counts = req.data?.counts || {};
  const money = Boolean(req.data?.money);

  const act = async (fn, ok) => {
    try { const r = await fn(); notify.success(typeof ok === 'function' ? ok(r) : ok); req.reload(); } catch (e) { notify.error(String(e?.message || 'Not done.')); }
  };
  const bonusCell = (r) => (!r.hasBonus ? <span className="ui-muted">—</span> : (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {money && r.bonusAmount != null ? <span className="tabular-nums">{rupees(r.bonusAmount)}</span> : null}
      <Pill map={BONUS} value={r.bonusStatus} />
    </span>
  ));
  const columns = [
    { key: 'candidate', label: 'Candidate', always: true, render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.candidate}</span><span className="block truncate ui-caption">{r.job}</span></span> },
    { key: 'referrer', label: 'Referred by', render: (r) => <span className="min-w-0"><span className="block truncate">{r.referrer}{r.referrerLeft ? <span className="ui-muted"> (left)</span> : null}</span><span className="block truncate ui-caption">{r.via === 'LINK' ? 'Through their link' : r.relation || 'Referred in the app'}</span></span> },
    { key: 'stage', label: 'Stage', render: (r) => <Pill map={STAGES} value={r.stage} /> },
    { key: 'when', label: 'Referred', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.referredAt)}</span> },
    { key: 'bonus', label: 'Bonus', align: 'right', render: (r) => <span className="block text-right">{bonusCell(r)}{r.bonusStatus === 'WAITING' && r.bonusDueOn ? <span className="block ui-caption tabular-nums">due {day(r.bonusDueOn)}</span> : null}</span> },
  ];
  const rowActions = (r) => [
    { key: 'open', label: 'Open candidate', onSelect: () => setOpen(r.candidateId) },
    canEdit && canPayroll && r.bonusStatus === 'DUE' ? { key: 'send', label: 'Send to Payroll', onSelect: () => act(() => sendBonus(r.id), (x) => (x?.sent ? 'With Payroll as a draft earning.' : x?.why || 'Not sent.')) } : null,
    canEdit && r.bonusStatus === 'DUE' ? { key: 'paid', label: 'Mark paid', onSelect: () => act(() => bonusPaid(r.id), 'Marked paid.') } : null,
    canEdit && ['WAITING', 'DUE'].includes(r.bonusStatus) ? { key: 'forfeit', label: 'Not payable', onSelect: () => setForfeiting(r) } : null,
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Referrals' }]} title="Referrals" />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : report ? (
        <>
          <Tabs label="Referrals" tabs={TABS.map(([k, l]) => [k, l, k !== 'report' ? counts[k] : undefined])} value={status} onChange={setStatus} />
          <Report data={req.data} loading={req.loading} money={money} />
        </>
      ) : (
        <DataTable
          tabs={<Tabs label="Referrals" tabs={TABS.map(([k, l]) => [k, l, k !== 'report' && k !== 'all' ? counts[k] : undefined])} value={status} onChange={setStatus} />}
          label="Referrals" columns={columns} rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun="referrals"
          onRowClick={(r) => setOpen(r.candidateId)} rowActions={rowActions}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.candidate}</span><Pill map={STAGES} value={r.stage} /></span>
              <span className="block truncate ui-caption">{[r.job, `by ${r.referrer}`].join(' · ')}</span>
              {r.hasBonus ? <span className="mt-1 flex items-center gap-1.5 text-sm">{money && r.bonusAmount != null ? <span className="tabular-nums">{rupees(r.bonusAmount)}</span> : null}<Pill map={BONUS} value={r.bonusStatus} /></span> : null}
            </span>
          )}
          empty={q || opening || status !== 'all'
            ? <EmptyState kind="filtered" title="No referrals match" description="Nothing here matches the search, the opening or the tab." />
            : <EmptyState title="No referrals yet" description="Open a job to referrals and your staff can put people forward from their phone." routes={[{ label: 'Job openings', onSelect: () => openScreen?.('recruitment') }]} />}
          toolbar={(
            <>
              <SearchField value={q} onSearch={setQ} placeholder="Search candidate, job or referrer" label="Search referrals" className="w-full sm:w-72" />
              <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="Opening" placeholder="Every opening" value={opening} alwaysSearch={(openings.data || []).length > 8} onChange={(v) => setOpening(v || '')} options={[{ value: '', label: 'Every opening' }, ...(openings.data || []).map((o) => ({ value: o.id, label: o.title }))]} /></div>
            </>
          )} />
      )}
      {open ? <CandidateDrawer id={open} hr known={[]} canEdit={canEdit} canHire={canEdit && allowed('PEOPLE::Employees::CREATE')} canOffer={canEdit && allowed('PEOPLE::Documents::CREATE')} onClose={() => setOpen(null)} onChanged={req.reload} onHired={() => req.reload()} /> : null}
      {forfeiting ? (
        <ReasonDrawer title={`Bonus for ${forfeiting.candidate} not payable`} label="Why" help="Say why, for example let go during probation." action="Not payable"
          suggestions={['Let go during probation', 'Referrer left', 'Rehire of a former employee']}
          onClose={() => setForfeiting(null)}
          onDone={async (reason) => { await bonusForfeit(forfeiting.id, reason); notify.success('Set as not payable.'); setForfeiting(null); req.reload(); }} />
      ) : null}
    </div>
  );
}

/** By employee: who refers, how many joined, and the bonus owed and paid; the totals above it. */
function Report({ data, loading, money }) {
  if (loading && !data) return <p className="text-sm ui-muted">Loading…</p>;
  const t = data?.totals || {};
  const stats = [
    ['Referred', t.referred, false], ['In process', t.inProcess, false], ['Joined', t.joined, false],
    ...(money ? [['Bonus waiting', t.bonusWaiting, true], ['Bonus due', t.bonusDue, true], ['Bonus paid', t.bonusPaid, true]] : []),
  ];
  const rows = data?.byEmployee || [];
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b pb-4 sm:grid-cols-3 lg:grid-cols-6" style={{ borderColor: 'rgb(var(--border))' }}>
        {stats.map(([label, v, isMoney]) => (
          <div key={label}><dt className="ui-label">{label}</dt><dd className="text-lg tabular-nums">{isMoney ? rupees(v || 0) : v ?? 0}</dd></div>
        ))}
      </dl>
      {!rows.length ? <EmptyState title="No referrals yet" description="When staff refer people, who referred and who joined shows here." /> : (
        <div className="ui-table-scroll">
          <table className="ui-table w-full" aria-label="Referrals by employee">
            <thead>
              <tr>
                <th scope="col" className="text-left">Employee</th>
                <th scope="col" className="text-right ui-num">Referred</th>
                <th scope="col" className="text-right ui-num">In process</th>
                <th scope="col" className="text-right ui-num">Joined</th>
                {money ? <th scope="col" className="text-right ui-num">Bonus owed</th> : null}
                {money ? <th scope="col" className="text-right ui-num">Bonus paid</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.referrerId}>
                  <td>{r.referrer}</td>
                  <td className="text-right tabular-nums">{r.referred}</td>
                  <td className="text-right tabular-nums">{r.inProcess}</td>
                  <td className="text-right tabular-nums">{r.joined}</td>
                  {money ? <td className="text-right tabular-nums">{rupees(r.bonusDue)}</td> : null}
                  {money ? <td className="text-right tabular-nums">{rupees(r.bonusPaid)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
