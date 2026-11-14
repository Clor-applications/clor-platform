import React from 'react';
import { formatDate } from '@ui/components/ui/DatePicker';
import { Avatar } from '@ui/personnel/Employees';
import { symbolOf } from './symbols';
import { AssetPill, StatusPill } from './RegisterViews';

/* The table columns of the Assets list and the Benefits enrolments (clor-rnd PEOPLE-08, PEOPLE-10). */
const day = (v) => (v ? formatDate(String(v).slice(0, 10)) : '');
const short = (v, today) => {
  const d = String(v || '').slice(0, 10);
  const full = d ? formatDate(d) : '';
  return d.slice(0, 4) === today.slice(0, 4) ? full.replace(/\s\d{4}$/, '') : full;
};

/** Tag · Asset · Type · With · Since · Status (PEOPLE-08). A held asset that must come back says by when. */
export function assetColumns({ cfg, people, today }) {
  return [
    { key: 'tag', label: 'Tag', render: (r) => <span className="rg-tag">{r.details?.assetTag || '—'}</span> },
    { key: 'title', label: 'Asset', always: true, render: (r) => <span>{symbolOf(r.details?.symbol) ? <span className="mr-1.5" aria-hidden="true">{symbolOf(r.details.symbol).emoji}</span> : null}{r.title}</span> },
    { key: 'category', label: 'Type', render: (r) => r.details?.category || <span className="ui-muted">—</span> },
    { key: 'employee', label: 'With', render: (r) => (people.get(r.employeeId) ? <span className="rg-who"><Avatar person={people.get(r.employeeId)} size={28} /><span className="truncate font-medium">{people.get(r.employeeId).name}</span></span> : <span className="ui-muted">—</span>) },
    { key: 'since', label: 'Since', align: 'right', render: (r) => <span className="tabular-nums whitespace-nowrap">{r.employeeId && r.details?.issuedOn ? day(r.details.issuedOn) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <AssetPill cfg={cfg} row={r} holder={people.get(r.employeeId)} today={today} /> },
  ];
}

/** Employee · Plan · Change · Effective · Status (PEOPLE-10 "Enrolments"). One starting later says when. */
export function enrolmentColumns({ cfg, people, today }) {
  return [
    { key: 'employee', label: 'Employee', always: true, render: (r) => (people.get(r.employeeId) ? <span className="rg-who"><Avatar person={people.get(r.employeeId)} size={28} /><span className="truncate font-medium">{people.get(r.employeeId).name}</span></span> : <span className="ui-muted">Someone who has left</span>) },
    { key: 'title', label: 'Plan', render: (r) => r.title },
    { key: 'coverage', label: 'Change', render: (r) => <span className="block max-w-[22rem] truncate" title={r.details?.coverage || ''}>{r.details?.coverage || '—'}</span> },
    { key: 'startDate', label: 'Effective', align: 'right', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.details?.startDate) || '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => (r.status === 'ACTIVE' && String(r.details?.startDate || '') > today
      ? <StatusPill cfg={cfg} status={r.status} tone="warn">Starts {short(r.details.startDate, today)}</StatusPill>
      : <StatusPill cfg={cfg} status={r.status} />) },
  ];
}
