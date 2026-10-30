import React, { useMemo, useState } from 'react';

import PopupSelect from '@ui/components/pickers/PopupSelect';
import SearchField from '@ui/components/ui/SearchField';
import useRequest from '@ui/components/ui/useRequest';
import { listAllEmployees, listBranches, listStructure } from '@ui/personnel/api';

/*
 * Who reads an announcement (time depth, gap 20): everyone, or only some
 * departments, branches, locations or people. The employee app and People
 * show it to those only. The words shown with it ("For Operations") follow
 * the choice, so the list and the reader say the same thing.
 */
const AUDIENCE_KINDS = [
  { value: 'ALL', label: 'Everyone' },
  { value: 'DEPARTMENT', label: 'Some departments' },
  { value: 'BRANCH', label: 'Some branches' },
  { value: 'LOCATION', label: 'Some locations' },
  { value: 'PEOPLE', label: 'Some people' },
];

/** The words for a choice: "Everyone", "Operations, Finance", "3 people". */
function audienceWords(kind, ids, items) {
  if (!kind || kind === 'ALL' || !ids?.length) return 'Everyone';
  const names = ids.map((id) => items.find((x) => x.id === id)?.name).filter(Boolean);
  if (kind === 'PEOPLE' && names.length > 2) return `${names.length} people`;
  const text = names.join(', ');
  return text.length > 110 ? `${names.length} ${kind === 'BRANCH' ? 'branches' : kind === 'LOCATION' ? 'locations' : 'departments'}` : text;
}

function useAudienceLists() {
  return useRequest(() => Promise.all([
    listStructure('departments').catch(() => []),
    listBranches().catch(() => []),
    listStructure('areas').catch(() => []),
    listAllEmployees().then((r) => r?.employees || []).catch(() => []),
  ]).then(([departments, branches, areas, people]) => ({
    DEPARTMENT: departments.map((d) => ({ id: d.id, name: d.name })),
    BRANCH: branches.map((b) => ({ id: b.id, name: b.branchName || b.name })),
    LOCATION: areas.map((a) => ({ id: a.id, name: a.name })),
    PEOPLE: people.filter((p) => p.status !== 'LEFT').map((p) => ({ id: p.id, name: p.name, hint: p.code || p.department || '' })),
  })), []);
}

export default function AudiencePicker({ kind = 'ALL', ids = [], onChange }) {
  const lists = useAudienceLists();
  const [q, setQ] = useState('');
  const items = useMemo(() => (kind === 'ALL' ? [] : lists.data?.[kind] || []), [kind, lists.data]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? items.filter((x) => `${x.name} ${x.hint || ''}`.toLowerCase().includes(needle)) : items;
  }, [items, q]);
  const set = (nextKind, nextIds) => onChange({ audienceKind: nextKind, audienceIds: nextIds, audience: audienceWords(nextKind, nextIds, nextKind === 'ALL' ? [] : lists.data?.[nextKind] || []) });
  const toggle = (id) => set(kind, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const noun = { DEPARTMENT: 'department', BRANCH: 'branch', LOCATION: 'location', PEOPLE: 'person' }[kind];

  return (
    <fieldset className="sm:col-span-2 space-y-2">
      <legend className="sr-only">Who reads it</legend>
      <PopupSelect showValueSubtext={false} label="Who reads it" value={kind} onChange={(v) => { setQ(''); set(v || 'ALL', []); }} options={AUDIENCE_KINDS} />
      {kind !== 'ALL' ? (
        <>
          {items.length > 12 ? <SearchField value={q} onSearch={(v) => setQ(v || '')} placeholder={`Find a ${noun}`} label={`Find a ${noun}`} className="w-full" /> : null}
          {lists.loading ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : !items.length ? (
            <p className="ui-caption">This company has no {noun === 'branch' ? 'branches' : noun === 'person' ? 'people' : `${noun}s`} set up yet.</p>
          ) : (
            <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label={`Choose ${noun === 'person' ? 'people' : `${noun === 'branch' ? 'branches' : `${noun}s`}`}`}>
              {shown.map((x) => (
                <button key={x.id} type="button" className="ui-choice-chip" aria-pressed={ids.includes(x.id)} onClick={() => toggle(x.id)} title={x.hint || undefined}>{x.name}</button>
              ))}
            </div>
          )}
          <p className="ui-caption">{ids.length ? `Read only by ${audienceWords(kind, ids, items)}, in the employee app and in People.` : `Choose at least one ${noun}.`}</p>
        </>
      ) : <p className="ui-caption">Everyone in the company reads this in the employee app and in People.</p>}
    </fieldset>
  );
}
