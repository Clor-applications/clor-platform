import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';

/**
 * People → Settings: one page instead of a long sidebar (founder, 22 Oct 2026;
 * the pattern of Zoho People, Keka and greytHR settings). Everything that is
 * set up once and changed rarely, grouped the way an HR person thinks about
 * it, each with a line saying what it is for. Only what this person may open.
 */
const GROUPS = [
  {
    title: 'Company',
    note: 'Who the employer is and how the company is organised.',
    items: [
      ['companyDetails', 'Legal name, PAN, TAN, address and statutory registrations'],
      ['businessUnits', 'Divisions or domains the company runs as one business'],
      ['areas', 'Offices, plants and sites people work at'],
      ['departments', 'How the company is divided; a department can sit under another'],
      ['jobPositions', 'The titles people hold'],
      ['grades', 'Levels or pay bands'],
      ['costCentres', 'Where salary cost is booked in the accounts'],
      ['jobRoles', 'Finer roles inside a designation'],
    ],
  },
  {
    title: 'Employees',
    note: 'How people are classified, and what happens when they join or leave.',
    items: [
      ['employeeTypes', 'Permanent, probation, contract, intern'],
      ['workTypes', 'Office, remote, hybrid, field'],
      ['tags', 'Labels to group people any way you like'],
      ['checklists', 'Joining and leaving checklists'],
      ['selfService', 'Who can sign in to the employee app'],
    ],
  },
  {
    title: 'Time Off',
    note: 'Leave rules and the company calendar.',
    items: [
      ['leaveTypes', 'Leave types, yearly days, carry forward'],
      ['holidays', 'Company and location holidays'],
    ],
  },
  {
    title: 'Access & Security',
    note: 'How people sign in.',
    items: [['sso', 'Sign in with Google or Microsoft for your domain']],
  },
  {
    title: 'Integrations',
    note: 'Connect CLOR to your other systems.',
    items: [['integrations', 'Webhooks, API keys and HR tool sync']],
    apps: [
      ['payroll', 'Payroll', 'Salaries, statutory deductions and payslips for these people'],
      ['attendance', 'Attendance', 'Readers, shifts and days for these people'],
    ],
  },
  {
    title: 'Data & Privacy',
    note: 'Bring data in, take it out, and keep it right.',
    items: [
      ['dataImport', 'Employees, leave balances and more from a spreadsheet'],
      ['dataExport', 'A copy of the company’s HR data'],
      ['dataHealth', 'Missing or wrong details before they cost a payroll'],
      ['auditLogs', 'Who changed what, and when'],
      ['recycleBin', 'Bring back what was deleted in the last 30 days'],
      ['dataProtection', 'Privacy notice and consent (DPDP)'],
      ['dataRequests', 'Employees’ requests to see, correct or erase data'],
    ],
  },
];

export default function PeopleSettings({ openScreen, navItems = [] }) {
  const [q, setQ] = useState('');
  const byKey = useMemo(() => new Map(navItems.filter((i) => i.key).map((i) => [i.key, i])), [navItems]);
  const match = (...texts) => !q.trim() || texts.join(' ').toLowerCase().includes(q.trim().toLowerCase());
  const groups = GROUPS.map((g) => ({
    ...g,
    cards: g.items.map(([key, note]) => ({ key, note, item: byKey.get(key) })).filter((c) => c.item && match(c.item.label, c.note, g.title)),
    apps: (g.apps || []).filter(([, label, note]) => match(label, note, g.title)),
  })).filter((g) => g.cards.length || g.apps.length);

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        entity="settings"
        title="Settings"
        description="Everything set up once and changed rarely, in one place."
        actions={
          <label className="relative block w-72 max-w-full">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" aria-hidden="true" />
            <input className="ui-input w-full pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings…" aria-label="Search settings" />
          </label>
        }
      />
      {!groups.length ? <p className="ui-muted text-sm">No setting matches “{q}”.</p> : null}
      {groups.map((g) => (
        <section key={g.title} className="space-y-2" aria-labelledby={`set-${g.title}`}>
          <div>
            <h2 id={`set-${g.title}`} className="ui-t-sec">{g.title}</h2>
            <p className="ui-caption">{g.note}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {g.cards.map(({ key, note, item }) => {
              const Icon = item.icon;
              return (
                <li key={key}>
                  <button type="button" onClick={() => openScreen?.(key)} className="ui-card w-full h-full p-4 text-left flex items-start gap-3 hover:border-[rgb(var(--brand))]">
                    {Icon ? <Icon size={22} aria-hidden="true" /> : null}
                    <span className="min-w-0">
                      <span className="block font-medium">{item.label}</span>
                      <span className="ui-caption block">{note}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {g.apps.map(([id, label, note]) => (
              <li key={id}>
                <a href={`?app=${id}`} className="ui-card w-full h-full p-4 text-left flex items-start gap-3 hover:border-[rgb(var(--brand))]">
                  <ArrowUpRight size={22} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium">{label}</span>
                    <span className="ui-caption block">{note}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
