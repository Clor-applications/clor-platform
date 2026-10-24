import React, { useEffect, useState } from 'react';
import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { getPeopleSettings, savePeopleSettings } from './api';

/**
 * What employees may change about themselves without waiting (CORE-03,
 * decision D-02). By default contact details save at once and the rest —
 * name, address, date of birth, gender, marital status — waits for HR as a
 * request; the company can move that line either way.
 */
export default function SelfServiceSettings() {
  const [settings, setSettings] = useState(null);
  useEffect(() => { getPeopleSettings().then(setSettings).catch((e) => notify.error(String(e?.message || 'Could not load.'))); }, []);
  if (!settings) return <SkeletonCard lines={4} />;
  const choose = async (mode) => {
    try {
      setSettings(await savePeopleSettings({ selfServiceChanges: mode }));
      notify.success('Saved.');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Changes employees make themselves" subtitle="From the employee app, a person can change their own personal details. This says which changes save at once and which wait for HR. Every change is logged either way." />
      <fieldset className="space-y-2" aria-label="Self-service changes">
        {settings.modes.map((m) => (
          <label key={m.key} className="flex items-start gap-3 text-sm">
            <input type="radio" name="selfServiceChanges" className="mt-1" checked={settings.selfServiceChanges === m.key} onChange={() => choose(m.key)} />
            <span>{m.label}{m.key === 'CONTACT_DIRECT' ? <span className="ui-caption block">Contact details: phone, personal email, emergency contact. The rest — name, address, date of birth, gender, marital status — becomes a request HR decides within three days.</span> : null}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
