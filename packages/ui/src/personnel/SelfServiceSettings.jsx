import React, { useState } from 'react';
import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { getPeopleSettings, savePeopleSettings } from './api';

/**
 * What employees may change about themselves without waiting (CORE-03,
 * decision D-02). By default contact details save at once and the rest —
 * name, address, date of birth, gender, marital status — waits for HR as a
 * request; the company can move that line either way.
 */
/** E23: the due time comes from the active profile-change rule, not a fixed promise. */
const daysWords = (n) => {
  const d = Number(n) || 3;
  return `${d} working day${d === 1 ? '' : 's'}`;
};

export default function SelfServiceSettings() {
  const req = useRequest(() => getPeopleSettings(), []);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const settings = saved || req.data;
  if (req.error && !req.data) return <ErrorState error={req.error} onRetry={req.reload} />;
  if (!settings) return <SkeletonCard lines={4} />;
  const choose = async (mode) => {
    if (mode === settings.selfServiceChanges) return;
    setBusy(true);
    try {
      setSaved(await savePeopleSettings({ selfServiceChanges: mode }));
      notify.success('Saved.');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Self-service edits" />
      <fieldset className="space-y-1" disabled={busy}>
        <legend className="ui-t-sec mb-2">When someone changes their own details in the employee app</legend>
        <ul className="divide-y border-t">
          {settings.modes.map((m) => (
            <li key={m.key}>
              <label className="flex items-start gap-3 py-3 text-sm cursor-pointer">
                <input type="radio" name="selfServiceChanges" className="ui-radio mt-0.5" checked={settings.selfServiceChanges === m.key} onChange={() => choose(m.key)} />
                <span>{m.label}{m.key === 'CONTACT_DIRECT' ? <span className="ui-caption block">Phone, personal email and emergency contact save at once. Name, address, date of birth, gender and marital status go to HR, decided within {daysWords(settings.profileDecideDays)}{settings.profileRuleSet ? ', as the profile-change approval rule says' : ''}.</span> : null}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="ui-caption">Every change is logged either way.</p>
    </div>
  );
}
