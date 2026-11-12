import React, { useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { listAllEmployees } from '@ui/personnel/api';
import useRequest from '@ui/components/ui/useRequest';

/**
 * "Which person?" before an action that lives on a person's record (an
 * offer, a job change, a leaving). A list's primary opens this, the choice
 * opens the record with the action already open, so the screen has a primary
 * that can be completed (People plan 8 Nov 2026, step 3) instead of a note
 * saying where to go.
 *
 * `filter` narrows who may be picked (someone not yet joined for an offer,
 * someone working now for a leaving). `choices` adds a second question, for
 * example which kind of job change.
 */
export default function PickPersonDrawer({ title, description, action = 'Continue', filter = null, choices = null, choiceLabel = 'What', onClose, onPick }) {
  const req = useRequest(() => listAllEmployees({ status: 'CURRENT' }).then((r) => (r?.employees || []).filter((e) => e.status !== 'LEFT' && (!filter || filter(e)))), []);
  const [person, setPerson] = useState('');
  const [choice, setChoice] = useState(choices?.[0]?.[0] || '');
  const people = req.data || [];
  /* No designation or department: no second line (never the record's id in its place). */
  const options = people.map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name, subtext: [p.designation, p.department].filter(Boolean).join(' · ') || undefined }));
  const go = (e) => {
    e?.preventDefault();
    if (!person) return;
    onPick(people.find((p) => p.id === person), choice);
  };
  return (
    <Drawer open onClose={onClose} title={title} description={description} widthClass="w-[min(32rem,96vw)] ui-drawer-sheet"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="pick-person" className="ui-btn ui-btn-primary" disabled={!person}>{action}</button>
      </>}>
      <form id="pick-person" className="grid gap-4" onSubmit={go}>
        {req.loading ? <p className="ui-muted text-sm" aria-busy="true">Loading people…</p>
          : !people.length ? <p className="ui-muted text-sm" role="status">Nobody to choose from yet. Add an employee first.</p>
            : <PopupSelect label="Person" alwaysSearch showValueSubtext={false} value={person} onChange={(v) => setPerson(v || '')} options={options} placeholder="Choose a person" />}
        {choices?.length ? <PopupSelect label={choiceLabel} showValueSubtext={false} value={choice} onChange={(v) => setChoice(v || choices[0][0])} options={choices.map(([k, l]) => ({ value: k, label: l }))} /> : null}
      </form>
    </Drawer>
  );
}
