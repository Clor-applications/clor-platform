import React, { useMemo, useState } from 'react';
import { Download } from '@ui/components/ui/lineIcons';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { getLeaveBalances, thisYear } from '@ui/timeOff/api';
import { plusDaysIso, todayIst } from '@ui/utils/dates';
import { downloadText, listEmployees } from './api';
import { teamBalanceRows, teamCounts, teamCsv, teamDue } from './round65';

/**
 * Over the Workforce "My team" tab (round 65 manager picks): the team's real size with who is
 * joining and who is on notice (each opens those people), what falls due this month, the leave
 * each person has left, and "Download team". Everything comes from the lists the manager can
 * already read; a part the manager may not read (leave balances) is simply left out.
 */
export default function MyTeamPanel({ onFilter, openScreen }) {
  const today = todayIst();
  const team = useRequest(() => listEmployees({ team: 'mine', status: 'CURRENT', limit: 500 }), []);
  const balances = useRequest(() => getLeaveBalances(thisYear()), []);
  const [sortType, setSortType] = useState('');
  const rows = team.data?.employees || [];
  const counts = useMemo(() => teamCounts(rows, today), [rows, today]);
  const due = useMemo(() => teamDue(rows, today), [rows, today]);
  const idKey = rows.map((r) => r.id).join(',');
  const types = balances.data?.types || [];
  const leaveRows = useMemo(() => teamBalanceRows(balances.data, idKey.split(','), sortType), [balances.data, idKey, sortType]);
  if (!rows.length) return null;

  const open = (id) => openScreen?.('employee', { id });
  const download = () => downloadText(teamCsv(rows, balances.error ? null : balances.data), `my-team-${today}.csv`);

  return (
    <section className="ui-myteam" aria-label="Your team">
      <div className="ui-myteam-head">
        <p className="ui-myteam-count">
          <button type="button" className="ui-link" onClick={() => onFilter?.({ status: null, from: null })}>{counts.people} {counts.people === 1 ? 'person' : 'people'}</button>
          {counts.joining ? <> · <button type="button" className="ui-link" onClick={() => onFilter?.({ status: null, from: plusDaysIso(1) })}>{counts.joining} joining</button></> : null}
          {counts.leaving ? <> · <button type="button" className="ui-link" onClick={() => onFilter?.({ status: 'ON_NOTICE', from: null })}>{counts.leaving} leaving</button></> : null}
        </p>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={download}><Download size={16} aria-hidden="true" /> Download team</button>
      </div>

      {due.length ? (
        <div className="ui-myteam-block">
          <h2 className="ui-myteam-title">Due this month</h2>
          <ul className="ui-myteam-due">
            {due.map((d) => (
              <li key={`${d.kind}-${d.id}`}>
                <span className="tabular-nums ui-myteam-date">{formatDate(d.date)}</span>
                <span className="min-w-0 flex-1">{d.text}</span>
                <button type="button" className="ui-link text-sm" onClick={() => open(d.id)}>{d.action}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!balances.error && types.length && leaveRows.length ? (
        <div className="ui-myteam-block">
          <h2 className="ui-myteam-title">Leave left</h2>
          <div className="ui-myteam-scroll">
            <table className="ui-myteam-table">
              <thead>
                <tr>
                  <th scope="col"><button type="button" className="ui-myteam-sort" aria-pressed={!sortType} onClick={() => setSortType('')}>Name</button></th>
                  {types.map((t) => (
                    <th scope="col" key={t.id} className="text-right">
                      <button type="button" className="ui-myteam-sort" aria-pressed={sortType === t.id} title={`Most ${t.name} left first`} onClick={() => setSortType(t.id)}>{t.code || t.name}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaveRows.map((r) => (
                  <tr key={r.employeeId}>
                    <th scope="row"><button type="button" className="ui-link" onClick={() => open(r.employeeId)}>{r.name}</button></th>
                    {types.map((t) => {
                      const b = r.balances?.[t.id];
                      return <td key={t.id} className={`text-right tabular-nums ${b?.available < 0 ? 'ui-text-neg' : ''}`}>{b?.available ?? '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
