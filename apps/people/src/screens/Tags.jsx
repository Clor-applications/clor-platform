import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createTag, deleteTag, listTags } from '@ui/personnel/api';

const SWATCHES = ['#E54F38', '#0EA5E9', '#22C55E', '#F59E0B', '#8B5CF6', '#64748B'];

/** Labels for grouping people — Remote, Night shift, Key person. */
export default function Tags() {
  const [tags, setTags] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);

  const load = useCallback(() => listTags().then(setTags).catch((e) => notify.error(String(e?.message || 'Could not load tags.'))), []);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await createTag({ name: name.trim(), color });
      setName('');
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Tag not saved.'));
    }
  };

  const remove = async (t) => {
    const ok = await confirmDialog({ title: `Delete ${t.name}?`, message: 'It comes off everyone who has it.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    await deleteTag(t.id).catch((err) => notify.error(String(err?.message || 'Could not delete.')));
    load();
  };

  if (!tags) return <SkeletonCard lines={4} />;
  return (
    <div className="space-y-6">
      <SettingsScreenHeader entity="settings" title="Tags" description="Labels for grouping people — Remote, Night shift, Key person." />
      <form onSubmit={add} className="ui-card flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="ui-label">New tag</span>
          <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <div role="radiogroup" aria-label="Colour" className="flex gap-1.5 pb-1.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className="h-6 w-6 rounded-full"
              style={{ backgroundColor: c, outline: color === c ? '2px solid rgb(var(--fg))' : 'none', outlineOffset: 2 }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={!name.trim()}>
          <Plus size={16} aria-hidden="true" /> Add
        </button>
      </form>
      {tags.length ? (
        <ul className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t.id} className="ui-pill inline-flex items-center gap-1" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
              {t.name}
              <button type="button" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}>
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No tags yet" description="Add one above, then pick it on an employee's file." />
      )}
    </div>
  );
}
